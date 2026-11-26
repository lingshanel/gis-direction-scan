(function (global) {
    "use strict";

    /**
     * Cesium 뷰어를 만들고 건물·관측점·방향 검토·분석 영역 모듈을 연결합니다.
     * 개별 표현 효과는 전용 모듈이 소유하고, 이 파일은 2D에서 받은 상태를 보관해
     * 뷰어가 늦게 생성되더라도 같은 상태를 3D 장면에 재적용하는 조정자 역할을 합니다.
     */
    function create(options) {
        var theme = global.GisVisualTheme;
        var colors = theme.colors;
        var viewer = null;
        var buildings = null;
        var thematicMap = null;
        var visibilityRegions = null;
        var scanMotion = null;
        var observationRenderer = null;
        var focusMask = null;
        var focusMaskDataSource = null;
        var reviewDirectionRenderer = null;
        var clickHandler = null;
        var pendingBuildingData = null;
        var pendingAnalysisData = null;
        var pendingAnimatedAnalysisData = null;
        var pendingAnalysisBearing = 0;
        var pendingScanMotion = null;
        var pendingObservationCenter = null;
        var pendingObservationRadius = 0;
        var pendingObservationElevation = null;
        var pendingReviewDirection = null;
        var pendingHighlightedBuildingIds = [];
        var pendingDetailSelectedBuildingId = null;
        var pendingRevealedBuildingIds = [];
        var zoomChangeListeners = [];
        var buildingHoverTimer = null;
        var pendingBuildingHoverPosition = null;
        var radiusVisible = true;
        var excludedVisible = true;
        var visibleAreaVisible = true;
        var workspaceOffsetAnimationId = null;
        var appliedWorkspaceOffsetPixels = 0;
        var terrainReadyPromise = Promise.resolve(null);
        var preloadPromise = null;
        var preloadKey = null;
        var warmedSceneKey = null;
        var preloadVersion = 0;
        var cartographicLayer = null;
        var satelliteLayer = null;
        var satelliteEnabled = false;

        function ensureSatelliteLayer() {
            if (viewer === null || satelliteLayer !== null) return satelliteLayer;
            satelliteLayer = viewer.imageryLayers.addImageryProvider(
                new Cesium.UrlTemplateImageryProvider({
                    url: "https://services.arcgisonline.com/ArcGIS/rest/services/" +
                        "World_Imagery/MapServer/tile/{z}/{y}/{x}",
                    credit: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
                    maximumLevel: 19
                })
            );
            satelliteLayer.show = false;
            return satelliteLayer;
        }

        function applyImageryMode() {
            if (viewer === null || cartographicLayer === null) return;
            cartographicLayer.show = !satelliteEnabled;
            if (satelliteEnabled) ensureSatelliteLayer();
            if (satelliteLayer !== null) satelliteLayer.show = satelliteEnabled;
            viewer.container.setAttribute(
                "data-imagery-state",
                satelliteEnabled ? "satellite" : "cartographic"
            );
            viewer.scene.requestRender();
        }

        function setSatelliteEnabled(enabled) {
            satelliteEnabled = Boolean(enabled);
            applyImageryMode();
        }

        function bringFocusMaskToFront() {
            if (viewer === null || focusMaskDataSource === null ||
                    !viewer.dataSources.contains(focusMaskDataSource)) return;
            viewer.dataSources.raiseToTop(focusMaskDataSource);
            viewer.scene.requestRender();
        }

        function emitScreenBuildingCount() {
            if (viewer === null || buildings === null ||
                    typeof options.onScreenBuildingCountChange !== "function") return;
            options.onScreenBuildingCountChange(
                buildings.countVisibleBuildingIds(pendingRevealedBuildingIds)
            );
        }

        function clearBuildingHover() {
            pendingBuildingHoverPosition = null;
            if (buildingHoverTimer !== null) {
                clearTimeout(buildingHoverTimer);
                buildingHoverTimer = null;
            }
            if (buildings !== null) buildings.setHovered(null);
            if (viewer !== null) viewer.scene.canvas.style.cursor = "";
            if (typeof options.onBuildingHover === "function") {
                options.onBuildingHover(null, null);
            }
        }

        function scheduleBuildingHover(screenPosition) {
            if (!screenPosition) {
                clearBuildingHover();
                return;
            }
            pendingBuildingHoverPosition = Cesium.Cartesian2.clone(screenPosition);
            if (buildingHoverTimer !== null) return;
            // drillPick은 분류 영역 뒤의 건물을 찾기 위해 필요하지만 매 프레임 실행할
            // 필요는 없습니다. 최신 좌표만 보관해 초당 약 20회로 제한합니다.
            buildingHoverTimer = setTimeout(function () {
                buildingHoverTimer = null;
                var position = pendingBuildingHoverPosition;
                pendingBuildingHoverPosition = null;
                if (position === null || buildings === null || viewer === null) return;
                var id = buildings.pickBuildingId(position);
                var accepted = typeof options.onBuildingHover === "function" &&
                    options.onBuildingHover(id, position) === true;
                buildings.setHovered(accepted ? id : null);
                viewer.scene.canvas.style.cursor = accepted ? "pointer" : "";
            }, 50);
        }

        function loadWorldTerrain(activeViewer) {
            var token = String(options.ionAccessToken || "").trim();
            var container = activeViewer.container;
            if (!token) {
                container.setAttribute("data-terrain-state", "flat-fallback");
                console.info(
                    "CESIUM_ION_TOKEN이 없어 3D 지형 대신 기본 평면 지구를 사용합니다."
                );
                return Promise.resolve(null);
            }

            Cesium.Ion.defaultAccessToken = token;
            container.setAttribute("data-terrain-state", "loading");
            return Cesium.createWorldTerrainAsync({
                requestVertexNormals: true,
                requestWaterMask: true
            }).then(function (terrainProvider) {
                if (viewer !== activeViewer) return null;
                activeViewer.terrainProvider = terrainProvider;
                container.setAttribute("data-terrain-state", "ready");
                activeViewer.scene.requestRender();
                return terrainProvider;
            }).catch(function (error) {
                container.setAttribute("data-terrain-state", "flat-fallback");
                console.warn(
                    "Cesium World Terrain을 불러오지 못해 기본 평면 지구를 사용합니다.",
                    error
                );
                return null;
            });
        }

        function observationCentersEqual(first, second) {
            return first !== null && second !== null &&
                Math.abs(first[0] - second[0]) <= 0.0000001 &&
                Math.abs(first[1] - second[1]) <= 0.0000001;
        }

        function matchesObservationCenter(center) {
            return observationCentersEqual(center, pendingObservationCenter);
        }

        function observationGroundHeight(center) {
            return observationRenderer === null
                ? 0
                : observationRenderer.getGroundHeight(center);
        }

        function ensureViewer() {
            if (viewer !== null) return viewer;

            viewer = new Cesium.Viewer(options.target, {
                baseLayer: false,
                animation: false,
                timeline: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                baseLayerPicker: false,
                navigationHelpButton: false,
                fullscreenButton: false,
                selectionIndicator: false,
                infoBox: false,
                requestRenderMode: true,
                maximumRenderTimeChange: Infinity
            });
            terrainReadyPromise = loadWorldTerrain(viewer);
            // 3D 건물·지형 장면에서 전체 해상도 렌더링은 픽셀 부하를 크게
            // 늘리므로 기존의 균형값을 유지합니다.
            viewer.resolutionScale = 0.85;
            cartographicLayer = viewer.imageryLayers.addImageryProvider(
                new Cesium.OpenStreetMapImageryProvider({
                    url: "https://tile.openstreetmap.org/"
                })
            );
            cartographicLayer.alpha = 0.34;
            cartographicLayer.brightness = 1.12;
            cartographicLayer.contrast = 0.84;
            cartographicLayer.saturation = 0.16;
            cartographicLayer.gamma = 1.04;
            applyImageryMode();
            viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(colors.canvas);
            viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(colors.land);
            viewer.scene.light = new Cesium.SunLight();
            viewer.shadows = false;
            viewer.scene.globe.enableLighting = false;
            if (viewer.scene.shadowMap) viewer.scene.shadowMap.enabled = false;
            viewer.scene.globe.maximumScreenSpaceError = 4;
            viewer.scene.globe.preloadAncestors = false;
            viewer.scene.globe.preloadSiblings = false;
            viewer.scene.globe.depthTestAgainstTerrain = true;
            if ("msaaSamples" in viewer.scene) {
                viewer.scene.msaaSamples = 1;
            }
            if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
                // 낮춘 해상도에서도 건물 모서리와 반투명 분석 영역이 부드럽게
                // 이어지도록 가벼운 후처리 안티앨리어싱을 사용합니다.
                viewer.scene.postProcessStages.fxaa.enabled = true;
            }
            focusMaskDataSource = new Cesium.CustomDataSource("analysis-focus-mask");
            Promise.resolve(viewer.dataSources.add(focusMaskDataSource)).then(function () {
                bringFocusMaskToFront();
            });
            thematicMap = GisCesiumThematicMap.create(viewer, {
                endpoint: options.thematicEndpoint
            });
            buildings = GisCesiumBuildings.create(viewer, {
                osmEnabled: Boolean(String(options.ionAccessToken || "").trim())
            });
            buildings.setDetailSelected(pendingDetailSelectedBuildingId);
            buildings.setRevealed(pendingRevealedBuildingIds);
            visibilityRegions = GisCesiumVisibilityRegions.create(viewer);
            observationRenderer = GisCesiumObservation.create(viewer, {
                terrainReadyPromise: terrainReadyPromise
            });
            observationRenderer.setRadiusVisible(radiusVisible);
            observationRenderer.set(pendingObservationCenter, pendingObservationRadius);
            if (pendingObservationElevation !== null) {
                observationRenderer.setElevation(
                    pendingObservationCenter,
                    pendingObservationElevation.groundHeight,
                    pendingObservationElevation.observerHeight
                );
            }
            scanMotion = GisCesiumScanMotion.create(viewer, {
                getTerrainHeight: observationRenderer.getRadiusTerrainHeight
            });
            reviewDirectionRenderer = GisCesiumReviewDirection.create(viewer, {
                startHeight: function (center) {
                    return observationRenderer.getEyeHeight(center);
                },
                endHeight: observationRenderer.getRadiusTerrainHeight
            });
            clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
            clickHandler.setInputAction(function (movement) {
                var pickedBuildingId = buildings.pickBuildingId(movement.position);
                if (pickedBuildingId !== null &&
                        typeof options.onBuildingSelected === "function" &&
                        options.onBuildingSelected(pickedBuildingId) === true) {
                    return;
                }
                var pickRay = viewer.camera.getPickRay(movement.position);
                var cartesian = pickRay
                    ? viewer.scene.globe.pick(pickRay, viewer.scene)
                    : null;
                if (!Cesium.defined(cartesian)) {
                    cartesian = viewer.camera.pickEllipsoid(
                        movement.position,
                        viewer.scene.globe.ellipsoid
                    );
                }
                if (!cartesian || typeof options.onPositionSelected !== "function") return;
                var cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                options.onPositionSelected([
                    Cesium.Math.toDegrees(cartographic.longitude),
                    Cesium.Math.toDegrees(cartographic.latitude)
                ], reviewBearingFromScreenPosition(movement.position));
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
            clickHandler.setInputAction(function (movement) {
                scheduleBuildingHover(movement.endPosition);
            }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
            viewer.scene.canvas.addEventListener("pointerleave", clearBuildingHover);
            viewer.camera.moveEnd.addEventListener(function () {
                emitScreenBuildingCount();
                emitZoomChange();
            });

            if (pendingReviewDirection !== null) {
                setReviewDirection(
                    pendingReviewDirection.center,
                    pendingReviewDirection.bearing,
                    pendingReviewDirection.radius,
                    false
                );
            }

            if (pendingBuildingData !== null) {
                buildings.replace(pendingBuildingData).then(function () {
                    buildings.setHighlighted(pendingHighlightedBuildingIds);
                }).catch(function (error) {
                    console.error("Cesium 건물 표시 실패", error);
                });
            }
            if (pendingAnalysisData !== null) {
                visibilityRegions.replace(pendingAnalysisData).catch(function (error) {
                    console.error("Cesium 분석 영역 표시 실패", error);
                });
            } else if (pendingAnimatedAnalysisData !== null) {
                visibilityRegions.prepare(pendingAnimatedAnalysisData).then(function () {
                    visibilityRegions.revealThrough(pendingAnalysisBearing);
                }).catch(function (error) {
                    console.error("Cesium 진행 영역 준비 실패", error);
                });
            }
            renderFocusMask(pendingAnalysisData !== null);
            buildings.setAnalysisFocus(
                pendingObservationCenter,
                pendingObservationRadius,
                pendingAnalysisData !== null
            );
            visibilityRegions.setExcludedVisible(excludedVisible);
            visibilityRegions.setVisibleAreaVisible(visibleAreaVisible);
            if (pendingScanMotion !== null) {
                scanMotion.update(
                    pendingScanMotion.origin,
                    pendingScanMotion.bearing,
                    pendingScanMotion.radius
                );
            }
            return viewer;
        }

        function moveCamera(center, radius, duration) {
            var activeViewer = ensureViewer();
            var height = Math.max(450, Number(radius || 300) * 2.4);
            var flightDuration = Number.isFinite(Number(duration))
                ? Number(duration)
                : 0.7;
            if (workspaceOffsetAnimationId !== null) {
                cancelAnimationFrame(workspaceOffsetAnimationId);
                workspaceOffsetAnimationId = null;
            }
            appliedWorkspaceOffsetPixels = 0;
            activeViewer.camera.flyToBoundingSphere(
                new Cesium.BoundingSphere(
                    Cesium.Cartesian3.fromDegrees(
                        center[0],
                        center[1],
                        observationGroundHeight(center)
                    ),
                    1
                ), {
                offset: new Cesium.HeadingPitchRange(
                    Cesium.Math.toRadians(0),
                    Cesium.Math.toRadians(-45),
                    height
                ),
                duration: flightDuration
            });
        }

        function waitForInitialScene(activeViewer, osmTileset) {
            return new Promise(function (resolve) {
                var startedAt = performance.now();
                var stableFrames = 0;
                var finished = false;
                var removePostRender = null;
                var timeoutId = null;
                var renderTimer = null;

                function finish() {
                    if (finished) return;
                    finished = true;
                    if (typeof removePostRender === "function") removePostRender();
                    if (timeoutId !== null) clearTimeout(timeoutId);
                    if (renderTimer !== null) clearInterval(renderTimer);
                    resolve();
                }

                function inspectFrame() {
                    var elapsed = performance.now() - startedAt;
                    var globeReady = activeViewer.scene.globe.tilesLoaded;
                    var buildingsReady = !osmTileset || osmTileset.tilesLoaded;
                    stableFrames = globeReady && buildingsReady
                        ? stableFrames + 1
                        : 0;
                    if (elapsed >= 700 && stableFrames >= 3) finish();
                }

                removePostRender = activeViewer.scene.postRender.addEventListener(inspectFrame);
                timeoutId = setTimeout(finish, 3200);
                renderTimer = setInterval(function () {
                    activeViewer.scene.requestRender();
                }, 100);
                activeViewer.scene.requestRender();
            });
        }

        function sceneKey(center, radius) {
            return center[0].toFixed(5) + ":" + center[1].toFixed(5) + ":" +
                Math.round(Number(radius) || 500);
        }

        function preload(center, radius) {
            var activeViewer = ensureViewer();
            var targetCenter = (center || options.defaultCenter).slice();
            var targetRadius = Number(radius) || 500;
            var targetKey = sceneKey(targetCenter, targetRadius);
            if (warmedSceneKey === targetKey) return Promise.resolve(activeViewer);
            if (preloadPromise !== null && preloadKey === targetKey) return preloadPromise;

            var version = ++preloadVersion;
            preloadKey = targetKey;
            var thematicRadius = Math.max(2000, Math.min(3000, targetRadius * 4));
            activeViewer.resize();
            moveCamera(targetCenter, targetRadius, 0);
            var thematicPromise = thematicMap.load(
                targetCenter,
                thematicRadius,
                targetRadius
            ).then(function (result) {
                bringFocusMaskToFront();
                return result;
            });
            preloadPromise = Promise.all([
                terrainReadyPromise,
                buildings.getOsmReadyPromise(),
                thematicPromise
            ]).then(function (results) {
                activeViewer.scene.requestRender();
                return waitForInitialScene(activeViewer, results[1]);
            }).then(function () {
                if (version === preloadVersion) warmedSceneKey = targetKey;
                return activeViewer;
            }).catch(function (error) {
                if (version === preloadVersion) {
                    preloadPromise = null;
                    preloadKey = null;
                }
                throw error;
            });
            return preloadPromise;
        }

        function show(center, radius) {
            var activeViewer = ensureViewer();
            var targetCenter = (center || options.defaultCenter).slice();
            activeViewer.resize();
            var analysisVisible = pendingAnalysisData !== null ||
                pendingAnimatedAnalysisData !== null;
            renderFocusMask(analysisVisible);
            buildings.setAnalysisFocus(
                pendingObservationCenter,
                pendingObservationRadius,
                analysisVisible
            );
            return preload(targetCenter, Number(radius) || 500).then(function () {
                if (matchesObservationCenter(targetCenter)) {
                    return observationRenderer.sampleTerrainHeight();
                }
                return null;
            }).then(function () {
                moveCamera(targetCenter, radius, 0);
                activeViewer.scene.requestRender();
                return activeViewer;
            });
        }

        function setBuildingData(featureCollection) {
            pendingBuildingData = featureCollection;
            if (buildings === null) return Promise.resolve(null);
            return buildings.replace(featureCollection).then(function (dataSource) {
                buildings.setHighlighted(pendingHighlightedBuildingIds);
                buildings.setDetailSelected(pendingDetailSelectedBuildingId);
                buildings.setRevealed(pendingRevealedBuildingIds);
                bringFocusMaskToFront();
                return dataSource;
            });
        }

        function setHighlightedBuildings(ids) {
            pendingHighlightedBuildingIds = Array.isArray(ids) ? ids.slice() : [];
            if (buildings !== null) {
                buildings.setHighlighted(pendingHighlightedBuildingIds);
            }
        }

        function clearHighlightedBuildings() {
            setHighlightedBuildings([]);
        }

        function focusObservation(center, horizontalOffsetPixels) {
            if (!center) return;
            var activeViewer = ensureViewer();
            var targetOffset = Math.max(0, Number(horizontalOffsetPixels) || 0);
            var deltaPixels = targetOffset - appliedWorkspaceOffsetPixels;
            if (Math.abs(deltaPixels) < 0.5) return;

            if (workspaceOffsetAnimationId !== null) {
                cancelAnimationFrame(workspaceOffsetAnimationId);
                workspaceOffsetAnimationId = null;
            }

            var canvas = activeViewer.scene.canvas;
            var width = Math.max(1, canvas.clientWidth || canvas.width);
            var height = Math.max(1, canvas.clientHeight || canvas.height);
            var target = Cesium.Cartesian3.fromDegrees(
                center[0],
                center[1],
                observationGroundHeight(center)
            );
            var distance = Cesium.Cartesian3.distance(
                activeViewer.camera.positionWC,
                target
            );
            var verticalFov = activeViewer.camera.frustum.fovy;
            if (!Number.isFinite(verticalFov)) {
                verticalFov = activeViewer.camera.frustum.fov;
            }
            if (!Number.isFinite(verticalFov) || !Number.isFinite(distance)) return;

            var horizontalFov = 2 * Math.atan(
                Math.tan(verticalFov / 2) * width / height
            );
            var metersPerPixel = 2 * distance * Math.tan(horizontalFov / 2) / width;
            var totalMeters = deltaPixels * metersPerPixel;
            var startOffset = appliedWorkspaceOffsetPixels;
            var startedAt = performance.now();
            var duration = 620;
            var previousProgress = 0;

            function animate(now) {
                var linear = Math.min((now - startedAt) / duration, 1);
                var progress = 1 - Math.pow(1 - linear, 3);
                activeViewer.camera.moveLeft(
                    totalMeters * (progress - previousProgress)
                );
                previousProgress = progress;
                appliedWorkspaceOffsetPixels = startOffset + deltaPixels * progress;
                activeViewer.scene.requestRender();
                if (linear < 1) {
                    workspaceOffsetAnimationId = requestAnimationFrame(animate);
                } else {
                    workspaceOffsetAnimationId = null;
                    appliedWorkspaceOffsetPixels = targetOffset;
                }
            }

            workspaceOffsetAnimationId = requestAnimationFrame(animate);
        }

        function setObservation(center, radius) {
            var nextCenter = center ? center.slice() : null;
            var sameCenter = observationCentersEqual(
                pendingObservationCenter,
                nextCenter
            );
            pendingObservationCenter = nextCenter;
            pendingObservationRadius = Number(radius) || 0;
            if (!sameCenter) pendingObservationElevation = null;
            if (observationRenderer !== null) {
                observationRenderer.set(
                    pendingObservationCenter,
                    pendingObservationRadius
                );
            }
            if (viewer !== null && pendingObservationCenter !== null) {
                thematicMap.load(
                    pendingObservationCenter,
                    Math.max(2000, Math.min(3000, pendingObservationRadius * 4)),
                    pendingObservationRadius
                ).then(function () {
                    bringFocusMaskToFront();
                });
            }
        }

        function positionsFromRing(ring) {
            var degrees = [];
            ring.forEach(function (coordinate) {
                degrees.push(coordinate[0], coordinate[1]);
            });
            return Cesium.Cartesian3.fromDegreesArray(degrees);
        }

        function reviewBearingFromScreenPosition(screenPosition) {
            if (viewer === null || pendingObservationCenter === null ||
                    pendingObservationRadius <= 0 || !screenPosition) return null;

            var startPosition = Cesium.Cartesian3.fromDegrees(
                pendingObservationCenter[0],
                pendingObservationCenter[1],
                observationRenderer.getEyeHeight(pendingObservationCenter)
            );
            var startScreen = Cesium.SceneTransforms.worldToWindowCoordinates(
                viewer.scene,
                startPosition
            );
            if (!Cesium.defined(startScreen)) return null;

            var targetX = screenPosition.x - startScreen.x;
            var targetY = screenPosition.y - startScreen.y;
            if (targetX * targetX + targetY * targetY < 4) return null;

            function angularError(bearing) {
                var normalizedBearing = (bearing + 360) % 360;
                var end = turf.destination(
                    pendingObservationCenter,
                    pendingObservationRadius / 1000,
                    normalizedBearing,
                    { units: "kilometers" }
                ).geometry.coordinates;
                var endPosition = Cesium.Cartesian3.fromDegrees(
                    end[0],
                    end[1],
                    observationRenderer.getRadiusTerrainHeight(end)
                );
                var endScreen = Cesium.SceneTransforms.worldToWindowCoordinates(
                    viewer.scene,
                    endPosition
                );
                if (!Cesium.defined(endScreen)) return Number.POSITIVE_INFINITY;
                var directionX = endScreen.x - startScreen.x;
                var directionY = endScreen.y - startScreen.y;
                if (directionX * directionX + directionY * directionY < 1) {
                    return Number.POSITIVE_INFINITY;
                }
                var cross = targetX * directionY - targetY * directionX;
                var dot = targetX * directionX + targetY * directionY;
                return Math.abs(Math.atan2(cross, dot));
            }

            var bestBearing = null;
            var bestError = Number.POSITIVE_INFINITY;
            var bearing;
            for (bearing = 0; bearing < 360; bearing += 4) {
                var error = angularError(bearing);
                if (error < bestError) {
                    bestError = error;
                    bestBearing = bearing;
                }
            }
            if (bestBearing === null) return null;

            var coarseBearing = bestBearing;
            for (bearing = coarseBearing - 4; bearing <= coarseBearing + 4;
                    bearing += 0.1) {
                var refinedError = angularError(bearing);
                if (refinedError < bestError) {
                    bestError = refinedError;
                    bestBearing = bearing;
                }
            }
            return (bestBearing + 360) % 360;
        }

        function renderFocusMask(visible) {
            if (viewer === null) return;
            if (!visible || pendingObservationCenter === null || pendingObservationRadius <= 0) {
                if (focusMask !== null) focusMask.show = false;
                viewer.scene.requestRender();
                return;
            }

            var innerRadius = Number(pendingObservationRadius);
            var outerRadius = Math.max(3500, innerRadius * 8);
            var outerRing = turf.circle(pendingObservationCenter, outerRadius / 1000, {
                steps: 360,
                units: "kilometers"
            }).geometry.coordinates[0];
            var innerRing = turf.circle(pendingObservationCenter, innerRadius / 1000, {
                steps: 360,
                units: "kilometers"
            }).geometry.coordinates[0];
            var hierarchy = new Cesium.PolygonHierarchy(
                positionsFromRing(outerRing),
                [new Cesium.PolygonHierarchy(positionsFromRing(innerRing))]
            );

            if (focusMask === null) {
                focusMask = focusMaskDataSource.entities.add({
                    show: true,
                    polygon: {
                        hierarchy: hierarchy,
                        material: Cesium.Color.fromCssColorString(colors.focusMask)
                            .withAlpha(theme.focusMaskOpacity),
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        // 2D처럼 원 바깥의 배경과 3D Tiles를 함께 어둡게 표시합니다.
                        classificationType: Cesium.ClassificationType.BOTH,
                        arcType: Cesium.ArcType.GEODESIC,
                        outline: false,
                        zIndex: 1000
                    }
                });
            } else {
                focusMask.polygon.hierarchy = hierarchy;
                focusMask.show = true;
            }
            bringFocusMaskToFront();
            viewer.scene.requestRender();
        }

        function setObservationElevation(center, groundHeight, observerHeight) {
            if (!center || pendingObservationCenter === null) return;
            if (Math.abs(center[0] - pendingObservationCenter[0]) > 0.0000001 ||
                    Math.abs(center[1] - pendingObservationCenter[1]) > 0.0000001) return;

            var ground = Number(groundHeight);
            var observer = Number(observerHeight);
            if (!Number.isFinite(ground) || !Number.isFinite(observer)) return;
            pendingObservationElevation = {
                groundHeight: ground,
                observerHeight: observer,
                absoluteHeight: ground + observer
            };
            if (observationRenderer !== null) {
                observationRenderer.setElevation(center, ground, observer);
            }
        }

        function setRadiusVisible(visible) {
            radiusVisible = Boolean(visible);
            if (observationRenderer !== null) {
                observationRenderer.setRadiusVisible(radiusVisible);
            }
        }

        function setReviewDirection(center, bearing, radius, animateDirection) {
            pendingReviewDirection = {
                center: center.slice(),
                bearing: Number(bearing),
                radius: Number(radius)
            };
            if (reviewDirectionRenderer !== null) {
                reviewDirectionRenderer.set(center, bearing, radius, animateDirection);
            }
        }

        function clearReviewDirection(animateDirection) {
            pendingReviewDirection = null;
            if (reviewDirectionRenderer !== null) {
                reviewDirectionRenderer.clear(animateDirection);
            }
        }

        function setAnalysisData(featureCollection) {
            pendingAnalysisData = featureCollection;
            pendingAnimatedAnalysisData = null;
            if (visibilityRegions === null) return Promise.resolve(null);
            return visibilityRegions.replace(featureCollection).then(function (dataSource) {
                visibilityRegions.setExcludedVisible(excludedVisible);
                visibilityRegions.setVisibleAreaVisible(visibleAreaVisible);
                renderFocusMask(true);
                buildings.setAnalysisFocus(
                    pendingObservationCenter,
                    pendingObservationRadius,
                    true
                );
                bringFocusMaskToFront();
                return dataSource;
            });
        }

        function clearAnalysis() {
            pendingAnalysisData = null;
            pendingAnimatedAnalysisData = null;
            pendingAnalysisBearing = 0;
            if (visibilityRegions !== null) visibilityRegions.clear();
            renderFocusMask(false);
            if (buildings !== null) {
                buildings.setAnalysisFocus(null, 0, false);
            }
        }

        function prepareAnimatedAnalysis(featureCollection) {
            pendingAnalysisData = null;
            pendingAnimatedAnalysisData = featureCollection;
            pendingAnalysisBearing = 0;
            renderFocusMask(true);
            if (buildings !== null) {
                buildings.setAnalysisFocus(
                    pendingObservationCenter,
                    pendingObservationRadius,
                    true
                );
            }
            if (visibilityRegions === null) return Promise.resolve(null);
            return visibilityRegions.prepare(featureCollection).then(function (dataSource) {
                bringFocusMaskToFront();
                return dataSource;
            });
        }

        function revealAnalysisThrough(bearing) {
            pendingAnalysisBearing = bearing;
            if (visibilityRegions !== null) {
                visibilityRegions.revealThrough(bearing);
            }
        }

        function setExcludedVisible(visible) {
            excludedVisible = Boolean(visible);
            if (visibilityRegions !== null) {
                visibilityRegions.setExcludedVisible(excludedVisible);
            }
        }

        function setVisibleAreaVisible(visible) {
            visibleAreaVisible = Boolean(visible);
            if (visibilityRegions !== null) {
                visibilityRegions.setVisibleAreaVisible(visibleAreaVisible);
            }
        }

        function setDetailSelectedBuilding(id) {
            pendingDetailSelectedBuildingId = id === null || id === undefined
                ? null
                : String(id);
            if (buildings !== null) {
                buildings.setDetailSelected(pendingDetailSelectedBuildingId);
            }
        }

        function setRevealedBuildings(ids) {
            pendingRevealedBuildingIds = Array.isArray(ids) ? ids.slice() : [];
            if (buildings !== null) buildings.setRevealed(pendingRevealedBuildingIds);
            emitScreenBuildingCount();
        }

        function updateScanMotion(origin, bearing, radius) {
            pendingScanMotion = {
                origin: origin.slice(),
                bearing: bearing,
                radius: radius
            };
            if (scanMotion !== null) scanMotion.update(origin, bearing, radius);
        }

        function hideScanMotion() {
            pendingScanMotion = null;
            if (scanMotion !== null) scanMotion.hide();
        }

        function zoomLevelFromHeight(height) {
            var minimumHeight = 30;
            var maximumHeight = 12000;
            var safeHeight = Math.max(minimumHeight, Math.min(maximumHeight, height));
            return (1 - Math.log(safeHeight / minimumHeight) /
                Math.log(maximumHeight / minimumHeight)) * 100;
        }

        function getZoomLevel() {
            if (viewer === null) return 50;
            return zoomLevelFromHeight(viewer.camera.positionCartographic.height);
        }

        function emitZoomChange() {
            var level = getZoomLevel();
            zoomChangeListeners.forEach(function (listener) {
                listener(level);
            });
        }

        function onZoomChange(listener) {
            if (typeof listener === "function") zoomChangeListeners.push(listener);
        }

        function setZoomLevel(level) {
            if (viewer === null) return;
            var normalized = Math.max(0, Math.min(100, Number(level) || 0));
            var minimumHeight = 30;
            var maximumHeight = 12000;
            var targetHeight = minimumHeight * Math.pow(
                maximumHeight / minimumHeight,
                1 - normalized / 100
            );
            var camera = viewer.camera;
            var currentHeight = camera.positionCartographic.height;
            var verticalRatio = Math.max(0.25, Math.abs(Math.sin(camera.pitch)));
            var travelDistance = Math.abs(currentHeight - targetHeight) / verticalRatio;

            // 카메라의 주시 방향을 유지한 채 이동해야 슬라이더 조작 중 관측점이
            // 옆으로 밀리지 않습니다. 고도 차이를 시선 방향 거리로 환산합니다.
            if (targetHeight < currentHeight) camera.zoomIn(travelDistance);
            else camera.zoomOut(travelDistance);
            viewer.scene.requestRender();
            emitZoomChange();
        }

        return {
            clearBuildingHover: clearBuildingHover,
            clearAnalysis: clearAnalysis,
            clearHighlightedBuildings: clearHighlightedBuildings,
            clearReviewDirection: clearReviewDirection,
            setAnalysisData: setAnalysisData,
            setBuildingData: setBuildingData,
            setDetailSelectedBuilding: setDetailSelectedBuilding,
            setExcludedVisible: setExcludedVisible,
            setVisibleAreaVisible: setVisibleAreaVisible,
            focusObservation: focusObservation,
            getZoomLevel: getZoomLevel,
            setHighlightedBuildings: setHighlightedBuildings,
            hideScanMotion: hideScanMotion,
            onZoomChange: onZoomChange,
            prepareAnimatedAnalysis: prepareAnimatedAnalysis,
            preload: preload,
            revealAnalysisThrough: revealAnalysisThrough,
            setObservation: setObservation,
            setObservationElevation: setObservationElevation,
            setRevealedBuildings: setRevealedBuildings,
            setRadiusVisible: setRadiusVisible,
            setReviewDirection: setReviewDirection,
            setSatelliteEnabled: setSatelliteEnabled,
            setZoomLevel: setZoomLevel,
            updateScanMotion: updateScanMotion,
            show: show
        };
    }

    global.GisCesiumMap = {
        create: create
    };
})(window);
