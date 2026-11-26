(function (global) {
    "use strict";

    /**
     * 애플리케이션 조립 지점입니다. 각 모듈이 계산·표시·입력 처리라는 한 가지
     * 책임에 집중하도록 공용 상태와 콜백을 여기서 연결합니다.
     *
     * 관측점 선택 → 건물·DEM 준비 → 360도 분석 → 2D·3D 결과 동기화 순서이며,
     * 3D 화면은 별도 판정을 만들지 않고 scan-controller의 동일 결과를 표현합니다.
     */
    function start(options) {
        options = options || {};
        options.defaultCenter = options.defaultCenter || [126.84139, 37.56833];
        options.initialSearchRadius = options.initialSearchRadius || 300;
        options.initialZoom = options.initialZoom || 16.6;
        options.terrainSampleStepMeters = options.terrainSampleStepMeters || 10;
        options.demPreloadRadiusMeters = options.demPreloadRadiusMeters || 1200;
        options.cesiumIonToken = String(options.cesiumIonToken || "").trim();

        if (typeof global.PerformanceObserver === "function") {
            try {
                new global.PerformanceObserver(function (list) {
                    list.getEntries().forEach(function (entry) {
                        if (entry.duration < 50) return;
                        console.warn("[GIS 성능][메인 스레드] 긴 작업", {
                            startMs: Number(entry.startTime.toFixed(1)),
                            durationMs: Number(entry.duration.toFixed(1))
                        });
                    });
                }).observe({ entryTypes: ["longtask"] });
            } catch (error) {
                console.debug("긴 작업 측정을 지원하지 않는 브라우저입니다.", error);
            }
        }

        GisPanelControls.create();

        var searchRadius = options.initialSearchRadius;
        var centerLonLat = null;
        var highlightedBuildings = new Set();
        // 관측점과 반경은 2D·3D가 함께 읽는 원본 상태입니다. 각 화면이 값을 따로
        // 보관하지 않고 이 접근 함수를 사용해야 전환 후에도 같은 분석 범위를 유지합니다.
        var appState = {
            getCenter: function () { return centerLonLat; },
            setCenter: function (center) { centerLonLat = center; },
            getRadius: function () { return searchRadius; },
            setRadius: function (radius) { searchRadius = radius; }
        };

        var buildingDisplay = GisBuildingDisplay.create();
        var buildingSource = buildingDisplay.source;
        var mapLayers = GisMapLayers.create({
            target: options.mapTarget || "map",
            buildingLayer: buildingDisplay.layer,
            buildingHoverLayer: buildingDisplay.hoverLayer,
            detailSelectionLayer: buildingDisplay.detailSelectionLayer,
            initialCenter: options.defaultCenter,
            initialZoom: options.initialZoom
        });
        var map = mapLayers.map;
        var terrainProvider = new GisTerrain.TerrainProvider({
            manifestUrl: options.contextPath + "/dem/dem-index.json"
        });
        var uiStatus = GisUiStatus.create();
        var mapInteractions = null;
        var directionReview = null;
        var scanController = null;
        var buildingLoader = null;
        var buildingDetail = null;
        var threeDimensionalSync = null;
        var layoutFocusTimer = null;
        var buildingCountFrame = null;
        var focusRequestVersion = 0;
        var cesiumBuildingHover = document.getElementById("cesiumBuildingHover");
        var cesiumBuildingHoverLabel = "";

        function analyzedBuildingById(id) {
            if (!id || scanController === null || !scanController.isCompleted() ||
                    (directionReview !== null &&
                    directionReview.isObservationSelectionMode())) return null;
            var feature = buildingSource.getFeatureById(String(id));
            return feature && feature.get("scanRevealed") === true ? feature : null;
        }

        function hideCesiumBuildingHover() {
            if (!cesiumBuildingHover) return;
            cesiumBuildingHover.hidden = true;
            cesiumBuildingHoverLabel = "";
            cesiumBuildingHover.textContent = "";
        }

        function showCesiumBuildingHover(feature, position) {
            if (!cesiumBuildingHover || !feature || !position) return;
            var label = buildingDisplay.heightLabel(feature);
            if (!label) {
                hideCesiumBuildingHover();
                return;
            }
            var nextLabel = "옥상 해발 " + label;
            if (cesiumBuildingHoverLabel !== nextLabel) {
                cesiumBuildingHoverLabel = nextLabel;
                cesiumBuildingHover.textContent = nextLabel;
            }
            cesiumBuildingHover.hidden = false;
            // 크기 측정은 강제 레이아웃을 유발하므로 화면 좌표만 합성 단계에서 이동합니다.
            var x = position.x > global.innerWidth - 170 ? position.x - 150 : position.x + 14;
            var y = position.y > global.innerHeight - 60 ? position.y - 44 : position.y + 14;
            cesiumBuildingHover.style.transform = "translate3d(" +
                Math.round(x) + "px, " + Math.round(y) + "px, 0)";
        }

        function focusObservationInWorkspace() {
            if (scanController === null || !scanController.isCompleted()) return;
            if (buildingLoader !== null && buildingLoader.isLoading()) return;
            var center = appState.getCenter();
            if (center === null) return;

            // 분석 결과 패널은 지도 위 오버레이이므로 관측점을 옆으로 밀지 않습니다.
            var horizontalOffset = 0;
            if (viewSwitcher.getMode() === "3d") {
                viewSwitcher.focusObservation(center, horizontalOffset);
                return;
            }

            map.updateSize();
            var size = map.getSize();
            var view = map.getView();
            var currentCenter = view.getCenter();
            if (!size || !currentCenter) return;
            var targetPixel = [size[0] / 2 + horizontalOffset, size[1] / 2];
            var coordinateAtTarget = map.getCoordinateFromPixel(targetPixel);
            if (!coordinateAtTarget) return;
            var observationCoordinate = ol.proj.fromLonLat(center);
            var nextCenter = [
                currentCenter[0] + observationCoordinate[0] - coordinateAtTarget[0],
                currentCenter[1] + observationCoordinate[1] - coordinateAtTarget[1]
            ];
            view.animate({
                center: nextCenter,
                duration: 620,
                easing: function (progress) {
                    return 1 - Math.pow(1 - progress, 3);
                }
            });
        }

        function cancelObservationFocus() {
            focusRequestVersion++;
            if (layoutFocusTimer !== null) {
                clearTimeout(layoutFocusTimer);
                layoutFocusTimer = null;
            }
            map.getView().cancelAnimations();
        }

        function scheduleObservationFocus(delay) {
            if (layoutFocusTimer !== null) clearTimeout(layoutFocusTimer);
            var version = ++focusRequestVersion;
            layoutFocusTimer = setTimeout(function () {
                layoutFocusTimer = null;
                global.requestAnimationFrame(function () {
                    global.requestAnimationFrame(function () {
                        if (version === focusRequestVersion) {
                            focusObservationInWorkspace();
                        }
                    });
                });
            }, Number(delay) || 0);
        }

        function scheduleScreenBuildingCount() {
            if (buildingCountFrame !== null) cancelAnimationFrame(buildingCountFrame);
            buildingCountFrame = requestAnimationFrame(function () {
                buildingCountFrame = null;
                if (scanController !== null) {
                    scanController.refreshScreenBuildingCount();
                }
            });
        }

        var cesiumMap = GisCesiumMap.create({
            target: "cesiumMap",
            defaultCenter: options.defaultCenter,
            ionAccessToken: options.cesiumIonToken,
            thematicEndpoint: options.contextPath + "/gis/thematic-map.do",
            onBuildingHover: function (id, position) {
                var feature = analyzedBuildingById(id);
                if (!feature) {
                    hideCesiumBuildingHover();
                    return false;
                }
                showCesiumBuildingHover(feature, position);
                return true;
            },
            onBuildingSelected: function (id) {
                var feature = analyzedBuildingById(id);
                if (!feature || buildingDetail === null) return false;
                hideCesiumBuildingHover();
                uiStatus.hideAlert();
                if (directionReview !== null &&
                        typeof directionReview.pointAt === "function" &&
                        feature.getGeometry()) {
                    // 3D 선택은 화면 클릭 좌표를 전달하지 않으므로 건물 도형 중심을 같은 방향 기준으로 사용합니다.
                    directionReview.pointAt(ol.proj.toLonLat(
                        ol.extent.getCenter(feature.getGeometry().getExtent())
                    ));
                }
                buildingDetail.open(feature);
                return true;
            },
            onPositionSelected: function (center, screenAlignedBearing) {
                if (mapInteractions !== null) {
                    mapInteractions.selectObservationPoint(center, screenAlignedBearing);
                }
            },
            onScreenBuildingCountChange: function (count) {
                if (!viewSwitcher || viewSwitcher.getMode() !== "3d" ||
                        !Number.isFinite(count)) return;
                document.getElementById("screenBuildingCount").textContent =
                    count.toLocaleString() + "개";
            }
        });
        var viewSwitcher = GisMapViewSwitcher.create({
            map: map,
            mapLayers: mapLayers,
            mapTarget: options.mapTarget || "map",
            cesiumMap: cesiumMap,
            cesiumTarget: "cesiumMap",
            getCenter: appState.getCenter,
            getRadius: appState.getRadius,
            onBeforeShow3d: function () {
                return threeDimensionalSync === null
                    ? Promise.resolve(null)
                    : threeDimensionalSync.flushBuildingData();
            },
            onViewReady: function () {
                scheduleObservationFocus(0);
                scheduleScreenBuildingCount();
            },
            onError: function () {
                uiStatus.showAlert(
                    "3D 지도 시작 실패",
                    "CesiumJS를 불러오지 못했습니다. 네트워크 연결을 확인하세요."
                );
            }
        });
        GisPanelControls.createMapControls({
            map: map,
            cesiumMap: cesiumMap,
            viewSwitcher: viewSwitcher
        });
        threeDimensionalSync = GisThreeDimensionalSync.create({
            map: map,
            viewSwitcher: viewSwitcher
        });
        // 아래 모듈은 서로의 현재 상태가 필요하지만 사용자 이벤트는 조립이 끝난 뒤
        // 발생합니다. 콜백으로 연결하여 생성 순서 때문에 분석 로직이 결합되지 않게 합니다.
        directionReview = GisDirectionReview.create({
            map: map,
            mapLayers: mapLayers,
            buildingDisplay: buildingDisplay,
            elevationProfile: GisElevationProfile,
            highlightedBuildings: highlightedBuildings,
            analyzeRay: ElevationViewshed.analyzeRay,
            getCenter: appState.getCenter,
            getRadius: appState.getRadius,
            getElevationContext: function () {
                return scanController.getElevationContext();
            },
            isScanCompleted: function () { return scanController.isCompleted(); },
            hideAlert: uiStatus.hideAlert,
            showAlert: uiStatus.showAlert,
            onDirectionChange: viewSwitcher.setReviewDirection,
            onDirectionClear: viewSwitcher.clearReviewDirection,
            onBuildingHighlightsChange: viewSwitcher.setHighlightedBuildings,
            onBuildingHighlightsClear: viewSwitcher.clearHighlightedBuildings
        });

        scanController = GisScanController.create({
            map: map,
            mapLayers: mapLayers,
            buildingSource: buildingSource,
            buildingDisplay: buildingDisplay,
            geojsonFormat: mapLayers.geojsonFormat,
            terrainProvider: terrainProvider,
            resultSource: mapLayers.resultSource,
            raySource: mapLayers.raySource,
            highlightedBuildings: highlightedBuildings,
            directionReview: directionReview,
            terrainSampleStep: options.terrainSampleStepMeters,
            getCenter: appState.getCenter,
            getRadius: appState.getRadius,
            getViewMode: viewSwitcher.getMode,
            areBuildingsReady: function () { return buildingLoader.isReady(); },
            getObserverHeight: uiStatus.getObserverHeight,
            loadBuildings: function () { return buildingLoader.load(); },
            hideAlert: uiStatus.hideAlert,
            showAlert: uiStatus.showAlert,
            onAnalysisClear: viewSwitcher.clearAnalysis,
            onAnalysisPrepare: threeDimensionalSync.prepareAnalysis,
            onAnalysisProgress: viewSwitcher.revealAnalysisThrough,
            onAnalysisReady: threeDimensionalSync.setAnalysisData,
            onObservationElevationChange: function (center, groundHeight, observerHeight) {
                uiStatus.updateObserverCriterion(groundHeight);
                viewSwitcher.setObservationElevation(center, groundHeight, observerHeight);
            },
            onRevealedBuildingsChange: function (ids) {
                if (!Array.isArray(ids) || ids.length === 0) {
                    viewSwitcher.clearBuildingHover();
                }
                viewSwitcher.setRevealedBuildings(ids);
            },
            onScanBearing: viewSwitcher.updateScanMotion,
            onScanEnd: viewSwitcher.hideScanMotion
        });

        buildingLoader = GisBuildingLoader.create({
            endpoint: options.contextPath + "/gis/buildings.do",
            map: map,
            buildingSource: buildingSource,
            resultSource: mapLayers.resultSource,
            raySource: mapLayers.raySource,
            geojsonFormat: mapLayers.geojsonFormat,
            terrainProvider: terrainProvider,
            demPreloadRadius: options.demPreloadRadiusMeters,
            getCenter: appState.getCenter,
            getRadius: appState.getRadius,
            setLoading: uiStatus.setLoading,
            updateTerrainStatus: uiStatus.updateTerrainStatus,
            hideAlert: uiStatus.hideAlert,
            showAlert: uiStatus.showAlert,
            onDataReady: threeDimensionalSync.queueBuildingData,
            onReady: function () {
                threeDimensionalSync.prepareQueuedBuildings(
                    scanController.prepareBuildingData
                ).then(function (data) {
                    if (data !== null && !buildingLoader.isLoading() &&
                            buildingLoader.isReady()) {
                        scanController.start();
                    }
                }).catch(function (error) {
                    console.error("건물 분석 데이터 준비 실패", error);
                    uiStatus.showAlert(
                        "분석 준비 실패",
                        "건물 분석 데이터를 준비하지 못했습니다. 다시 시도하세요."
                    );
                });
            }
        });

        // 상세 모듈은 스캔 로더와 별도입니다. 사용자가 건물을 클릭할 때만 API를 호출합니다.
        buildingDetail = GisBuildingDetail.create({
            endpoint: options.contextPath + "/gis/building-detail.do",
            showAlert: uiStatus.showAlert,
            onSelect: function (feature) {
                buildingDisplay.showDetailSelection(feature);
                viewSwitcher.setDetailSelectedBuilding(
                    feature.get("buildingId") || feature.getId()
                );
            },
            onClearSelection: function () {
                buildingDisplay.clearDetailSelection();
                viewSwitcher.setDetailSelectedBuilding(null);
            }
        });

        mapInteractions = GisMapInteractions.create({
            map: map,
            mapLayers: mapLayers,
            buildingSource: buildingSource,
            buildingDisplay: buildingDisplay,
            centerSource: mapLayers.centerSource,
            radiusLayer: mapLayers.radiusLayer,
            resultSource: mapLayers.resultSource,
            resultLayer: mapLayers.resultLayer,
            directionReview: directionReview,
            buildingDetail: buildingDetail,
            scanController: scanController,
            buildingLoader: buildingLoader,
            getCenter: appState.getCenter,
            setCenter: appState.setCenter,
            getRadius: appState.getRadius,
            setRadius: appState.setRadius,
            hideAlert: uiStatus.hideAlert,
            showAlert: uiStatus.showAlert,
            updateObserverCriterion: uiStatus.updateObserverCriterion,
            onAnalysisClear: viewSwitcher.clearAnalysis,
            onObservationChange: viewSwitcher.setObservation,
            onRadiusVisibilityChange: viewSwitcher.setRadiusVisible,
            onExcludedVisibilityChange: viewSwitcher.setExcludedVisible,
            onVisibleVisibilityChange: viewSwitcher.setVisibleAreaVisible,
            onObservationSelectionStart: cancelObservationFocus
        });

        var toolbar = document.querySelector(".toolbar");
        if (toolbar) {
            toolbar.addEventListener("transitionend", function (event) {
                if (event.propertyName === "width" ||
                        event.propertyName === "max-height") {
                    scheduleObservationFocus(0);
                    scheduleScreenBuildingCount();
                }
            });
        }
        var analysisPanel = document.getElementById("analysisResultPanel");
        if (analysisPanel) {
            new MutationObserver(function () {
                requestAnimationFrame(scheduleScreenBuildingCount);
            }).observe(analysisPanel, { attributes: true, attributeFilter: ["hidden"] });
        }
        map.on("moveend", scheduleScreenBuildingCount);
        global.addEventListener("resize", function () {
            scheduleObservationFocus(120);
            scheduleScreenBuildingCount();
        });

        function preloadThreeDimensionalMap() {
            return new Promise(function (resolve) {
                global.requestAnimationFrame(function () {
                    global.requestAnimationFrame(function () {
                        resolve(viewSwitcher.preload());
                    });
                });
            }).catch(function (error) {
                console.warn("3D 지도 백그라운드 준비 실패", error);
                return null;
            });
        }

        uiStatus.setLoading(true, "고도 및 3D 지도 데이터를 준비하고 있습니다.");
        terrainProvider.prepare(options.defaultCenter, searchRadius, {
            preloadRadius: options.demPreloadRadiusMeters
        }).then(function (status) {
            uiStatus.updateTerrainStatus(status);
            uiStatus.setLoading(false);
            return status;
        });
        preloadThreeDimensionalMap();
        GisElevationProfile.draw(null, searchRadius);
    }

    global.GisApp = {
        start: start
    };

    var script = document.getElementById("gisAppScript");
    var runtimeConfig = global.GIS_RUNTIME_CONFIG || {};
    start({
        contextPath: script ? script.getAttribute("data-context-path") : "",
        cesiumIonToken: runtimeConfig.cesiumIonToken || ""
    });
})(window);
