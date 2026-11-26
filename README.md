# GIS 360° 방향 스캔

관측점과 분석 반경을 기준으로 360° 방향을 스캔하고, 건물과 지형 고도를 이용해
가시·차폐 영역을 2D와 3D로 표현하는 GIS 웹 애플리케이션입니다.

## 주요 기능

- 100~500m 반경의 방향별 건물 교차 및 차폐 분석
- Copernicus DEM GLO-30 기반 지형 고도 분석
- OpenLayers 2D 지도와 Cesium 3D 지도 전환
- 가시·차폐 영역, 교차 건물, 고도 단면 시각화
- PostGIS 공간 인덱스를 이용한 주변 건물 조회
- 수역·토지피복·도로를 포함한 3D 주제지도
- 건물 높이, 층수, 주소 및 OSM 태그 상세 조회

## 구조

```text
Browser
  ├─ JSP / JavaScript
  ├─ OpenLayers / Turf / GeoTIFF
  └─ Cesium
        │
        │ same-origin *.do API
        ▼
Tomcat 9 / eGovFrame 4.3 / Spring MVC / MyBatis
        ├─ PostgreSQL + PostGIS
        └─ Copernicus DEM COG Range proxy
```

현재 애플리케이션은 GeoServer를 사용하지 않고 MyBatis를 통해 PostGIS를 직접 조회합니다.
방향 스캔과 고도 차폐 계산은 브라우저에서 수행하며, 서버는 GeoJSON과 DEM Range 응답을 제공합니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| Backend | Java, eGovFrame 4.3, Spring MVC, MyBatis |
| Database | PostgreSQL, PostGIS |
| Frontend | JSP, JavaScript, CSS |
| 2D GIS | OpenLayers, Turf.js |
| 3D GIS | Cesium |
| Terrain | Copernicus DEM GLO-30 COG, GeoTIFF.js |
| Runtime | Tomcat 9, Docker |

## API

| 경로 | 설명 |
| --- | --- |
| `GET /health.do` | 애플리케이션과 DB 연결 상태 |
| `GET /gis/buildings.do` | 관측점 주변 건물 GeoJSON |
| `GET /gis/building-detail.do` | 건물 상세정보 |
| `GET /gis/thematic-map.do` | 수역·토지피복·도로 |
| `GET /gis/dem.do` | Copernicus DEM COG Range 프록시 |

## 환경변수

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `GIS_DB_URL` | 예 | PostgreSQL JDBC URL |
| `GIS_DB_USERNAME` | 예 | 운영 DB 계정 |
| `GIS_DB_PASSWORD` | 예 | 운영 DB 비밀번호 |
| `CESIUM_ION_TOKEN` | 선택 | Cesium World Terrain 및 OSM Buildings |

실제 값은 저장소에 커밋하지 않고 배포 플랫폼의 Secret 또는 환경변수로 관리합니다.

## 빌드

Java 8 이상과 Maven이 필요합니다. 배포 컨테이너는 Java 17과 Tomcat 9를 사용합니다.

```bash
mvn -B -ntp clean verify
```

빌드 결과:

```text
target/gis-scan-1.0.0.war
```

## Docker 실행

```bash
docker build -t gis-scan .
docker run --rm -p 8080:8080 \
  -e GIS_DB_URL="jdbc:postgresql://host.docker.internal:5432/gis_scan" \
  -e GIS_DB_USERNAME="gis_scan_runtime" \
  -e GIS_DB_PASSWORD="change-me" \
  -e CESIUM_ION_TOKEN="" \
  gis-scan
```

접속 주소:

- 애플리케이션: `http://localhost:8080/`
- 헬스체크: `http://localhost:8080/health.do`

## 운영 DB 복원

원본 덤프를 GitHub 저장소에 커밋하지 않습니다. 빈 PostgreSQL/PostGIS 데이터베이스를
준비한 다음 `deploy/db/restore-production.ps1`을 실행합니다.

```powershell
.\deploy\db\restore-production.ps1 `
  -DatabaseUrl "postgresql://USER:PASSWORD@HOST:5432/gis_scan" `
  -DumpPath "C:\path\gis_scan.dump" `
  -RuntimeRole "gis_scan_runtime"
```

복원 스크립트는 덤프에서 `gis` 운영 스키마만 복원합니다. 데이터 적재용
`gis_import` 스키마와 스테이징 테이블은 배포하지 않습니다. 기존 데이터가 있는 DB에
재실행하면 객체 충돌이 발생할 수 있으므로 새 데이터베이스에서 한 번만 실행합니다.

운영 웹 계정에는 가능한 경우 `gis` 스키마의 읽기 전용 권한만 부여합니다.

## 데이터

배포 데이터는 서울 지역 OpenStreetMap 기반 공간정보입니다.

| 테이블 | 데이터 |
| --- | --- |
| `gis.building` | 건물 폴리곤, 높이, 층수, OSM 태그 |
| `gis.water` | 수역 |
| `gis.landcover` | 토지피복 |
| `gis.road` | 주요 도로 |

지도 및 공간데이터 화면에는 OpenStreetMap 저작자 표시를 유지해야 합니다.

## 외부 서비스

- OpenStreetMap 지도 타일 및 공간데이터
- ArcGIS Online 배경지도
- Copernicus DEM GLO-30
- Cesium ion
- jsDelivr CDN

외부 서비스가 일시적으로 응답하지 않으면 일부 배경지도·3D 지형·DEM 분석이 제한될 수 있습니다.

## 저장소에서 제외되는 항목

- DB 덤프와 백업 파일
- 실제 환경변수와 Secret
- 빌드 결과물 `target/`, `*.war`
- Eclipse 설정 파일
- 로컬 DEM GeoTIFF 타일

