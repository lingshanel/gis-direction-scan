(function (global) {
    "use strict";

    /**
     * 차폐 분석, 건물 교차 판정, 방향 검토 UI가 함께 사용하는 구면 지리 계산입니다.
     * 모듈마다 좌표·방위각 계산을 따로 가지면 같은 방향을 가리켜도 Ray 끝점과
     * 화면 표시가 어긋날 수 있으므로, 거리·방위각·목적지 계산을 한곳에서 관리합니다.
     * 모든 좌표는 [경도, 위도], 거리는 미터, 각도는 도 단위를 사용합니다.
     */
    var EARTH_RADIUS_METERS = 6371008.8;

    function radians(value) {
        return Number(value) * Math.PI / 180;
    }

    function degrees(value) {
        return value * 180 / Math.PI;
    }

    function normalizeBearing(value) {
        return ((Number(value) % 360) + 360) % 360;
    }

    function distanceMeters(left, right) {
        var leftLatitude = radians(left[1]);
        var rightLatitude = radians(right[1]);
        var latitudeDelta = rightLatitude - leftLatitude;
        var longitudeDelta = radians(right[0]) - radians(left[0]);
        var latitudeSin = Math.sin(latitudeDelta / 2);
        var longitudeSin = Math.sin(longitudeDelta / 2);
        var haversine = latitudeSin * latitudeSin +
            Math.cos(leftLatitude) * Math.cos(rightLatitude) *
            longitudeSin * longitudeSin;
        return EARTH_RADIUS_METERS * 2 * Math.atan2(
            Math.sqrt(haversine),
            Math.sqrt(Math.max(0, 1 - haversine))
        );
    }

    function bearingDegrees(origin, destination) {
        var originLatitude = radians(origin[1]);
        var destinationLatitude = radians(destination[1]);
        var longitudeDelta = radians(destination[0]) - radians(origin[0]);
        var y = Math.sin(longitudeDelta) * Math.cos(destinationLatitude);
        var x = Math.cos(originLatitude) * Math.sin(destinationLatitude) -
            Math.sin(originLatitude) * Math.cos(destinationLatitude) *
            Math.cos(longitudeDelta);
        return degrees(Math.atan2(y, x));
    }

    function destination(origin, distance, bearing) {
        var angularDistance = Math.max(0, Number(distance) || 0) /
            EARTH_RADIUS_METERS;
        var bearingRadians = radians(bearing);
        var originLatitude = radians(origin[1]);
        var originLongitude = radians(origin[0]);
        var latitude = Math.asin(
            Math.sin(originLatitude) * Math.cos(angularDistance) +
            Math.cos(originLatitude) * Math.sin(angularDistance) *
            Math.cos(bearingRadians)
        );
        var longitude = originLongitude + Math.atan2(
            Math.sin(bearingRadians) * Math.sin(angularDistance) *
                Math.cos(originLatitude),
            Math.cos(angularDistance) - Math.sin(originLatitude) * Math.sin(latitude)
        );
        return [
            ((degrees(longitude) + 540) % 360) - 180,
            degrees(latitude)
        ];
    }

    global.GisGeoMath = Object.freeze({
        bearingDegrees: bearingDegrees,
        destination: destination,
        distanceMeters: distanceMeters,
        normalizeBearing: normalizeBearing
    });
})(window);
