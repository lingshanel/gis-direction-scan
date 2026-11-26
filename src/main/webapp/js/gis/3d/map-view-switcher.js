(function (global) {
    "use strict";

    function create(options) {
        var mapElement = document.getElementById(options.mapTarget);
        var cesiumElement = document.getElementById(options.cesiumTarget);
        var show2dButton = document.getElementById("show2dButton");
        var show3dButton = document.getElementById("show3dButton");
        var generalMapButton = document.getElementById("generalMapButton");
        var satelliteMapButton = document.getElementById("satelliteMapButton");
        var viewModeSwitch = show2dButton.closest(".view-mode-switch");
        var basemapModeSwitch = generalMapButton.closest(".basemap-mode-switch");
        var interactionHint = document.getElementById("mapInteractionHint");
        var mode = "2d";
        var cesiumReady = false;
        var preloadPromise = null;
        var preloadVersion = 0;
        var satelliteEnabled = false;

        function setSatelliteEnabled(enabled) {
            satelliteEnabled = Boolean(enabled);
            options.mapLayers.setSatelliteEnabled(satelliteEnabled);
            options.cesiumMap.setSatelliteEnabled(satelliteEnabled);
            basemapModeSwitch.dataset.mode = satelliteEnabled ? "satellite" : "general";
            generalMapButton.setAttribute("aria-pressed", String(!satelliteEnabled));
            satelliteMapButton.setAttribute("aria-pressed", String(satelliteEnabled));
        }

        function setSurfaceActive(element, active) {
            element.classList.toggle("map-surface-active", active);
            element.classList.toggle("map-surface-inactive", !active);
            element.setAttribute("aria-hidden", String(!active));
        }

        function animateSurface(element) {
            element.classList.remove("map-surface-entering");
            void element.offsetWidth;
            element.classList.add("map-surface-entering");
            element.addEventListener("animationend", function clearAnimation() {
                element.classList.remove("map-surface-entering");
            }, { once: true });
        }

        function notifyViewReady() {
            if (typeof options.onViewReady !== "function") return;
            window.requestAnimationFrame(function () {
                options.onViewReady(mode);
            });
        }

        function updateButtons() {
            viewModeSwitch.dataset.mode = mode;
            show2dButton.setAttribute("aria-pressed", String(mode === "2d"));
            show3dButton.setAttribute("aria-pressed", String(mode === "3d"));
            interactionHint.setAttribute("data-mode", mode);
            var reviewReady = interactionHint.getAttribute("data-review-ready") === "true";
            var observationPick = interactionHint.getAttribute("data-observation-pick") === "true";
            if (observationPick) {
                interactionHint.textContent = "지도 클릭 · 새 관측점 선택";
            } else if (reviewReady) {
                interactionHint.textContent = mode === "3d"
                    ? "원 안 클릭 · 방향 검토   |   드래그 · 회전   |   휠 · 확대/축소"
                    : "원 안 클릭 · 방향 검토   |   원 밖 클릭 · 새 관측점";
            } else {
                interactionHint.textContent = mode === "3d"
                    ? "클릭 · 관측점 선택   |   드래그 · 회전   |   휠 · 확대/축소"
                    : "지도 클릭 · 관측점 선택   |   휠 · 확대/축소";
            }
        }

        function show2d() {
            if (mode === "2d" && mapElement.classList.contains("map-surface-active")) {
                updateButtons();
                return;
            }
            mode = "2d";
            options.cesiumMap.clearBuildingHover();
            cesiumElement.classList.remove("is-preparing");
            cesiumElement.setAttribute("aria-busy", "false");
            setSurfaceActive(cesiumElement, false);
            setSurfaceActive(mapElement, true);
            animateSurface(mapElement);
            options.map.updateSize();
            updateButtons();
            notifyViewReady();
        }

        function show3d() {
            if (mode === "3d" && cesiumElement.classList.contains("map-surface-active")) return;
            if (typeof options.onBeforeShow3d === "function") {
                options.onBeforeShow3d();
            }
            mode = "3d";
            setSurfaceActive(mapElement, false);
            setSurfaceActive(cesiumElement, true);
            if (!cesiumReady) {
                cesiumElement.classList.add("is-preparing");
                cesiumElement.setAttribute("aria-busy", "true");
            }
            animateSurface(cesiumElement);
            updateButtons();

            window.requestAnimationFrame(function () {
                var center = options.getCenter();
                if (center === null) {
                    center = ol.proj.toLonLat(options.map.getView().getCenter());
                }
                try {
                    Promise.resolve(options.cesiumMap.show(center, options.getRadius()))
                        .then(function () {
                            cesiumReady = true;
                            cesiumElement.classList.remove("is-preparing");
                            cesiumElement.setAttribute("aria-busy", "false");
                            notifyViewReady();
                        })
                        .catch(function (error) {
                            show2d();
                            if (typeof options.onError === "function") options.onError(error);
                            console.error("Cesium 지도 시작 실패", error);
                        });
                } catch (error) {
                    show2d();
                    if (typeof options.onError === "function") options.onError(error);
                    console.error("Cesium 지도 시작 실패", error);
                }
            });
        }

        function preload(requestedCenter, requestedRadius) {
            var requestedMode = mode;
            var version = ++preloadVersion;
            var center = Array.isArray(requestedCenter)
                ? requestedCenter.slice()
                : options.getCenter();
            if (center === null) {
                center = ol.proj.toLonLat(options.map.getView().getCenter());
            }
            var radius = Number(requestedRadius) || options.getRadius();
            preloadPromise = Promise.resolve(
                options.cesiumMap.preload(center, radius)
            ).then(function (viewer) {
                if (version !== preloadVersion) return viewer;
                cesiumReady = true;
                if (requestedMode === "3d" && mode === "3d") {
                    cesiumElement.classList.remove("is-preparing");
                    cesiumElement.setAttribute("aria-busy", "false");
                }
                return viewer;
            }).catch(function (error) {
                if (version === preloadVersion) preloadPromise = null;
                throw error;
            });
            return preloadPromise;
        }

        function setObservation(center, radius) {
            var result = options.cesiumMap.setObservation(center, radius);
            if (mode === "2d") {
                cesiumReady = false;
                preload(center, radius).catch(function (error) {
                    console.warn("변경한 관측점의 3D 장면 준비 실패", error);
                });
            }
            return result;
        }

        show2dButton.addEventListener("click", show2d);
        show3dButton.addEventListener("click", show3d);
        generalMapButton.addEventListener("click", function () { setSatelliteEnabled(false); });
        satelliteMapButton.addEventListener("click", function () { setSatelliteEnabled(true); });
        setSatelliteEnabled(false);
        show2d();

        return {
            clearBuildingHover: options.cesiumMap.clearBuildingHover,
            clearAnalysis: options.cesiumMap.clearAnalysis,
            clearHighlightedBuildings: options.cesiumMap.clearHighlightedBuildings,
            clearReviewDirection: options.cesiumMap.clearReviewDirection,
            focusObservation: options.cesiumMap.focusObservation,
            getMode: function () { return mode; },
            isSatelliteEnabled: function () { return satelliteEnabled; },
            hideScanMotion: options.cesiumMap.hideScanMotion,
            preload: preload,
            prepareAnimatedAnalysis: options.cesiumMap.prepareAnimatedAnalysis,
            revealAnalysisThrough: options.cesiumMap.revealAnalysisThrough,
            setAnalysisData: options.cesiumMap.setAnalysisData,
            setBuildingData: options.cesiumMap.setBuildingData,
            setDetailSelectedBuilding: options.cesiumMap.setDetailSelectedBuilding,
            setExcludedVisible: options.cesiumMap.setExcludedVisible,
            setVisibleAreaVisible: options.cesiumMap.setVisibleAreaVisible,
            setHighlightedBuildings: options.cesiumMap.setHighlightedBuildings,
            setObservation: setObservation,
            setObservationElevation: options.cesiumMap.setObservationElevation,
            setRevealedBuildings: options.cesiumMap.setRevealedBuildings,
            setRadiusVisible: options.cesiumMap.setRadiusVisible,
            setReviewDirection: options.cesiumMap.setReviewDirection,
            updateScanMotion: options.cesiumMap.updateScanMotion
        };
    }

    global.GisMapViewSwitcher = {
        create: create
    };
})(window);
