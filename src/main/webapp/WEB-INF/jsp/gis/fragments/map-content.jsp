<%@ page pageEncoding="UTF-8" %>

<div id="mobilePanelWorkspace" class="mobile-panel-workspace">
    <%-- 모바일에서는 지도를 기본 화면으로 유지하고, 선택한 작업만 제한된 높이의 시트로 엽니다. --%>
    <header class="mobile-panel-sheet-header">
        <button id="mobilePanelResizeHandle" class="mobile-panel-resize-handle" type="button"
                aria-label="작업 패널 크게 펼치기" aria-expanded="false"
                aria-controls="mobilePanelTrack" title="위아래로 끌어 패널 크기 조절">
            <span aria-hidden="true"></span>
        </button>
        <div class="mobile-panel-position" aria-live="polite">
            <strong id="mobilePanelTitle">방향 스캔</strong>
            <span id="mobilePanelCount">설정과 결과를 확인합니다.</span>
        </div>
        <button id="mobilePanelCollapse" class="mobile-panel-collapse" type="button"
                aria-expanded="true" aria-controls="mobilePanelTrack"
                aria-label="작업 패널 최소화" title="작업 패널 최소화">
            <span aria-hidden="true">⌄</span>
        </button>
    </header>
    <div id="mobilePanelTrack" class="mobile-panel-track">
<section class="toolbar" data-mobile-panel="scan" aria-label="방향 스캔 제어판">
    <header class="panel-header">
        <div class="panel-title">
            <div class="eyebrow">SPATIAL ANALYSIS</div>
            <h1>GIS 방향 스캔</h1>
        </div>
        <button id="togglePanelButton" class="panel-toggle-button" type="button"
                aria-expanded="true" aria-controls="gisPanelBody" aria-label="제어판 접기"
                title="제어판 접기">
            <span id="panelToggleIcon" aria-hidden="true">‹</span>
        </button>
    </header>
    <div id="gisPanelBody" class="panel-body">
        <div class="step-heading">
            <span class="step-number">01</span>
            <div><strong>분석 조건 설정</strong><small>관측점과 높이, 검색 반경을 설정합니다.</small></div>
        </div>
        <p id="status" class="selection-status">지도에서 건물 바깥의 관측점을 클릭하세요. 검색반경은 300m입니다.</p>

        <div class="analysis-settings" aria-label="분석 설정">
            <div class="settings-summary" aria-label="고정 분석 조건">
                <div><span>분석 방식</span><strong>건물·지형 절대고도</strong></div>
                <div class="observer-criterion"><span>관측 기준</span><strong id="observerCriterion">지면 확인 전 + 관측자 1.5m</strong></div>
            </div>

            <div class="setting-control">
                <div class="setting-heading">
                    <label for="observerHeight">관측자 높이</label>
                    <output id="observerHeightValue" for="observerHeight">1.5m</output>
                </div>
                <div class="range-adjuster">
                    <button class="control-step" type="button" data-control="observerHeight" data-step="-0.5" aria-label="관측자 높이 0.5미터 낮추기">−</button>
                    <input id="observerHeight" type="range" min="0.5" max="50" step="0.5" value="1.5">
                    <button class="control-step" type="button" data-control="observerHeight" data-step="0.5" aria-label="관측자 높이 0.5미터 높이기">+</button>
                </div>
                <div class="range-scale" aria-hidden="true"><span>0.5m</span><span>25m</span><span>50m</span></div>
            </div>

            <div class="setting-control">
                <div class="setting-heading">
                    <label for="radiusInput">검색 반경</label>
                    <output id="radiusValue" for="radiusInput">300m</output>
                </div>
                <div class="range-adjuster">
                    <button class="control-step" type="button" data-control="radiusInput" data-step="-10" aria-label="검색 반경 10미터 줄이기">−</button>
                    <input id="radiusInput" type="range" min="100" max="500" step="10" value="300">
                    <button class="control-step" type="button" data-control="radiusInput" data-step="10" aria-label="검색 반경 10미터 늘리기">+</button>
                </div>
                <div class="range-scale" aria-hidden="true"><span>100m</span><span>300m</span><span>500m</span></div>
            </div>

            <div class="display-options">
                <div class="display-options-heading">
                    <span>분석 영역 표시</span>
                </div>
                <div class="display-toggle-stack">
                    <label class="toggle result-toggle">
                        <span class="result-toggle-copy">
                            <strong><i class="legend-swatch visible"></i>관측 가능 영역</strong>
                            <small>장애물 없이 직접 보이는 구간</small>
                        </span>
                        <input id="showVisible" type="checkbox" checked aria-label="관측 가능 영역 표시">
                    </label>
                    <label class="toggle result-toggle">
                        <span class="result-toggle-copy">
                            <strong><i class="legend-swatch blocked"></i>관측 불가 영역</strong>
                            <small>건물 또는 지형 뒤에 가려진 구간</small>
                        </span>
                        <input id="showExcluded" type="checkbox" checked aria-label="관측 불가 영역 표시">
                    </label>
                </div>
                <div class="result-data-note" aria-label="고도 데이터 없음 설명">
                    <i class="legend-swatch nodata" aria-hidden="true"></i>
                    <span><strong>고도 데이터 없음</strong><small>표고 자료가 없어 판정하지 못한 구간</small></span>
                </div>
            </div>
        </div>

        <div class="button-row">
            <button id="scanButton" type="button" disabled>스캔 시작</button>
            <button id="toggleRadiusButton" type="button" aria-pressed="false">원 외곽선 숨기기</button>
        </div>

        <p id="resultInfo" class="visually-hidden" role="status">관측점을 선택하면 분석을 시작합니다.</p>
        <p id="buildingInfo" class="visually-hidden" role="status">건물 조회 대기 중</p>
        <p id="terrainInfo" class="visually-hidden" role="status" data-state="idle">DEM 조회 대기 중</p>
    </div>
</section>

<aside id="analysisResultPanel" class="analysis-result-panel" data-mobile-panel="analysis"
       aria-label="방향 분석 결과" hidden>
    <header class="result-panel-header">
        <div class="result-panel-heading">
            <div class="result-panel-title"><span>ANALYSIS RESULT</span><strong>방향 분석</strong></div>
            <button id="analysisResultClose" class="result-panel-close" type="button"
                    aria-label="방향 분석 닫기">×</button>
        </div>
        <p>원의 방향을 선택해 건물과 고도 단면을 확인하세요.</p>
    </header>
    <div class="result-panel-body">
        <div id="directionReview" class="review-control" hidden>
            <div class="review-heading"><span id="reviewBearingLabel">방향별 스캔 결과</span><output id="reviewBearingValue">0.0° 북</output></div>
            <div class="bearing-dial-wrap">
                <div id="reviewBearingDial" class="bearing-dial" role="slider" tabindex="0"
                     aria-labelledby="reviewBearingLabel" aria-describedby="bearingDialHelp"
                     aria-valuemin="0" aria-valuemax="359.9" aria-valuenow="0" aria-valuetext="0.0° 북">
                    <canvas id="reviewBuildingCanvas" class="bearing-dial-canvas" aria-hidden="true"></canvas>
                    <canvas id="reviewHitCanvas" class="bearing-dial-canvas bearing-dial-hit-canvas" aria-hidden="true"></canvas>
                    <span class="bearing-dial-label bearing-dial-label-n" aria-hidden="true">N</span>
                    <span class="bearing-dial-label bearing-dial-label-e" aria-hidden="true">E</span>
                    <span class="bearing-dial-label bearing-dial-label-s" aria-hidden="true">S</span>
                    <span class="bearing-dial-label bearing-dial-label-w" aria-hidden="true">W</span>
                    <span class="bearing-dial-indicator" aria-hidden="true">
                        <span class="bearing-dial-line"></span>
                        <span class="bearing-dial-tip"></span>
                    </span>
                    <span class="bearing-dial-center" aria-hidden="true"></span>
                </div>
                <p id="bearingDialHelp" class="bearing-dial-help">건물 배치를 보고 원의 방향을 클릭하거나 드래그하세요.</p>
            </div>
            <div class="review-actions">
                <div id="reviewInfo" class="review-summary" role="status" aria-live="polite" aria-label="방향별 경로 차폐 정보">
                    <div><span>경로 교차</span><strong id="reviewHitCount">—</strong></div>
                    <div><span id="reviewFirstHeightLabel">차폐 원인</span><strong id="reviewFirstHeight">—</strong></div>
                    <div><span>차폐 거리</span><strong id="reviewFirstDistance">—</strong></div>
                </div>
            </div>
        </div>
        <div class="profile-box">
            <div class="profile-box-heading">
                <h2>현재 방향 고도 단면</h2>
                <span><i aria-hidden="true"></i>지형 고도선</span>
            </div>
            <canvas id="profileCanvas" width="330" height="112" aria-label="현재 방위각의 거리별 고도 단면"></canvas>
        </div>
    </div>
</aside>

<aside id="buildingDetailPanel" class="building-detail-panel" data-mobile-panel="building"
       aria-labelledby="buildingDetailName" aria-busy="false" hidden>
    <header class="building-detail-header">
        <div>
            <div class="building-detail-kicker">
                <span class="building-detail-eyebrow">BUILDING DETAIL</span>
                <span class="building-detail-selection-badge"><i aria-hidden="true"></i>지도에서 선택됨</span>
            </div>
            <h2 id="buildingDetailName">건물 상세정보</h2>
            <p id="buildingDetailType">OSM 건물</p>
        </div>
        <div class="building-detail-preview" aria-hidden="true">
            <canvas id="buildingDetailPreview" width="220" height="160"></canvas>
        </div>
        <button id="buildingDetailClose" type="button" aria-label="건물 상세정보 닫기">×</button>
    </header>
    <p id="buildingDetailStatus" class="building-detail-status" role="status">
        건물 상세정보를 불러오는 중입니다.
    </p>
    <div id="buildingDetailContent" class="building-detail-content" hidden>
        <div class="building-detail-metrics" aria-label="건물 주요 높이">
            <div>
                <svg class="building-detail-metric-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2.8 12s3.4-5.2 9.2-5.2S21.2 12 21.2 12 17.8 17.2 12 17.2 2.8 12 2.8 12Z"/>
                    <circle cx="12" cy="12" r="2.6"/>
                </svg>
                <span>옥상 해발</span><strong id="buildingDetailRoof">—</strong>
            </div>
            <div>
                <svg class="building-detail-metric-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m3 18 5.3-8 3.1 4.1L15.3 8 21 18H3Z"/>
                    <path d="m6.6 18 4.7-6.9"/>
                </svg>
                <span>지면 해발</span><strong id="buildingDetailGround">—</strong>
            </div>
            <div>
                <svg class="building-detail-metric-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 20V4h8v16M5 20h14M10.5 8h3M10.5 12h3M10.5 16h3"/>
                    <path d="m4.5 7 1.8-2 1.8 2M6.3 5v14m-1.8-2 1.8 2 1.8-2"/>
                </svg>
                <span>건물 높이</span><strong id="buildingDetailHeight">—</strong>
            </div>
        </div>
        <dl class="building-detail-list">
            <div><dt>높이 산정</dt><dd id="buildingDetailHeightSource">—</dd></div>
            <div><dt>건물 ID</dt><dd id="buildingDetailId">—</dd></div>
            <div><dt>주소</dt><dd id="buildingDetailAddress"></dd></div>
            <div><dt>층수</dt><dd id="buildingDetailLevels"></dd></div>
            <div><dt>최소 높이</dt><dd id="buildingDetailMinHeight"></dd></div>
            <div><dt>원본 갱신</dt><dd id="buildingDetailUpdatedAt"></dd></div>
        </dl>
        <details id="buildingDetailTagsSection" class="building-detail-tags">
            <summary>OSM 원본 속성</summary>
            <dl id="buildingDetailTags"></dl>
        </details>
    </div>
</aside>

<aside id="mobileMapSettingsPanel" class="mobile-map-settings-panel" data-mobile-panel="map"
       aria-label="지도 설정">
    <div class="mobile-map-settings-section">
        <strong>화면 방식</strong>
        <div class="mobile-map-setting-options" role="group" aria-label="지도 화면 방식">
            <button type="button" data-mobile-map-control="2d" aria-pressed="true">2D</button>
            <button type="button" data-mobile-map-control="3d" aria-pressed="false">3D</button>
        </div>
    </div>
    <div class="mobile-map-settings-section">
        <strong>배경지도</strong>
        <div class="mobile-map-setting-options" role="group" aria-label="배경지도 종류">
            <button type="button" data-mobile-map-control="general" aria-pressed="true">일반</button>
            <button type="button" data-mobile-map-control="satellite" aria-pressed="false">위성</button>
        </div>
    </div>
</aside>
    </div>

    <nav class="mobile-panel-navigation" aria-label="모바일 주요 메뉴">
        <button class="mobile-panel-tab is-active" type="button" data-mobile-target="scan"
                aria-pressed="true" aria-controls="gisPanelBody">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>
            <span>스캔</span>
        </button>
        <button class="mobile-panel-tab" type="button" data-mobile-target="analysis"
                aria-pressed="false" aria-controls="analysisResultPanel" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18.5 9 13l3 2.5L20 6"/><path d="M4 5v14h16"/></svg>
            <span>분석</span>
        </button>
        <button class="mobile-panel-tab" type="button" data-mobile-target="building"
                aria-pressed="false" aria-controls="buildingDetailPanel" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4h12v17M3 21h18M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2"/></svg>
            <span>건물</span>
        </button>
        <button class="mobile-panel-tab" type="button" data-mobile-target="map"
                aria-pressed="false" aria-controls="mobileMapSettingsPanel">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2V6Z"/><path d="M8 4v13M16 7v13"/></svg>
            <span>지도</span>
        </button>
    </nav>
</div>

<div id="mapZoomControl" class="map-zoom-dock" aria-label="지도 화면 도구">
    <button id="mobileInterfaceButton" class="mobile-interface-button" type="button"
            aria-label="모든 UI 감추기" aria-pressed="false" title="모든 UI 감추기">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3.2 12C5.25 8.55 8.2 6.7 12 6.7C15.8 6.7 18.75 8.55 20.8 12C18.75 15.45 15.8 17.3 12 17.3C8.2 17.3 5.25 15.45 3.2 12Z"
                  stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"/>
            <circle cx="12" cy="12" r="2.65" stroke="currentColor" stroke-width="1.65"/>
            <path class="interface-hide-slash" d="M5 4.8L19 19.2"
                  stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
    </button>
    <button id="mapZoomOutButton" type="button" aria-label="화면 축소">−</button>
    <input id="mapZoomRange" type="range" min="0" max="100" step="1" value="50"
           aria-label="화면 확대 수준" aria-valuetext="확대 50%">
    <button id="mapZoomInButton" type="button" aria-label="화면 확대">+</button>
</div>

<div class="map-tool-menu" aria-label="지도 도구">
    <%-- 화면이 좁아지면 모드 전환과 실행 도구를 서로 다른 줄로 재배치할 수 있도록 역할별로 묶습니다. --%>
    <div class="map-mode-controls">
        <div class="view-mode-switch" role="group" aria-label="지도 화면 전환" data-mode="2d">
            <button id="show2dButton" type="button" aria-pressed="true">2D</button>
            <button id="show3dButton" type="button" aria-pressed="false">3D</button>
        </div>
        <div class="view-mode-switch basemap-mode-switch" role="group"
             aria-label="배경지도 전환" data-mode="general">
            <button id="generalMapButton" type="button" aria-pressed="true">일반</button>
            <button id="satelliteMapButton" type="button" aria-pressed="false">위성</button>
        </div>
    </div>
    <div class="map-action-controls">
        <button id="buildingDetailButton" class="map-observation-button map-building-detail-button"
            type="button" aria-label="분석 건물을 선택하면 상세정보를 볼 수 있습니다"
            aria-pressed="false" aria-disabled="true" disabled
            aria-expanded="false" aria-controls="buildingDetailPanel"
            data-tooltip="분석 건물을 선택하세요">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3.4L20 7.5L12 11.6L4 7.5L12 3.4Z"
                  stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"/>
            <path d="M4 11.35L12 15.45L20 11.35M4 15.25L12 19.35L20 15.25"
                  stroke="currentColor" stroke-width="1.65" stroke-linecap="round"
                  stroke-linejoin="round"/>
        </svg>
        </button>
        <button id="analysisResultButton" class="map-observation-button map-analysis-button"
            type="button" aria-label="방향 분석 결과 열기" aria-pressed="false"
            aria-expanded="false" aria-controls="analysisResultPanel"
            data-tooltip="방향 분석 결과" hidden>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="7.25" stroke="currentColor" stroke-width="1.7"/>
            <path d="M12 12L8.1 6.9M12 12L17.4 9.2M12 12V18.2"
                  stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            <circle cx="12" cy="12" r="1.7" fill="currentColor"/>
        </svg>
        </button>
        <button id="changeObservationButton" class="map-observation-button" type="button"
            aria-label="관측점 변경" aria-pressed="false"
            data-tooltip="관측점 변경" hidden>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2.75V5.25M12 18.75V21.25M2.75 12H5.25M18.75 12H21.25"
                  stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="12" cy="12" r="6.25" stroke="currentColor" stroke-width="1.8"/>
            <circle cx="12" cy="12" r="2.35" fill="currentColor"/>
            <circle cx="12" cy="12" r="0.85" fill="white"/>
        </svg>
        </button>
        <button id="toggleInterfaceButton" class="map-observation-button map-interface-button"
            type="button" aria-label="모든 UI 감추기" aria-pressed="false"
            data-tooltip="모든 UI 감추기">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3.2 12C5.25 8.55 8.2 6.7 12 6.7C15.8 6.7 18.75 8.55 20.8 12C18.75 15.45 15.8 17.3 12 17.3C8.2 17.3 5.25 15.45 3.2 12Z"
                  stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"/>
            <circle cx="12" cy="12" r="2.65" stroke="currentColor" stroke-width="1.65"/>
            <path class="interface-hide-slash" d="M5 4.8L19 19.2"
                  stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        </button>
        <span class="map-brand-mark" role="img" aria-label="GIS 방향 스캔">
            <img src="<%=request.getContextPath()%>/images/gis-scan-mark.png?v=20261007-1"
                 alt="" aria-hidden="true">
        </span>
    </div>
    <div id="alertBanner" class="map-warning" role="alert" aria-live="assertive" hidden>
        <span class="warning-icon" aria-hidden="true">!</span>
        <span class="warning-copy">
            <strong id="alertTitle">오류가 발생했습니다.</strong>
            <span id="alertMessage">잠시 후 다시 시도하세요.</span>
        </span>
    </div>
</div>
<section id="scanStatusCard" class="scan-overview scan-status-dock" data-state="idle"
         tabindex="0" aria-label="스캔 상태와 분석 정보">
    <div class="scan-progress-head">
        <div id="scanProgressRing" class="scan-progress-ring" style="--scan-progress: 0deg" aria-hidden="true">
            <span id="scanProgressPercent">0%</span>
        </div>
        <div class="scan-progress-copy">
            <strong id="scanStatusTitle">분석 대기</strong>
            <div class="scan-progress-track" aria-hidden="true"><i id="scanProgressBar"></i></div>
        </div>
    </div>
    <div class="scan-condition-grid" aria-label="현재 분석 조건">
        <div><span>관측 반경</span><strong id="scanRadiusValue">300m</strong></div>
        <div><span>관측자 높이</span><strong id="scanObserverHeight">1.5m</strong></div>
        <div><span>관측자 해발</span><strong id="observerElevation">—</strong></div>
    </div>
    <div class="scan-overview-details">
        <p id="hitInfo" role="status">지도를 클릭하면 주변 건물을 조회한 뒤 자동으로 스캔합니다.</p>
        <div class="scan-count-grid" aria-label="건물 집계">
            <div>
                <span>현재 화면 건물</span><strong id="screenBuildingCount">—</strong>
                <small>현재 화면에서 확인되는 분석 건물</small>
            </div>
            <div>
                <span>전체 분석 건물</span><strong id="analysisBuildingCount">—</strong>
                <small>관측 반경과 맞닿은 DB 건물</small>
            </div>
        </div>
        <div class="scan-result-strip" aria-label="분석 결과 비율">
            <span><i class="visible" aria-hidden="true"></i>관측 가능 <strong id="visiblePercent">—</strong></span>
            <span><i class="blocked" aria-hidden="true"></i>관측 불가 <strong id="blockedPercent">—</strong></span>
        </div>
        <div class="scan-data-date"><span>데이터 갱신</span><time id="scanDataDate">—</time></div>
        <details class="sample-note">
            <summary>데이터 및 판정 기준</summary>
            <p>건물: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · PostgreSQL / PostGIS<br>
            표고: <a href="https://registry.opendata.aws/copernicus-dem/" target="_blank" rel="noopener">Copernicus DEM GLO-30 Public</a> · 30m DSM<br>
            관측자와 건물 옥상의 지형 포함 해발고도를 비교합니다.</p>
        </details>
    </div>
</section>
<div id="mapInteractionHint" class="map-interaction-hint" role="status">
    지도 클릭 · 관측점 선택&nbsp;&nbsp;|&nbsp;&nbsp;휠 · 확대/축소
</div>
<div id="map" class="map-surface-active" tabindex="0" aria-label="분석 관측점 선택 지도" aria-hidden="false"></div>
<div id="cesiumMap" class="map-surface-inactive" aria-label="3D 건물 지도" aria-hidden="true"></div>
<div id="cesiumBuildingHover" class="cesium-building-hover" role="tooltip" hidden></div>
<div id="demLoading" class="dem-loading" role="status" aria-live="polite">
    <div class="loading-card"><div class="loading-spinner" aria-hidden="true"></div>
        <strong>고도 데이터를 미리 준비하고 있습니다</strong>
        <span id="demLoadingMessage">현재 지도 주변 DEM을 불러오는 중입니다.</span>
    </div>
</div>
