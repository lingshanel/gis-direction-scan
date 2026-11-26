package egovframework.example.gis.repository;

import org.apache.ibatis.annotations.Param;
import org.egovframe.rte.psl.dataaccess.mapper.Mapper;

import egovframework.example.gis.service.BuildingDetail;

@Mapper("buildingMapper")
public interface BuildingMapper {

    String selectBuildingsGeoJson(
            @Param("latitude") double latitude,
            @Param("longitude") double longitude,
            @Param("radius") int radius);

    /** 공간 범위 조회가 아니라 건물 기본키 한 건만 읽습니다. */
    BuildingDetail selectBuildingDetail(
            @Param("osmType") String osmType,
            @Param("osmId") long osmId);
}
