(function (global) {
    "use strict";

    /**
     * 한 방향의 건물·지형 차폐를 판정하고, 이를 360개의 1도 구간으로 확장합니다.
     * scan-controller는 analyzeAsync()로 전체 결과를 먼저 계산하고, 이후 스캔
     * 애니메이션에서는 이 결과를 다시 계산하지 않고 순서대로 공개합니다.
     * direction-review는 analyzeRay()를 재사용해 사용자가 고른 한 방향만 상세 분석합니다.
     */
    var geoMath = global.GisGeoMath;

    function finite(value) {
        return value != null && isFinite(Number(value));
    }
    function normalizeHeight(properties) {
        var value = Number(properties && properties.heightMeters);
        return finite(value) && value > 0 ? Math.min(300, Math.max(2, value)) : 10;
    }
    function continuousSegments(cutoff, radius, noData) {// 분석결과 : cutoff 가 처음으로 관측자 높이 이상의 건물을 만나는 거리
        if (noData) return [{ start: 0, end: radius, state: "nodata" }];
        cutoff = Math.max(0, Math.min(radius, cutoff));
        if (cutoff >= radius - 0.05) return [{ start: 0, end: radius, state: "visible" }];
        if (cutoff <= 0.05) return [{ start: 0, end: radius, state: "blocked" }];
        return [
            { start: 0, end: cutoff, state: "visible" },
            { start: cutoff, end: radius, state: "blocked" }
        ];
    }

    function appendTerrainProfile(profile, options) {
        var validSamples = 0;
        var step = options.step || 10;
        var startDistance = options.startDistance == null
            ? Math.max(2, step)
            : Math.max(2, Number(options.startDistance));
        for (var distance = startDistance;
                distance <= options.radius + 1e-9; distance += step) {
            var sampleDistance = Math.min(distance, options.radius);
            var elevation = options.sample(geoMath.destination(
                options.origin,
                sampleDistance,
                options.bearing
            ));
            if (!finite(elevation)) continue;
            validSamples++;
            profile.push({
                distance: sampleDistance,
                elevation: Number(elevation),
                terrain: true
            });
        }
        profile.sort(function (a, b) {
            if (a.distance !== b.distance) return a.distance - b.distance;
            return a.building ? 1 : -1;
        });
        return validSamples;
    }

    function ensureTerrainProfile(ray, options) {
        if (!ray || ray.terrainSampled) return 0;
        var validSamples = 0;
        var cachedSamples = Array.isArray(ray.terrainSamples)
            ? ray.terrainSamples
            : [];
        for (var index = 0; index + 1 < cachedSamples.length; index += 2) {
            ray.profile.push({
                distance: cachedSamples[index],
                elevation: cachedSamples[index + 1],
                terrain: true
            });
            validSamples++;
        }
        ray.terrainSamples = [];
        var step = options.step || 10;
        var nextDistance = ray.terrainSampledThrough > 0
            ? ray.terrainSampledThrough + step
            : Math.max(2, step);
        var added = appendTerrainProfile(ray.profile, {
            origin: options.origin,
            bearing: ray.sampleBearing == null ? ray.bearing : ray.sampleBearing,
            radius: options.radius,
            step: step,
            sample: options.sample,
            startDistance: nextDistance
        });
        ray.sampleCount += validSamples + added;
        ray.terrainSampled = true;
        return validSamples + added;
    }

    function findTerrainCutoff(options, eyeElevation, maximumDistance, samples) {
        var step = options.step || 10;
        var sampledThrough = 0;
        for (var distance = Math.max(2, step);
                distance < maximumDistance - 0.05; distance += step) {
            var sampleDistance = Math.min(distance, options.radius);
            var elevation = options.sample(geoMath.destination(
                options.origin,
                sampleDistance,
                options.bearing
            ));
            sampledThrough = sampleDistance;
            if (!finite(elevation)) continue;
            var normalizedElevation = Number(elevation);
            samples.push(sampleDistance, normalizedElevation);
            if (normalizedElevation + 1e-9 >= eyeElevation) {
                return {
                    cutoff: sampleDistance,
                    sampledThrough: sampledThrough
                };
            }
        }
        return {
            cutoff: maximumDistance,
            sampledThrough: sampledThrough
        };
    }

    function analyzeRay(options) {
        var origin = options.origin;
        var bearing = geoMath.normalizeBearing(options.bearing);
        var radius = options.radius;
        var sample = options.sample;
        var step = options.step || 10;
        var collectAllHits = options.collectAllHits !== false;
        var collectAllBlockingHits = options.collectAllBlockingHits === true;
        var observerGround = finite(options.observerGround)
            ? Number(options.observerGround)
            : sample(origin);
        observerGround = finite(observerGround) ? Number(observerGround) : 0;
        var observerHeight = Math.max(0, Number(options.observerHeight) || 1.6);
        var eye = observerGround + observerHeight;
        var cutoff = radius;
        var cause = "clear";
        var profile = [{ distance: 0, elevation: observerGround, eye: eye, observer: true }];
        var hits = collectAllBlockingHits && typeof options.findBlockingHits === "function"
            ? options.findBlockingHits(bearing)
            : options.findHits(bearing, collectAllHits);
        var blockingHits = [];
        var blockingHit = null;

        // 관측점과 건물 모두 DEM 기준 절대고도로 환산합니다.
        // 관측점에서 가까운 순서로 검사하여 관측자 해발고도 이상인 첫 건물의 진입점이
        // 초록색 가시영역의 끝이 되고, 그 지점부터 검색 원까지는 빨간색 차폐영역입니다.
        // 관측자보다 옥상 절대고도가 낮은 건물은 통과하여 그 뒤의 건물을 계속 검사합니다.
        for (var h = 0; h < hits.length; h++) {
            var hit = hits[h];
            var relativeHeight = finite(hit.relativeHeight)
                ? Number(hit.relativeHeight)
                : normalizeHeight(hit.properties || {});
            // 한 건물의 모든 교차 광선은 동일한 대표 DEM 고도를 사용합니다.
            // 광선 진입점마다 30m DEM 픽셀이 달라져 한 건물이 부분 차폐되는 것을 막습니다.
            var hitGround = finite(hit.groundElevation)
                ? Number(hit.groundElevation)
                : sample(geoMath.destination(
                    origin,
                    Math.max(0.2, hit.distance),
                    bearing
                ));
            var base = finite(hitGround) ? Number(hitGround) : observerGround;
            var roof = base + relativeHeight;
            profile.push({
                distance: hit.distance,
                elevation: base,
                roof: roof,
                relativeHeight: relativeHeight,
                roofSource: "building-height",
                building: true,
                buildingId: hit.id || "",
                name: hit.properties && hit.properties.name ? hit.properties.name : ""
            });
            if (roof + 1e-9 >= eye) {
                blockingHits.push(hit);
                if (cutoff >= radius - 0.05) {
                    cutoff = hit.distance;
                    cause = "building";
                    blockingHit = hit;
                    if (!collectAllHits && !collectAllBlockingHits) break;
                }
            }
        }

        var terrainSamples = [];
        var terrainResult = findTerrainCutoff({
            origin: origin,
            bearing: bearing,
            step: step,
            radius: radius,
            sample: sample
        }, eye, cutoff, terrainSamples);
        var terrainCutoff = terrainResult.cutoff;
        if (terrainCutoff < cutoff - 0.05) {
            cutoff = terrainCutoff;
            cause = "terrain";
            if (!collectAllHits) blockingHit = null;
        }

        var terrainSampled = options.includeTerrainProfile !== false;
        var validSamples = 0;
        if (terrainSampled) {
            for (var sampleIndex = 0;
                    sampleIndex + 1 < terrainSamples.length;
                    sampleIndex += 2) {
                profile.push({
                    distance: terrainSamples[sampleIndex],
                    elevation: terrainSamples[sampleIndex + 1],
                    terrain: true
                });
                validSamples++;
            }
            validSamples += appendTerrainProfile(profile, {
                origin: origin,
                bearing: bearing,
                radius: radius,
                step: step,
                sample: sample,
                startDistance: terrainResult.sampledThrough > 0
                    ? terrainResult.sampledThrough + step
                    : Math.max(2, step)
            });
            terrainSamples = [];
        }
        return {
            bearing: bearing,
            segments: continuousSegments(cutoff, radius, false),
            profile: profile,
            // 영역 경계는 가장 가까운 차폐물로 결정하지만, 스캔 강조는 같은 방향의
            // 높이 조건을 충족하는 건물을 모두 사용해야 관측자 높이에 따른 역전이 없습니다.
            hits: collectAllHits
                ? hits
                : (collectAllBlockingHits ? blockingHits : (blockingHit ? [blockingHit] : [])),
            cutoff: cutoff,
            cause: cause,
            sampleCount: validSamples,
            terrainSampled: terrainSampled,
            terrainSamples: terrainSamples,
            terrainSampledThrough: terrainResult.sampledThrough,
            observerGround: observerGround,
            eyeElevation: eye,
            hitCount: collectAllHits
                ? hits.length
                : (collectAllBlockingHits ? blockingHits.length : (blockingHit ? 1 : 0)),
            observerRelativeHeight: observerHeight
        };
    }

    function analyzeAsync(options, isCancelled) {
        var observerGround = finite(options.observerGround)
            ? Number(options.observerGround)
            : options.sample(options.origin);
        observerGround = finite(observerGround) ? Number(observerGround) : 0;
        var sampleCount = 0;
        var rays = new Array(360);
        var degree = 0;

        return new Promise(function (resolve) {
            function analyzeChunk() {
                if (typeof isCancelled === "function" && isCancelled()) {
                    resolve(null);
                    return;
                }
                var startedAt = performance.now();
                var firstDegree = degree;
                while (degree < 360 &&
                        (degree === firstDegree || performance.now() - startedAt < 7)) {
                    var start = degree;
                    var end = degree + 1;
                    var sampleBearing = start + 0.5;
                    var result = analyzeRay({
                        origin: options.origin,
                        bearing: sampleBearing,
                        radius: options.radius,
                        sample: options.sample,
                        observerGround: observerGround,
                        step: options.step,
                        observerHeight: options.observerHeight,
                        collectAllHits: false,
                        collectAllBlockingHits: true,
                        includeTerrainProfile: false,
                        findHits: options.findHits,
                        findBlockingHits: options.findBlockingHits
                    });
                    sampleCount += result.sampleCount;
                    result.bearing = start;
                    result.endBearing = end;
                    result.sampleBearing = sampleBearing;
                    rays[degree] = result;
                    degree++;
                }
                if (degree < 360) {
                    global.requestAnimationFrame(analyzeChunk);
                    return;
                }
                resolve({
                    mode: "elevation",
                    observerGround: observerGround,
                    observerHeight: Number(options.observerHeight || 1.6),
                    sampleCount: sampleCount,
                    rays: rays
                });
            }
            global.requestAnimationFrame(analyzeChunk);
        });
    }

    global.ElevationViewshed = {
        analyzeAsync: analyzeAsync,
        analyzeRay: analyzeRay,
        ensureTerrainProfile: ensureTerrainProfile
    };
})(window);

