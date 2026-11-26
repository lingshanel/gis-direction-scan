(function (global) {
    "use strict";

    function rgba(hex, alpha) {
        var value = String(hex || "").replace("#", "");
        if (value.length === 3) {
            value = value.split("").map(function (part) { return part + part; }).join("");
        }
        var number = parseInt(value, 16);
        return "rgba(" + ((number >> 16) & 255) + ", " +
            ((number >> 8) & 255) + ", " + (number & 255) + ", " + alpha + ")";
    }

    global.GisVisualTheme = Object.freeze({
        rgba: rgba,
        focusMaskOpacity: 0.60,
        colors: Object.freeze({
            canvas: "#f5f5f2",
            land: "#ece8df",
            surface: "#f4f3f0",
            surfaceEstimated: "#e3e5e8",
            ink: "#1d1d1f",
            muted: "#6e6e73",
            line: "#d2d2d7",
            accent: "#2f7867",
            accentSoft: "#4b9482",
            accentPale: "#e4f2ed",
            remaining: "#4dbb94",
            visible: "#71c9ad",
            blocked: "#efb45d",
            highlight: "#d99442",
            // 3D 기본 건물은 따뜻한 백색을 유지하고 표면 법선 조명으로 명암을 만듭니다.
            // Cesium은 완전한 흰색을 색상 혼합 예외로 처리하므로, 육안상 흰색인
            // 근접색을 사용해 OSM 원본 회색 재질을 실제로 교체합니다.
            buildingSurface3d: "#fefefe",
            buildingOutside3d: "#9ea5ad",
            visibleSurface: "#8fd4bf",
            blockedSurface: "#e7b15e",
            highlightSurface: "#d7973f",
            accentSurface: "#68b8a3",
            visibleRegion3d: "#8bd3bd",
            blockedRegion3d: "#f0bd6c",
            noDataRegion3d: "#aeb5b9",
            noData: "#9ca3ad",
            water: "#9ed9e6",
            focusMask: "#69727d",
            graphite: "#25252a",
            graphiteSoft: "#34343a"
        })
    });
})(window);
