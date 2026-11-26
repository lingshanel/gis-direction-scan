package egovframework.example.gis.web;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import egovframework.example.gis.service.BuildingService;

@Controller
public class BuildingController {
    private static final Logger LOGGER = LoggerFactory.getLogger(BuildingController.class);

    private final BuildingService buildingService;

    @Autowired
    public BuildingController(BuildingService buildingService) {
        this.buildingService = buildingService;
    }

    @RequestMapping(value = "/gis/buildings.do", method = RequestMethod.GET,
            produces = "application/json;charset=UTF-8")
    @ResponseBody
    public ResponseEntity<String> buildings(
            @RequestParam(value = "lat", required = false) String lat,
            @RequestParam(value = "lon", required = false) String lon,
            @RequestParam(value = "radius", defaultValue = "300") String radius) {
        final GisControllerSupport.SpatialQuery query;
        try {
            query = GisControllerSupport.parseSpatialQuery(lat, lon, radius, 100, 500);
        } catch (IllegalArgumentException ex) {
            return GisControllerSupport.jsonResponse(HttpStatus.BAD_REQUEST,
                    GisControllerSupport.errorBody(
                            "한국 주변의 올바른 좌표와 100~500m 반경을 입력하세요."));
        }
        try {
            // HTTP 계층은 검증된 값만 전달하며 공간 조회와 GeoJSON 생성은 Service가 맡습니다.
            String geoJson = buildingService.findBuildings(
                    query.getLatitude(), query.getLongitude(), query.getRadiusMeters());
            return GisControllerSupport.jsonResponse(HttpStatus.OK, geoJson);
        } catch (Exception ex) {
            LOGGER.error("건물 공간 조회 실패: lat={}, lon={}, radius={}",
                    query.getLatitude(), query.getLongitude(), query.getRadiusMeters(), ex);
            return GisControllerSupport.jsonResponse(HttpStatus.SERVICE_UNAVAILABLE,
                    GisControllerSupport.errorBody(
                            "건물 조회를 완료하지 못했습니다. 잠시 후 다시 시도하세요."));
        }
    }

    @RequestMapping(value = "/gis/building-detail.do", method = RequestMethod.GET,
            produces = "application/json;charset=UTF-8")
    @ResponseBody
    public ResponseEntity<String> buildingDetail(
            @RequestParam(value = "buildingId", required = false) String buildingId) {
        // 브라우저의 복합 ID를 DB 기본키인 OSM 유형과 숫자 ID로 분리합니다.
        String normalizedId = buildingId == null ? "" : buildingId.trim();
        if (!normalizedId.matches("(way|relation)/[1-9][0-9]{0,18}")) {
            return GisControllerSupport.jsonResponse(HttpStatus.BAD_REQUEST,
                    GisControllerSupport.errorBody("올바른 건물 식별자가 필요합니다."));
        }

        String[] idParts = normalizedId.split("/", 2);
        final long osmId;
        try {
            osmId = Long.parseLong(idParts[1]);
        } catch (NumberFormatException ex) {
            return GisControllerSupport.jsonResponse(HttpStatus.BAD_REQUEST,
                    GisControllerSupport.errorBody("건물 식별자 범위가 올바르지 않습니다."));
        }

        try {
            String detailJson = buildingService.findBuildingDetail(idParts[0], osmId);
            if (detailJson == null) {
                return GisControllerSupport.jsonResponse(HttpStatus.NOT_FOUND,
                        GisControllerSupport.errorBody("선택한 건물 정보를 찾을 수 없습니다."));
            }
            return GisControllerSupport.jsonResponse(HttpStatus.OK, detailJson);
        } catch (Exception ex) {
            LOGGER.error("건물 상세 조회 실패: buildingId={}", normalizedId, ex);
            return GisControllerSupport.jsonResponse(HttpStatus.SERVICE_UNAVAILABLE,
                    GisControllerSupport.errorBody(
                            "건물 상세정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요."));
        }
    }
}
