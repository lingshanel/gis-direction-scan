(function (global) {
    "use strict";

    /**
     * 0~360도 스캔의 시간 진행과 프레임 예약만 담당합니다.
     * 2D와 3D가 같은 requestAnimationFrame 흐름을 사용해야 화면 전환 뒤에도
     * 회전 속도와 움직임의 인상이 달라지지 않습니다. 실제 지도 그리기와 완료
     * 처리는 호출자가 전달합니다.
     */
    function create() {
        var animationId = null;

        function stop() {
            if (animationId === null) return;
            global.cancelAnimationFrame(animationId);
            animationId = null;
        }

        function start(scan, handlers) {
            stop();

            function animate(now) {
                try {
                    if (scan.lastFrameAt !== null) {
                        var frameGap = now - scan.lastFrameAt;
                        scan.maxFrameGap = Math.max(scan.maxFrameGap, frameGap);
                        if (frameGap >= 50) scan.longFrameCount++;
                    }
                    scan.lastFrameAt = now;
                    scan.frameCount++;
                    var progress = Math.min((now - scan.startedAt) / scan.duration, 1);
                    var bearing = progress * 360;
                    var progressPercent = Math.round(progress * 100);
                    if (progressPercent !== scan.lastProgressPercent) {
                        scan.lastProgressPercent = progressPercent;
                        handlers.progress(scan, bearing, progress);
                    }

                    var viewMode = handlers.getViewMode();
                    handlers.reveal(scan, bearing);
                    if (viewMode === "3d") {
                        handlers.renderThreeDimensional(scan, bearing, progress);
                    } else {
                        handlers.renderTwoDimensional(scan, bearing, progress);
                    }

                    if (progress < 1) {
                        animationId = global.requestAnimationFrame(animate);
                    } else {
                        if (viewMode === "3d") {
                            handlers.renderTwoDimensional(scan, bearing, 1);
                        }
                        handlers.complete(scan);
                    }
                } catch (error) {
                    handlers.fail(scan, error);
                }
            }

            animationId = global.requestAnimationFrame(animate);
        }

        return {
            start: start,
            stop: stop
        };
    }

    global.GisScanAnimation = {
        create: create
    };
})(window);
