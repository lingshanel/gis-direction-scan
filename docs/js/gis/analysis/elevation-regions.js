(function (global) {
    "use strict";

    /**
     * 360개 Ray의 거리 구간을 지도에 그릴 GeoJSON 면으로 변환합니다.
     * 2D 완료 화면은 buildCompactGeoJson(), 3D 스캔 진행 화면은 방위각별 공개가
     * 필요하므로 buildAnimatedGeoJson()을 사용합니다. 두 출력은 같은 분석 결과에서
     * 만들어져 2D와 3D의 판정이 달라지지 않습니다.
     */

    function appendCoordinate(ring, coordinate) {
        var previous = ring.length ? ring[ring.length - 1] : null;
        if (previous && Math.abs(previous[0] - coordinate[0]) < 1e-12 &&
                Math.abs(previous[1] - coordinate[1]) < 1e-12) {
            return;
        }
        ring.push(coordinate);
    }

    function coordinateAt(origin, distance, bearing) {
        return turf.destination(origin, Math.max(0, distance), bearing, {
            units: "meters"
        }).geometry.coordinates;
    }

    function compactRunFeature(origin, state, run, totalRayCount) {
        var ring = [];
        run.forEach(function (item) {
            appendCoordinate(ring, coordinateAt(
                origin, item.segment.end, item.ray.bearing
            ));
            appendCoordinate(ring, coordinateAt(
                origin, item.segment.end, item.ray.endBearing
            ));
        });

        var fullCircle = run.length === totalRayCount;
        var startsAtOrigin = run.every(function (item) {
            return item.segment.start <= 0.05;
        });
        if (!fullCircle || !startsAtOrigin) {
            if (startsAtOrigin) {
                appendCoordinate(ring, origin.slice());
            } else {
                for (var i = run.length - 1; i >= 0; i--) {
                    appendCoordinate(ring, coordinateAt(
                        origin, run[i].segment.start, run[i].ray.endBearing
                    ));
                    appendCoordinate(ring, coordinateAt(
                        origin, run[i].segment.start, run[i].ray.bearing
                    ));
                }
            }
        }
        appendCoordinate(ring, ring[0].slice());

        return {
            type: "Feature",
            properties: {
                visibilityState: state,
                revealBearing: run[0].ray.bearing
            },
            geometry: {
                type: "Polygon",
                coordinates: [ring]
            }
        };
    }

    function compactStateFeatures(origin, rays, state, totalRayCount) {
        var runs = [];
        var currentRun = [];

        function flushRun() {
            if (currentRun.length === 0) return;
            runs.push(currentRun);
            currentRun = [];
        }

        rays.forEach(function (ray) {
            var segment = ray.segments.find(function (candidate) {
                return candidate.state === state;
            });
            if (segment) {
                currentRun.push({ ray: ray, segment: segment });
            } else {
                flushRun();
            }
        });
        flushRun();

        return runs.map(function (run) {
            return compactRunFeature(
                origin,
                state,
                run,
                totalRayCount || rays.length
            );
        });
    }

    function buildAnimatedGeoJson(origin, elevationResult, chunkDegrees) {
        var rays = elevationResult.rays || [];
        var step = Math.max(1, Number(chunkDegrees) || 5);
        var chunks = [];
        var currentChunk = [];
        var chunkStart = null;

        function flushChunk() {
            if (currentChunk.length === 0) return;
            chunks.push(currentChunk);
            currentChunk = [];
            chunkStart = null;
        }

        rays.forEach(function (ray) {
            if (chunkStart === null) chunkStart = ray.bearing;
            if (currentChunk.length && ray.bearing >= chunkStart + step) {
                flushChunk();
                chunkStart = ray.bearing;
            }
            currentChunk.push(ray);
        });
        flushChunk();

        var features = [];
        chunks.forEach(function (chunk) {
            ["visible", "blocked", "nodata"].forEach(function (state) {
                features = features.concat(compactStateFeatures(
                    origin,
                    chunk,
                    state,
                    rays.length
                ));
            });
        });
        return {
            type: "FeatureCollection",
            features: features
        };
    }

    function buildCompactGeoJson(origin, elevationResult) {
        var rays = elevationResult.rays || [];
        var features = [];
        ["visible", "blocked", "nodata"].forEach(function (state) {
            features = features.concat(compactStateFeatures(
                origin,
                rays,
                state,
                rays.length
            ));
        });
        return {
            type: "FeatureCollection",
            features: features
        };
    }

    function distributionFromResult(elevationResult) {
        var weights = { visible: 0, blocked: 0, nodata: 0 };
        (elevationResult.rays || []).forEach(function (ray) {
            var angularWidth = Math.max(0, ray.endBearing - ray.bearing);
            ray.segments.forEach(function (segment) {
                var radialArea = Math.max(0,
                    segment.end * segment.end - segment.start * segment.start
                );
                weights[segment.state] += radialArea * angularWidth;
            });
        });

        var total = weights.visible + weights.blocked + weights.nodata || 1;
        return {
            visible: weights.visible / total * 100,
            blocked: weights.blocked / total * 100,
            nodata: weights.nodata / total * 100
        };
    }

    function summarizeResult(elevationResult, observerGround, observerHeight) {
        var result = distributionFromResult(elevationResult);
        return "절대고도 분석 완료 · 관측 가능 " + result.visible.toFixed(1) +
            "% / 관측 불가 " + result.blocked.toFixed(1) +
            "% / 고도 데이터 없음 " + result.nodata.toFixed(1) +
            "% / 관측점 지면 " + observerGround.toFixed(1) + "m · 관측자 +" +
            observerHeight.toFixed(1) + "m";
    }

    global.GisElevationRegions = {
        buildAnimatedGeoJson: buildAnimatedGeoJson,
        buildCompactGeoJson: buildCompactGeoJson,
        distributionFromResult: distributionFromResult,
        summarizeResult: summarizeResult
    };
})(window);
