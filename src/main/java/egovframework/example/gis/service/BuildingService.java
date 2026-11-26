package egovframework.example.gis.service;

public interface BuildingService {
    String findBuildings(double latitude, double longitude, int radius);

    /** 클릭한 건물 한 건만 조회하며, 없는 건물은 null을 반환합니다. */
    String findBuildingDetail(String osmType, long osmId);
}
