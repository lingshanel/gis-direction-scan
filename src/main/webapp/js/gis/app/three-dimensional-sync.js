(function (global) {
    "use strict";

    /**
     * 2D에서 조회·분석한 데이터를 동일한 순서로 3D 장면에 전달합니다.
     * 건물 전처리 중 관측점이 바뀌면 이전 결과를 버전으로 무시하여, 늦게 끝난 요청이
     * 최신 Cesium 장면을 덮어쓰지 않게 합니다. 3D는 별도 분석 결과를 만들지 않습니다.
     */
    function create(options) {
        var pendingBuildingData = null;
        var buildingQueuedAt = null;
        var buildingDataVersion = 0;

        function waitForMapMovement() {
            var view = options.map.getView();
            if (typeof view.getAnimating !== "function" || !view.getAnimating()) {
                return Promise.resolve();
            }
            return new Promise(function (resolve) {
                var settled = false;
                var timeoutId = null;
                function finish() {
                    if (settled) return;
                    settled = true;
                    options.map.un("moveend", finish);
                    if (timeoutId !== null) global.clearTimeout(timeoutId);
                    resolve();
                }
                options.map.on("moveend", finish);
                timeoutId = global.setTimeout(finish, 700);
            });
        }

        function queueBuildingData(data) {
            pendingBuildingData = data;
            buildingQueuedAt = global.performance.now();
            buildingDataVersion++;
        }

        function flushBuildingData(expectedVersion) {
            if ((expectedVersion !== undefined &&
                    expectedVersion !== buildingDataVersion) ||
                    pendingBuildingData === null) {
                return Promise.resolve(null);
            }
            var data = pendingBuildingData;
            var queuedAt = buildingQueuedAt;
            var startedAt = global.performance.now();
            var buildingCount = Array.isArray(data.features) ? data.features.length : 0;
            pendingBuildingData = null;
            buildingQueuedAt = null;
            return options.viewSwitcher.setBuildingData(data).catch(function (error) {
                console.error("Cesium 건물 표시 실패", error);
                return null;
            }).then(function (result) {
                console.info("[GIS 성능][3D] DB 건물 Cesium 변환", {
                    queuedWaitMs: queuedAt === null
                        ? null
                        : Number((startedAt - queuedAt).toFixed(1)),
                    elapsedMs: Number((global.performance.now() - startedAt).toFixed(1)),
                    buildingCount: buildingCount
                });
                return result;
            });
        }

        function prepareQueuedBuildings(prepareBuildingData) {
            var expectedVersion = buildingDataVersion;
            return waitForMapMovement().then(function () {
                if (expectedVersion !== buildingDataVersion) return null;
                return prepareBuildingData();
            }).then(function (data) {
                if (data === null || expectedVersion !== buildingDataVersion) return null;
                return flushBuildingData(expectedVersion).then(function () {
                    return expectedVersion === buildingDataVersion ? data : null;
                });
            });
        }

        function setAnalysisData(data) {
            options.viewSwitcher.setAnalysisData(data).catch(function (error) {
                console.error("Cesium 분석 영역 표시 실패", error);
            });
        }

        function prepareAnalysis(data) {
            return options.viewSwitcher.prepareAnimatedAnalysis(data).catch(function (error) {
                console.error("Cesium 진행 영역 준비 실패", error);
            });
        }

        return {
            flushBuildingData: flushBuildingData,
            prepareAnalysis: prepareAnalysis,
            prepareQueuedBuildings: prepareQueuedBuildings,
            queueBuildingData: queueBuildingData,
            setAnalysisData: setAnalysisData
        };
    }

    global.GisThreeDimensionalSync = {
        create: create
    };
})(window);
