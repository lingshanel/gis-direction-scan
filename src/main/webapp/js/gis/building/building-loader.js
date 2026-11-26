(function (global) {
    "use strict";

    function fetchBuildings(options) {
        var params = new URLSearchParams({
            lat: options.latitude.toFixed(7),
            lon: options.longitude.toFixed(7),
            radius: String(options.radius)
        });
        return GisJsonApi.fetch({
            url: options.endpoint + "?" + params,
            signal: options.signal,
            label: "건물 조회",
            invalidMessage: "건물 데이터 형식이 올바르지 않습니다.",
            validate: function (data) {
                return data.type === "FeatureCollection" && Array.isArray(data.features);
            }
        });
    }

    function create(options) {
        var activeController = null;
        var requestVersion = 0;
        var ready = false;

        function logPerformance(request, stage, startedAt, details) {
            console.info("[GIS 성능][건물 요청 " + request.id + "] " + stage, Object.assign({
                elapsedMs: Number((global.performance.now() - startedAt).toFixed(1)),
                center: request.origin.slice(),
                radius: request.radius
            }, details || {}));
        }

        function isCurrent(request) {
            return request.id === requestVersion;
        }

        function setText(id, value) {
            var element = document.getElementById(id);
            if (element) element.textContent = value;
        }

        function formatDataDate(value) {
            if (!value) return "확인되지 않음";
            var date = new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            return new Intl.DateTimeFormat("ko-KR", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }).format(date);
        }

        function resetProgressDisplay() {
            var ring = document.getElementById("scanProgressRing");
            var bar = document.getElementById("scanProgressBar");
            if (ring) ring.style.setProperty("--scan-progress", "0deg");
            if (bar) bar.style.width = "0%";
            setText("scanProgressPercent", "0%");
        }

        function begin(origin, onAccepted) {
            options.hideAlert();
            if (activeController !== null) activeController.abort();

            var controller = new AbortController();
            var request = {
                id: ++requestVersion,
                controller: controller,
                origin: origin.slice(),
                previousOrigin: options.getCenter() === null
                    ? null
                    : options.getCenter().slice(),
                radius: options.getRadius(),
                onAccepted: onAccepted,
                previousReady: ready,
                button: document.getElementById("scanButton"),
                buildingInfo: document.getElementById("buildingInfo")
            };
            request.startedAt = global.performance.now();
            request.timeout = setTimeout(function () {
                controller.abort();
            }, 50000);
            activeController = controller;
            ready = false;

            request.button.disabled = true;
            request.button.textContent = "건물 조회 중…";
            document.getElementById("scanStatusCard").dataset.state = "loading";
            setText("scanStatusTitle", "건물 불러오는 중");
            resetProgressDisplay();
            request.buildingInfo.textContent =
                "선택한 위치 주변의 실제 건물 경계를 조회하고 있습니다.";

            var terrainInfo = document.getElementById("terrainInfo");
            terrainInfo.dataset.state = options.terrainProvider.lastStatus.state;
            terrainInfo.textContent = options.terrainProvider.covers(request.origin, request.radius)
                ? "미리 준비한 DEM 캐시를 사용합니다."
                : "DEM 타일을 백그라운드에서 준비합니다.";
            document.getElementById("hitInfo").textContent =
                "조회가 완료되면 자동으로 스캔합니다.";
            return request;
        }

        function requestData(request) {
            var startedAt = global.performance.now();
            return fetchBuildings({
                endpoint: options.endpoint,
                latitude: request.origin[1],
                longitude: request.origin[0],
                radius: request.radius,
                signal: request.controller.signal
            }).then(function (data) {
                logPerformance(request, "API 응답 + JSON 파싱", startedAt, {
                    buildingCount: data.features.length
                });
                return data;
            });
        }

        function createFeatures(request, data) {
            var startedAt = global.performance.now();
            data.features.forEach(function (feature) {
                if (!feature.geometry ||
                        ["Polygon", "MultiPolygon"].indexOf(feature.geometry.type) < 0) {
                    throw new Error("건물 경계가 누락되어 분석을 중단했습니다.");
                }
            });
            var features = options.geojsonFormat.readFeatures({
                type: "FeatureCollection",
                features: data.features
            }, {
                dataProjection: "EPSG:4326",
                featureProjection: options.map.getView().getProjection()
            });
            logPerformance(request, "GeoJSON 검증 + OpenLayers Feature 변환", startedAt, {
                buildingCount: features.length
            });
            return features;
        }

        function rejection(title, message) {
            var error = new Error(message);
            error.selectionRejected = true;
            error.title = title;
            return error;
        }

        function validateBuildingPosition(request, data) {
            if (typeof request.onAccepted !== "function") return;

            var point = turf.point(request.origin);
            var containingBuilding = data.features.some(function (feature) {
                return feature.geometry &&
                    ["Polygon", "MultiPolygon"].indexOf(feature.geometry.type) >= 0 &&
                    turf.booleanPointInPolygon(point, feature);
            });
            if (containingBuilding) {
                throw rejection(
                    "관측점을 지정할 수 없습니다.",
                    "건물 내부 또는 경계가 아닌 빈 공간을 선택하세요."
                );
            }
        }

        function validateTerrainPosition(request, data, terrainStatus) {
            if (typeof request.onAccepted !== "function") return;

            if (!terrainStatus || terrainStatus.state !== "ready") {
                throw rejection(
                    "분석 지원 범위 밖입니다.",
                    "고도 데이터가 준비된 대한민국 지도 영역을 선택하세요."
                );
            }

            var samples = [request.origin];
            for (var bearing = 0; bearing < 360; bearing += 45) {
                samples.push(turf.destination(
                    request.origin,
                    0.06,
                    bearing,
                    { units: "kilometers" }
                ).geometry.coordinates);
            }
            var heights = samples.map(function (coordinate) {
                return options.terrainProvider.sample(coordinate);
            });
            if (heights.some(function (height) { return height === null; })) {
                throw rejection(
                    "분석 지원 범위 밖입니다.",
                    "고도 자료가 없는 위치에는 관측점을 지정할 수 없습니다."
                );
            }

            var openWater = data.features.length === 0 && heights.every(function (height) {
                return Math.abs(height) <= 0.01;
            });
            if (openWater) {
                throw rejection(
                    "수역에는 관측점을 지정할 수 없습니다.",
                    "육지의 건물 바깥 지점을 선택하세요."
                );
            }
        }

        function prepareTerrain(request) {
            var startedAt = global.performance.now();
            var cacheHit = options.terrainProvider.covers(request.origin, request.radius);
            if (!cacheHit) {
                options.setLoading(
                    true,
                    "선택한 관측점 주변의 고도 격자를 준비하고 있습니다."
                );
            }
            return options.terrainProvider.prepare(request.origin, request.radius, {
                preloadRadius: options.demPreloadRadius
            }).then(function (status) {
                options.setLoading(false);
                logPerformance(request, "DEM 준비", startedAt, {
                    cacheHit: cacheHit,
                    state: status && status.state
                });
                return status;
            });
        }

        function complete(request, data, features, terrainStatus) {
            validateTerrainPosition(request, data, terrainStatus);
            options.updateTerrainStatus(terrainStatus);
            var sourceStartedAt = global.performance.now();
            options.buildingSource.clear();
            options.resultSource.clear();
            options.raySource.clear();
            options.buildingSource.addFeatures(features);
            logPerformance(request, "2D 건물 소스 교체", sourceStartedAt, {
                buildingCount: features.length
            });
            if (typeof request.onAccepted === "function") {
                request.onAccepted(request.origin);
            }
            ready = true;
            if (typeof options.onDataReady === "function") {
                options.onDataReady(data);
            }

            var metadata = data.metadata || {};
            var analysisBuildingCount = features.length;
            options.buildingSource.set("analysisBuildingCount", analysisBuildingCount);
            options.buildingSource.set("dataUpdatedAt", metadata.dataUpdatedAt || "");
            // 설정 변경만으로 재조회하지 않기 때문에, 다시 스캔 시 현재 건물 데이터가
            // 어느 관측점·반경에서 준비됐는지 비교할 수 있도록 조회 조건을 보관합니다.
            options.buildingSource.set("loadedOrigin", request.origin.slice());
            options.buildingSource.set("loadedRadius", request.radius);
            setText("analysisBuildingCount", analysisBuildingCount.toLocaleString() + "개");
            setText("screenBuildingCount", "스캔 후 표시");
            setText("scanDataDate", formatDataDate(metadata.dataUpdatedAt));
            setText("scanStatusTitle", "분석 준비 완료");
            document.getElementById("scanStatusCard").dataset.state = "ready";
            request.buildingInfo.textContent =
                "전체 분석 건물: " + analysisBuildingCount + "개" +
                (metadata.dataUpdatedAt ? " / DB 갱신: " + metadata.dataUpdatedAt : "");
            if (analysisBuildingCount === 0) {
                request.buildingInfo.textContent +=
                    " · 원 경계에 걸친 건물은 차폐 분석에만 포함됩니다.";
            }

            request.button.disabled = false;
            request.button.textContent = "스캔 시작";
            logPerformance(request, "건물 조회부터 화면 적용까지", request.startedAt, {
                buildingCount: features.length
            });
            options.onReady();
        }

        function handleFailure(request, error) {
            options.setLoading(false);
            if (!isCurrent(request)) return;

            if (error.selectionRejected || typeof request.onAccepted === "function") {
                ready = false;
                document.getElementById("scanStatusCard").dataset.state =
                    request.previousReady ? "ready" : "idle";
                setText(
                    "scanStatusTitle",
                    request.previousReady ? "기존 분석 유지" : "관측점 선택 필요"
                );
                request.button.disabled = true;
                request.button.textContent = request.previousOrigin
                    ? "기존 관측점 복원 중…"
                    : "관측점 선택 대기";
                var rejectedMessage = error.selectionRejected
                    ? error.message
                    : "선택한 위치를 확인하지 못했습니다. 기존 관측점을 유지합니다.";
                request.buildingInfo.textContent = rejectedMessage;
                document.getElementById("hitInfo").textContent = rejectedMessage;
                options.showAlert(
                    error.title || "관측점 확인 실패",
                    error.selectionRejected
                        ? error.message
                        : (error.message || rejectedMessage),
                    error.selectionRejected ? { transient: true } : null
                );
                if (request.previousOrigin === null) return Promise.resolve();
                return options.terrainProvider.prepare(
                    request.previousOrigin,
                    request.radius,
                    { preloadRadius: options.demPreloadRadius }
                ).then(function (status) {
                    if (!isCurrent(request)) return;
                    options.updateTerrainStatus(status);
                    ready = request.previousReady && status.state === "ready";
                    request.button.disabled = !ready;
                    request.button.textContent = ready ? "다시 스캔" : "관측점 선택 대기";
                });
            }

            ready = false;
            document.getElementById("scanStatusCard").dataset.state = "error";
            setText("scanStatusTitle", "건물 조회 실패");
            options.buildingSource.clear();
            options.buildingSource.unset("analysisBuildingCount", true);
            options.buildingSource.unset("dataUpdatedAt", true);
            setText("analysisBuildingCount", "—");
            setText("screenBuildingCount", "—");
            setText("scanDataDate", "—");
            options.resultSource.clear();
            request.button.disabled = false;
            request.button.textContent = "건물 조회 다시 시도";
            request.buildingInfo.textContent =
                "건물 조회 실패 · 결과를 표시하지 않습니다.";
            var failureMessage = error.name === "AbortError"
                ? "조회 시간이 초과되었습니다. 잠시 후 다시 시도하세요."
                : (error.message || "건물 조회를 완료하지 못했습니다.");
            document.getElementById("hitInfo").textContent = failureMessage;
            document.getElementById("resultInfo").textContent =
                "건물 데이터를 받은 후 분석할 수 있습니다.";
            options.showAlert(
                "건물 조회 실패",
                failureMessage
            );
        }

        function finish(request) {
            clearTimeout(request.timeout);
            if (isCurrent(request)) activeController = null;
        }

        function load(origin, onAccepted) {
            var requestedOrigin = Array.isArray(origin) ? origin : options.getCenter();
            if (requestedOrigin === null) return Promise.resolve();
            var request = begin(requestedOrigin, onAccepted);

            return requestData(request).then(function (data) {
                if (!isCurrent(request)) return null;
                validateBuildingPosition(request, data);
                var features = createFeatures(request, data);
                return prepareTerrain(request).then(function (terrainStatus) {
                    return {
                        data: data,
                        features: features,
                        terrainStatus: terrainStatus
                    };
                });
            }).then(function (result) {
                if (!result || !isCurrent(request)) return;
                complete(
                    request,
                    result.data,
                    result.features,
                    result.terrainStatus
                );
            }).catch(function (error) {
                return handleFailure(request, error);
            }).then(function () {
                finish(request);
            });
        }

        return {
            isLoading: function () { return activeController !== null; },
            isReady: function () { return ready; },
            load: load
        };
    }

    global.GisBuildingLoader = {
        create: create
    };
})(window);
