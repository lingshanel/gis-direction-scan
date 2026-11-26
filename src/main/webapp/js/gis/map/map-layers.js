(function (global) {
    "use strict";

    /**
     * OpenLayers 지도와 2D 표시용 레이어의 생성·갱신을 한곳에서 관리합니다.
     * 상위 모듈에는 실제로 직접 조작해야 하는 데이터 소스와 명령만 공개하고,
     * 방향선처럼 이 모듈이 수명 주기를 책임지는 내부 소스는 외부에 노출하지 않습니다.
     */
    function createMapLayers(options) {
        var theme = global.GisVisualTheme;
        var colors = theme.colors;
        var geojsonFormat = new ol.format.GeoJSON();
        var centerSource = new ol.source.Vector();
        var radiusSource = new ol.source.Vector();
        var raySource = new ol.source.Vector();
        var viewDirectionSource = new ol.source.Vector();
        var resultSource = new ol.source.Vector();
        var focusMaskSource = new ol.source.Vector({ wrapX: false });
        var rayFeature = null;
        var viewDirectionLineFeature = null;
        var viewDirectionEndFeature = null;
        var viewDirectionAnimationId = null;
        var displayedViewDirectionStart = null;
        var displayedViewDirectionEnd = null;
        var satelliteAttribution =
            "Esri, Maxar, Earthstar Geographics, and the GIS User Community";

        var radiusCircleStyle = new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: colors.accent,
                width: 2,
                lineDash: [8, 6]
            }),
            fill: new ol.style.Fill({ color: theme.rgba(colors.accent, 0) })
        });
        var radiusLabelStyleCache = {};

        function radiusStyle(feature) {
            var label = feature.get("radiusLabel");
            if (!label) return radiusCircleStyle;
            if (!radiusLabelStyleCache[label]) {
                radiusLabelStyleCache[label] = new ol.style.Style({
                    text: new ol.style.Text({
                        text: label,
                        offsetY: -1,
                        font: "800 12px sans-serif",
                        fill: new ol.style.Fill({ color: "#ffffff" }),
                        backgroundFill: new ol.style.Fill({ color: colors.accent }),
                        backgroundStroke: new ol.style.Stroke({
                            color: theme.rgba(colors.surface, 0.9),
                            width: 2
                        }),
                        padding: [4, 9, 4, 9]
                    })
                });
            }
            return radiusLabelStyleCache[label];
        }

        var radiusLayer = new ol.layer.Vector({
            source: radiusSource,
            declutter: false,
            style: radiusStyle
        });

        var centerLayer = new ol.layer.Vector({
            source: centerSource,
            style: new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 7,
                    fill: new ol.style.Fill({ color: colors.accent }),
                    stroke: new ol.style.Stroke({ color: colors.surface, width: 2 })
                })
            })
        });

        var rayLayer = new ol.layer.Vector({
            source: raySource,
            style: new ol.style.Style({
                stroke: new ol.style.Stroke({ color: colors.accentSoft, width: 3 })
            })
        });

        var viewDirectionLayer = new ol.layer.Vector({
            source: viewDirectionSource,
            style: function (feature) {
                if (feature.getGeometry().getType() === "Point") {
                    return new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 5,
                            fill: new ol.style.Fill({ color: colors.accent }),
                            stroke: new ol.style.Stroke({ color: colors.surface, width: 2 })
                        }),
                        text: new ol.style.Text({
                            text: feature.get("bearingLabel"),
                            offsetY: -15,
                            font: "800 12px sans-serif",
                            fill: new ol.style.Fill({ color: colors.accent }),
                            backgroundFill: new ol.style.Fill({ color: theme.rgba(colors.surface, 0.92) }),
                            padding: [2, 4, 2, 4]
                        })
                    });
                }
                return new ol.style.Style({
                    stroke: new ol.style.Stroke({ color: colors.accent, width: 4 })
                });
            }
        });

        var noDataRegionStyle = new ol.style.Style({
            fill: new ol.style.Fill({ color: theme.rgba(colors.noData, 0.16) })
        });
        var elevationVisibleStyle = new ol.style.Style({
            // 위성영상 위에서도 영역이 읽히되 지형을 가리지 않는 농도를 유지합니다.
            fill: new ol.style.Fill({ color: theme.rgba(colors.visible, 0.50) })
        });
        var elevationBlockedStyle = new ol.style.Style({
            fill: new ol.style.Fill({ color: theme.rgba(colors.blocked, 0.52) })
        });

        var noDataResultLayer = new ol.layer.Vector({
            source: resultSource,
            style: function (feature) {
                return feature.get("visibilityState") === "nodata"
                    ? noDataRegionStyle : undefined;
            },
            opacity: 1
        });

        var blockedResultLayer = new ol.layer.Vector({
            source: resultSource,
            style: function (feature) {
                return feature.get("visibilityState") === "blocked" &&
                    document.getElementById("showExcluded").checked
                    ? elevationBlockedStyle : undefined;
            },
            opacity: 1
        });

        var visibleResultLayer = new ol.layer.Vector({
            source: resultSource,
            style: function (feature) {
                return feature.get("visibilityState") === "visible" &&
                    document.getElementById("showVisible").checked
                    ? elevationVisibleStyle : undefined;
            },
            opacity: 1
        });

        var focusMaskLayer = new ol.layer.Vector({
            source: focusMaskSource,
            style: new ol.style.Style({
                fill: new ol.style.Fill({
                    color: theme.rgba(colors.focusMask, theme.focusMaskOpacity)
                })
            })
        });

        // 결과 표시 토글은 같은 소스를 쓰는 두 레이어를 함께 다시 그립니다.
        var resultLayer = {
            changed: function () {
                blockedResultLayer.changed();
                visibleResultLayer.changed();
            }
        };

        var cartographicLayer = new ol.layer.Tile({
            source: new ol.source.OSM()
        });
        var satelliteLayer = new ol.layer.Tile({
            visible: false,
            source: new ol.source.XYZ({
                url: "https://services.arcgisonline.com/ArcGIS/rest/services/" +
                    "World_Imagery/MapServer/tile/{z}/{y}/{x}",
                attributions: satelliteAttribution,
                crossOrigin: "anonymous",
                maxZoom: 19
            })
        });

        var map = new ol.Map({
            target: options.target,
            layers: [
                cartographicLayer,
                satelliteLayer,
                noDataResultLayer,
                blockedResultLayer,
                visibleResultLayer,
                options.buildingLayer,
                options.buildingHoverLayer,
                options.detailSelectionLayer,
                focusMaskLayer,
                radiusLayer,
                rayLayer,
                viewDirectionLayer,
                centerLayer
            ],
            view: new ol.View({
                center: ol.proj.fromLonLat(options.initialCenter),
                zoom: options.initialZoom
            })
        });

        function setSatelliteEnabled(enabled) {
            var active = Boolean(enabled);
            cartographicLayer.setVisible(!active);
            satelliteLayer.setVisible(active);
        }

        function readFeature(geojson) {
            return geojsonFormat.readFeature(geojson, {
                dataProjection: "EPSG:4326",
                featureProjection: map.getView().getProjection()
            });
        }

        function drawSearchCircle(center, radius) {
            radiusSource.clear();
            if (!center) return;
            var numericRadius = Number(radius);
            radiusSource.addFeature(readFeature(turf.circle(center, numericRadius, {
                steps: 128,
                units: "meters"
            })));
            // 0°와 360°가 만나는 정북쪽 원 경계에 반경 수치를 붙입니다.
            var labelCoordinate = turf.destination(center, numericRadius, 0, {
                units: "meters"
            }).geometry.coordinates;
            radiusSource.addFeature(new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat(labelCoordinate)),
                radiusLabel: Math.round(numericRadius) + "m"
            }));
        }

        function showFocusMask(center, radius) {
            focusMaskSource.clear();
            if (!center || !Number.isFinite(Number(radius)) || Number(radius) <= 0) return;

            var projectionExtent = map.getView().getProjection().getExtent();
            var outerRing = [
                [projectionExtent[0], projectionExtent[1]],
                [projectionExtent[2], projectionExtent[1]],
                [projectionExtent[2], projectionExtent[3]],
                [projectionExtent[0], projectionExtent[3]],
                [projectionExtent[0], projectionExtent[1]]
            ];
            var circleFeature = readFeature(turf.circle(center, Number(radius), {
                steps: 128,
                units: "meters"
            }));
            var innerRing = circleFeature.getGeometry().getCoordinates()[0];
            focusMaskSource.addFeature(new ol.Feature({
                geometry: new ol.geom.Polygon([outerRing, innerRing])
            }));
        }

        function clearFocusMask() {
            focusMaskSource.clear();
        }

        function drawRay(origin, bearing, radius) {
            var end = turf.destination(origin, radius, bearing, {
                units: "meters"
            }).geometry.coordinates;
            var coordinates = [
                ol.proj.fromLonLat(origin),
                ol.proj.fromLonLat(end)
            ];
            if (rayFeature === null) {
                rayFeature = new ol.Feature({
                    geometry: new ol.geom.LineString(coordinates)
                });
            } else {
                rayFeature.getGeometry().setCoordinates(coordinates);
            }
            if (!raySource.hasFeature(rayFeature)) raySource.addFeature(rayFeature);
        }

        function cancelViewDirectionAnimation() {
            if (viewDirectionAnimationId !== null) {
                cancelAnimationFrame(viewDirectionAnimationId);
                viewDirectionAnimationId = null;
            }
        }

        function ensureViewDirectionFeatures(start, bearingLabel) {
            if (viewDirectionLineFeature === null) {
                viewDirectionLineFeature = new ol.Feature({
                    geometry: new ol.geom.LineString([start, start])
                });
                viewDirectionEndFeature = new ol.Feature({
                    geometry: new ol.geom.Point(start)
                });
            }
            viewDirectionEndFeature.set("bearingLabel", bearingLabel);
            if (!viewDirectionSource.hasFeature(viewDirectionLineFeature)) {
                viewDirectionSource.addFeatures([
                    viewDirectionLineFeature,
                    viewDirectionEndFeature
                ]);
            }
        }

        function updateViewDirectionCoordinates(start, end, bearingLabel) {
            ensureViewDirectionFeatures(start, bearingLabel);
            viewDirectionLineFeature.getGeometry().setCoordinates([start, end]);
            viewDirectionEndFeature.getGeometry().setCoordinates(end);
            viewDirectionEndFeature.set("bearingLabel", bearingLabel);
            displayedViewDirectionStart = start.slice();
            displayedViewDirectionEnd = end.slice();
        }

        function finishClearViewDirection() {
            viewDirectionSource.clear();
            displayedViewDirectionStart = null;
            displayedViewDirectionEnd = null;
        }

        function clearViewDirection(animateDirection) {
            cancelViewDirectionAnimation();
            var reduceMotion = global.matchMedia &&
                global.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (!animateDirection || reduceMotion ||
                    displayedViewDirectionStart === null ||
                    displayedViewDirectionEnd === null ||
                    !viewDirectionSource.hasFeature(viewDirectionLineFeature)) {
                finishClearViewDirection();
                return;
            }

            var start = displayedViewDirectionStart.slice();
            var animationStartEnd = displayedViewDirectionEnd.slice();
            var bearingLabel = viewDirectionEndFeature.get("bearingLabel") || "";
            var startedAt = null;
            var duration = 360;

            function animate(now) {
                if (startedAt === null) {
                    startedAt = now;
                    viewDirectionAnimationId = requestAnimationFrame(animate);
                    return;
                }
                var linear = Math.min((now - startedAt) / duration, 1);
                var progress = linear * linear * (3 - 2 * linear);
                var animatedEnd = [
                    animationStartEnd[0] +
                        (start[0] - animationStartEnd[0]) * progress,
                    animationStartEnd[1] +
                        (start[1] - animationStartEnd[1]) * progress
                ];
                updateViewDirectionCoordinates(start, animatedEnd, bearingLabel);
                if (linear < 1) {
                    viewDirectionAnimationId = requestAnimationFrame(animate);
                } else {
                    viewDirectionAnimationId = null;
                    finishClearViewDirection();
                }
            }

            viewDirectionAnimationId = requestAnimationFrame(animate);
        }

        function drawViewDirection(origin, bearing, radius, bearingLabel,
                animateDirection) {
            if (!origin) return;

            var end = turf.destination(origin, radius, bearing, { units: "meters" }).geometry.coordinates;
            var startCoordinate = ol.proj.fromLonLat(origin);
            var endCoordinate = ol.proj.fromLonLat(end);
            cancelViewDirectionAnimation();

            var reduceMotion = global.matchMedia &&
                global.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (!animateDirection || reduceMotion) {
                updateViewDirectionCoordinates(
                    startCoordinate,
                    endCoordinate,
                    bearingLabel
                );
                return;
            }

            var hasDisplayedDirection = displayedViewDirectionEnd !== null &&
                viewDirectionSource.hasFeature(viewDirectionLineFeature);
            var animationStartEnd = hasDisplayedDirection
                ? displayedViewDirectionEnd.slice()
                : startCoordinate.slice();
            updateViewDirectionCoordinates(
                startCoordinate,
                animationStartEnd,
                bearingLabel
            );

            var startedAt = null;
            var duration = hasDisplayedDirection ? 280 : 480;
            function animate(now) {
                if (startedAt === null) {
                    startedAt = now;
                    viewDirectionAnimationId = requestAnimationFrame(animate);
                    return;
                }
                var linear = Math.min((now - startedAt) / duration, 1);
                var progress = 1 - Math.pow(1 - linear, 3);
                var animatedEnd = [
                    animationStartEnd[0] +
                        (endCoordinate[0] - animationStartEnd[0]) * progress,
                    animationStartEnd[1] +
                        (endCoordinate[1] - animationStartEnd[1]) * progress
                ];
                updateViewDirectionCoordinates(
                    startCoordinate,
                    animatedEnd,
                    bearingLabel
                );
                if (linear < 1) {
                    viewDirectionAnimationId = requestAnimationFrame(animate);
                } else {
                    viewDirectionAnimationId = null;
                    updateViewDirectionCoordinates(
                        startCoordinate,
                        endCoordinate,
                        bearingLabel
                    );
                }
            }
            viewDirectionAnimationId = requestAnimationFrame(animate);
        }

        return {
            map: map,
            geojsonFormat: geojsonFormat,
            centerSource: centerSource,
            radiusLayer: radiusLayer,
            raySource: raySource,
            resultSource: resultSource,
            resultLayer: resultLayer,
            clearFocusMask: clearFocusMask,
            clearViewDirection: clearViewDirection,
            drawSearchCircle: drawSearchCircle,
            drawRay: drawRay,
            drawViewDirection: drawViewDirection,
            setSatelliteEnabled: setSatelliteEnabled,
            showFocusMask: showFocusMask
        };
    }

    global.GisMapLayers = {
        create: createMapLayers
    };
})(window);
