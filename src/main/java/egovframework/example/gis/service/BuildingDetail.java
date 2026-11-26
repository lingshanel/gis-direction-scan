package egovframework.example.gis.service;

import java.util.Map;

import javax.json.bind.annotation.JsonbNillable;
import javax.json.bind.annotation.JsonbPropertyOrder;

/**
 * 건물 상세 조회 한 건을 담는 전용 응답 객체입니다.
 *
 * 스캔 응답에는 이 객체를 사용하지 않습니다. 사용자가 분석 완료 후 건물을
 * 직접 클릭했을 때만 생성하므로, 이름과 OSM 태그가 대량 스캔 응답에 섞이지 않습니다.
 */
@JsonbNillable(false)
@JsonbPropertyOrder({
        "buildingId", "name", "buildingType", "heightMeters", "heightSource",
        "minHeightMeters", "levels", "address", "sourceUpdatedAt", "importedAt",
        "additionalTags"
})
public class BuildingDetail {
    private String buildingId;
    private String name;
    private String buildingType;
    private Double heightMeters;
    private String heightSource;
    private Double minHeightMeters;
    private Double levels;
    private String address;
    private String sourceUpdatedAt;
    private String importedAt;
    private String tagsJson;
    private Map<String, String> additionalTags;

    public String getBuildingId() { return buildingId; }
    public void setBuildingId(String buildingId) { this.buildingId = buildingId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getBuildingType() { return buildingType; }
    public void setBuildingType(String buildingType) { this.buildingType = buildingType; }
    public Double getHeightMeters() { return heightMeters; }
    public void setHeightMeters(Double heightMeters) { this.heightMeters = heightMeters; }
    public String getHeightSource() { return heightSource; }
    public void setHeightSource(String heightSource) { this.heightSource = heightSource; }
    public Double getMinHeightMeters() { return minHeightMeters; }
    public void setMinHeightMeters(Double minHeightMeters) { this.minHeightMeters = minHeightMeters; }
    public Double getLevels() { return levels; }
    public void setLevels(Double levels) { this.levels = levels; }
    public String getAddress() { return address; }
    public void setAddress(String address) { this.address = address; }
    public String getSourceUpdatedAt() { return sourceUpdatedAt; }
    public void setSourceUpdatedAt(String sourceUpdatedAt) { this.sourceUpdatedAt = sourceUpdatedAt; }
    public String getImportedAt() { return importedAt; }
    public void setImportedAt(String importedAt) { this.importedAt = importedAt; }

    /** MyBatis가 받은 JSONB 문자열은 서비스에서 Map으로 변환한 뒤 응답합니다. */
    public String getTagsJson() { return tagsJson; }
    public void setTagsJson(String tagsJson) { this.tagsJson = tagsJson; }
    public Map<String, String> getAdditionalTags() { return additionalTags; }
    public void setAdditionalTags(Map<String, String> additionalTags) { this.additionalTags = additionalTags; }
}
