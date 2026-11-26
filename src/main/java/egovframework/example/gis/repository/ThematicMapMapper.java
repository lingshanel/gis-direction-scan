package egovframework.example.gis.repository;

import org.apache.ibatis.annotations.Param;
import org.egovframe.rte.psl.dataaccess.mapper.Mapper;

@Mapper("thematicMapMapper")
public interface ThematicMapMapper {

    String selectThematicMapGeoJson(
            @Param("latitude") double latitude,
            @Param("longitude") double longitude,
            @Param("radius") int radius,
            @Param("tolerance") double tolerance);
}
