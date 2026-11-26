(function (global) {
    "use strict";

    /**
     * 하이라이트 건물의 상세 조회와 패널 표시만 담당합니다.
     * 스캔용 building-loader와 분리되어 있으므로 건물을 클릭하기 전에는 요청하지 않습니다.
     */
    function create(options) {
        var panel = document.getElementById("buildingDetailPanel");
        var toggleButton = document.getElementById("buildingDetailButton");
        var closeButton = document.getElementById("buildingDetailClose");
        var status = document.getElementById("buildingDetailStatus");
        var content = document.getElementById("buildingDetailContent");
        var preview = global.GisBuildingPreview.create(
            document.getElementById("buildingDetailPreview")
        );
        var cache = new Map();
        var requestController = null;
        var requestVersion = 0;
        var activeFeature = null;
        var activeBuildingId = null;

        function setVisible(visible) {
            var nextVisible = Boolean(visible && activeFeature);
            panel.hidden = !nextVisible;
            document.body.classList.toggle("building-detail-open", nextVisible);
            toggleButton.setAttribute("aria-pressed", String(nextVisible));
            toggleButton.setAttribute("aria-expanded", String(nextVisible));
            toggleButton.setAttribute(
                "aria-label",
                nextVisible ? "선택 건물 상세정보 닫기" : "선택 건물 상세정보 열기"
            );
            toggleButton.setAttribute(
                "data-tooltip",
                nextVisible ? "건물 상세 닫기" : "건물 상세정보"
            );
        }

        function setAvailable(available) {
            toggleButton.disabled = !available;
            toggleButton.setAttribute("aria-disabled", String(!available));
            if (available) return;
            toggleButton.setAttribute(
                "aria-label",
                "분석 건물을 선택하면 상세정보를 볼 수 있습니다"
            );
            toggleButton.setAttribute("data-tooltip", "분석 건물을 선택하세요");
        }

        function setText(id, value) {
            document.getElementById(id).textContent = value;
        }

        function hasValue(value) {
            return value !== null && value !== undefined && String(value).trim() !== "";
        }

        function formatMeters(value) {
            var number = Number(value);
            return Number.isFinite(number) ? number.toFixed(1) + "m" : "—";
        }

        function showOptionalRow(id, value) {
            var element = document.getElementById(id);
            element.closest("div").hidden = !hasValue(value);
            element.textContent = hasValue(value) ? value : "";
        }

        function heightSourceLabel(source) {
            if (source === "height") return "OSM height";
            if (source === "building:levels") return "층수 × 3m 추정";
            return "기본 높이 10m 추정";
        }

        function renderTags(tags) {
            var list = document.getElementById("buildingDetailTags");
            var section = document.getElementById("buildingDetailTagsSection");
            list.replaceChildren();

            var keys = tags && typeof tags === "object" ? Object.keys(tags).sort() : [];
            section.hidden = keys.length === 0;
            keys.forEach(function (key) {
                var row = document.createElement("div");
                var term = document.createElement("dt");
                var description = document.createElement("dd");
                term.textContent = key;
                description.textContent = tags[key];
                row.appendChild(term);
                row.appendChild(description);
                list.appendChild(row);
            });
        }

        function render(detail, feature) {
            // 6단계: DB 상세값과 이미 계산된 DEM 옥상고도를 한 화면에서 조합합니다.
            var height = Number(detail.heightMeters);
            var roofElevation = Number(feature.get("roofElevationMeters"));
            var groundElevation = Number.isFinite(roofElevation) && Number.isFinite(height)
                ? roofElevation - height
                : NaN;

            setText("buildingDetailName", detail.name || "이름 없는 건물");
            setText("buildingDetailType", detail.buildingType || "OSM 건물");
            setText("buildingDetailRoof", formatMeters(roofElevation));
            setText("buildingDetailGround", formatMeters(groundElevation));
            setText("buildingDetailHeight", formatMeters(height));
            setText("buildingDetailHeightSource", heightSourceLabel(detail.heightSource));
            setText("buildingDetailId", detail.buildingId || "—");
            showOptionalRow("buildingDetailAddress", detail.address);
            showOptionalRow(
                "buildingDetailLevels",
                hasValue(detail.levels) ? Number(detail.levels).toFixed(1).replace(/\.0$/, "") + "층" : null
            );
            showOptionalRow("buildingDetailMinHeight", hasValue(detail.minHeightMeters)
                ? formatMeters(detail.minHeightMeters) : null);
            showOptionalRow("buildingDetailUpdatedAt", detail.sourceUpdatedAt || detail.importedAt);
            renderTags(detail.additionalTags);
            // 선택된 건물의 기존 지도 도형과 상세 높이만 사용하므로
            // 미리보기 때문에 추가 API 요청이나 WebGL 화면을 만들지 않습니다.
            preview.render(feature, height);

            status.hidden = true;
            content.hidden = false;
            panel.setAttribute("aria-busy", "false");
        }

        function renderImmediate(feature, buildingId) {
            var height = Number(feature.get("heightMeters"));
            var roofElevation = Number(feature.get("roofElevationMeters"));
            var heightSource = feature.get("heightSource");
            var groundElevation = Number.isFinite(roofElevation) && Number.isFinite(height)
                ? roofElevation - height
                : NaN;
            var name = feature.get("name") || feature.get("buildingName") ||
                feature.get("ref") || "건물 " + buildingId;
            var type = feature.get("buildingType") || feature.get("building") || "OSM 건물";

            // 스캔에 이미 포함된 값은 API 응답을 기다리지 않고 먼저 보여 클릭 반응을 즉시 전달합니다.
            setText("buildingDetailName", name);
            setText("buildingDetailType", type);
            setText("buildingDetailRoof", formatMeters(roofElevation));
            setText("buildingDetailGround", formatMeters(groundElevation));
            setText("buildingDetailHeight", formatMeters(height));
            setText("buildingDetailHeightSource", heightSource
                ? heightSourceLabel(heightSource)
                : "스캔 분석값");
            setText("buildingDetailId", buildingId);
            showOptionalRow("buildingDetailAddress", null);
            showOptionalRow("buildingDetailLevels", null);
            showOptionalRow("buildingDetailMinHeight", null);
            showOptionalRow("buildingDetailUpdatedAt", null);
            renderTags(null);
            status.hidden = true;
            content.hidden = false;
        }

        function reset() {
            var version = ++requestVersion;
            if (requestController !== null) requestController.abort();
            requestController = null;
            setVisible(false);
            setAvailable(false);
            panel.setAttribute("aria-busy", "false");
            activeFeature = null;
            activeBuildingId = null;
            // 패널을 먼저 닫은 뒤 캔버스와 지도 강조를 정리해 닫기 조작이 즉시 보이게 합니다.
            global.setTimeout(function () {
                if (version !== requestVersion) return;
                preview.clear();
                if (typeof options.onClearSelection === "function") {
                    options.onClearSelection();
                }
            }, 0);
        }

        function open(feature) {
            var buildingId = feature && (feature.get("buildingId") || feature.getId());
            if (!buildingId) {
                options.showAlert("상세정보 조회 실패", "선택한 건물의 식별자가 없습니다.");
                return;
            }

            // 상세창과 초록색 선택 강조는 같은 선택 상태를 표현합니다.
            // 같은 건물을 다시 누르면 패널만 숨기지 않고 선택 자체를 해제해야
            // 2D와 3D의 강조 상태가 화면에 남지 않습니다.
            if (activeFeature !== null &&
                    String(activeBuildingId) === String(buildingId)) {
                reset();
                return;
            }

            activeFeature = feature;
            activeBuildingId = buildingId;
            setAvailable(true);

            // 패널과 스캔에서 확보한 핵심 수치를 먼저 표시하고 상세 API 값은 뒤에서 보강합니다.
            setVisible(true);
            renderImmediate(feature, buildingId);
            panel.setAttribute("aria-busy", "true");

            // 상세 데이터가 도착하기 전부터 선택 위치를 보여 사용자가 클릭 결과를 인지합니다.
            if (typeof options.onSelect === "function") options.onSelect(feature);

            // 직전에 누른 다른 건물의 늦은 응답이 현재 패널을 덮지 못하게 먼저 취소합니다.
            if (requestController !== null) requestController.abort();
            requestController = null;
            var version = ++requestVersion;
            global.setTimeout(function () {
                if (version !== requestVersion) return;
                preview.render(feature, feature.get("heightMeters"));
            }, 0);

            // 이전에 조회했던 건물을 다시 선택하면 메모리 캐시를 사용해 중복 요청하지 않습니다.
            if (cache.has(buildingId)) {
                render(cache.get(buildingId), feature);
                return;
            }

            requestController = new AbortController();

            global.GisJsonApi.fetch({
                url: options.endpoint + "?buildingId=" + encodeURIComponent(buildingId),
                signal: requestController.signal,
                label: "건물 상세정보",
                validate: function (data) {
                    return data && String(data.buildingId) === String(buildingId);
                },
                invalidMessage: "건물 상세정보 응답 형식이 올바르지 않습니다."
            }).then(function (detail) {
                if (version !== requestVersion) return;
                requestController = null;
                cache.set(buildingId, detail);
                render(detail, feature);
            }).catch(function (error) {
                if (error && error.name === "AbortError") return;
                if (version !== requestVersion) return;
                requestController = null;
                reset();
                options.showAlert("건물 상세정보 조회 실패", error.message);
            });
        }

        toggleButton.addEventListener("click", function () {
            if (!activeFeature) return;
            reset();
        });
        closeButton.addEventListener("click", reset);
        global.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !panel.hidden) reset();
        });

        return { open: open, reset: reset };
    }

    global.GisBuildingDetail = { create: create };
})(window);
