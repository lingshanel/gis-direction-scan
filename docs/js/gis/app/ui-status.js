(function (global) {
    "use strict";

    function create() {
        var alertTimer = null;
        var alertHideTimer = null;
        var observerGround = null;

        function getObserverHeight() {
            return Number(document.getElementById("observerHeight").value) || 1.5;
        }

        function updateObserverCriterion(ground) {
            if (arguments.length > 0) {
                observerGround = ground !== null && ground !== "" &&
                    Number.isFinite(Number(ground)) ? Number(ground) : null;
            }
            var observerHeight = getObserverHeight();
            var criterion = document.getElementById("observerCriterion");
            if (observerGround === null) {
                criterion.textContent = "지면 확인 전 + 관측자 " +
                    observerHeight.toFixed(1) + "m";
                return;
            }
            criterion.textContent = "지면 " + observerGround.toFixed(1) +
                "m + 관측자 " + observerHeight.toFixed(1) + "m = " +
                (observerGround + observerHeight).toFixed(1) + "m";
        }

        function setLoading(visible, message) {
            document.getElementById("demLoading").hidden = !visible;
            if (message) {
                document.getElementById("demLoadingMessage").textContent = message;
            }
        }

        function hideAlert() {
            if (alertTimer !== null) {
                window.clearTimeout(alertTimer);
                alertTimer = null;
            }
            if (alertHideTimer !== null) {
                window.clearTimeout(alertHideTimer);
                alertHideTimer = null;
            }
            var banner = document.getElementById("alertBanner");
            banner.classList.remove("is-hiding");
            banner.hidden = true;
        }

        function showAlert(title, message, settings) {
            var banner = document.getElementById("alertBanner");
            if (alertTimer !== null) window.clearTimeout(alertTimer);
            if (alertHideTimer !== null) window.clearTimeout(alertHideTimer);
            document.getElementById("alertTitle").textContent = title;
            document.getElementById("alertMessage").textContent = message;
            banner.classList.remove("is-hiding");
            banner.hidden = false;

            if (settings && settings.transient) {
                alertTimer = window.setTimeout(function () {
                    banner.classList.add("is-hiding");
                    alertHideTimer = window.setTimeout(hideAlert, 180);
                }, settings.duration || 3000);
            }
        }

        function updateTerrainStatus(status) {
            var element = document.getElementById("terrainInfo");
            element.dataset.state = status.state;
            element.textContent = status.state === "ready"
                ? status.message + " · 건물·지형 절대고도 기준 차폐 판정"
                : status.message + " · DEM 없이 상대높이 기준으로 제한 분석";
        }

        updateObserverCriterion(null);

        return {
            getObserverHeight: getObserverHeight,
            hideAlert: hideAlert,
            setLoading: setLoading,
            showAlert: showAlert,
            updateObserverCriterion: updateObserverCriterion,
            updateTerrainStatus: updateTerrainStatus
        };
    }

    global.GisUiStatus = {
        create: create
    };
})(window);
