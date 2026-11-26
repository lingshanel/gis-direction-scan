(function (global) {
    "use strict";

    var theme = global.GisVisualTheme;
    var colors = theme.colors;
    var geoMath = global.GisGeoMath;
    var profileCanvas = document.getElementById("profileCanvas");
    var lastRay = null;
    var lastRadius = null;
    var resizeFrame = null;

    function findNearestRay(result, bearing) {
        if (!result || !result.rays.length) return null;
        // 결과 배열은 0~359도 순서이므로 같은 기준으로 정규화한 뒤 이진 탐색합니다.
        // 방위각 규칙은 고도 분석의 부가 기능이 아니라 모든 지도 모듈의 공통 규칙입니다.
        var normalized = geoMath.normalizeBearing(bearing);
        var low = 0;
        var high = result.rays.length - 1;
        var match = 0;
        while (low <= high) {
            var middle = Math.floor((low + high) / 2);
            if (result.rays[middle].bearing <= normalized) {
                match = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return result.rays[match];
    }

    function draw(ray, radius) {
        var canvas = profileCanvas;
        var context = canvas.getContext("2d");
        var ratio = window.devicePixelRatio || 1;
        var width = canvas.clientWidth > 0 ? canvas.clientWidth : 330;
        var height = Math.max(112, canvas.clientHeight || 168);
        lastRay = ray;
        lastRadius = radius;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = colors.graphite;
        context.fillRect(0, 0, width, height);

        if (!ray || !ray.profile || !ray.profile.length) {
            context.fillStyle = colors.noData;
            context.font = "12px sans-serif";
            context.fillText("스캔을 시작하면 고도 단면이 표시됩니다.", 12, 88);
            return;
        }

        var values = [];
        ray.profile.forEach(function (point) {
            if (Number.isFinite(point.elevation)) values.push(point.elevation);
            if (Number.isFinite(point.roof)) values.push(point.roof);
        });
        if (Number.isFinite(ray.eyeElevation)) values.push(ray.eyeElevation);

        var rawMin = Math.min.apply(Math, values);
        var rawMax = Math.max.apply(Math, values);
        var valueRange = Math.max(5, rawMax - rawMin);
        var verticalPadding = Math.max(2, valueRange * 0.12);
        var min = rawMin - verticalPadding;
        var max = rawMax + verticalPadding;
        var left = 30;
        var right = 8;
        var topPadding = 54;
        var bottom = 20;
        var toX = function (distance) {
            return left + distance / radius * (width - left - right);
        };
        var toY = function (elevation) {
            return height - bottom - (elevation - min) / (max - min) *
                (height - topPadding - bottom);
        };

        context.strokeStyle = theme.rgba(colors.surface, 0.12);
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(left, height - bottom);
        context.lineTo(width - right, height - bottom);
        context.stroke();

        context.strokeStyle = colors.remaining;
        context.lineWidth = 2;
        context.beginPath();
        ray.profile.filter(function (point) {
            return Number.isFinite(point.elevation);
        }).forEach(function (point, index) {
            if (index === 0) context.moveTo(toX(point.distance), toY(point.elevation));
            else context.lineTo(toX(point.distance), toY(point.elevation));
        });
        context.stroke();

        context.strokeStyle = colors.accentSoft;
        context.setLineDash([5, 4]);
        context.beginPath();
        context.moveTo(left, toY(ray.eyeElevation));
        context.lineTo(width - right, toY(ray.eyeElevation));
        context.stroke();
        context.setLineDash([]);

        context.fillStyle = colors.highlight;
        context.beginPath();
        context.arc(left, toY(ray.eyeElevation), 4, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#ffe4c2";
        context.font = "700 9px sans-serif";
        context.fillText(
            "관측자 해발 " + ray.eyeElevation.toFixed(1) + "m",
            left + 5,
            Math.max(topPadding + 10, Math.min(height - bottom - 5, toY(ray.eyeElevation) - 5))
        );

        var labelLaneRight = [left - 5, left - 5, left - 5];
        var labelLaneY = [12, 27, 42];
        ray.profile.filter(function (point) {
            return point.building && Number.isFinite(point.roof);
        }).forEach(function (point) {
            var isEffectiveBlocker = ray.cause === "building" &&
                point.roof + 1e-9 >= ray.eyeElevation &&
                Math.abs(point.distance - ray.cutoff) <= 0.05;
            context.fillStyle = isEffectiveBlocker
                ? colors.surfaceEstimated
                : theme.rgba(colors.noData, 0.42);
            var x = toX(point.distance);
            var top = toY(point.roof);
            var base = toY(point.elevation);
            context.fillRect(x - 6, top, 12, Math.max(3, base - top));
            context.strokeStyle = isEffectiveBlocker
                ? theme.rgba(colors.surface, 0.82)
                : theme.rgba(colors.noData, 0.62);
            context.strokeRect(x - 6, top, 12, Math.max(3, base - top));

            // 통과 건물과 차폐 뒤 건물은 단면 맥락만 제공하고 라벨은 표시하지 않습니다.
            if (!isEffectiveBlocker) return;

            context.font = "700 9px sans-serif";
            var label = "차폐 옥상 " + point.roof.toFixed(1) + "m · " +
                point.distance.toFixed(0) + "m";
            var labelWidth = Math.ceil(context.measureText(label).width) + 8;
            var labelLeft = Math.max(left, Math.min(width - right - labelWidth, x - labelWidth / 2));
            var lane = -1;
            for (var laneIndex = 0; laneIndex < labelLaneRight.length; laneIndex++) {
                if (labelLeft >= labelLaneRight[laneIndex] + 4) {
                    lane = laneIndex;
                    break;
                }
            }
            if (lane >= 0) {
                var labelY = labelLaneY[lane];
                labelLaneRight[lane] = labelLeft + labelWidth;
                context.strokeStyle = theme.rgba(colors.surfaceEstimated, 0.45);
                context.beginPath();
                context.moveTo(x, top);
                context.lineTo(labelLeft + labelWidth / 2, labelY + 3);
                context.stroke();
                context.fillStyle = theme.rgba(colors.graphiteSoft, 0.96);
                context.fillRect(labelLeft, labelY - 10, labelWidth, 13);
                context.fillStyle = colors.surface;
                context.fillText(label, labelLeft + 4, labelY);
            }
        });

        if (ray.cutoff < radius - 0.05) {
            context.strokeStyle = colors.blocked;
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(toX(ray.cutoff), topPadding);
            context.lineTo(toX(ray.cutoff), height - bottom);
            context.stroke();
            context.fillStyle = "#ffb2ac";
            context.font = "700 9px sans-serif";
            context.fillText(
                (ray.cause === "building" ? "건물" : "지형") + " 차폐 " + ray.cutoff.toFixed(0) + "m",
                Math.min(width - 82, toX(ray.cutoff) + 4),
                topPadding - 6
            );
        }

        context.fillStyle = colors.noData;
        context.font = "10px sans-serif";
        context.fillText(max.toFixed(0) + "m", 2, topPadding + 3);
        context.fillText(min.toFixed(0) + "m", 2, height - bottom + 3);
        context.fillText("0m", left, height - 4);
        context.fillText(radius + "m", width - 40, height - 4);
    }

    function updateFromResult(result, bearing, radius, prepareRay) {
        if (!result) return;

        var ray = findNearestRay(result, bearing);
        if (prepareRay) prepareRay(ray);
        document.getElementById("observerElevation").textContent = Number.isFinite(result.observerGround)
            ? (result.observerGround + result.observerHeight).toFixed(1) + "m"
            : "NoData";
        draw(ray, radius);
    }

    function updateFromRay(ray, bearing, radius) {
        document.getElementById("observerElevation").textContent = Number.isFinite(ray.eyeElevation)
            ? ray.eyeElevation.toFixed(1) + "m"
            : "NoData";
        draw(ray, radius);
    }

    function redrawForDisplayedSize() {
        if (resizeFrame !== null || lastRadius === null) return;
        resizeFrame = global.requestAnimationFrame(function () {
            resizeFrame = null;
            // 숨겨진 탭은 실제 폭이 0이므로 화면에 표시된 뒤에만 다시 그립니다.
            if (profileCanvas.clientWidth > 0 && profileCanvas.clientHeight > 0) {
                draw(lastRay, lastRadius);
            }
        });
    }

    if (typeof global.ResizeObserver === "function") {
        new global.ResizeObserver(redrawForDisplayedSize).observe(profileCanvas);
    } else {
        global.addEventListener("resize", redrawForDisplayedSize);
    }

    global.GisElevationProfile = {
        draw: draw,
        updateFromResult: updateFromResult,
        updateFromRay: updateFromRay
    };
})(window);
