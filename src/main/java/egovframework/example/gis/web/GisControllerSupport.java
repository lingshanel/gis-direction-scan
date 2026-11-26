package egovframework.example.gis.web;

import javax.json.Json;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * GIS JSON API가 공통으로 사용하는 HTTP 경계 규칙을 모읍니다.
 *
 * 좌표 제한은 실제 분석 범위인 한국 주변만 DB 공간 조회로 전달하기 위한 보호 장치이고,
 * 반경 제한은 각 API가 허용하는 조회 비용이 다르므로 호출하는 Controller가 지정합니다.
 */
final class GisControllerSupport {
    static final String PRIVATE_FIVE_MINUTES = "private, max-age=300";

    private static final String NO_STORE = "no-store";
    private static final double MIN_LATITUDE = 33.0;
    private static final double MAX_LATITUDE = 39.5;
    private static final double MIN_LONGITUDE = 124.0;
    private static final double MAX_LONGITUDE = 132.0;
    private static final MediaType JSON_UTF8 =
            MediaType.parseMediaType("application/json;charset=UTF-8");

    private GisControllerSupport() {
        // 정적 HTTP 경계 규칙만 제공하므로 인스턴스를 만들지 않습니다.
    }

    static SpatialQuery parseSpatialQuery(String lat, String lon, String radius,
            int minimumRadius, int maximumRadius) {
        double latitude = Double.parseDouble(lat == null ? "" : lat);
        double longitude = Double.parseDouble(lon == null ? "" : lon);
        int radiusMeters = Integer.parseInt(radius == null ? "" : radius);

        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)
                || latitude < MIN_LATITUDE || latitude > MAX_LATITUDE
                || longitude < MIN_LONGITUDE || longitude > MAX_LONGITUDE
                || radiusMeters < minimumRadius || radiusMeters > maximumRadius) {
            throw new IllegalArgumentException("Spatial query is outside the supported range");
        }
        return new SpatialQuery(latitude, longitude, radiusMeters);
    }

    static String errorBody(String message) {
        return Json.createObjectBuilder().add("error", message).build().toString();
    }

    static ResponseEntity<String> jsonResponse(
            HttpStatus status, String json) {
        return jsonResponse(status, json, NO_STORE);
    }

    static ResponseEntity<String> jsonResponse(
            HttpStatus status, String json, String successfulResponseCacheControl) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(JSON_UTF8);
        headers.setCacheControl(status == HttpStatus.OK
                ? successfulResponseCacheControl
                : NO_STORE);
        return new ResponseEntity<String>(json, headers, status);
    }

    /** Controller 검증을 통과한 값만 Service로 전달하는 불변 요청 값입니다. */
    static final class SpatialQuery {
        private final double latitude;
        private final double longitude;
        private final int radiusMeters;

        private SpatialQuery(double latitude, double longitude, int radiusMeters) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.radiusMeters = radiusMeters;
        }

        double getLatitude() {
            return latitude;
        }

        double getLongitude() {
            return longitude;
        }

        int getRadiusMeters() {
            return radiusMeters;
        }
    }
}
