(function (global) {
    "use strict";

    function createBuildingDisplay() {
        var theme = global.GisVisualTheme;
        var palette = theme.colors;
        var source = new ol.source.Vector();
        var hoverSource = new ol.source.Vector();
        var detailSelectionSource = new ol.source.Vector();
        var styleCache = {};
        var hoverStyleCache = {};
        var hoveredFeature = null;

        function heightLabel(feature) {
            var value = feature.get("roofElevationMeters");
            var roofElevation = Number(value);
            if (value === null || value === undefined || !Number.isFinite(roofElevation)) {
                return "";
            }
            return (feature.get("heightEstimated") ? "약 " : "") +
                roofElevation.toFixed(1) + "m";
        }

        function styleFor(feature, state) {
            var key = state;
            if (styleCache[key]) return styleCache[key];

            var colors = state === "detected"
                ? { stroke: palette.blocked, fill: theme.rgba(palette.blocked, 0.46), text: "#ffffff", background: theme.rgba(palette.blocked, 0.94) }
                : state === "review"
                ? { stroke: palette.highlight, fill: theme.rgba(palette.highlight, 0.5), text: palette.ink, background: theme.rgba("#fff7e8", 0.96) }
                : { stroke: palette.muted, fill: theme.rgba(palette.surfaceEstimated, 0.68), text: palette.ink, background: theme.rgba(palette.surface, 0.92) };

            var mainStyle = new ol.style.Style({
                stroke: new ol.style.Stroke({ color: colors.stroke, width: state === "normal" ? 2 : 3 }),
                fill: new ol.style.Fill({ color: colors.fill })
            });

            if (state === "normal") {
                // 선택 전 건물은 위성사진을 덮지 않으면서도 밝고 어두운 지붕 모두에서 보여야 한다.
                // 밝은 외곽 분리선과 얇은 흑연색 경계를 겹쳐, 배경 색상과 무관하게 형태를 읽게 한다.
                styleCache[key] = [
                    new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: "rgba(255, 255, 255, 0.84)",
                            width: 4.5
                        })
                    }),
                    new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: "rgba(55, 65, 81, 0.78)",
                            width: 2
                        }),
                        fill: new ol.style.Fill({
                            color: "rgba(248, 250, 252, 0.66)"
                        })
                    })
                ];
                return styleCache[key];
            }

            // 위성영상처럼 명암과 색 변화가 큰 배경에서는 상태색만으로 건물 경계가 묻힌다.
            // 분석 대상에만 밝은 분리선을 먼저 그려 배경과 경계를 떼고, 그 위에 의미 색상을 유지한다.
            mainStyle.getStroke().setWidth(4);
            mainStyle.getFill().setColor(
                state === "detected"
                    ? theme.rgba(palette.blocked, 0.64)
                    : theme.rgba(palette.highlight, 0.68)
            );
            styleCache[key] = [
                new ol.style.Style({
                    stroke: new ol.style.Stroke({
                        color: "rgba(255, 255, 255, 0.96)",
                        width: 8
                    })
                }),
                mainStyle
            ];
            return styleCache[key];
        }

        function largestInteriorPoint(feature) {
            var geometry = feature.getGeometry();
            if (!geometry) return null;
            if (geometry.getType() === "Polygon") return geometry.getInteriorPoint();
            if (geometry.getType() !== "MultiPolygon") return null;

            var polygons = geometry.getPolygons();
            if (polygons.length === 0) return null;
            var largest = polygons.reduce(function (current, polygon) {
                return polygon.getArea() > current.getArea() ? polygon : current;
            }, polygons[0]);
            return largest.getInteriorPoint();
        }

        var hoverAreaStyle = new ol.style.Style({
            stroke: new ol.style.Stroke({ color: palette.visible, width: 3 }),
            fill: new ol.style.Fill({ color: theme.rgba(palette.visible, 0.16) })
        });

        function hoverStyles(feature) {
            var label = feature.get("hoverLabel") || "";
            if (!hoverStyleCache[label]) {
                hoverStyleCache[label] = new ol.style.Style({
                    geometry: largestInteriorPoint,
                    text: new ol.style.Text({
                        text: label,
                        offsetY: -18,
                        font: "700 11px sans-serif",
                        fill: new ol.style.Fill({ color: palette.ink }),
                        backgroundFill: new ol.style.Fill({
                            color: theme.rgba(palette.surface, 0.96)
                        }),
                        backgroundStroke: new ol.style.Stroke({
                            color: theme.rgba(palette.visible, 0.28),
                            width: 1
                        }),
                        padding: [5, 8, 5, 8]
                    })
                });
            }
            return [hoverAreaStyle, hoverStyleCache[label]];
        }

        function clearHighlights(features) {
            features.forEach(function (feature) {
                feature.setStyle(undefined);
            });
            features.clear();
        }

        function countScreenVisible(map) {
            var target = map.getTargetElement();
            var size = map.getSize();
            if (!target || target.hidden ||
                    target.classList.contains("map-surface-inactive") ||
                    !size || size[0] <= 0 || size[1] <= 0) {
                return null;
            }

            var viewportRect = map.getViewport().getBoundingClientRect();
            var blockerSelector = [
                ".toolbar",
                ".analysis-result-panel:not([hidden])",
                ".map-tool-menu",
                ".scan-status-dock",
                ".map-interaction-hint",
                ".map-warning:not([hidden])"
            ].join(",");
            var blockers = Array.prototype.slice.call(
                document.querySelectorAll(blockerSelector)
            ).filter(function (element) {
                var style = global.getComputedStyle(element);
                var rect = element.getBoundingClientRect();
                return style.visibility !== "hidden" && style.display !== "none" &&
                    rect.width > 0 && rect.height > 0;
            }).map(function (element) {
                return element.getBoundingClientRect();
            });

            var viewExtent = map.getView().calculateExtent(size);

            function footprintIsVisible(geometry) {
                if (!geometry || !geometry.intersectsExtent(viewExtent)) return false;
                var extent = geometry.getExtent();
                var topLeft = map.getPixelFromCoordinate([extent[0], extent[3]]);
                var bottomRight = map.getPixelFromCoordinate([extent[2], extent[1]]);
                if (!topLeft || !bottomRight) return false;
                var visibleRect = {
                    left: Math.max(viewportRect.left, viewportRect.left + topLeft[0]),
                    top: Math.max(viewportRect.top, viewportRect.top + topLeft[1]),
                    right: Math.min(viewportRect.right, viewportRect.left + bottomRight[0]),
                    bottom: Math.min(viewportRect.bottom, viewportRect.top + bottomRight[1])
                };
                if (visibleRect.right <= visibleRect.left ||
                        visibleRect.bottom <= visibleRect.top) return false;
                return !blockers.some(function (rect) {
                    return rect.left <= visibleRect.left && rect.top <= visibleRect.top &&
                        rect.right >= visibleRect.right && rect.bottom >= visibleRect.bottom;
                });
            }

            return source.getFeatures().filter(function (feature) {
                if (!feature.get("scanRevealed")) return false;
                return footprintIsVisible(feature.getGeometry());
            }).length;
        }

        var layer = new ol.layer.Vector({
            source: source,
            declutter: false,
            style: function (feature) {
                return feature.get("scanRevealed") ? styleFor(feature, "normal") : undefined;
            }
        });

        // 호버 레이어는 같은 건물을 가리키는 동안 다시 만들지 않습니다.
        // 마우스가 다른 건물로 이동할 때만 도형 한 개를 교체합니다.
        var hoverLayer = new ol.layer.Vector({
            source: hoverSource,
            // 상세 선택 외곽선보다 위에 그려야 선택된 건물에서도
            // 옥상 해발 라벨이 건물 채움 아래로 가려지지 않습니다.
            zIndex: 110,
            updateWhileAnimating: false,
            updateWhileInteracting: false,
            style: hoverStyles
        });

        function showBuildingHover(feature) {
            if (feature === hoveredFeature) return;
            hoveredFeature = feature || null;
            hoverSource.clear();
            if (!feature || !feature.getGeometry()) return;

            var hoverLabel = heightLabel(feature);
            if (!hoverLabel) return;
            hoverSource.addFeature(new ol.Feature({
                geometry: feature.getGeometry().clone(),
                hoverLabel: "옥상 해발 " + hoverLabel
            }));
        }

        function clearBuildingHover() {
            hoveredFeature = null;
            hoverSource.clear();
        }

        // 상세 선택은 원본 feature.setStyle()을 바꾸지 않고 별도 레이어에 그립니다.
        // 따라서 스캔 중 빨간 강조와 방향 검토의 주황 강조가 그대로 보존됩니다.
        // 선택 상태도 기본 건물과 같은 이중 경계 구조를 사용하되, 청록색 농도만 높여 구분합니다.
        // 별도 위치 표식이나 라벨을 얹지 않아 실제 건물 형태를 가리지 않는 것이 목적입니다.
        var detailSelectionLayer = new ol.layer.Vector({
            source: detailSelectionSource,
            zIndex: 100,
            updateWhileAnimating: false,
            updateWhileInteracting: false,
            style: [
                new ol.style.Style({
                    stroke: new ol.style.Stroke({
                        color: "rgba(255, 255, 255, 0.96)",
                        width: 8
                    })
                }),
                new ol.style.Style({
                    stroke: new ol.style.Stroke({ color: palette.accent, width: 4 }),
                    fill: new ol.style.Fill({ color: theme.rgba(palette.accent, 0.46) })
                })
            ]
        });

        function showDetailSelection(feature) {
            detailSelectionSource.clear();
            if (!feature || !feature.getGeometry()) return;
            detailSelectionSource.addFeature(new ol.Feature({
                geometry: feature.getGeometry().clone()
            }));
        }

        function clearDetailSelection() {
            detailSelectionSource.clear();
        }

        var invalidCenterStyle = new ol.style.Style({
            stroke: new ol.style.Stroke({ color: palette.blocked, width: 4 }),
            fill: new ol.style.Fill({ color: theme.rgba(palette.blocked, 0.58) })
        });

        return {
            source: source,
            layer: layer,
            hoverLayer: hoverLayer,
            detailSelectionLayer: detailSelectionLayer,
            invalidCenterStyle: invalidCenterStyle,
            clearBuildingHover: clearBuildingHover,
            clearDetailSelection: clearDetailSelection,
            clearHighlights: clearHighlights,
            countScreenVisible: countScreenVisible,
            heightLabel: heightLabel,
            showBuildingHover: showBuildingHover,
            showDetailSelection: showDetailSelection,
            styleFor: styleFor
        };
    }

    global.GisBuildingDisplay = {
        create: createBuildingDisplay
    };
})(window);
