param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$DumpPath,

    [string]$RuntimeRole
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $DumpPath -PathType Leaf)) {
    throw "DB 덤프를 찾을 수 없습니다: $DumpPath"
}

$psql = Get-Command psql -ErrorAction Stop
$pgRestore = Get-Command pg_restore -ErrorAction Stop
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '1/3 PostGIS 확장을 준비합니다.'
& $psql.Source $DatabaseUrl -f (Join-Path $scriptRoot 'prepare.sql')
if ($LASTEXITCODE -ne 0) { throw 'PostGIS 확장 준비에 실패했습니다.' }

Write-Host '2/3 gis 운영 스키마만 복원합니다.'
& $pgRestore.Source `
    --exit-on-error `
    --no-owner `
    --no-privileges `
    --schema=gis `
    --dbname=$DatabaseUrl `
    $DumpPath
if ($LASTEXITCODE -ne 0) { throw 'GIS 운영 스키마 복원에 실패했습니다.' }

if (-not [string]::IsNullOrWhiteSpace($RuntimeRole)) {
    Write-Host '3/3 웹 애플리케이션 계정에 읽기 전용 권한을 부여합니다.'
    & $psql.Source $DatabaseUrl `
        -v "runtime_role=$RuntimeRole" `
        -f (Join-Path $scriptRoot 'grant-runtime-readonly.sql')
    if ($LASTEXITCODE -ne 0) { throw '읽기 전용 권한 부여에 실패했습니다.' }
} else {
    Write-Host '3/3 RuntimeRole이 없어 권한 부여를 건너뜁니다.'
}

Write-Host 'GIS 운영 데이터 복원이 완료되었습니다.'

