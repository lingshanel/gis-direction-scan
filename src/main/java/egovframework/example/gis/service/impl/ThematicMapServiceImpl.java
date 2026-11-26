package egovframework.example.gis.service.impl;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import egovframework.example.gis.repository.ThematicMapMapper;
import egovframework.example.gis.service.ThematicMapService;

@Service("thematicMapService")
public class ThematicMapServiceImpl implements ThematicMapService {
    private static final int LARGE_EXTENT_THRESHOLD_METERS = 2200;
    private static final double DEFAULT_SIMPLIFICATION_TOLERANCE = 0.000006;
    private static final double LARGE_EXTENT_SIMPLIFICATION_TOLERANCE = 0.000012;

    private final ThematicMapMapper thematicMapMapper;

    @Autowired
    public ThematicMapServiceImpl(ThematicMapMapper thematicMapMapper) {
        this.thematicMapMapper = thematicMapMapper;
    }

    @Override
    @Transactional(readOnly = true)
    public String findThematicMap(double latitude, double longitude, int radius) {
        // 넓은 화면은 더 많은 도형을 포함하므로 단순화 허용치를 높여 3D 배경 응답 크기를 제한합니다.
        double tolerance = radius > LARGE_EXTENT_THRESHOLD_METERS
                ? LARGE_EXTENT_SIMPLIFICATION_TOLERANCE
                : DEFAULT_SIMPLIFICATION_TOLERANCE;
        String geoJson = thematicMapMapper.selectThematicMapGeoJson(
                latitude, longitude, radius, tolerance);
        // 정상적인 빈 결과도 세 FeatureCollection을 가진 JSON이므로 null/공백은 DB 응답 오류입니다.
        if (geoJson == null || geoJson.trim().isEmpty()) {
            throw new IllegalStateException("PostGIS thematic map query returned no GeoJSON");
        }
        return geoJson;
    }
}
