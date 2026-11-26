(function (global) {
    "use strict";

    var LANDCOVER_STYLES = {
        residential: { color: "#e7e3dc", alpha: 0.74, zIndex: 10 },
        commercial: { color: "#ead8c5", alpha: 0.76, zIndex: 11 },
        industrial: { color: "#d5d3d0", alpha: 0.76, zIndex: 12 },
        farmland: { color: "#ddd4a8", alpha: 0.74, zIndex: 13 },
        bare: { color: "#d8cab7", alpha: 0.72, zIndex: 14 },
        construction: { color: "#dbc0ac", alpha: 0.74, zIndex: 15 },
        scrub: { color: "#a8bd93", alpha: 0.76, zIndex: 16 },
        grass: { color: "#c9ddb2", alpha: 0.76, zIndex: 17 },
        forest: { color: "#8fb493", alpha: 0.82, zIndex: 18 },
        cemetery: { color: "#bac8ad", alpha: 0.76, zIndex: 19 },
        park: { color: "#b8d4a5", alpha: 0.8, zIndex: 20 },
        wetland: { color: "#a6c8c2", alpha: 0.8, zIndex: 21 }
    };
    var DEFAULT_LANDCOVER_STYLE = {
        color: "#e4e0d8",
        alpha: 0.68,
        zIndex: 9
    };
    var ROAD_STYLES = {
        motorway: { width: 5.4, color: "#f4d49b", outline: "#b59a70" },
        motorway_link: { width: 3.6, color: "#f4d49b", outline: "#b59a70" },
        trunk: { width: 5.0, color: "#f0dfbc", outline: "#aa9a7e" },
        trunk_link: { width: 3.4, color: "#f0dfbc", outline: "#aa9a7e" },
        primary: { width: 4.4, color: "#f7efe0", outline: "#b3aa9d" },
        primary_link: { width: 3.2, color: "#f7efe0", outline: "#b3aa9d" },
        secondary: { width: 3.6, color: "#faf7f0", outline: "#bbb6ad" },
        secondary_link: { width: 2.8, color: "#faf7f0", outline: "#bbb6ad" },
        tertiary: { width: 2.8, color: "#fdfbf7", outline: "#c4c0ba" },
        tertiary_link: { width: 2.2, color: "#fdfbf7", outline: "#c4c0ba" }
    };
    var DEFAULT_ROAD_STYLE = {
        width: 2.4,
        color: "#fdfbf7",
        outline: "#c4c0ba"
    };

    function isFeatureCollection(value) {
        return value && value.type === "FeatureCollection" &&
            Array.isArray(value.features);
    }

    function fetchThematicMap(options) {
        var params = new URLSearchParams({
            lat: Number(options.center[1]).toFixed(6),
            lon: Number(options.center[0]).toFixed(6),
            radius: String(Math.round(options.radius))
        });
        return GisJsonApi.fetch({
            url: options.endpoint + "?" + params,
            signal: options.signal,
            label: "주제지도",
            invalidMessage: "주제지도 데이터 구조가 올바르지 않습니다.",
            validate: function (data) {
                return data.type === "ThematicMap" &&
                    isFeatureCollection(data.landcover) &&
                    isFeatureCollection(data.water) &&
                    isFeatureCollection(data.roads);
            }
        });
    }

    function propertyValues(entity, time) {
        return entity.properties
            ? entity.properties.getValue(time) || {}
            : {};
    }

    function tagIsEnabled(value) {
        var normalized = String(value || "").toLowerCase();
        return normalized === "yes" || normalized === "true" || normalized === "1";
    }

    function styleLandcover(dataSource) {
        var time = Cesium.JulianDate.now();
        dataSource.entities.values.forEach(function (entity) {
            if (!entity.polygon) return;
            var properties = propertyValues(entity, time);
            var style = LANDCOVER_STYLES[properties.landcoverType] ||
                DEFAULT_LANDCOVER_STYLE;
            entity.polygon.material = Cesium.Color.fromCssColorString(style.color)
                .withAlpha(style.alpha);
            entity.polygon.outline = false;
            entity.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
            entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN;
            entity.polygon.zIndex = style.zIndex;
        });
    }

    function styleWater(dataSource) {
        dataSource.entities.values.forEach(function (entity) {
            if (!entity.polygon) return;
            entity.polygon.material = Cesium.Color.fromCssColorString(
                global.GisVisualTheme.colors.water
            ).withAlpha(0.88);
            entity.polygon.outline = false;
            entity.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
            entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN;
            entity.polygon.zIndex = 30;
        });
    }

    function styleRoads(dataSource) {
        var time = Cesium.JulianDate.now();
        dataSource.entities.values.forEach(function (entity) {
            if (!entity.polyline) return;
            var properties = propertyValues(entity, time);
            var style = ROAD_STYLES[properties.roadType] || DEFAULT_ROAD_STYLE;
            var alpha = tagIsEnabled(properties.tunnel) ? 0.48 : 0.94;
            entity.polyline.width = style.width;
            entity.polyline.clampToGround = true;
            entity.polyline.classificationType = Cesium.ClassificationType.TERRAIN;
            entity.polyline.zIndex = 40;
            entity.polyline.material = new Cesium.PolylineOutlineMaterialProperty({
                color: Cesium.Color.fromCssColorString(style.color).withAlpha(alpha),
                outlineColor: Cesium.Color.fromCssColorString(style.outline)
                    .withAlpha(alpha * 0.72),
                outlineWidth: 1
            });
        });
    }

    function create(viewer, options) {
        var currentDataSources = [];
        var requestController = null;
        var requestVersion = 0;
        var currentKey = null;
        var currentData = null;
        var currentCoverage = null;
        var cache = new Map();
        var pendingKey = null;
        var pendingPromise = null;

        function cacheKey(center, radius) {
            return Number(center[0]).toFixed(4) + ":" +
                Number(center[1]).toFixed(4) + ":" + Math.round(radius);
        }

        function remember(key, data) {
            cache.set(key, data);
            if (cache.size <= 4) return;
            cache.delete(cache.keys().next().value);
        }

        function removeDataSources(dataSources) {
            dataSources.forEach(function (dataSource) {
                viewer.dataSources.remove(dataSource, true);
            });
        }

        function covers(center, radius) {
            if (currentCoverage === null || currentDataSources.length === 0) return false;
            var distance = turf.distance(
                currentCoverage.center,
                center,
                { units: "meters" }
            );
            return distance + Math.max(0, Number(radius) || 0) + 250 <=
                currentCoverage.radius;
        }

        function loadDataSource(featureCollection, style) {
            return Cesium.GeoJsonDataSource.load(featureCollection, {
                clampToGround: true
            }).then(function (dataSource) {
                style(dataSource);
                return dataSource;
            });
        }

        function replace(data, version, key, coverageCenter, coverageRadius) {
            return Promise.all([
                loadDataSource(data.landcover, styleLandcover),
                loadDataSource(data.water, styleWater),
                loadDataSource(data.roads, styleRoads)
            ]).then(function (nextDataSources) {
                if (version !== requestVersion) {
                    nextDataSources.forEach(function (dataSource) {
                        if (!dataSource.isDestroyed || !dataSource.isDestroyed()) {
                            dataSource.entities.removeAll();
                        }
                    });
                    return null;
                }

                var added = [];
                return nextDataSources.reduce(function (promise, dataSource) {
                    return promise.then(function () {
                        return Promise.resolve(viewer.dataSources.add(dataSource))
                            .then(function () { added.push(dataSource); });
                    });
                }, Promise.resolve()).then(function () {
                    if (version !== requestVersion) {
                        removeDataSources(added);
                        return null;
                    }
                    var previous = currentDataSources;
                    currentDataSources = added;
                    currentKey = key;
                    currentData = data;
                    currentCoverage = {
                        center: coverageCenter.slice(),
                        radius: coverageRadius
                    };
                    removeDataSources(previous);
                    viewer.scene.requestRender();
                    return data;
                }).catch(function (error) {
                    removeDataSources(added);
                    throw error;
                });
            });
        }

        function load(center, radius, requiredRadius) {
            var targetRadius = Math.max(1000, Math.min(3000, Math.round(radius)));
            var key = cacheKey(center, targetRadius);
            if (key === currentKey && currentDataSources.length > 0) {
                return Promise.resolve(currentData);
            }
            if (key === pendingKey && pendingPromise !== null) {
                return pendingPromise;
            }

            if (covers(center, requiredRadius)) {
                requestVersion += 1;
                if (requestController !== null) requestController.abort();
                requestController = null;
                pendingKey = null;
                pendingPromise = null;
                return Promise.resolve(currentData);
            }

            var version = ++requestVersion;
            if (requestController !== null) requestController.abort();
            requestController = typeof AbortController === "function"
                ? new AbortController()
                : null;

            var cached = cache.get(key);
            var request = cached
                ? Promise.resolve(cached)
                : fetchThematicMap({
                    endpoint: options.endpoint,
                    center: center,
                    radius: targetRadius,
                    signal: requestController ? requestController.signal : undefined
                }).then(function (data) {
                    remember(key, data);
                    return data;
                });

            pendingKey = key;
            pendingPromise = request.then(function (data) {
                if (version !== requestVersion) return null;
                return replace(data, version, key, center, targetRadius);
            }).catch(function (error) {
                if (error && error.name === "AbortError") return null;
                console.warn("3D 주제지도를 불러오지 못해 기본 지도를 유지합니다.", error);
                return null;
            }).finally(function () {
                if (version === requestVersion) {
                    requestController = null;
                    pendingKey = null;
                    pendingPromise = null;
                }
            });
            return pendingPromise;
        }

        return {
            load: load
        };
    }

    global.GisCesiumThematicMap = {
        create: create
    };
})(window);
