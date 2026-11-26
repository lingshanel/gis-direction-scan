(function (global) {
    "use strict";

    function create(viewer, options) {
        options = options || {};
        var scanColor = Cesium.Color.fromCssColorString(
            global.GisVisualTheme.colors.accentSoft
        );
        var positions = [
            new Cesium.Cartesian3(),
            new Cesium.Cartesian3()
        ];
        var positionsProperty = new Cesium.CallbackProperty(function () {
            return positions;
        }, false);
        var rayEntity = viewer.entities.add({
            show: false,
            polyline: {
                positions: positionsProperty,
                width: 5,
                material: scanColor,
                // 지면 밀착 선을 매 프레임 다시 만들면 Cesium의 지형 분할 작업이
                // 반복되어 회전이 끊깁니다. 이미 구한 지형고도를 사용하는 일반
                // 3D 선으로 유지하면 건물 차폐는 지키면서 좌표만 가볍게 바뀝니다.
                clampToGround: false,
                arcType: Cesium.ArcType.NONE
            }
        });

        function toRadians(value) {
            return value * Math.PI / 180;
        }

        function toDegrees(value) {
            return value * 180 / Math.PI;
        }

        function destination(origin, radius, bearing) {
            var earthRadius = 6378137;
            var distanceRatio = radius / earthRadius;
            var heading = toRadians(bearing);
            var latitude = toRadians(origin[1]);
            var longitude = toRadians(origin[0]);
            var endLatitude = Math.asin(
                Math.sin(latitude) * Math.cos(distanceRatio) +
                Math.cos(latitude) * Math.sin(distanceRatio) * Math.cos(heading)
            );
            var endLongitude = longitude + Math.atan2(
                Math.sin(heading) * Math.sin(distanceRatio) * Math.cos(latitude),
                Math.cos(distanceRatio) - Math.sin(latitude) * Math.sin(endLatitude)
            );
            return [toDegrees(endLongitude), toDegrees(endLatitude)];
        }

        function getHeight(coordinate) {
            if (typeof options.getTerrainHeight === "function") {
                var height = Number(options.getTerrainHeight(coordinate));
                if (Number.isFinite(height)) return height;
            }
            var loadedHeight = viewer.scene.globe.getHeight(
                Cesium.Cartographic.fromDegrees(coordinate[0], coordinate[1])
            );
            return Number.isFinite(loadedHeight) ? loadedHeight + 0.35 : 0.35;
        }

        function update(origin, bearing, radius) {
            var end = destination(origin, radius, bearing);
            Cesium.Cartesian3.fromDegrees(
                origin[0],
                origin[1],
                getHeight(origin),
                Cesium.Ellipsoid.WGS84,
                positions[0]
            );
            Cesium.Cartesian3.fromDegrees(
                end[0],
                end[1],
                getHeight(end),
                Cesium.Ellipsoid.WGS84,
                positions[1]
            );
            rayEntity.show = true;
            viewer.scene.requestRender();
        }

        function hide() {
            rayEntity.show = false;
            viewer.scene.requestRender();
        }

        return {
            hide: hide,
            update: update
        };
    }

    global.GisCesiumScanMotion = {
        create: create
    };
})(window);
