package egovframework.example.gis.service.impl;

import java.io.StringReader;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.json.Json;
import javax.json.JsonObject;
import javax.json.JsonReader;
import javax.json.JsonString;
import javax.json.JsonValue;
import javax.json.bind.Jsonb;
import javax.json.bind.JsonbBuilder;
import javax.json.bind.JsonbConfig;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import egovframework.example.gis.repository.BuildingMapper;
import egovframework.example.gis.service.BuildingDetail;
import egovframework.example.gis.service.BuildingService;

@Service("buildingService")
public class BuildingServiceImpl implements BuildingService {

    /* 상세 응답의 직렬화 규칙은 항상 같으므로 요청마다 설정 객체를 다시 만들지 않습니다. */
    private static final Jsonb JSONB = JsonbBuilder.create(
            new JsonbConfig().withNullValues(false));

    private final BuildingMapper buildingMapper;

    @Autowired
    public BuildingServiceImpl(BuildingMapper buildingMapper) {
        this.buildingMapper = buildingMapper;
    }

    @Override
    @Transactional(readOnly = true)
    public String findBuildings(double latitude, double longitude, int radius) {
        String geoJson = buildingMapper.selectBuildingsGeoJson(latitude, longitude, radius);
        // Mapper는 빈 결과도 FeatureCollection JSON으로 반환해야 하므로 null/공백은 DB 응답 오류입니다.
        if (geoJson == null || geoJson.trim().isEmpty()) {
            throw new IllegalStateException("PostGIS building query returned no GeoJSON");
        }
        return geoJson;
    }

    @Override
    @Transactional(readOnly = true)
    public String findBuildingDetail(String osmType, long osmId) {
        // 상세 패널에는 형상이 필요 없으므로 기본키로 속성 한 건만 조회합니다.
        BuildingDetail detail = buildingMapper.selectBuildingDetail(osmType, osmId);
        if (detail == null) return null;

        // DB의 JSONB 문자열을 화면이 키·값 목록으로 순회할 수 있는 Map으로 바꿉니다.
        Map<String, String> tags = parseNonEmptyTags(detail.getTagsJson());
        detail.setTagsJson(null);
        detail.setAdditionalTags(tags.isEmpty() ? null : tags);

        // null과 빈 태그를 응답에서 제외해 상세 패널이 표시 가능한 항목만 받도록 합니다.
        return JSONB.toJson(detail);
    }

    private static Map<String, String> parseNonEmptyTags(String tagsJson) {
        Map<String, String> tags = new LinkedHashMap<String, String>();
        if (tagsJson == null || tagsJson.trim().isEmpty()) return tags;

        // 저장된 값은 JSON 객체여야 하며, 손상된 JSON은 숨기지 않고 조회 실패로 전달합니다.
        try (JsonReader reader = Json.createReader(new StringReader(tagsJson))) {
            JsonObject object = reader.readObject();
            for (Map.Entry<String, JsonValue> entry : object.entrySet()) {
                JsonValue value = entry.getValue();
                String text = value.getValueType() == JsonValue.ValueType.STRING
                        ? ((JsonString) value).getString()
                        : value.toString();
                if (text != null && !text.trim().isEmpty()) {
                    tags.put(entry.getKey(), text);
                }
            }
        }
        return tags;
    }
}
