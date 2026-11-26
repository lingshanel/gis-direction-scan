(function (global) {
    "use strict";

    /**
     * 3D 관측점의 마커·높이 기둥·검색 반경과 지형고도 샘플링을 함께 관리합니다.
     * 이 요소들은 동일한 관측점과 지형 기준고도를 공유해야 서로 떠 있거나 어긋나지
     * 않으므로 한 모듈이 상태를 소유하고, cesium-map에는 장면 조정만 남깁니다.
     */
    function create(viewer, options) {
        var theme = global.GisVisualTheme;
        var colors = theme.colors;
        var center = null;
        var radius = 0;
        var elevation = null;
        var radiusVisible = true;
        var animationId = null;
        var transitionVersion = 0;
        var transitionActive = false;
        var displayedCenter = null;
        var displayedGroundHeight = 0;
        var displayedPillarHeight = 0;
        var displayedPillarPosition = Cesium.Cartesian3.fromDegrees(0, 0);
        var animationKey = null;
        var terrainSampleVersion = 0;
        var terrainGroundHeight = null;
        var terrainPromise = Promise.resolve(null);
        var radiusTerrainSampleVersion = 0;
        var radiusTerrainKey = null;
        var radiusTerrainPoints = [];

        function centersEqual(first, second) {
            return first !== null && second !== null &&
                Math.abs(first[0] - second[0]) <= 0.0000001 &&
                Math.abs(first[1] - second[1]) <= 0.0000001;
        }

        function matchesCenter(candidate) {
            return centersEqual(candidate, center);
        }

        function getGroundHeight(candidate) {
            return matchesCenter(candidate) && Number.isFinite(terrainGroundHeight)
                ? terrainGroundHeight
                : 0;
        }

        function createMarker() {
            var ratio = 2;
            var size = 32;
            var canvas = document.createElement("canvas");
            canvas.width = size * ratio;
            canvas.height = size * ratio;
            var context = canvas.getContext("2d");
            context.scale(ratio, ratio);
            context.beginPath();
            context.arc(size / 2, size / 2, 9, 0, Math.PI * 2);
            context.strokeStyle = theme.rgba(colors.surface, 0.97);
            context.lineWidth = 7;
            context.stroke();
            context.beginPath();
            context.arc(size / 2, size / 2, 9, 0, Math.PI * 2);
            context.strokeStyle = colors.accent;
            context.lineWidth = 4;
            context.stroke();
            context.beginPath();
            context.arc(size / 2, size / 2, 2.5, 0, Math.PI * 2);
            context.fillStyle = colors.accent;
            context.fill();
            return canvas;
        }

        var observationPoint = viewer.entities.add({
            show: false,
            position: Cesium.Cartesian3.fromDegrees(0, 0),
            billboard: {
                show: false,
                image: createMarker(),
                scale: 0.78,
                pixelOffset: Cesium.Cartesian2.ZERO,
                scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 3000, 0.62),
                verticalOrigin: Cesium.VerticalOrigin.CENTER
            }
        });
        var pillarPositionProperty = new Cesium.CallbackProperty(
            function (time, result) {
                return Cesium.Cartesian3.clone(displayedPillarPosition, result);
            },
            false
        );
        var pillarLengthProperty = new Cesium.CallbackProperty(function () {
            return Math.max(displayedPillarHeight, 0.1);
        }, false);
        var observationPillar = viewer.entities.add({
            show: false,
            position: pillarPositionProperty,
            cylinder: {
                length: pillarLengthProperty,
                topRadius: 3.8,
                bottomRadius: 3.8,
                material: Cesium.Color.fromCssColorString(colors.accent).withAlpha(0.9),
                outline: false
            }
        });
        var searchRadius = viewer.entities.add({
            show: false,
            polyline: {
                positions: [],
                width: 3,
                material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.fromCssColorString(colors.accent),
                    gapColor: Cesium.Color.TRANSPARENT,
                    dashLength: 14
                }),
                // 검색 반경은 실제 지형 위의 선이므로 건물에 가려진 구간을 따로 그리지 않습니다.
                clampToGround: false,
                arcType: Cesium.ArcType.NONE
            }
        });
        var searchRadiusLabel = viewer.entities.add({
            show: false,
            position: Cesium.Cartesian3.fromDegrees(0, 0),
            label: {
                text: "",
                font: "800 13px sans-serif",
                fillColor: Cesium.Color.WHITE,
                showBackground: true,
                backgroundColor: Cesium.Color.fromCssColorString(colors.accent)
                    .withAlpha(0.96),
                backgroundPadding: new Cesium.Cartesian2(10, 6),
                outlineWidth: 0,
                style: Cesium.LabelStyle.FILL,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -5),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(150, 1, 3500, 0.72)
            }
        });

        function cancelAnimation() {
            if (animationId === null) return;
            global.cancelAnimationFrame(animationId);
            animationId = null;
        }

        function hidePillar() {
            observationPoint.show = false;
            observationPoint.billboard.show = false;
            observationPillar.show = false;
            displayedPillarHeight = 0;
        }

        function setPillarHeight(targetCenter, terrainGround, height) {
            if (targetCenter === null) return;
            var visibleHeight = Math.max(height, 0.1);
            observationPoint.position = Cesium.Cartesian3.fromDegrees(
                targetCenter[0],
                targetCenter[1],
                terrainGround + visibleHeight
            );
            var pillarPosition = Cesium.Cartesian3.fromDegrees(
                targetCenter[0],
                targetCenter[1],
                terrainGround + visibleHeight / 2
            );
            Cesium.Cartesian3.clone(pillarPosition, displayedPillarPosition);
            observationPoint.show = true;
            observationPoint.billboard.show = height > 0.35;
            observationPillar.show = true;
            displayedCenter = targetCenter.slice();
            displayedGroundHeight = terrainGround;
            displayedPillarHeight = Math.max(0, height);
        }

        function animatePillar(targetCenter, terrainGround, startHeight,
                targetHeight, duration, expectedVersion, onComplete) {
            cancelAnimation();
            var reduceMotion = global.matchMedia &&
                global.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (reduceMotion) {
                if (targetHeight <= 0) hidePillar();
                else setPillarHeight(targetCenter, terrainGround, targetHeight);
                if (typeof onComplete === "function") onComplete();
                return;
            }
            setPillarHeight(targetCenter, terrainGround, startHeight);
            viewer.scene.requestRender();
            var startedAt = null;
            function frame(now) {
                if (expectedVersion !== transitionVersion) return;
                if (startedAt === null) {
                    startedAt = now;
                    viewer.scene.requestRender();
                    animationId = global.requestAnimationFrame(frame);
                    return;
                }
                var progress = Math.min(1, (now - startedAt) / duration);
                var eased = targetHeight < startHeight
                    ? progress * progress * (3 - 2 * progress)
                    : 1 - Math.pow(1 - progress, 3);
                var height = startHeight + (targetHeight - startHeight) * eased;
                setPillarHeight(targetCenter, terrainGround, height);
                viewer.scene.requestRender();
                if (progress < 1) {
                    animationId = global.requestAnimationFrame(frame);
                } else {
                    animationId = null;
                    if (targetHeight <= 0) hidePillar();
                    if (typeof onComplete === "function") onComplete();
                }
            }
            animationId = global.requestAnimationFrame(frame);
        }

        function growPillar(targetCenter, terrainGround, targetHeight) {
            var version = transitionVersion;
            var startHeight = centersEqual(displayedCenter, targetCenter)
                ? displayedPillarHeight
                : 0;
            animatePillar(
                targetCenter,
                terrainGround,
                startHeight,
                targetHeight,
                520,
                version
            );
        }

        function retractPillar(onComplete) {
            var version = transitionVersion;
            if (displayedCenter === null || displayedPillarHeight <= 0) {
                hidePillar();
                onComplete();
                return;
            }
            animatePillar(
                displayedCenter.slice(),
                displayedGroundHeight,
                displayedPillarHeight,
                0,
                300,
                version,
                onComplete
            );
        }

        function positionsFromTerrainRing(points) {
            var degreesHeights = [];
            points.forEach(function (point) {
                degreesHeights.push(point[0], point[1], point[2] + 0.35);
            });
            return Cesium.Cartesian3.fromDegreesArrayHeights(degreesHeights);
        }

        function getRadiusTerrainHeight(coordinate) {
            var loadedHeight = viewer.scene.globe.getHeight(
                Cesium.Cartographic.fromDegrees(coordinate[0], coordinate[1])
            );
            if (Number.isFinite(loadedHeight)) return loadedHeight + 0.35;
            if (radiusTerrainPoints.length) {
                var nearest = radiusTerrainPoints[0];
                var nearestDistance = Number.POSITIVE_INFINITY;
                radiusTerrainPoints.forEach(function (point) {
                    var longitudeDelta = point[0] - coordinate[0];
                    var latitudeDelta = point[1] - coordinate[1];
                    var distance = longitudeDelta * longitudeDelta +
                        latitudeDelta * latitudeDelta;
                    if (distance < nearestDistance) {
                        nearest = point;
                        nearestDistance = distance;
                    }
                });
                return nearest[2] + 0.35;
            }
            return getGroundHeight(center) + 0.35;
        }

        function renderSearchRadius() {
            if (center === null) return;
            var targetCenter = center.slice();
            var targetRadius = radius;
            var key = targetCenter[0].toFixed(7) + ":" +
                targetCenter[1].toFixed(7) + ":" + targetRadius.toFixed(3);
            var radiusRing = turf.circle(
                targetCenter,
                targetRadius / 1000,
                { steps: 180, units: "kilometers" }
            ).geometry.coordinates[0];
            var labelCoordinate = turf.destination(
                targetCenter,
                targetRadius / 1000,
                0,
                { units: "kilometers" }
            ).geometry.coordinates;

            function updateRadiusLabel(height) {
                searchRadiusLabel.position = Cesium.Cartesian3.fromDegrees(
                    labelCoordinate[0],
                    labelCoordinate[1],
                    Number(height) + 1.2
                );
                searchRadiusLabel.label.text = Math.round(targetRadius) + "m";
            }

            if (radiusTerrainKey === key && radiusTerrainPoints.length) {
                searchRadius.polyline.positions = positionsFromTerrainRing(
                    radiusTerrainPoints
                );
                updateRadiusLabel(getRadiusTerrainHeight(labelCoordinate));
                return;
            }

            var fallbackHeight = getGroundHeight(targetCenter);
            var fallbackPoints = radiusRing.map(function (coordinate) {
                return [coordinate[0], coordinate[1], fallbackHeight];
            });
            searchRadius.polyline.positions = positionsFromTerrainRing(fallbackPoints);
            updateRadiusLabel(fallbackHeight + 0.35);
            if (radiusTerrainKey === key) return;

            radiusTerrainKey = key;
            var version = ++radiusTerrainSampleVersion;
            options.terrainReadyPromise.then(function (terrainProvider) {
                if (version !== radiusTerrainSampleVersion ||
                        radiusTerrainKey !== key || !terrainProvider) return null;
                var samples = radiusRing.map(function (coordinate) {
                    return Cesium.Cartographic.fromDegrees(coordinate[0], coordinate[1]);
                });
                return Cesium.sampleTerrainMostDetailed(terrainProvider, samples);
            }).then(function (samples) {
                if (!samples || version !== radiusTerrainSampleVersion ||
                        radiusTerrainKey !== key) return;
                radiusTerrainPoints = radiusRing.map(function (coordinate, index) {
                    var height = Number(samples[index] && samples[index].height);
                    return [
                        coordinate[0],
                        coordinate[1],
                        Number.isFinite(height) ? height : fallbackHeight
                    ];
                });
                searchRadius.polyline.positions = positionsFromTerrainRing(
                    radiusTerrainPoints
                );
                updateRadiusLabel(getRadiusTerrainHeight(labelCoordinate));
                viewer.scene.requestRender();
            }).catch(function (error) {
                if (version === radiusTerrainSampleVersion) {
                    console.warn("검색 반경 지형고도 조회 실패", error);
                }
            });
        }

        function render() {
            if (center === null) {
                cancelAnimation();
                animationKey = null;
                transitionActive = false;
                hidePillar();
                searchRadius.show = false;
                searchRadiusLabel.show = false;
            } else {
                var terrainHeightReady = Number.isFinite(terrainGroundHeight);
                var terrainGround = getGroundHeight(center);
                var observerHeight = elevation === null ? 0 : elevation.observerHeight;
                var markerHeight = elevation === null ? 0 : Math.max(0.1, observerHeight);
                if (transitionActive) {
                    renderSearchRadius();
                    searchRadius.show = radiusVisible;
                    searchRadiusLabel.show = radiusVisible;
                    viewer.scene.requestRender();
                    return;
                }
                if (!terrainHeightReady || elevation === null) {
                    cancelAnimation();
                    animationKey = null;
                    hidePillar();
                } else {
                    var nextAnimationKey = center.join(":") + ":" +
                        observerHeight.toFixed(3) + ":" +
                        elevation.absoluteHeight.toFixed(3) + ":" +
                        terrainGround.toFixed(3);
                    if (animationKey !== nextAnimationKey) {
                        animationKey = nextAnimationKey;
                        growPillar(center.slice(), terrainGround, markerHeight);
                    }
                }
                renderSearchRadius();
                searchRadius.show = radiusVisible;
                searchRadiusLabel.show = radiusVisible;
            }
            viewer.scene.requestRender();
        }

        function sampleTerrainHeight() {
            var version = ++terrainSampleVersion;
            var targetCenter = center === null ? null : center.slice();
            if (targetCenter === null) {
                terrainGroundHeight = null;
                terrainPromise = Promise.resolve(null);
                return terrainPromise;
            }

            terrainPromise = options.terrainReadyPromise.then(function (terrainProvider) {
                if (version !== terrainSampleVersion ||
                        !matchesCenter(targetCenter)) return null;
                if (!terrainProvider) {
                    terrainGroundHeight = 0;
                    animationKey = null;
                    render();
                    return 0;
                }
                var sample = Cesium.Cartographic.fromDegrees(
                    targetCenter[0],
                    targetCenter[1]
                );
                return Cesium.sampleTerrainMostDetailed(terrainProvider, [sample])
                    .then(function (updated) {
                        if (version !== terrainSampleVersion ||
                                !matchesCenter(targetCenter)) return null;
                        var sampledHeight = updated && updated[0]
                            ? Number(updated[0].height)
                            : NaN;
                        terrainGroundHeight = Number.isFinite(sampledHeight)
                            ? sampledHeight
                            : 0;
                        animationKey = null;
                        render();
                        return terrainGroundHeight;
                    });
            }).catch(function (error) {
                if (version !== terrainSampleVersion ||
                        !matchesCenter(targetCenter)) return null;
                terrainGroundHeight = 0;
                animationKey = null;
                render();
                console.warn(
                    "관측점 지형고도를 가져오지 못해 기준고도 0m를 사용합니다.",
                    error
                );
                return 0;
            });
            return terrainPromise;
        }

        function set(targetCenter, targetRadius) {
            var nextCenter = targetCenter ? targetCenter.slice() : null;
            var centerChanged = center !== null && nextCenter !== null &&
                !centersEqual(center, nextCenter);
            var sameCenter = centersEqual(center, nextCenter);
            if (!sameCenter) {
                transitionVersion += 1;
                cancelAnimation();
                terrainSampleVersion += 1;
            }
            center = nextCenter;
            radius = Number(targetRadius) || 0;
            radiusTerrainSampleVersion += 1;
            radiusTerrainKey = null;
            radiusTerrainPoints = [];

            if (!sameCenter) {
                animationKey = null;
                elevation = null;
                terrainGroundHeight = null;
            }

            if (centerChanged && displayedCenter !== null && displayedPillarHeight > 0) {
                transitionActive = true;
                retractPillar(function () {
                    transitionActive = false;
                    animationKey = null;
                    render();
                });
            } else {
                if (!(sameCenter && transitionActive)) transitionActive = false;
                render();
            }
            if (center !== null && (!sameCenter || terrainGroundHeight === null)) {
                sampleTerrainHeight();
            }
        }

        function setElevation(targetCenter, groundHeight, observerHeight) {
            if (!targetCenter || center === null || !matchesCenter(targetCenter)) return;
            var ground = Number(groundHeight);
            var observer = Number(observerHeight);
            if (!Number.isFinite(ground) || !Number.isFinite(observer)) return;
            elevation = {
                groundHeight: ground,
                observerHeight: observer,
                absoluteHeight: ground + observer
            };
            render();
            if (terrainGroundHeight === null) sampleTerrainHeight();
        }

        function setRadiusVisible(visible) {
            radiusVisible = Boolean(visible);
            searchRadius.show = radiusVisible && center !== null;
            searchRadiusLabel.show = radiusVisible && center !== null;
            viewer.scene.requestRender();
        }

        function getEyeHeight(targetCenter) {
            var observerHeight = elevation === null
                ? 0
                : Math.max(0, elevation.observerHeight);
            return getGroundHeight(targetCenter) + observerHeight;
        }

        return {
            getEyeHeight: getEyeHeight,
            getGroundHeight: getGroundHeight,
            getRadiusTerrainHeight: getRadiusTerrainHeight,
            sampleTerrainHeight: sampleTerrainHeight,
            set: set,
            setElevation: setElevation,
            setRadiusVisible: setRadiusVisible
        };
    }

    global.GisCesiumObservation = {
        create: create
    };
})(window);
