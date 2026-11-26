GIS 방향 스캔 DEM/DSM 연결 안내

[현재 운영 방식]
dem-index.json은 대한민국 전역의 Copernicus DEM GLO-30 COG 주소를
/gis/dem.do 프록시로 연결합니다. 브라우저는 필요한 바이트 범위만 요청하므로
GeoTIFF 원본을 이 프로젝트에 내려받을 필요가 없습니다.

Copernicus GLO-30은 건물과 수목 높이가 포함될 수 있는 DSM으로 취급합니다.
따라서 dem-index.json의 surfaceModel은 DSM이며, 분석기가 OSM 건물 높이를
표고에 다시 더하지 않습니다.

[로컬 GeoTIFF로 교체하는 경우]
1. EPSG:4326, 북쪽이 위인 단일 밴드 표고(m) GeoTIFF/COG를 준비합니다.
2. 파일은 이 폴더 아래 tiles 폴더에 배치합니다.
3. dem-index.json의 tiles 배열에서 해당 타일 URL을 아래 형식으로 바꿉니다.
4. 지면만 담은 수치표고모델은 surfaceModel을 DTM으로 지정합니다. 이때 분석기는
   OSM height, building:levels, 기본 10m 순서로 구한 건물 높이를 지면고도에 더합니다.

{
  "surfaceModel": "DTM",
  "id": "tile-서울-001",
  "url": "tiles/tile-서울-001.tif",
  "bounds": [서쪽경도, 남쪽위도, 동쪽경도, 북쪽위도],
  "band": 0,
  "noData": -9999
}

실제 DEM이 없는 경우 임의 고도를 만들지 않습니다. 화면은 평면 방향 분석을 유지하고
DEM 상태를 NoData로 표시합니다.
