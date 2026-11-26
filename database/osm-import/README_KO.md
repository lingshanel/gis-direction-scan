# 서울 OSM 건물·수역·토지피복·주요 도로 데이터 적재

이 폴더는 Geofabrik의 대한민국 OSM PBF에서 서울권 건물, 면 형태의 수역,
토지피복과 주요 도로를 골라 각각 `gis.building`, `gis.water`, `gis.landcover`,
`gis.road`에 적재합니다.
애플리케이션 실행 코드와 분리되어 있으며, 가져오기는 개발자가 PowerShell에서 직접 실행합니다.

## 1. 준비물

1. osm2pgsql 2.x Windows 바이너리를 내려받아 압축을 풉니다.
   - 공식 설치 안내: https://osm2pgsql.org/doc/install/windows.html
2. Geofabrik에서 `south-korea-latest.osm.pbf`를 내려받습니다.
   - 다운로드 페이지: https://download.geofabrik.de/asia/south-korea.html
3. PostgreSQL 관리자 계정으로 최초 한 번 `01_prepare_import.sql`을 실행합니다.

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' `
  --host=localhost --port=5432 --username=postgres --dbname=gis_scan `
  --set=import_role=gis_scan_app `
  --file='.\database\osm-import\01_prepare_import.sql'
```

`gis_scan_app`이 아닌 별도 적재 계정을 만들었다면 `import_role`에 그 계정명을 넣습니다.
운영 환경에서는 조회 전용 애플리케이션 계정과 적재 계정을 분리하는 것이 좋습니다.

## 2. 환경변수

PowerShell에서 실행할 때도 다음 값이 필요합니다. Eclipse의 Tomcat 실행 설정에만 등록한 값은 PowerShell에 전달되지 않습니다.

```powershell
$env:GIS_DB_URL = 'jdbc:postgresql://localhost:5432/gis_scan'
$env:GIS_DB_USERNAME = 'gis_scan_app'
$env:GIS_DB_PASSWORD = '데이터베이스 비밀번호'
```

비밀번호 환경변수를 생략하면 실행 스크립트가 보안 입력창으로 묻습니다.

## 3. 적재 실행

프로젝트 루트에서 다음 명령을 실행합니다.

```powershell
.\database\osm-import\import-seoul-buildings.ps1 `
  -Osm2pgsqlPath 'C:\tools\osm2pgsql\osm2pgsql.exe' `
  -PbfPath 'D:\osm\south-korea-latest.osm.pbf'
```

처리 순서는 다음과 같습니다.

1. 대한민국 PBF 중 서울보다 약간 넓은 범위를 읽습니다.
2. `building=*`인 객체는 `gis_import.building_stage`에 적재합니다.
3. `natural=water`, `natural=bay`, `waterway=riverbank`, `landuse=reservoir`인
   면 객체는 `gis_import.water_stage`에 적재합니다.
4. 산림·공원·초지·주거·상업·산업·농지·습지·나지 등의 면 객체는
   `gis_import.landcover_stage`에 적재합니다.
5. 고속도로부터 3차 도로까지의 주요 도로는 `gis_import.road_stage`에 적재합니다.
6. 임시 데이터 개수를 검사한 뒤 서울권 데이터를 종류별 트랜잭션으로 병합합니다.

각 병합 파일은 독립된 트랜잭션으로 실행됩니다. 수역 병합에 실패해도 먼저 완료된
건물 병합은 유지되며, 기존 `gis.water` 데이터는 수역 트랜잭션 롤백으로 보존됩니다.

## 4. 결과 확인

```sql
SELECT COUNT(*) AS building_count FROM gis.building;

SELECT
    COUNT(*) FILTER (WHERE height_m IS NOT NULL) AS explicit_height,
    COUNT(*) FILTER (WHERE height_m IS NULL AND levels IS NOT NULL) AS levels_only,
    COUNT(*) FILTER (WHERE height_m IS NULL AND levels IS NULL) AS estimated_height
FROM gis.building;

SELECT water_type, COUNT(*)
FROM gis.water
GROUP BY water_type
ORDER BY COUNT(*) DESC;

SELECT landcover_type, COUNT(*)
FROM gis.landcover
GROUP BY landcover_type
ORDER BY landcover_type;

SELECT road_type, COUNT(*)
FROM gis.road
GROUP BY road_type
ORDER BY road_type;
```

Tomcat을 재시작할 필요는 없습니다. 지도에서 위치를 다시 선택하면 DB에 적재된 건물이 조회됩니다.

## 범위 관련 참고

현재 1차 적재는 `126.73,37.41,127.27,37.72` 사각 범위를 사용합니다. 서울 행정경계를 전부 포함하지만 경계 밖 인접 지역 일부도 포함됩니다. 정확한 서울 행정구역 경계로 자르는 작업은 다음 개선 단계에서 경계 폴리곤을 추가해 처리할 수 있습니다.
