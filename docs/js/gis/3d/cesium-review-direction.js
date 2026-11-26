(function (global) {
    "use strict";

    /**
     * 선택한 방위를 3D 장면에 선으로 표시하고 전환 애니메이션을 관리합니다.
     * 관측점과 검색 반경의 실제 높이는 cesium-map이 결정합니다. 이 모듈은 높이
     * 계산 정책을 전달받아 표현만 담당하므로 지형 처리와 화면 효과가 섞이지 않습니다.
     */
    function create(viewer, options) {
        var colors = global.GisVisualTheme.colors;
        var positions = [];
        var animationId = null;
        var displayedStartPosition = null;
        var displayedEndPosition = null;
        var positionsProperty = new Cesium.CallbackProperty(function () {
            return positions;
        }, false);
        var direction = viewer.entities.add({
            show: false,
            polyline: {
                positions: positionsProperty,
                width: 5,
                clampToGround: false,
                arcType: Cesium.ArcType.NONE,
                // 방향선도 건물 뒤에서는 숨겨 공간적인 앞뒤 관계를 그대로 전달합니다.
                material: Cesium.Color.fromCssColorString(colors.accent)
            }
        });

        function prefersReducedMotion() {
            return global.matchMedia &&
                global.matchMedia("(prefers-reduced-motion: reduce)").matches;
        }

        function cancelAnimation() {
            if (animationId === null) return;
            global.cancelAnimationFrame(animationId);
            animationId = null;
        }

        function setAppearance(alpha, width) {
            var accent = Cesium.Color.fromCssColorString(colors.accent);
            direction.polyline.width = width;
            direction.polyline.material = accent.withAlpha(alpha);
        }

        function updatePositions(startPosition, endPosition) {
            // CallbackProperty가 같은 배열을 계속 바라보게 하여 애니메이션 중에도
            // Entity 자체를 다시 만들지 않고 두 끝점만 갱신합니다.
            if (positions.length !== 2) {
                positions = [
                    Cesium.Cartesian3.clone(startPosition),
                    Cesium.Cartesian3.clone(endPosition)
                ];
            } else {
                Cesium.Cartesian3.clone(startPosition, positions[0]);
                Cesium.Cartesian3.clone(endPosition, positions[1]);
            }
        }

        function set(center, bearing, radius, animateDirection) {
            var end = turf.destination(
                center,
                Number(radius) / 1000,
                Number(bearing),
                { units: "kilometers" }
            ).geometry.coordinates;
            var startPosition = Cesium.Cartesian3.fromDegrees(
                center[0],
                center[1],
                options.startHeight(center)
            );
            var endPosition = Cesium.Cartesian3.fromDegrees(
                end[0],
                end[1],
                options.endHeight(end)
            );

            cancelAnimation();
            if (!animateDirection || prefersReducedMotion()) {
                updatePositions(startPosition, endPosition);
                setAppearance(1, 5);
                direction.show = true;
                displayedStartPosition = Cesium.Cartesian3.clone(startPosition);
                displayedEndPosition = Cesium.Cartesian3.clone(endPosition);
                viewer.scene.requestRender();
                return;
            }

            var hasDisplayedDirection = direction.show &&
                displayedEndPosition !== null;
            var animationStartEnd = hasDisplayedDirection
                ? Cesium.Cartesian3.clone(displayedEndPosition)
                : Cesium.Cartesian3.clone(startPosition);
            updatePositions(startPosition, animationStartEnd);
            var animatedEnd = positions[1];
            setAppearance(1, 5);
            direction.show = true;
            displayedStartPosition = Cesium.Cartesian3.clone(startPosition);
            displayedEndPosition = Cesium.Cartesian3.clone(animationStartEnd);
            viewer.scene.requestRender();

            var startedAt = null;
            var duration = hasDisplayedDirection ? 280 : 480;
            function animate(now) {
                if (startedAt === null) {
                    startedAt = now;
                    viewer.scene.requestRender();
                    animationId = global.requestAnimationFrame(animate);
                    return;
                }
                var linear = Math.min((now - startedAt) / duration, 1);
                var progress = 1 - Math.pow(1 - linear, 3);
                Cesium.Cartesian3.lerp(
                    animationStartEnd,
                    endPosition,
                    progress,
                    animatedEnd
                );
                Cesium.Cartesian3.clone(animatedEnd, displayedEndPosition);
                viewer.scene.requestRender();
                if (linear < 1) {
                    animationId = global.requestAnimationFrame(animate);
                } else {
                    animationId = null;
                    updatePositions(startPosition, endPosition);
                    displayedStartPosition = Cesium.Cartesian3.clone(startPosition);
                    displayedEndPosition = Cesium.Cartesian3.clone(endPosition);
                    viewer.scene.requestRender();
                }
            }
            animationId = global.requestAnimationFrame(animate);
        }

        function finishClear() {
            direction.show = false;
            displayedStartPosition = null;
            displayedEndPosition = null;
            viewer.scene.requestRender();
        }

        function clear(animateDirection) {
            cancelAnimation();
            if (!animateDirection || prefersReducedMotion() || !direction.show ||
                    displayedStartPosition === null || displayedEndPosition === null) {
                finishClear();
                return;
            }

            var startPosition = Cesium.Cartesian3.clone(displayedStartPosition);
            var animationStartEnd = Cesium.Cartesian3.clone(displayedEndPosition);
            updatePositions(startPosition, animationStartEnd);
            var animatedEnd = positions[1];
            var startedAt = null;
            var duration = 360;
            function animate(now) {
                if (startedAt === null) {
                    startedAt = now;
                    viewer.scene.requestRender();
                    animationId = global.requestAnimationFrame(animate);
                    return;
                }
                var linear = Math.min((now - startedAt) / duration, 1);
                var progress = linear * linear * (3 - 2 * linear);
                Cesium.Cartesian3.lerp(
                    animationStartEnd,
                    startPosition,
                    progress,
                    animatedEnd
                );
                Cesium.Cartesian3.clone(animatedEnd, displayedEndPosition);
                viewer.scene.requestRender();
                if (linear < 1) {
                    animationId = global.requestAnimationFrame(animate);
                } else {
                    animationId = null;
                    updatePositions(startPosition, startPosition);
                    finishClear();
                }
            }
            animationId = global.requestAnimationFrame(animate);
        }

        return {
            clear: clear,
            set: set
        };
    }

    global.GisCesiumReviewDirection = {
        create: create
    };
})(window);
