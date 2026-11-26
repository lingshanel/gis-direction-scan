(function (global) {
    "use strict";

    /**
     * 지도 건물을 차폐 분석용 데이터로 변환하고 결과를 Feature 단위로 캐시합니다.
     * DEM 조회와 GeoJSON 변환은 비용이 크므로 같은 Feature는 다시 계산하지 않으며,
     * 다수 건물은 프레임별로 나눠 처리해 준비 중에도 브라우저 입력을 막지 않습니다.
     */
    function create(options) {
        var cache = new WeakMap();
        var preparedFeatures = [];
        var preparedData = [];
        var preparationPromise = null;
        var preparationVersion = 0;
        var preparingFeatures = [];

        function groundSampleCoordinates(geojson) {
            var coordinates = [];
            var geometry = geojson.geometry;
            var polygons = geometry.type === "Polygon"
                ? [geometry.coordinates]
                : geometry.coordinates;
            var outerVertices = [];

            polygons.forEach(function (rings) {
                var outerRing = rings && rings[0] ? rings[0] : [];
                outerRing.slice(0, Math.max(0, outerRing.length - 1))
                    .forEach(function (coordinate) {
                        outerVertices.push(coordinate);
                    });
            });

            var pointOnBuilding = turf.pointOnFeature(geojson);
            if (pointOnBuilding && pointOnBuilding.geometry) {
                coordinates.push(pointOnBuilding.geometry.coordinates);
            }
            var sampleCount = Math.min(8, outerVertices.length);
            for (var index = 0; index < sampleCount; index++) {
                coordinates.push(outerVertices[
                    Math.floor(index * outerVertices.length / sampleCount)
                ]);
            }
            return coordinates;
        }

        function representativeGround(geojson) {
            var samples = groundSampleCoordinates(geojson).map(function (coordinate) {
                return options.terrainProvider.sample(coordinate);
            }).filter(function (value) {
                return value !== null && Number.isFinite(Number(value));
            }).map(Number).sort(function (left, right) {
                return left - right;
            });
            if (samples.length === 0) return null;
            var middle = Math.floor(samples.length / 2);
            return samples.length % 2
                ? samples[middle]
                : (samples[middle - 1] + samples[middle]) / 2;
        }

        function normalizedHeight(properties) {
            var value = Number(properties && properties.heightMeters);
            return Number.isFinite(value) && value > 0
                ? Math.min(300, Math.max(2, value))
                : 10;
        }

        function sameFeatureList(left, right) {
            return left.length === right.length && left.every(function (feature, index) {
                return feature === right[index];
            });
        }

        function createDatum(feature) {
            if (cache.has(feature)) return cache.get(feature);

            var geojson = options.geojsonFormat.writeFeatureObject(feature, {
                featureProjection: options.map.getView().getProjection(),
                dataProjection: "EPSG:4326"
            });
            var properties = feature.getProperties();
            var groundElevation = representativeGround(geojson);
            var relativeHeight = normalizedHeight(properties);
            var roofElevation = Number.isFinite(groundElevation)
                ? groundElevation + relativeHeight
                : null;
            feature.set("roofElevationMeters", roofElevation, true);
            var datum = {
                feature: feature,
                id: feature.getId(),
                properties: properties,
                geojson: geojson,
                bounds: turf.bbox(geojson),
                groundElevation: groundElevation,
                relativeHeight: relativeHeight,
                roofElevation: roofElevation
            };
            cache.set(feature, datum);
            return datum;
        }

        function get() {
            var features = options.buildingSource.getFeatures();
            if (sameFeatureList(features, preparedFeatures)) return preparedData;
            preparedFeatures = features.slice();
            preparedData = features.map(createDatum);
            return preparedData;
        }

        function prepare() {
            var features = options.buildingSource.getFeatures();
            if (sameFeatureList(features, preparedFeatures)) {
                return Promise.resolve(preparedData);
            }
            if (preparationPromise !== null &&
                    sameFeatureList(features, preparingFeatures)) {
                return preparationPromise;
            }
            if (preparationPromise !== null) {
                preparationVersion++;
                preparationPromise = null;
            }

            var version = ++preparationVersion;
            var data = new Array(features.length);
            var index = 0;
            var startedAt = global.performance.now();
            var activeWorkMs = 0;
            var frameCount = 0;
            preparingFeatures = features.slice();
            if (typeof options.onPreparationStart === "function") {
                options.onPreparationStart();
            }

            preparationPromise = new Promise(function (resolve) {
                function prepareChunk() {
                    if (version !== preparationVersion) {
                        resolve(null);
                        return;
                    }
                    var frameStartedAt = global.performance.now();
                    var firstIndex = index;
                    while (index < features.length &&
                            (index === firstIndex ||
                            global.performance.now() - frameStartedAt < 7)) {
                        data[index] = createDatum(features[index]);
                        index++;
                    }
                    activeWorkMs += global.performance.now() - frameStartedAt;
                    frameCount++;
                    if (index < features.length) {
                        global.requestAnimationFrame(prepareChunk);
                        return;
                    }
                    preparedFeatures = features.slice();
                    preparedData = data;
                    if (typeof options.onPerformance === "function") {
                        options.onPerformance("건물 DEM·옥상고도 전처리", startedAt, {
                            activeWorkMs: Number(activeWorkMs.toFixed(1)),
                            frameCount: frameCount,
                            buildingCount: features.length
                        });
                    }
                    resolve(data);
                }
                global.requestAnimationFrame(prepareChunk);
            }).then(function (data) {
                if (version === preparationVersion) {
                    preparationPromise = null;
                    preparingFeatures = [];
                }
                return data;
            });
            return preparationPromise;
        }

        return {
            get: get,
            isPreparing: function () { return preparationPromise !== null; },
            prepare: prepare
        };
    }

    global.GisScanBuildingData = {
        create: create
    };
})(window);
