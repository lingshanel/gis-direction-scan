(function (global) {
    "use strict";

    function createMobileWorkspace() {
        var workspace = document.getElementById("mobilePanelWorkspace");
        var track = document.getElementById("mobilePanelTrack");
        var collapseButton = document.getElementById("mobilePanelCollapse");
        var resizeHandle = document.getElementById("mobilePanelResizeHandle");
        var title = document.getElementById("mobilePanelTitle");
        var count = document.getElementById("mobilePanelCount");
        var tabs = Array.prototype.slice.call(
            document.querySelectorAll("[data-mobile-target]")
        );
        var panels = Array.prototype.slice.call(
            document.querySelectorAll("[data-mobile-panel]")
        );
        var mobileQuery = global.matchMedia("(max-width: 1100px)");
        var labels = {
            scan: "방향 스캔",
            analysis: "방향 분석",
            building: "건물 상세정보",
            map: "지도 설정"
        };
        var descriptions = {
            scan: "분석 조건을 설정합니다.",
            analysis: "방향별 차폐 결과를 확인합니다.",
            building: "선택한 건물 정보를 확인합니다.",
            map: "화면 방식과 배경지도를 바꿉니다."
        };
        var activePanel = panels[0] || null;
        var collapsed = false;
        var sheetLevel = "default";
        var dragState = null;
        var resizeFrame = null;

        if (!workspace || !track || !collapseButton || !resizeHandle || !title || !count ||
                !activePanel || !tabs.length) return;

        function availablePanels() {
            return panels.filter(function (panel) { return !panel.hidden; });
        }

        function panelName(panel) {
            return panel ? panel.dataset.mobilePanel : "scan";
        }

        function isPanelAvailable(panel) {
            var name = panelName(panel);
            if (name === "analysis") {
                var analysisButton = document.getElementById("analysisResultButton");
                return Boolean(analysisButton && !analysisButton.hidden);
            }
            if (name === "building") {
                var buildingButton = document.getElementById("buildingDetailButton");
                return Boolean(buildingButton && !buildingButton.disabled);
            }
            return Boolean(panel && !panel.hidden);
        }

        function renderNavigation() {
            var name = panelName(activePanel);
            title.textContent = labels[name] || "작업 패널";
            count.textContent = descriptions[name] || "필요한 작업을 선택합니다.";
            workspace.dataset.activePanel = name;

            tabs.forEach(function (tab) {
                var panel = panels.find(function (candidate) {
                    return panelName(candidate) === tab.dataset.mobileTarget;
                });
                var unavailable = !isPanelAvailable(panel);
                var selected = panel === activePanel;
                tab.disabled = unavailable;
                tab.classList.toggle("is-active", selected);
                tab.setAttribute("aria-pressed", String(selected));
                tab.setAttribute("aria-disabled", String(unavailable));
            });
        }

        function sheetSizes() {
            var viewportHeight = global.visualViewport
                ? global.visualViewport.height
                : global.innerHeight;
            var defaultRatio = global.innerWidth <= 480 ? 0.42 : 0.44;
            var defaultHeight = Math.min(viewportHeight * defaultRatio, 410);
            var expandedHeight = Math.min(
                viewportHeight * 0.72,
                720,
                Math.max(defaultHeight, viewportHeight - 96)
            );
            return {
                collapsed: 64,
                default: Math.round(defaultHeight),
                expanded: Math.round(expandedHeight)
            };
        }

        function setSheetHeight(height) {
            document.documentElement.style.setProperty(
                "--mobile-sheet-height",
                Math.round(height) + "px"
            );
        }

        function renderResizeHandle() {
            var expanded = sheetLevel === "expanded";
            resizeHandle.setAttribute("aria-expanded", String(expanded));
            resizeHandle.setAttribute(
                "aria-label",
                expanded ? "작업 패널 기본 크기로 줄이기" : "작업 패널 크게 펼치기"
            );
        }

        function setCollapsed(nextCollapsed) {
            collapsed = mobileQuery.matches && Boolean(nextCollapsed);
            if (mobileQuery.matches) {
                if (collapsed) {
                    sheetLevel = "collapsed";
                } else if (sheetLevel === "collapsed") {
                    sheetLevel = "default";
                }
                setSheetHeight(sheetSizes()[sheetLevel]);
            }
            workspace.classList.toggle("is-minimized", collapsed);
            workspace.classList.toggle("is-expanded", sheetLevel === "expanded");
            track.setAttribute("aria-hidden", String(collapsed));
            collapseButton.setAttribute("aria-expanded", String(!collapsed));
            collapseButton.setAttribute(
                "aria-label",
                collapsed ? "작업 패널 펼치기" : "작업 패널 최소화"
            );
            collapseButton.title = collapsed ? "작업 패널 펼치기" : "작업 패널 최소화";
            renderResizeHandle();
        }

        function applySheetLevel(level) {
            sheetLevel = level;
            setCollapsed(level === "collapsed");
        }

        function showPanel(panel, expand) {
            if (!panel || panel.hidden) return;
            panels.forEach(function (candidate) {
                candidate.classList.toggle("is-active-mobile-panel", candidate === panel);
            });
            activePanel = panel;
            renderNavigation();
            if (expand && mobileQuery.matches) {
                if (collapsed) sheetLevel = "default";
                setCollapsed(false);
            }
        }

        collapseButton.addEventListener("click", function () { setCollapsed(!collapsed); });

        function startResize(event) {
            if (!mobileQuery.matches || event.button > 0) return;
            event.preventDefault();
            var now = global.performance.now();
            dragState = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startHeight: workspace.getBoundingClientRect().height,
                lastY: event.clientY,
                lastTime: now,
                velocity: 0,
                moved: false
            };
            resizeHandle.setPointerCapture(event.pointerId);
            workspace.classList.add("is-dragging");
        }

        function resizePanel(event) {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            var now = global.performance.now();
            var elapsed = Math.max(1, now - dragState.lastTime);
            var movement = event.clientY - dragState.lastY;
            var sizes = sheetSizes();
            var height = Math.max(
                120,
                Math.min(sizes.expanded, dragState.startHeight - (event.clientY - dragState.startY))
            );
            dragState.velocity = movement / elapsed;
            dragState.lastY = event.clientY;
            dragState.lastTime = now;
            dragState.moved = dragState.moved || Math.abs(event.clientY - dragState.startY) > 5;
            collapsed = false;
            workspace.classList.remove("is-minimized");
            track.setAttribute("aria-hidden", "false");
            setSheetHeight(height);
        }

        function finishResize(event) {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            var state = dragState;
            var sizes = sheetSizes();
            var currentHeight = workspace.getBoundingClientRect().height;
            dragState = null;
            workspace.classList.remove("is-dragging");
            if (resizeHandle.hasPointerCapture(event.pointerId)) {
                resizeHandle.releasePointerCapture(event.pointerId);
            }

            if (!state.moved) {
                applySheetLevel(sheetLevel === "expanded" ? "default" : "expanded");
                return;
            }
            if (state.velocity < -0.45) {
                applySheetLevel("expanded");
                return;
            }
            if (state.velocity > 0.45) {
                applySheetLevel(currentHeight <= sizes.default ? "collapsed" : "default");
                return;
            }

            var nearest = ["collapsed", "default", "expanded"].reduce(function (best, level) {
                return Math.abs(currentHeight - sizes[level]) < Math.abs(currentHeight - sizes[best])
                    ? level
                    : best;
            }, "default");
            applySheetLevel(nearest);
        }

        resizeHandle.addEventListener("pointerdown", startResize);
        resizeHandle.addEventListener("pointermove", resizePanel);
        resizeHandle.addEventListener("pointerup", finishResize);
        resizeHandle.addEventListener("pointercancel", finishResize);
        resizeHandle.addEventListener("keydown", function (event) {
            if (event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                applySheetLevel("expanded");
            } else if (event.key === "ArrowDown") {
                event.preventDefault();
                applySheetLevel(sheetLevel === "expanded" ? "default" : "collapsed");
            }
        });

        tabs.forEach(function (tab) {
            tab.addEventListener("click", function () {
                var panel = panels.find(function (candidate) {
                    return panelName(candidate) === tab.dataset.mobileTarget;
                });
                if (!panel || !isPanelAvailable(panel)) return;
                if (panel.hidden && panelName(panel) === "analysis") {
                    document.getElementById("analysisResultButton").click();
                    return;
                }
                if (panel.hidden) return;
                if (panel === activePanel && !collapsed) {
                    setCollapsed(true);
                    return;
                }
                showPanel(panel, true);
            });
        });

        panels.forEach(function (panel) {
            new MutationObserver(function () {
                if (!panel.hidden) {
                    /* 새 분석 결과나 건물 정보는 사용자가 메뉴를 다시 찾지 않도록 즉시 엽니다. */
                    showPanel(panel, true);
                    return;
                }
                if (panel === activePanel) {
                    var panelIndex = panels.indexOf(panel);
                    var fallback = availablePanels().filter(function (candidate) {
                        return panels.indexOf(candidate) < panelIndex;
                    }).pop() || availablePanels()[0];
                    showPanel(fallback, true);
                } else {
                    renderNavigation();
                }
            }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
        });

        [document.getElementById("analysisResultButton"),
            document.getElementById("buildingDetailButton")].forEach(function (button) {
            if (!button) return;
            new MutationObserver(renderNavigation).observe(button, {
                attributes: true,
                attributeFilter: ["hidden", "disabled"]
            });
        });

        function connectMapSettingProxy(name, sourceId) {
            var proxy = document.querySelector('[data-mobile-map-control="' + name + '"]');
            var source = document.getElementById(sourceId);
            if (!proxy || !source) return;

            function sync() {
                proxy.setAttribute("aria-pressed", source.getAttribute("aria-pressed") || "false");
            }
            proxy.addEventListener("click", function () {
                source.click();
                global.requestAnimationFrame(sync);
            });
            new MutationObserver(sync).observe(source, {
                attributes: true,
                attributeFilter: ["aria-pressed"]
            });
            sync();
        }

        connectMapSettingProxy("2d", "show2dButton");
        connectMapSettingProxy("3d", "show3dButton");
        connectMapSettingProxy("general", "generalMapButton");
        connectMapSettingProxy("satellite", "satelliteMapButton");

        var interfaceProxy = document.getElementById("mobileInterfaceButton");
        var interfaceButton = document.getElementById("toggleInterfaceButton");
        if (interfaceProxy && interfaceButton) {
            function syncInterfaceProxy() {
                var pressed = interfaceButton.getAttribute("aria-pressed") === "true";
                var label = pressed ? "모든 UI 표시" : "모든 UI 감추기";
                interfaceProxy.setAttribute("aria-pressed", String(pressed));
                interfaceProxy.setAttribute("aria-label", label);
                interfaceProxy.title = label;
            }
            interfaceProxy.addEventListener("click", function () {
                interfaceButton.click();
                syncInterfaceProxy();
            });
            new MutationObserver(syncInterfaceProxy).observe(interfaceButton, {
                attributes: true,
                attributeFilter: ["aria-pressed"]
            });
            syncInterfaceProxy();
        }

        function alignForViewport() {
            if (mobileQuery.matches) {
                applySheetLevel("collapsed");
            } else {
                document.documentElement.style.removeProperty("--mobile-sheet-height");
                sheetLevel = "default";
                setCollapsed(false);
            }
            showPanel(activePanel, false);
        }
        if (typeof mobileQuery.addEventListener === "function") {
            mobileQuery.addEventListener("change", alignForViewport);
        } else {
            mobileQuery.addListener(alignForViewport);
        }
        global.addEventListener("resize", function () {
            if (!mobileQuery.matches || dragState || resizeFrame !== null) return;
            resizeFrame = global.requestAnimationFrame(function () {
                resizeFrame = null;
                setSheetHeight(sheetSizes()[sheetLevel]);
            });
        });

        showPanel(activePanel, false);
        if (mobileQuery.matches) {
            applySheetLevel("collapsed");
        } else {
            setCollapsed(false);
        }
    }

    function create() {
        var panel = document.querySelector(".toolbar");
        var body = document.getElementById("gisPanelBody");
        var button = document.getElementById("togglePanelButton");
        var icon = document.getElementById("panelToggleIcon");
        var collapsed = false;

        function render() {
            panel.classList.toggle("is-collapsed", collapsed);
            body.setAttribute("aria-hidden", String(collapsed));
            button.setAttribute("aria-expanded", String(!collapsed));
            button.setAttribute("aria-label", collapsed ? "제어판 펼치기" : "제어판 접기");
            button.title = collapsed ? "제어판 펼치기" : "제어판 접기";
            icon.textContent = collapsed ? "›" : "‹";
        }

        button.addEventListener("click", function () {
            collapsed = !collapsed;
            render();
        });
        render();
        createMobileWorkspace();
    }

    function createMapControls(options) {
        var range = document.getElementById("mapZoomRange");
        var zoomOutButton = document.getElementById("mapZoomOutButton");
        var zoomInButton = document.getElementById("mapZoomInButton");
        var interfaceButton = document.getElementById("toggleInterfaceButton");
        var show2dButton = document.getElementById("show2dButton");
        var show3dButton = document.getElementById("show3dButton");
        var mapView = options.map.getView();
        var minimumTwoDimensionalZoom = 11;
        var maximumTwoDimensionalZoom = 20.5;
        var syncFrame = null;
        var interfaceHidden = false;

        function clampLevel(value) {
            return Math.max(0, Math.min(100, Number(value) || 0));
        }

        function updateRangeAppearance(level) {
            var normalized = clampLevel(level);
            range.value = String(Math.round(normalized));
            range.style.setProperty("--zoom-level", normalized + "%");
            range.setAttribute("aria-valuetext", "확대 " + Math.round(normalized) + "%");
        }

        function readCurrentLevel() {
            if (options.viewSwitcher.getMode() === "3d") {
                return options.cesiumMap.getZoomLevel();
            }
            var zoom = Number(mapView.getZoom());
            if (!Number.isFinite(zoom)) return 50;
            return (zoom - minimumTwoDimensionalZoom) /
                (maximumTwoDimensionalZoom - minimumTwoDimensionalZoom) * 100;
        }

        function syncRange() {
            syncFrame = null;
            updateRangeAppearance(readCurrentLevel());
        }

        function scheduleRangeSync() {
            if (syncFrame !== null) return;
            syncFrame = global.requestAnimationFrame(syncRange);
        }

        function applyLevel(level, animate) {
            var normalized = clampLevel(level);
            updateRangeAppearance(normalized);
            if (options.viewSwitcher.getMode() === "3d") {
                options.cesiumMap.setZoomLevel(normalized);
                return;
            }
            var zoom = minimumTwoDimensionalZoom +
                (maximumTwoDimensionalZoom - minimumTwoDimensionalZoom) *
                normalized / 100;
            if (animate) {
                mapView.animate({ zoom: zoom, duration: 180 });
            } else {
                mapView.setZoom(zoom);
            }
        }

        function stepZoom(amount) {
            applyLevel(Number(range.value) + amount, true);
        }

        function setInterfaceHidden(hidden) {
            interfaceHidden = Boolean(hidden);
            document.body.classList.toggle("ui-hidden", interfaceHidden);
            interfaceButton.setAttribute("aria-pressed", String(interfaceHidden));
            interfaceButton.setAttribute(
                "aria-label",
                interfaceHidden ? "모든 UI 표시" : "모든 UI 감추기"
            );
            interfaceButton.dataset.tooltip = interfaceHidden
                ? "모든 UI 표시"
                : "모든 UI 감추기";
        }

        range.addEventListener("input", function () {
            applyLevel(range.value, false);
        });
        zoomOutButton.addEventListener("click", function () { stepZoom(-8); });
        zoomInButton.addEventListener("click", function () { stepZoom(8); });
        mapView.on("change:resolution", scheduleRangeSync);
        options.cesiumMap.onZoomChange(scheduleRangeSync);
        show2dButton.addEventListener("click", scheduleRangeSync);
        show3dButton.addEventListener("click", scheduleRangeSync);
        interfaceButton.addEventListener("click", function () {
            setInterfaceHidden(!interfaceHidden);
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && interfaceHidden) setInterfaceHidden(false);
        });

        updateRangeAppearance(readCurrentLevel());
        setInterfaceHidden(false);
    }

    global.GisPanelControls = {
        create: create,
        createMapControls: createMapControls
    };
})(window);
