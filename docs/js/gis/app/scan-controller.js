(function (global) {
    "use strict";

    /**
     * 관측 조건을 모아 차폐 분석을 시작하고 2D·3D 결과 모듈을 연결합니다.
     * 건물 데이터 준비와 시간 기반 애니메이션은 전용 모듈에 맡기고, 여기서는
     * 분석 생명주기와 사용자에게 보여줄 상태가 서로 어긋나지 않도록 조정합니다.
     */
    function create(options) {
        var lastElevationContext = null;
        var scanCompleted = false;
        var preserveThreeDimensionalScene = false;
        var analysisVersion = 0;
        var cachedElevationAnalysis = null;
        var scanAnimation = GisScanAnimation.create();
        var buildingPreparation = GisScanBuildingData.create({
            buildingSource: options.buildingSource,
            geojsonFormat: options.geojsonFormat,
            map: options.map,
            terrainProvider: options.terrainProvider,
            onPerformance: logPerformance,
            onPreparationStart: function () {
                updateProgress("loading", 0, "건물 분석 준비 중");
                setText("screenBuildingCount", "준비 중");
                var button = document.getElementById("scanButton");
                button.disabled = true;
                button.textContent = "분석 데이터 준비 중…";
            }
        });

        function logPerformance(stage, startedAt, details) {
            console.info("[GIS 성능][분석] " + stage, Object.assign({
                elapsedMs: Number((global.performance.now() - startedAt).toFixed(1))
            }, details || {}));
        }

        function setText(id, value) {
            var element = document.getElementById(id);
            if (element) element.textContent = value;
        }

        function updateProgress(state, progress, title) {
            var normalized = Math.max(0, Math.min(1, Number(progress) || 0));
            var card = document.getElementById("scanStatusCard");
            var ring = document.getElementById("scanProgressRing");
            var bar = document.getElementById("scanProgressBar");
            if (card) card.dataset.state = state;
            if (ring) ring.style.setProperty("--scan-progress", (normalized * 360) + "deg");
            if (bar) bar.style.width = (normalized * 100) + "%";
            setText("scanProgressPercent", Math.round(normalized * 100) + "%");
            if (title) setText("scanStatusTitle", title);
        }

        function refreshScreenBuildingCount() {
            if (!scanCompleted) return;
            var count = options.buildingDisplay.countScreenVisible(options.map);
            if (Number.isFinite(count)) {
                setText("screenBuildingCount", count.toLocaleString() + "개");
            }
        }

        function stop() {
            scanAnimation.stop();
            options.buildingDisplay.clearHighlights(options.highlightedBuildings);
            if (typeof options.onScanEnd === "function") options.onScanEnd();
        }

        function reset(preserveScene) {
            analysisVersion++;
            var viewMode = typeof options.getViewMode === "function"
                ? options.getViewMode()
                : "2d";
            preserveThreeDimensionalScene = Boolean(preserveScene) &&
                viewMode === "3d" &&
                (scanCompleted || lastElevationContext !== null);
            stop();
            scanCompleted = false;
            lastElevationContext = null;
            cachedElevationAnalysis = null;
            updateProgress("idle", 0, "분석 대기");
            setText("screenBuildingCount", "스캔 후 표시");
            setText("visiblePercent", "—");
            setText("blockedPercent", "—");
            options.mapLayers.clearFocusMask();
            if (typeof options.onRevealedBuildingsChange === "function") {
                options.onRevealedBuildingsChange([]);
            }
            if (!preserveThreeDimensionalScene &&
                    typeof options.onAnalysisClear === "function") {
                options.onAnalysisClear();
            }
        }

        function resetBuildingDisplay(buildingData) {
            buildingData.forEach(function (building) {
                building.feature.setStyle(undefined);
                building.feature.set("scanRevealed", false);
            });
            options.resultSource.clear();
        }

        function rejectCenterInsideBuilding(origin, buildingData, button, hitInfo) {
            var containingBuildings = GisBuildingIntersections.findContaining(origin, buildingData);
            if (containingBuildings.length === 0) return false;

            containingBuildings.forEach(function (building) {
                building.feature.set("scanRevealed", true);
                building.feature.setStyle(options.buildingDisplay.invalidCenterStyle);
                options.highlightedBuildings.add(building.feature);
            });
            document.getElementById("resultInfo").textContent =
                "관측점이 건물 내부 또는 경계에 있습니다. 건물 바깥을 선택하세요.";
            options.showAlert(
                "관측점을 지정할 수 없습니다.",
                "건물 바깥의 빈 공간을 선택하세요."
            );
            button.disabled = true;
            button.textContent = "건물 바깥을 선택하세요";
            hitInfo.textContent = "건물 바깥을 클릭하면 다시 조회합니다.";
            return true;
        }

        function createElevationContext(origin, radius, buildingData, observerHeight, version) {
            var sample = function (lonLat) {
                var value = options.terrainProvider.sample(lonLat);
                return value === null ? 0 : value;
            };
            var observerGround = sample(origin);
            var eyeElevation = observerGround + observerHeight;
            var indexStartedAt = global.performance.now();
            return GisBuildingIntersections.createIndexAsync(
                origin,
                radius,
                buildingData,
                eyeElevation,
                function () { return version !== analysisVersion; }
            ).then(function (buildingIndex) {
                if (buildingIndex === null || version !== analysisVersion) return null;
                logPerformance("차폐 후보 인덱스 생성", indexStartedAt, {
                    buildingCount: buildingData.length,
                    blockerCandidateCount: buildingIndex.candidateCount
                });
                return {
                    origin: origin,
                    radius: radius,
                    buildingData: buildingData,
                    buildingIndex: buildingIndex,
                    sample: sample,
                    observerGround: observerGround,
                    step: options.terrainSampleStep,
                    observerHeight: observerHeight,
                    findHits: function (bearing, collectAllHits) {
                        return buildingIndex.findHits(bearing, collectAllHits !== false);
                    },
                    findBlockingHits: function (bearing) {
                        return buildingIndex.findBlockingHits(bearing);
                    }
                };
            });
        }

        function analyzeElevation(origin, radius, buildingData, observerHeight, version) {
            var analysisStartedAt = global.performance.now();
            var viewshedStartedAt = null;
            if (cachedElevationAnalysis !== null &&
                    cachedElevationAnalysis.radius === radius &&
                    cachedElevationAnalysis.observerHeight === observerHeight &&
                    cachedElevationAnalysis.buildingData === buildingData &&
                    cachedElevationAnalysis.origin[0] === origin[0] &&
                    cachedElevationAnalysis.origin[1] === origin[1]) {
                lastElevationContext = cachedElevationAnalysis.context;
                logPerformance("동일 조건 분석 캐시 재사용", analysisStartedAt, {
                    buildingCount: buildingData.length,
                    rayCount: cachedElevationAnalysis.result.rays.length
                });
                return Promise.resolve({ result: cachedElevationAnalysis.result });
            }
            return createElevationContext(
                origin,
                radius,
                buildingData,
                observerHeight,
                version
            ).then(function (context) {
                if (context === null || version !== analysisVersion) return null;
                lastElevationContext = context;
                viewshedStartedAt = global.performance.now();
                return ElevationViewshed.analyzeAsync(context, function () {
                    return version !== analysisVersion;
                });
            }).then(function (elevationResult) {
                if (elevationResult === null || version !== analysisVersion) return null;
                logPerformance("360개 1° Ray 계산", viewshedStartedAt, {
                    buildingCount: buildingData.length,
                    rayCount: elevationResult.rays.length
                });
                logPerformance("인덱스 + 360° 분석 전체", analysisStartedAt, {
                    buildingCount: buildingData.length
                });
                cachedElevationAnalysis = {
                    origin: origin.slice(),
                    radius: radius,
                    observerHeight: observerHeight,
                    buildingData: buildingData,
                    context: lastElevationContext,
                    result: elevationResult
                };
                return { result: elevationResult };
            });
        }

        function createRevealQueue(elevationResult) {
            var firstAngles = new Map();
            elevationResult.rays.forEach(function (ray) {
                ray.hits.forEach(function (hit) {
                    if (!firstAngles.has(hit.feature)) {
                        firstAngles.set(hit.feature, ray.bearing);
                    }
                });
            });
            return Array.from(firstAngles, function (entry) {
                return {
                    feature: entry[0],
                    angle: entry[1]
                };
            }).sort(function (left, right) {
                return left.angle - right.angle;
            });
        }

        function revealBuildings(revealQueue, state, bearing) {
            while (state.index < revealQueue.length && revealQueue[state.index].angle <= bearing) {
                revealQueue[state.index++].feature.set("scanRevealed", true);
            }
        }

        function createTwoDimensionalRevealQueue(origin, elevationResult) {
            var animatedAnalysis = GisElevationRegions.buildAnimatedGeoJson(
                origin,
                elevationResult,
                // 분석 해상도와 같은 1° 단위로 준비하면 스캔선과 영역 경계가
                // 같은 방위각을 공유하면서도 프레임마다 도형을 다시 만들 필요가 없습니다.
                1
            );
            var features = options.geojsonFormat.readFeatures(animatedAnalysis, {
                dataProjection: "EPSG:4326",
                featureProjection: options.map.getView().getProjection()
            });
            return features.map(function (feature) {
                return {
                    feature: feature,
                    angle: Number(feature.get("revealBearing")) || 0
                };
            }).sort(function (left, right) {
                return left.angle - right.angle;
            });
        }

        function revealTwoDimensionalAnalysis(scan, bearing, progress) {
            var revealBearing = progress === 1 ? 360 : bearing;
            var newlyRevealed = [];
            while (scan.twoDimensionalRevealState.index < scan.twoDimensionalRevealQueue.length &&
                    scan.twoDimensionalRevealQueue[scan.twoDimensionalRevealState.index].angle <= revealBearing) {
                newlyRevealed.push(
                    scan.twoDimensionalRevealQueue[scan.twoDimensionalRevealState.index++].feature
                );
            }
            // 이미 공개된 도형은 그대로 유지하고 새 구간만 추가해야 대규모 건물 데이터에서도
            // 회전 중 레이어 전체를 재투영하는 비용 없이 스캔선과 함께 부드럽게 진행됩니다.
            if (newlyRevealed.length > 0) {
                options.resultSource.addFeatures(newlyRevealed);
            }
        }

        function paintAnalysisResult(scan, bearing, progress) {
            revealTwoDimensionalAnalysis(scan, bearing, progress);
            if (Math.floor(bearing) === scan.lastPaintedDegree && progress !== 1) return;

            GisElevationProfile.updateFromResult(
                scan.elevationResult,
                bearing,
                scan.radius,
                function (ray) {
                    scan.elevationResult.sampleCount +=
                        ElevationViewshed.ensureTerrainProfile(ray, scan.elevationContext);
                }
            );
            scan.lastPaintedDegree = Math.floor(bearing);
        }

        function replaceTwoDimensionalAnalysis(featureCollection) {
            var features = options.geojsonFormat.readFeatures(featureCollection, {
                dataProjection: "EPSG:4326",
                featureProjection: options.map.getView().getProjection()
            });
            options.resultSource.clear();
            options.resultSource.addFeatures(features);
        }

        function updateDetectedBuildings(scan, bearing) {
            var rays = scan.elevationResult.rays;
            var rayIndex = Math.max(0, scan.activeRayIndex);
            while (rayIndex + 1 < rays.length && rays[rayIndex + 1].bearing <= bearing + 0.0001) {
                rayIndex++;
            }
            if (rayIndex === scan.activeRayIndex) return;
            scan.activeRayIndex = rayIndex;

            var hits = rays[rayIndex].hits;
            var nextHighlights = new Set();
            hits.forEach(function (hit) {
                nextHighlights.add(hit.feature);
                hit.feature.set("scanRevealed", true);
                scan.detectedIds.add(hit.id);
            });
            options.highlightedBuildings.forEach(function (feature) {
                if (nextHighlights.has(feature)) return;
                feature.setStyle(undefined);
                options.highlightedBuildings.delete(feature);
            });
            hits.forEach(function (hit) {
                if (options.highlightedBuildings.has(hit.feature)) return;
                hit.feature.setStyle(options.buildingDisplay.styleFor(hit.feature, "detected"));
                options.highlightedBuildings.add(hit.feature);
            });

            if (hits.length > 0) {
                var nearestHit = hits[0];
                scan.hitInfo.textContent = "객체 포착: " + hits.length + "개" +
                    " / 가장 가까운 객체: " + nearestHit.id +
                    " / 방위각: " + bearing.toFixed(1) + "°" +
                    " / 거리: " + nearestHit.distance.toFixed(1) + "m" +
                    " / 높이: " + options.buildingDisplay.heightLabel(nearestHit.feature);
            } else {
                scan.hitInfo.textContent = "방위각: " + bearing.toFixed(1) +
                    "° / 교차하는 건물 없음";
            }
        }

        function completeScan(scan) {
            stop();
            scan.button.disabled = false;
            scan.button.textContent = "다시 스캔";
            options.raySource.clear();
            document.getElementById("resultInfo").textContent =
                GisElevationRegions.summarizeResult(
                scan.elevationResult,
                scan.elevationResult.observerGround,
                options.getObserverHeight()
            );
            GisElevationProfile.updateFromResult(scan.elevationResult, 360, scan.radius);
            scanCompleted = true;
            if (typeof options.onRevealedBuildingsChange === "function") {
                options.onRevealedBuildingsChange(scan.revealQueue.map(function (item) {
                    return item.feature.get("buildingId") || item.feature.getId();
                }).filter(Boolean));
            }
            updateProgress("complete", 1, "분석 완료");
            var distribution = GisElevationRegions.distributionFromResult(
                scan.elevationResult
            );
            setText("visiblePercent", distribution.visible.toFixed(1) + "%");
            setText("blockedPercent", distribution.blocked.toFixed(1) + "%");
            var compactAnalysis = GisElevationRegions.buildCompactGeoJson(
                scan.origin,
                scan.elevationResult
            );
            replaceTwoDimensionalAnalysis(compactAnalysis);
            console.info("[GIS 성능][렌더] 2D 스캔 애니메이션 프레임", {
                frameCount: scan.frameCount,
                longFrameCount: scan.longFrameCount,
                maxFrameGapMs: Number(scan.maxFrameGap.toFixed(1)),
                buildingCount: scan.buildingData.length
            });
            options.mapLayers.showFocusMask(scan.origin, scan.radius);
            options.directionReview.setAvailable(true);
            var analysisBuildingCount = Number(options.buildingSource.get("analysisBuildingCount"));
            setText(
                "analysisBuildingCount",
                Number.isFinite(analysisBuildingCount)
                    ? analysisBuildingCount.toLocaleString() + "개"
                    : scan.buildingData.length.toLocaleString() + "개"
            );
            scan.hitInfo.textContent = "관측 범위 분석을 완료했습니다.";
            global.requestAnimationFrame(refreshScreenBuildingCount);
            if (typeof options.onAnalysisReady === "function") {
                options.onAnalysisReady(compactAnalysis);
            }
        }

        function failScan(scan, error) {
            options.resultSource.clear();
            options.mapLayers.clearFocusMask();
            if (typeof options.onAnalysisClear === "function") {
                options.onAnalysisClear();
            }
            document.getElementById("resultInfo").textContent = "분석을 완료하지 못했습니다.";
            updateProgress("error", 0, "분석 실패");
            options.showAlert("스캔 오류", "분석을 완료하지 못했습니다. 다시 시도하세요.");
            stop();
            scan.button.disabled = false;
            scan.button.textContent = "다시 스캔";
            scan.hitInfo.textContent = "스캔 중 오류가 발생했습니다. 브라우저 Console을 확인하세요.";
            console.error(error);
        }

        function runAnimation(scan) {
            scanAnimation.start(scan, {
                getViewMode: function () {
                    var viewMode = typeof options.getViewMode === "function"
                        ? options.getViewMode()
                        : "2d";
                    return viewMode === "3d" &&
                        typeof options.onScanBearing !== "function"
                        ? "2d"
                        : viewMode;
                },
                progress: function (activeScan, bearing, progress) {
                    updateProgress("scanning", progress, "방향 스캔 중");
                },
                reveal: function (activeScan, bearing) {
                    revealBuildings(
                        activeScan.revealQueue,
                        activeScan.revealState,
                        bearing
                    );
                },
                renderThreeDimensional: function (activeScan, bearing) {
                    if (typeof options.onScanBearing === "function") {
                        options.onScanBearing(
                            activeScan.origin,
                            bearing,
                            activeScan.radius
                        );
                    }
                    if (typeof options.onAnalysisProgress === "function") {
                        options.onAnalysisProgress(bearing);
                    }
                    activeScan.hitInfo.textContent = "3D 스캔 중 · 방위각: " +
                        bearing.toFixed(1) + "°";
                },
                renderTwoDimensional: function (activeScan, bearing, progress) {
                    options.mapLayers.drawRay(
                        activeScan.origin,
                        bearing,
                        activeScan.radius
                    );
                    paintAnalysisResult(activeScan, bearing, progress);
                    updateDetectedBuildings(activeScan, bearing);
                },
                complete: completeScan,
                fail: failScan
            });
        }

        function start() {
            var center = options.getCenter();
            if (center === null) return Promise.resolve();
            if (buildingPreparation.isPreparing()) return Promise.resolve();
            options.mapLayers.clearFocusMask();
            if (!options.areBuildingsReady()) {
                options.hideAlert();
                options.loadBuildings();
                return Promise.resolve();
            }

            stop();
            var version = ++analysisVersion;
            options.hideAlert();
            if (!preserveThreeDimensionalScene &&
                    typeof options.onAnalysisClear === "function") {
                options.onAnalysisClear();
            }

            var button = document.getElementById("scanButton");
            var hitInfo = document.getElementById("hitInfo");
            var origin = center.slice();
            var radius = options.getRadius();
            var observerHeight = options.getObserverHeight();

            scanCompleted = false;
            updateProgress("scanning", 0, "분석 준비 중");
            setText("scanRadiusValue", radius.toLocaleString() + "m");
            setText("scanObserverHeight", observerHeight.toFixed(1) + "m");
            setText("screenBuildingCount", "계산 중");
            setText("visiblePercent", "계산 중");
            setText("blockedPercent", "계산 중");
            options.directionReview.reset();
            options.mapLayers.clearViewDirection(false);

            var buildingData = buildingPreparation.get();
            resetBuildingDisplay(buildingData);
            if (rejectCenterInsideBuilding(origin, buildingData, button, hitInfo)) {
                preserveThreeDimensionalScene = false;
                if (typeof options.onAnalysisClear === "function") {
                    options.onAnalysisClear();
                }
                return Promise.resolve();
            }

            document.getElementById("resultInfo").textContent =
                "관측자와 건물·지형의 절대고도를 비교해 가시구간을 계산하고 있습니다.";

            return new Promise(function (resolve) {
                setTimeout(resolve, 0);
            }).then(function () {
                return analyzeElevation(
                    origin,
                    radius,
                    buildingData,
                    observerHeight,
                    version
                );
            }).then(function (elevation) {
                if (elevation === null || version !== analysisVersion) return null;
                if (typeof options.onObservationElevationChange === "function") {
                    options.onObservationElevationChange(
                        origin,
                        elevation.result.observerGround,
                        observerHeight
                    );
                }
                document.getElementById("resultInfo").textContent =
                    "절대고도 기준 스캔 중 · 관측자 해발고도 이상인 첫 건물 또는 지형까지 관측 가능 영역으로 표시합니다.";

                var scan = {
                    origin: origin,
                    radius: radius,
                    buildingData: buildingData,
                    elevationContext: lastElevationContext,
                    elevationResult: elevation.result,
                    revealQueue: createRevealQueue(elevation.result),
                    revealState: { index: 0 },
                    twoDimensionalRevealQueue: createTwoDimensionalRevealQueue(
                        origin,
                        elevation.result
                    ),
                    twoDimensionalRevealState: { index: 0 },
                    activeRayIndex: -1,
                    lastPaintedDegree: -1,
                    lastProgressPercent: -1,
                    detectedIds: new Set(),
                    frameCount: 0,
                    longFrameCount: 0,
                    maxFrameGap: 0,
                    lastFrameAt: null,
                    duration: 8000,
                    startedAt: performance.now(),
                    button: button,
                    hitInfo: hitInfo
                };
                button.disabled = true;
                if (options.getViewMode() === "3d" &&
                        typeof options.onAnalysisPrepare === "function") {
                    button.textContent = "3D 영역 준비 중…";
                    return Promise.resolve(options.onAnalysisPrepare(
                        GisElevationRegions.buildAnimatedGeoJson(
                            origin,
                            elevation.result,
                            // 분석 결과가 생성되는 1° Ray와 공개 단위를 맞춰야
                            // 관측 영역의 끝선이 회전하는 스캔선을 따라갑니다.
                            1
                        )
                    )).then(function () {
                        preserveThreeDimensionalScene = false;
                        button.textContent = "스캔 중…";
                        scan.startedAt = performance.now();
                        runAnimation(scan);
                    }).catch(function (error) {
                        preserveThreeDimensionalScene = false;
                        if (typeof options.onAnalysisClear === "function") {
                            options.onAnalysisClear();
                        }
                        throw error;
                    });
                }
                preserveThreeDimensionalScene = false;
                button.textContent = "스캔 중…";
                runAnimation(scan);
                return null;
            });
        }

        return {
            getElevationContext: function () { return lastElevationContext; },
            isCompleted: function () { return scanCompleted; },
            prepareBuildingData: buildingPreparation.prepare,
            refreshScreenBuildingCount: refreshScreenBuildingCount,
            reset: reset,
            start: start,
            stop: stop
        };
    }

    global.GisScanController = {
        create: create
    };
})(window);
