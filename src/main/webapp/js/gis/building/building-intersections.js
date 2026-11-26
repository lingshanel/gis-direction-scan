(function (global) {
    "use strict";

    /**
     * 건물 footprint를 방위각 버킷에 미리 나눠 Ray와 교차할 후보를 줄입니다.
     * 생성된 인덱스의 findHits()는 elevation-viewshed가 호출하며, 첫 차폐점만 필요한
     * 전체 스캔과 모든 교차 건물이 필요한 방향 상세 분석을 같은 인덱스로 지원합니다.
     */
    var BUCKET_COUNT = 360;
    var geoMath = global.GisGeoMath;

    function finite(value) {
        return value != null && isFinite(Number(value));
    }

    function boundsIntersect(left, right) {
        return left[0] <= right[2] && left[2] >= right[0] &&
            left[1] <= right[3] && left[3] >= right[1];
    }

    // 건물 bbox를 모두 포함하는 원으로 관측점에서 건물까지의 최소 가능
    // 거리를 구합니다. 실제 건물까지의 거리보다 작거나 같은 값만 사용해야
    // 이후 후보를 결과 변화 없이 생략할 수 있습니다.
    function minimumPossibleDistance(origin, bounds) {
        if (!Array.isArray(bounds) || bounds.length !== 4) return 0;
        var center = [
            (Number(bounds[0]) + Number(bounds[2])) / 2,
            (Number(bounds[1]) + Number(bounds[3])) / 2
        ];
        if (!center.every(isFinite)) return 0;
        // bbox 전체 대각선을 반경으로 사용하면 실제 필요한 반경보다 넉넉해
        // 하한값은 다소 작아지지만, 건물마다 거리 계산을 두 번으로 제한하면서
        // 조기 종료의 안전성은 유지할 수 있습니다.
        var coveringRadius = geoMath.distanceMeters(
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]]
        );
        // 좌표 및 부동소수점 오차 때문에 조기 종료가 앞당겨지지 않도록
        // 포함 반경을 조금 더 크게 잡습니다.
        coveringRadius += 0.5;
        return Math.max(
            0,
            geoMath.distanceMeters(origin, center) - coveringRadius
        );
    }

    function geometryCoordinates(geometry) {
        var coordinates = [];
        if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
            return coordinates;
        }
        var polygons = geometry.type === "Polygon"
            ? [geometry.coordinates]
            : geometry.coordinates;
        polygons.forEach(function (rings) {
            rings.forEach(function (ring) {
                ring.forEach(function (coordinate) {
                    coordinates.push(coordinate);
                });
            });
        });
        return coordinates;
    }

    // 0/360도 경계를 포함해 건물이 차지하는 가장 짧은 원형 방위각 구간을 구합니다.
    function angularSpan(origin, building) {
        var bearings = geometryCoordinates(building.geojson.geometry).map(function (coordinate) {
            return geoMath.normalizeBearing(
                geoMath.bearingDegrees(origin, coordinate)
            );
        }).sort(function (left, right) { return left - right; });
        if (bearings.length === 0) return null;
        if (bearings.length === 1) return { start: bearings[0], end: bearings[0] };

        var largestGap = -1;
        var gapIndex = 0;
        for (var i = 0; i < bearings.length; i++) {
            var next = i + 1 < bearings.length ? bearings[i + 1] : bearings[0] + 360;
            var gap = next - bearings[i];
            if (gap > largestGap) {
                largestGap = gap;
                gapIndex = i;
            }
        }
        var startIndex = (gapIndex + 1) % bearings.length;
        var start = bearings[startIndex];
        var end = bearings[gapIndex];
        if (end < start) end += 360;
        return { start: start, end: end };
    }

    function addToBuckets(buckets, building, span) {
        if (!span) return;
        var first = Math.floor(span.start);
        var last = Math.floor(span.end + 1e-9);
        for (var degree = first; degree <= last; degree++) {
            var bucket = buckets[((degree % BUCKET_COUNT) + BUCKET_COUNT) % BUCKET_COUNT];
            if (bucket.indexOf(building) === -1) bucket.push(building);
        }
    }

    function intersectBuildings(origin, bearing, radius, buildings, settings) {
        var endCoordinate = geoMath.destination(origin, radius, bearing);
        var ray = turf.lineString([origin, endCoordinate]);
        var rayBounds = turf.bbox(ray);
        var hits = [];
        var stopAtFirstBlocker = settings && settings.stopAtFirstBlocker;
        var eyeElevation = settings ? settings.eyeElevation : null;
        var minimumDistances = settings ? settings.minimumDistances : null;
        var nearestKnownBlocker = null;

        for (var buildingIndex = 0; buildingIndex < buildings.length; buildingIndex++) {
            var building = buildings[buildingIndex];
            var minimumDistance = minimumDistances && minimumDistances.has(building)
                ? minimumDistances.get(building)
                : 0;
            if (stopAtFirstBlocker && nearestKnownBlocker !== null &&
                    minimumDistance > nearestKnownBlocker + 0.05) {
                break;
            }
            if (building.bounds && !boundsIntersect(rayBounds, building.bounds)) continue;

            var intersections = turf.lineIntersect(ray, building.geojson);
            var nearestDistance = null;
            var farthestDistance = null;

            intersections.features.forEach(function (point) {
                var distance = geoMath.distanceMeters(
                    origin,
                    point.geometry.coordinates
                );
                if (distance <= radius + 0.001) {
                    if (nearestDistance === null || distance < nearestDistance) nearestDistance = distance;
                    if (farthestDistance === null || distance > farthestDistance) farthestDistance = distance;
                }
            });

            if (nearestDistance !== null) {
                hits.push({
                    feature: building.feature,
                    id: building.feature.getId(),
                    distance: nearestDistance,
                    exitDistance: farthestDistance === null ? nearestDistance : farthestDistance,
                    groundElevation: building.groundElevation,
                    relativeHeight: building.relativeHeight,
                    roofElevation: building.roofElevation,
                    properties: building.properties || building.geojson.properties || {}
                });
                if (stopAtFirstBlocker && finite(eyeElevation) &&
                        finite(building.roofElevation) &&
                        Number(building.roofElevation) + 1e-9 >= Number(eyeElevation) &&
                        (nearestKnownBlocker === null ||
                            nearestDistance < nearestKnownBlocker)) {
                    nearestKnownBlocker = nearestDistance;
                }
            }
        }

        hits.sort(function (left, right) {
            return left.distance - right.distance;
        });
        return hits;
    }

    function sortBuckets(buckets, minimumDistances) {
        buckets.forEach(function (bucket) {
            bucket.sort(function (left, right) {
                return minimumDistances.get(left) - minimumDistances.get(right);
            });
        });
    }

    function createIndexResult(origin, radius, allBuckets, blockerBuckets, candidateCount,
            minimumDistances, eyeElevation) {
        function findHits(bearing, includeAllBuildings) {
            var normalized = geoMath.normalizeBearing(bearing);
            var bucketIndex = Math.floor(normalized) % BUCKET_COUNT;
            var buckets = includeAllBuildings ? allBuckets : blockerBuckets;
            return intersectBuildings(
                origin,
                normalized,
                radius,
                buckets[bucketIndex],
                includeAllBuildings ? null : {
                    stopAtFirstBlocker: true,
                    eyeElevation: eyeElevation,
                    minimumDistances: minimumDistances
                }
            );
        }

        function findBlockingHits(bearing) {
            var normalized = geoMath.normalizeBearing(bearing);
            var bucketIndex = Math.floor(normalized) % BUCKET_COUNT;
            // 가시영역 경계는 첫 차폐물만 필요하지만, 건물 강조에는 그 뒤에 있는
            // 모든 높이 조건 충족 건물이 필요하므로 같은 후보 버킷을 끝까지 조회합니다.
            return intersectBuildings(
                origin,
                normalized,
                radius,
                blockerBuckets[bucketIndex],
                null
            );
        }

        return {
            candidateCount: candidateCount,
            findHits: findHits,
            findBlockingHits: findBlockingHits
        };
    }

    function createIndexAsync(origin, radius, buildingData, eyeElevation, isCancelled) {
        var allBuckets = Array.from({ length: BUCKET_COUNT }, function () { return []; });
        var blockerBuckets = Array.from({ length: BUCKET_COUNT }, function () { return []; });
        var candidateCount = 0;
        var buildings = buildingData || [];
        var minimumDistances = new Map();
        var index = 0;

        return new Promise(function (resolve) {
            function createChunk() {
                if (typeof isCancelled === "function" && isCancelled()) {
                    resolve(null);
                    return;
                }
                var startedAt = performance.now();
                var firstIndex = index;
                while (index < buildings.length &&
                        (index === firstIndex || performance.now() - startedAt < 7)) {
                    var building = buildings[index++];
                    minimumDistances.set(
                        building,
                        minimumPossibleDistance(origin, building.bounds)
                    );
                    var span = angularSpan(origin, building);
                    addToBuckets(allBuckets, building, span);

                    // 값이 확실한 경우에만 관측자보다 낮은 건물을 제외합니다.
                    // DEM 또는 높이가 불확실한 건물은 누락 방지를 위해 후보로 유지합니다.
                    var canBlock = !finite(eyeElevation) ||
                        !finite(building.roofElevation) ||
                        Number(building.roofElevation) + 1e-9 >= Number(eyeElevation);
                    if (canBlock) {
                        candidateCount++;
                        addToBuckets(blockerBuckets, building, span);
                    }
                }
                if (index < buildings.length) {
                    global.requestAnimationFrame(createChunk);
                    return;
                }
                sortBuckets(blockerBuckets, minimumDistances);
                resolve(createIndexResult(
                    origin,
                    radius,
                    allBuckets,
                    blockerBuckets,
                    candidateCount,
                    minimumDistances,
                    eyeElevation
                ));
            }
            global.requestAnimationFrame(createChunk);
        });
    }

    function findContaining(origin, buildingData) {
        var point = turf.point(origin);
        return buildingData.filter(function (building) {
            return turf.booleanPointInPolygon(point, building.geojson);
        });
    }

    global.GisBuildingIntersections = {
        createIndexAsync: createIndexAsync,
        findContaining: findContaining
    };
})(window);
