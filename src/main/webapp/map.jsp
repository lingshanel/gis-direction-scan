<%@ page language="java" contentType="text/html; charset=UTF-8"
	pageEncoding="UTF-8"%>
<%
String cesiumIonToken = System.getenv("CESIUM_ION_TOKEN");
if (cesiumIonToken == null || !cesiumIonToken.matches("[A-Za-z0-9._-]{20,4096}")) {
	cesiumIonToken = "";
}
%>
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GIS 방향 스캔</title>
<link rel="icon" type="image/png"
	href="<%=request.getContextPath()%>/images/gis-scan-mark.png?v=20261007-1">

<link rel="stylesheet"
	href="https://cdn.jsdelivr.net/npm/ol@10.6.1/ol.css">
<link rel="stylesheet"
	href="https://cdn.jsdelivr.net/npm/cesium@1.145.0/Build/Cesium/Widgets/widgets.css">
	<link rel="stylesheet"
		href="<%=request.getContextPath()%>/css/gis/gis-scan.css?v=20261013-4">
</head>
<body>
	<%@ include file="/WEB-INF/jsp/gis/fragments/map-content.jsp"%>

	<script>
		window.CESIUM_BASE_URL = "https://cdn.jsdelivr.net/npm/cesium@1.145.0/Build/Cesium/";
	window.GIS_RUNTIME_CONFIG = {
			cesiumIonToken: "<%=cesiumIonToken%>"
		};
	</script>
	<script
		src="https://cdn.jsdelivr.net/npm/cesium@1.145.0/Build/Cesium/Cesium.js"></script>

	<script src="https://cdn.jsdelivr.net/npm/ol@10.6.1/dist/ol.js"></script>
	<script src="https://cdn.jsdelivr.net/npm/@turf/turf@7.2.0/turf.min.js"></script>
	<script
		src="https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/app/visual-theme.js?v=20261007-8"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/app/json-api.js?v=20261001-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/analysis/geo-math.js?v=20261008-2"></script>

	<!-- 건물 데이터 조회·표시 -->
	<script
		src="<%=request.getContextPath()%>/js/gis/building/building-display.js?v=20261012-6"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/building/building-intersections.js?v=20261012-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/building/building-loader.js?v=20261012-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/building/building-preview.js?v=20261007-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/building/building-detail.js?v=20261013-1"></script>

	<!-- 지도 생성·사용자 조작 -->
	<script
		src="<%=request.getContextPath()%>/js/gis/map/map-layers.js?v=20261012-3"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/map/map-interactions.js?v=20261013-1"></script>

	<!-- Cesium 3D 건물 표시·화면 전환 -->
	<script
		src="<%=request.getContextPath()%>/js/gis/3d/cesium-thematic-map.js?v=20261001-4"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/3d/cesium-buildings.js?v=20261012-2"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/3d/cesium-visibility-regions.js?v=20261012-3"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/3d/cesium-scan-motion.js?v=20261012-2"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/3d/cesium-observation.js?v=20261012-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/3d/cesium-review-direction.js?v=20261012-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/3d/cesium-map.js?v=20261012-4"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/3d/map-view-switcher.js?v=20261012-2"></script>

	<!-- 방향·고도·지형 분석 -->
	<script
		src="<%=request.getContextPath()%>/js/gis/analysis/elevation-viewshed.js?v=20261012-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/analysis/elevation-regions.js?v=20261008-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/analysis/elevation-profile.js?v=20261013-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/analysis/direction-review.js?v=20261013-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/analysis/terrain-provider.js?v=20260928-1"></script>

	<!-- 애플리케이션 상태·실행 -->
	<script
		src="<%=request.getContextPath()%>/js/gis/app/ui-status.js?v=20261001-2"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/app/panel-controls.js?v=20261013-3"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/app/scan-building-data.js?v=20261008-1"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/app/scan-animation.js?v=20261012-2"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/app/scan-controller.js?v=20261012-5"></script>
	<script
		src="<%=request.getContextPath()%>/js/gis/app/three-dimensional-sync.js?v=20261008-1"></script>
	<script id="gisAppScript"
		data-context-path="<%=request.getContextPath()%>"
		src="<%=request.getContextPath()%>/js/gis/app/gis-app.js?v=20261013-1"></script>

</body>
</html>
