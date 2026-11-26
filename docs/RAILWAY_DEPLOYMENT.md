# Railway 배포 가이드

이 문서는 GIS 방향 스캔 프로젝트를 Railway에 배포할 때 필요한 설정을 정리합니다.

## 권장 구성

- 애플리케이션: `lingshanel/gis-direction-scan` 저장소의 Dockerfile
- 데이터베이스: Railway Marketplace의 PostGIS 템플릿
- 애플리케이션 포트: `8080`
- 헬스체크: `/health.do`
- 배포 순서: PostGIS 생성 → 덤프 복원 → 애플리케이션 배포

Java/Tomcat과 PostGIS를 함께 계속 실행해야 하므로 안정적인 포트폴리오 공개에는 Hobby 플랜을 권장합니다. 리소스를 실제로 생성하기 전에 Railway 화면에서 예상 월 사용량과 결제 수단을 확인합니다.

## 1. PostGIS 서비스 생성

1. Railway에서 새 프로젝트를 만듭니다.
2. Marketplace에서 PostGIS 템플릿을 선택합니다.
3. 애플리케이션과 같은 리전에 배치합니다.
4. DB 복원을 위해 PostGIS 서비스의 Public Networking을 일시적으로 활성화합니다.
5. 생성된 외부 접속 URL을 복사합니다.

기본 PostgreSQL 템플릿에는 PostGIS가 포함되지 않으므로 PostGIS 템플릿을 사용합니다.

## 2. 운영 데이터 복원

로컬 PC에 PostgreSQL 18의 `psql`과 `pg_restore`가 설치되어 있어야 합니다.

```powershell
.\deploy\db\restore-production.ps1 `
  -DatabaseUrl "postgresql://USER:PASSWORD@HOST:PORT/DATABASE" `
  -DumpPath "C:\Users\user\Downloads\gis_scan_20261014-095030.dump"
```

복원 스크립트는 `gis` 스키마만 가져오며 데이터 적재용 `gis_import` 스키마는 제외합니다. 복원이 끝나면 외부 DB 접속이 더 이상 필요하지 않은 경우 Public Networking을 비활성화합니다.

## 3. 애플리케이션 서비스 생성

1. 새 서비스에서 GitHub 저장소 `lingshanel/gis-direction-scan`을 연결합니다.
2. Railway가 저장소 루트의 `Dockerfile`을 자동 감지하는지 확인합니다.
3. 서비스 변수 `PORT=8080`을 추가합니다.
4. Public Networking에서 Railway 도메인을 생성합니다.
5. Healthcheck Path를 `/health.do`로 설정합니다.

## 4. 환경변수

다음 값은 GitHub에 커밋하지 않고 Railway 서비스 변수로 설정합니다.

```text
PORT=8080
GIS_DB_URL=jdbc:postgresql://<private-host>:<private-port>/<database>
GIS_DB_USERNAME=<database-user>
GIS_DB_PASSWORD=<database-password>
CESIUM_ION_TOKEN=<optional-token>
```

DB 호스트·포트·사용자·비밀번호는 PostGIS 서비스 변수 참조를 사용합니다. 애플리케이션과 DB가 같은 Railway 프로젝트에 있으면 외부 TCP 주소 대신 private network 주소를 사용합니다.

## 5. 확인

배포 후 다음 경로를 순서대로 확인합니다.

```text
https://<railway-domain>/health.do
https://<railway-domain>/
https://<railway-domain>/gis/buildings.do?lat=37.5665&lon=126.9780&radius=300
```

`/health.do`가 `200`을 반환하고 메인 화면에서 건물 조회와 2D·3D 전환이 동작하면 배포가 완료된 것입니다.

## 주의사항

- DB 덤프는 GitHub에 올리지 않습니다.
- Cesium ion 토큰은 Railway Secret으로만 관리합니다.
- 무료 플랜은 메모리와 볼륨 제한 때문에 Java/Tomcat 또는 PostGIS가 불안정할 수 있습니다.
- Railway 비용은 실행 시간, CPU, 메모리, 볼륨과 네트워크 사용량에 따라 달라질 수 있습니다.

