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

import egovframework.example.gis.service.ThematicMapService;

@Controller
public class ThematicMapController {
    private static final Logger LOGGER = LoggerFactory.getLogger(ThematicMapController.class);

    private final ThematicMapService thematicMapService;

    @Autowired
    public ThematicMapController(ThematicMapService thematicMapService) {
        this.thematicMapService = thematicMapService;
    }

    @RequestMapping(value = "/gis/thematic-map.do", method = RequestMethod.GET,
            produces = "application/json;charset=UTF-8")
    @ResponseBody
    public ResponseEntity<String> thematicMap(
            @RequestParam(value = "lat", required = false) String lat,
            @RequestParam(value = "lon", required = false) String lon,
            @RequestParam(value = "radius", defaultValue = "2000") String radius) {
        final GisControllerSupport.SpatialQuery query;
        try {
            query = GisControllerSupport.parseSpatialQuery(lat, lon, radius, 1000, 3000);
        } catch (IllegalArgumentException ex) {
            return GisControllerSupport.jsonResponse(HttpStatus.BAD_REQUEST,
                    GisControllerSupport.errorBody(
                            "한국 주변의 올바른 좌표와 1000~3000m 반경을 입력하세요."));
        }

        try {
            String geoJson = thematicMapService.findThematicMap(
                    query.getLatitude(), query.getLongitude(), query.getRadiusMeters());
            return GisControllerSupport.jsonResponse(HttpStatus.OK, geoJson,
                    GisControllerSupport.PRIVATE_FIVE_MINUTES);
        } catch (Exception ex) {
            LOGGER.error("주제지도 조회 실패: lat={}, lon={}, radius={}",
                    query.getLatitude(), query.getLongitude(), query.getRadiusMeters(), ex);
            return GisControllerSupport.jsonResponse(HttpStatus.SERVICE_UNAVAILABLE,
                    GisControllerSupport.errorBody(
                            "주제지도 데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요."));
        }
    }
}
