[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Osm2pgsqlPath,

    [Parameter(Mandatory = $true)]
    [string]$PbfPath,

    [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
    [string]$DatabaseUrl = $env:GIS_DB_URL,
    [string]$DatabaseUser = $env:GIS_DB_USERNAME,

    [ValidateRange(1, 16)]
    [int]$Workers = 4
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-FileExists {
    param([string]$Path, [string]$Label)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label 파일을 찾을 수 없습니다: $Path"
    }
}

Assert-FileExists -Path $Osm2pgsqlPath -Label 'osm2pgsql'
Assert-FileExists -Path $PbfPath -Label 'OSM PBF'
Assert-FileExists -Path $PsqlPath -Label 'psql'

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    throw 'GIS_DB_URL 환경변수 또는 -DatabaseUrl 값이 필요합니다.'
}
if ([string]::IsNullOrWhiteSpace($DatabaseUser)) {
    throw 'GIS_DB_USERNAME 환경변수 또는 -DatabaseUser 값이 필요합니다.'
}
if ($DatabaseUrl -notmatch '^jdbc:postgresql://') {
    throw 'DatabaseUrl은 jdbc:postgresql://host:port/database 형식이어야 합니다.'
}

$postgresUri = [Uri]($DatabaseUrl.Substring(5))
$databaseHost = $postgresUri.Host
$databasePort = if ($postgresUri.Port -gt 0) { $postgresUri.Port } else { 5432 }
$databaseName = $postgresUri.AbsolutePath.Trim('/')
if ([string]::IsNullOrWhiteSpace($databaseName)) {
    throw 'DatabaseUrl에서 데이터베이스 이름을 확인할 수 없습니다.'
}

$stylePath = Join-Path $PSScriptRoot 'buildings-flex.lua'
$mergePath = Join-Path $PSScriptRoot '02_merge_buildings.sql'
    $waterMergePath = Join-Path $PSScriptRoot '03_merge_water.sql'
    $landcoverMergePath = Join-Path $PSScriptRoot '04_merge_landcover.sql'
    $roadMergePath = Join-Path $PSScriptRoot '05_merge_roads.sql'
Assert-FileExists -Path $stylePath -Label 'Flex 설정'
Assert-FileExists -Path $mergePath -Label '병합 SQL'
    Assert-FileExists -Path $waterMergePath -Label '수역 병합 SQL'
    Assert-FileExists -Path $landcoverMergePath -Label '토지피복 병합 SQL'
    Assert-FileExists -Path $roadMergePath -Label '주요 도로 병합 SQL'

$databasePassword = $env:GIS_DB_PASSWORD
if ([string]::IsNullOrWhiteSpace($databasePassword)) {
    $securePassword = Read-Host 'PostgreSQL 비밀번호' -AsSecureString
    $databasePassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
}

$previousPgPassword = $env:PGPASSWORD
$env:PGPASSWORD = $databasePassword

try {
    # Windows PowerShell 5.1은 일부 정상적인 네이티브 stderr 출력도
    # NativeCommandError로 바꾸므로 버전 확인 동안만 중단 동작을 완화합니다.
    $savedErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $versionOutput = & $Osm2pgsqlPath --version 2>&1
        $versionExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $savedErrorActionPreference
    }

    if ($versionExitCode -ne 0 -or ($versionOutput -join ' ') -notmatch 'osm2pgsql version 2\.') {
        throw 'osm2pgsql 2.x 버전이 필요합니다.'
    }

    & $PsqlPath `
        --host=$databaseHost `
        --port=$databasePort `
        --username=$DatabaseUser `
        --dbname=$databaseName `
        --no-password `
        --set=ON_ERROR_STOP=1 `
        --command='SELECT PostGIS_Full_Version();'
    if ($LASTEXITCODE -ne 0) {
        throw 'PostgreSQL/PostGIS 연결 확인에 실패했습니다.'
    }

    $osmArguments = @(
        '--create',
        '--slim',
        '--drop',
        '--extra-attributes',
        '--output=flex',
        "--style=$stylePath",
        '--schema=gis_import',
        '--middle-schema=gis_import',
        '--prefix=seoul_osm',
        '--bbox=126.65,37.35,127.35,37.80',
        "--number-processes=$Workers",
        "--database=$databaseName",
        "--host=$databaseHost",
        "--port=$databasePort",
        "--username=$DatabaseUser",
        $PbfPath
    )

    Write-Host '1/5 OSM 건물·수역·토지피복·주요 도로를 임시 스키마에 적재합니다.'
    & $Osm2pgsqlPath @osmArguments
    if ($LASTEXITCODE -ne 0) {
        throw 'osm2pgsql 적재에 실패했습니다. gis.building은 변경되지 않았습니다.'
    }

    Write-Host '2/5 검증된 임시 건물 데이터를 gis.building에 병합합니다.'
    & $PsqlPath `
        --host=$databaseHost `
        --port=$databasePort `
        --username=$DatabaseUser `
        --dbname=$databaseName `
        --no-password `
        --file=$mergePath
    if ($LASTEXITCODE -ne 0) {
        throw 'gis.building 병합에 실패했습니다.'
    }

    Write-Host '3/5 검증된 임시 수역 데이터를 gis.water에 병합합니다.'
    & $PsqlPath `
        --host=$databaseHost `
        --port=$databasePort `
        --username=$DatabaseUser `
        --dbname=$databaseName `
        --no-password `
        --file=$waterMergePath
    if ($LASTEXITCODE -ne 0) {
        throw 'gis.water 병합에 실패했습니다. 건물 병합은 이미 완료되었습니다.'
    }

    Write-Host '4/5 검증된 임시 토지피복 데이터를 gis.landcover에 병합합니다.'
    & $PsqlPath `
        --host=$databaseHost `
        --port=$databasePort `
        --username=$DatabaseUser `
        --dbname=$databaseName `
        --no-password `
        --file=$landcoverMergePath
    if ($LASTEXITCODE -ne 0) {
        throw 'gis.landcover 병합에 실패했습니다. 앞 단계 병합은 이미 완료되었습니다.'
    }

    Write-Host '5/5 검증된 임시 주요 도로 데이터를 gis.road에 병합합니다.'
    & $PsqlPath `
        --host=$databaseHost `
        --port=$databasePort `
        --username=$DatabaseUser `
        --dbname=$databaseName `
        --no-password `
        --file=$roadMergePath
    if ($LASTEXITCODE -ne 0) {
        throw 'gis.road 병합에 실패했습니다. 앞 단계 병합은 이미 완료되었습니다.'
    }

    Write-Host '서울 OSM 건물·수역·토지피복·주요 도로 적재가 완료되었습니다.'
}
finally {
    $env:PGPASSWORD = $previousPgPassword
    $databasePassword = $null
}
