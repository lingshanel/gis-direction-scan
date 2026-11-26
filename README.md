# GIS 360° 방향 스캔

관측점을 중심으로 360° 방향을 분석해 건물과 지형에 따른 가시·차폐 영역을 2D와 3D로 보여주는 GIS 웹 애플리케이션입니다.

## 라이브 데모

**[GitHub Pages에서 실행하기](https://lingshanel.github.io/gis-direction-scan/)**

배포된 포트폴리오 데모는 별도 서버 없이 실행되는 정적 버전입니다. 화면에 표시되는 서울 강서·양천 일부 데모 영역에서 관측점을 선택하면 실제 프로젝트의 방향 스캔 로직을 체험할 수 있습니다.

- 건물 2,568개와 도로·수계·토지피복 데이터를 정적 GeoJSON으로 제공
- Copernicus DEM GLO-30 타일을 이용한 지형 절대고도 분석
- OpenLayers 2D 및 Cesium 3D 결과 확인
- PC와 모바일 반응형 화면 지원
- KRDS 디자인 리소스 적용

## 주요 기능

- 100~500m 반경의 방향별 건물·지형 차폐 분석
- 관측자 높이와 검색 반경 조절
- 관측 가능·불가 영역 및 첫 차폐 건물 표시
- 2D/3D 지도 전환과 분석 결과 유지
- 건물 높이·주소·OSM 속성 상세 조회
- DEM 캐시와 후보 건물 필터링을 통한 반복 분석 최적화

## 원본 프로젝트 구조

```text
Browser
  ├─ JSP / JavaScript
  ├─ OpenLayers / Turf / GeoTIFF
  └─ Cesium
        │
        └─ same-origin *.do API
              │
Tomcat 9 / eGovFrame 4.3 / Spring MVC / MyBatis
        ├─ PostgreSQL + PostGIS
        └─ Copernicus DEM COG Range proxy
```

원본 애플리케이션은 MyBatis를 통해 PostGIS 공간 데이터를 조회합니다. 방향 스캔 계산은 브라우저에서 수행하며, 서버는 주변 건물 GeoJSON과 DEM Range 응답을 제공합니다.

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| Backend | Java, eGovFrame 4.3, Spring MVC, MyBatis |
| Database | PostgreSQL, PostGIS |
| Frontend | JSP, JavaScript, CSS, KRDS |
| 2D GIS | OpenLayers, Turf.js |
| 3D GIS | Cesium |
| Terrain | Copernicus DEM GLO-30, GeoTIFF.js |
| Deployment | GitHub Pages, GitHub Actions |

## GitHub Pages 빌드

`docs/` 디렉터리는 GitHub Pages에서 바로 배포할 수 있는 완성본입니다. `main` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 자동으로 배포합니다.

원본 DB 덤프에서 정적 데모 데이터를 다시 생성할 때는 `pg_restore`로 네 테이블의 COPY 데이터를 SQL 파일로 추출한 뒤 다음 스크립트를 실행합니다.

```bash
node scripts/export-static-data.mjs
node scripts/build-pages-demo.mjs
```

생성 결과:

```text
docs/
  ├─ index.html
  ├─ data/
  │   ├─ buildings.geojson
  │   ├─ thematic-map.json
  │   └─ coverage.json
  ├─ dem/tiles/N37E126.tif
  ├─ js/
  ├─ css/
  └─ krds/
```

## 원본 서버 실행

Java 8 이상과 Maven이 필요합니다.

```bash
mvn -B -ntp clean verify
```

빌드 결과는 `target/gis-scan-1.0.0.war`입니다. 운영 DB 복원과 서버 배포 절차는 [Railway 배포 문서](docs/RAILWAY_DEPLOYMENT.md)를 참고할 수 있습니다.

## 데이터 출처

- OpenStreetMap 건물·도로·수계·토지피복 데이터
- Copernicus DEM GLO-30
- OpenStreetMap 기본 지도
- Cesium

OpenStreetMap 데이터 및 지도 화면에는 OpenStreetMap 기여자 표시를 유지합니다.

## 저장소에서 제외되는 항목

- DB 접속정보와 운영 비밀값
- 원본 PostgreSQL 덤프
- 빌드 결과물 `target/`, `*.war`
- Eclipse 개인 설정 파일
