(function (global) {
    "use strict";

    function create(options) {
        var hoverFrame = null;
        var pendingHover = null;

        function clearBuildingHover() {
            pendingHover = null;
            options.buildingDisplay.clearBuildingHover();
            options.map.getTargetElement().style.cursor = "";
        }

        function updateBuildingHover(pixel, pointerType) {
            if (pointerType === "touch" || !options.scanController.isCompleted() ||
                    options.directionReview.isObservationSelectionMode()) {
                clearBuildingHover();
                return;
            }
            var feature = options.map.forEachFeatureAtPixel(pixel, function (candidate) {
                return candidate.get("scanRevealed") === true ? candidate : undefined;
            }, {
                hitTolerance: 2,
                layerFilter: function (layer) { return layer === options.buildingDisplay.layer; }
            });
            options.buildingDisplay.showBuildingHover(feature || null);
            options.map.getTargetElement().style.cursor = feature ? "pointer" : "";
        }

        function scheduleBuildingHover(event) {
            pendingHover = {
                pixel: event.pixel.slice(),
                pointerType: event.originalEvent && event.originalEvent.pointerType
            };
            if (hoverFrame !== null) return;
            hoverFrame = requestAnimationFrame(function () {
                var next = pendingHover;
                pendingHover = null;
                hoverFrame = null;
                if (next) updateBuildingHover(next.pixel, next.pointerType);
            });
        }

        function updateRangeProgress(input) {
            var min = Number(input.min);
            var max = Number(input.max);
            var value = Number(input.value);
            var progress = max === min ? 0 : (value - min) / (max - min) * 100;
            input.style.setProperty("--range-progress", progress + "%");
        }

        function updateCenterStatus() {
            var center = options.getCenter();
            var radius = options.getRadius();
            if (center === null) {
                document.getElementById("status").textContent =
                    "지도에서 건물 바깥의 관측점을 클릭하세요. 검색반경은 " +
                    radius + "m입니다.";
                return;
            }
            document.getElementById("status").textContent =
                "경도: " + center[0].toFixed(6) +
                " / 위도: " + center[1].toFixed(6) +
                " / 검색반경: " + radius + "m";
        }

        function toggleRadiusLayer() {
            var visible = !options.radiusLayer.getVisible();
            options.radiusLayer.setVisible(visible);
            if (typeof options.onRadiusVisibilityChange === "function") {
                options.onRadiusVisibilityChange(visible);
            }
            this.textContent = visible ? "원 외곽선 숨기기" : "원 외곽선 표시";
            this.setAttribute("aria-pressed", String(!visible));
        }

        function previewRadius() {
            document.getElementById("radiusValue").textContent = this.value + "m";
            document.getElementById("scanRadiusValue").textContent = this.value + "m";
            updateRangeProgress(this);
        }

        function markAnalysisPending(message) {
            if (options.getCenter() === null) return;
            document.getElementById("resultInfo").textContent = message;
            var button = document.getElementById("scanButton");
            if (!options.buildingLoader.isLoading()) {
                button.disabled = false;
                button.textContent = "다시 스캔";
            }
        }

        function applyRadius() {
            var radius = Number(this.value);
            options.setRadius(radius);
            document.getElementById("radiusValue").textContent = radius + "m";
            document.getElementById("scanRadiusValue").textContent = radius + "m";
            updateCenterStatus();
            // 반경 변경은 건물 조회 범위까지 달라지므로 값만 대기 상태로 저장합니다.
            // 기존 결과를 즉시 지우거나 자동 분석하지 않고 사용자가 다시 스캔할 때 적용합니다.
            markAnalysisPending("검색 반경이 변경되었습니다. 다시 스캔하면 새 조건을 적용합니다.");
        }

        function updateObserverHeightLabel() {
            document.getElementById("observerHeightValue").textContent =
                Number(this.value).toFixed(1) + "m";
            document.getElementById("scanObserverHeight").textContent =
                Number(this.value).toFixed(1) + "m";
            updateRangeProgress(this);
            if (typeof options.updateObserverCriterion === "function") {
                options.updateObserverCriterion();
            }
            markAnalysisPending("관측자 높이가 변경되었습니다. 다시 스캔하면 새 조건을 적용합니다.");
        }

        function stepControl() {
            var input = document.getElementById(this.dataset.control);
            var step = Number(this.dataset.step);
            var min = Number(input.min);
            var max = Number(input.max);
            var decimals = (input.step.split(".")[1] || "").length;
            var next = Math.max(min, Math.min(max, Number(input.value) + step));
            input.value = next.toFixed(decimals);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        function buildingDataMatches(center, radius) {
            var loadedOrigin = options.buildingSource.get("loadedOrigin");
            var loadedRadius = Number(options.buildingSource.get("loadedRadius"));
            return Array.isArray(loadedOrigin) && Number.isFinite(loadedRadius) &&
                Math.abs(loadedOrigin[0] - center[0]) < 1e-9 &&
                Math.abs(loadedOrigin[1] - center[1]) < 1e-9 &&
                Math.abs(loadedRadius - radius) < 1e-9;
        }

        function scanWithCurrentSettings() {
            clearBuildingHover();
            if (options.buildingDetail) options.buildingDetail.reset();
            var center = options.getCenter();
            if (center === null) return;
            var radius = options.getRadius();

            if (options.buildingLoader.isReady() && buildingDataMatches(center, radius)) {
                options.scanController.start();
                return;
            }

            // 검색 반경이 달라진 경우에만 건물과 DEM을 새 범위로 준비합니다.
            // 로더 완료 콜백이 분석을 이어서 시작하므로 한 번의 버튼 클릭으로 동작합니다.
            options.scanController.stop();
            options.mapLayers.clearFocusMask();
            options.hideAlert();
            options.resultSource.clear();
            if (typeof options.onAnalysisClear === "function") {
                options.onAnalysisClear();
            }
            options.mapLayers.drawSearchCircle(center, radius);
            if (typeof options.onObservationChange === "function") {
                options.onObservationChange(center, radius);
            }
            document.getElementById("resultInfo").textContent =
                "변경한 반경의 건물을 조회한 뒤 다시 스캔합니다.";
            options.buildingLoader.load();
        }

        function isKnownBuildingCoordinate(mapCoordinate) {
            return options.buildingSource.getFeatures().some(function (feature) {
                var geometry = feature.getGeometry();
                return geometry && geometry.intersectsCoordinate(mapCoordinate);
            });
        }

        function openHighlightedBuilding(event) {
            if (!options.buildingDetail || !options.scanController.isCompleted() ||
                    options.directionReview.isObservationSelectionMode()) {
                return false;
            }

            // 5단계: scanRevealed는 360° 스캔에서 실제 교차 대상으로 표시된 건물입니다.
            // highlightedBuildings는 현재 방위각의 임시 강조 Set이라 스캔 종료 시 비워지므로
            // 상세 클릭 판정에는 스캔 완료 후에도 유지되는 이 속성을 사용해야 합니다.
            var selectedFeature = options.map.forEachFeatureAtPixel(
                event.pixel,
                function (feature) {
                    return feature.get("scanRevealed") === true ? feature : undefined;
                },
                { hitTolerance: 4 }
            );
            if (!selectedFeature) return false;

            options.hideAlert();
            if (typeof options.directionReview.pointAt === "function") {
                options.directionReview.pointAt(ol.proj.toLonLat(event.coordinate));
            }
            options.buildingDetail.open(selectedFeature);
            return true;
        }

        function applyObservationPoint(clickedLonLat, mapCoordinate, animateMap,
                screenAlignedBearing) {
            if (options.directionReview.handleMapClick(
                    clickedLonLat,
                    screenAlignedBearing
                )) return;
            clearBuildingHover();
            if (options.buildingDetail) options.buildingDetail.reset();
            if (typeof options.onObservationSelectionStart === "function") {
                options.onObservationSelectionStart();
            }
            if (isKnownBuildingCoordinate(mapCoordinate)) {
                options.showAlert(
                    "관측점을 지정할 수 없습니다.",
                    "건물 내부 또는 경계가 아닌 빈 공간을 선택하세요.",
                    { transient: true }
                );
                return;
            }

            options.map.getView().cancelAnimations();
            options.hideAlert();
            options.mapLayers.clearFocusMask();
            document.getElementById("resultInfo").textContent =
                "선택한 위치가 관측 가능한 지점인지 확인하고 있습니다.";

            options.buildingLoader.load(clickedLonLat, function (acceptedCenter) {
                if (typeof options.updateObserverCriterion === "function") {
                    options.updateObserverCriterion(null);
                }
                options.scanController.reset(true);
                options.mapLayers.clearViewDirection(false);
                options.directionReview.reset();
                options.setCenter(acceptedCenter.slice());
                if (animateMap) {
                    options.map.getView().animate({
                        center: mapCoordinate,
                        duration: 500
                    });
                }

                options.centerSource.clear();
                options.centerSource.addFeature(new ol.Feature({
                    geometry: new ol.geom.Point(mapCoordinate)
                }));
                options.mapLayers.drawSearchCircle(acceptedCenter, options.getRadius());
                if (typeof options.onObservationChange === "function") {
                    options.onObservationChange(acceptedCenter, options.getRadius());
                }
                document.getElementById("resultInfo").textContent =
                    "스캔이 끝나면 남은 방향의 각도를 표시합니다.";
                updateCenterStatus();
            });
        }

        function selectObservationPoint(event) {
            // 하이라이트 건물 상세 클릭을 관측점 선택보다 먼저 소비해야 경고가 뜨지 않습니다.
            if (openHighlightedBuilding(event)) return;
            applyObservationPoint(
                ol.proj.toLonLat(event.coordinate),
                event.coordinate,
                true
            );
        }

        function selectObservationPointFromLonLat(clickedLonLat, screenAlignedBearing) {
            applyObservationPoint(
                clickedLonLat.slice(),
                ol.proj.fromLonLat(clickedLonLat),
                false,
                screenAlignedBearing
            );
        }

        document.getElementById("toggleRadiusButton").addEventListener(
            "click",
            toggleRadiusLayer
        );
        document.getElementById("radiusInput").addEventListener("input", previewRadius);
        document.getElementById("radiusInput").addEventListener("change", applyRadius);
        document.getElementById("showExcluded").addEventListener("change", function () {
            options.resultLayer.changed();
            if (typeof options.onExcludedVisibilityChange === "function") {
                options.onExcludedVisibilityChange(this.checked);
            }
        });
        document.getElementById("showVisible").addEventListener("change", function () {
            options.resultLayer.changed();
            if (typeof options.onVisibleVisibilityChange === "function") {
                options.onVisibleVisibilityChange(this.checked);
            }
        });
        document.getElementById("observerHeight").addEventListener(
            "input",
            updateObserverHeightLabel
        );
        document.querySelectorAll(".control-step").forEach(function (button) {
            button.addEventListener("click", stepControl);
        });
        ["observerHeight", "radiusInput"].forEach(function (id) {
            updateRangeProgress(document.getElementById(id));
        });
        document.getElementById("scanButton").addEventListener(
            "click",
            scanWithCurrentSettings
        );
        options.map.on("singleclick", selectObservationPoint);
        options.map.on("pointermove", scheduleBuildingHover);
        options.map.getViewport().addEventListener("pointerleave", clearBuildingHover);

        return {
            selectObservationPoint: selectObservationPointFromLonLat
        };
    }

    global.GisMapInteractions = {
        create: create
    };
})(window);
