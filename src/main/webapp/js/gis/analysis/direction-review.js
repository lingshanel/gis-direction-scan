(function (global) {
    "use strict";

    /**
     * 완료된 360도 분석의 한 방향을 다시 자세히 보여주는 UI 조정자입니다.
     * 전체 스캔에서 만든 고도·건물 인덱스를 재사용하므로 서버 요청이나 전체 분석을
     * 반복하지 않고, 선택한 방향의 단면과 2D·3D 방향 표시만 함께 갱신합니다.
     */
    function compassLabel(bearing) {
        var names = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
        return names[Math.round(bearing / 45) % 8];
    }

    function copyWithBearing(context, bearing) {
        var copy = {};
        Object.keys(context).forEach(function (key) {
            copy[key] = context[key];
        });
        copy.bearing = bearing;
        return copy;
    }

    function create(options) {
        var theme = global.GisVisualTheme;
        var colors = theme.colors;
        var geoMath = global.GisGeoMath;
        var observationSelectionMode = false;
        var pendingBearing = null;
        var reviewFrameId = null;
        var rayCache = new Map();
        var currentBearing = 0;
        var activePointerId = null;
        var visibilityVersion = 0;
        var bearingDial = document.getElementById("reviewBearingDial");
        var buildingCanvas = document.getElementById("reviewBuildingCanvas");
        var hitCanvas = document.getElementById("reviewHitCanvas");
        var miniMapCacheKey = null;
        var reviewAvailable = false;
        var resultPanel = document.getElementById("analysisResultPanel");
        var directionReviewElement = document.getElementById("directionReview");
        var analysisButton = document.getElementById("analysisResultButton");
        var analysisCloseButton = document.getElementById("analysisResultClose");
        var observationButton = document.getElementById("changeObservationButton");

        function cancelScheduledReview() {
            if (reviewFrameId !== null) cancelAnimationFrame(reviewFrameId);
            reviewFrameId = null;
            pendingBearing = null;
        }

        function scheduleShow(bearing) {
            pendingBearing = bearing;
            if (reviewFrameId !== null) return;
            reviewFrameId = requestAnimationFrame(function () {
                var nextBearing = pendingBearing;
                reviewFrameId = null;
                pendingBearing = null;
                show(nextBearing);
            });
        }

        function updateInteractionHint() {
            var hint = document.getElementById("mapInteractionHint");
            if (!hint) return;
            var mode = hint.getAttribute("data-mode") || "2d";
            hint.setAttribute("data-review-ready", String(options.isScanCompleted()));
            hint.setAttribute("data-observation-pick", String(observationSelectionMode));
            if (observationSelectionMode) {
                hint.textContent = "지도 클릭 · 새 관측점 선택";
            } else if (options.isScanCompleted() && !resultPanel.hidden) {
                hint.textContent = mode === "3d"
                    ? "원 안 클릭 · 방향 검토   |   드래그 · 회전   |   휠 · 확대/축소"
                    : "원 안 클릭 · 방향 검토   |   원 밖 클릭 · 새 관측점";
            } else if (options.isScanCompleted()) {
                hint.textContent = "상단 분석 버튼 · 방향 검토   |   위치 버튼 · 새 관측점";
            }
        }

        function setObservationSelectionMode(active) {
            observationSelectionMode = !!active;
            observationButton.setAttribute("aria-pressed", String(observationSelectionMode));
            var buttonLabel = observationSelectionMode
                ? "새 관측점을 클릭하세요"
                : "관측점 변경";
            observationButton.setAttribute("aria-label", buttonLabel);
            observationButton.setAttribute("data-tooltip", buttonLabel);
            options.map.getTargetElement().classList.toggle(
                "observation-pick-mode",
                observationSelectionMode
            );
            var cesiumElement = document.getElementById("cesiumMap");
            if (cesiumElement) {
                cesiumElement.classList.toggle(
                    "observation-pick-mode",
                    observationSelectionMode
                );
            }
            updateInteractionHint();
        }

        function clearActiveReview(animateDirectionClear) {
            cancelScheduledReview();
            options.mapLayers.clearViewDirection(Boolean(animateDirectionClear));
            options.buildingDisplay.clearHighlights(options.highlightedBuildings);
            if (typeof options.onDirectionClear === "function") {
                options.onDirectionClear(Boolean(animateDirectionClear));
            }
            if (typeof options.onBuildingHighlightsClear === "function") {
                options.onBuildingHighlightsClear();
            }
        }

        function setVisible(visible, animateClose) {
            var nextVisible = reviewAvailable && Boolean(visible);
            var version = ++visibilityVersion;
            resultPanel.hidden = !nextVisible;
            directionReviewElement.hidden = !nextVisible;
            document.body.classList.toggle("analysis-panel-open", nextVisible);
            analysisButton.setAttribute("aria-pressed", String(nextVisible));
            analysisButton.setAttribute("aria-expanded", String(nextVisible));
            analysisButton.setAttribute(
                "aria-label",
                nextVisible ? "방향 분석 결과 닫기" : "방향 분석 결과 열기"
            );
            analysisButton.setAttribute(
                "data-tooltip",
                nextVisible ? "방향 분석 닫기" : "방향 분석 결과"
            );
            if (!nextVisible) {
                /* 패널은 즉시 닫고 지도 레이어 정리는 다음 실행 단위로 넘겨
                 * 많은 건물이 강조된 상태에서도 닫기 버튼이 먼저 반응하게 합니다. */
                global.setTimeout(function () {
                    if (version !== visibilityVersion) return;
                    clearActiveReview(Boolean(animateClose));
                }, 0);
            }
            updateInteractionHint();
        }

        function setAvailable(available) {
            reviewAvailable = Boolean(available);
            analysisButton.hidden = !reviewAvailable;
            observationButton.hidden = !reviewAvailable;
            if (!reviewAvailable) setVisible(false);
            updateInteractionHint();
        }

        function updateBearingDial(bearing, directionText) {
            currentBearing = bearing;
            bearingDial.style.setProperty("--bearing-angle", bearing + "deg");
            bearingDial.setAttribute("aria-valuenow", bearing.toFixed(1));
            bearingDial.setAttribute("aria-valuetext", directionText);
        }

        function prepareCanvas(canvas) {
            var size = bearingDial.clientWidth;
            var pixelRatio = Math.max(1, global.devicePixelRatio || 1);
            var pixelSize = Math.round(size * pixelRatio);
            if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
                canvas.width = pixelSize;
                canvas.height = pixelSize;
            }
            var context = canvas.getContext("2d");
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            context.clearRect(0, 0, size, size);
            return {
                context: context,
                size: size,
                center: size / 2,
                radius: Math.max(1, size / 2 - 27)
            };
        }

        function projectedPoint(origin, coordinate, scale, center) {
            var distance = turf.distance(origin, coordinate, { units: "meters" });
            var bearing = turf.bearing(origin, coordinate) * Math.PI / 180;
            return [
                center + Math.sin(bearing) * distance * scale,
                center - Math.cos(bearing) * distance * scale
            ];
        }

        function traceGeometry(context, geometry, origin, scale, center) {
            if (!geometry || ["Polygon", "MultiPolygon"].indexOf(geometry.type) < 0) {
                return false;
            }
            var polygons = geometry.type === "Polygon"
                ? [geometry.coordinates]
                : geometry.coordinates;
            context.beginPath();
            polygons.forEach(function (rings) {
                rings.forEach(function (ring) {
                    ring.forEach(function (coordinate, index) {
                        var point = projectedPoint(origin, coordinate, scale, center);
                        if (index === 0) context.moveTo(point[0], point[1]);
                        else context.lineTo(point[0], point[1]);
                    });
                    context.closePath();
                });
            });
            return true;
        }

        function drawBuildings(canvas, elevationContext, selectedFeatures, style) {
            var layer = prepareCanvas(canvas);
            var context = layer.context;
            var scale = layer.radius / Math.max(1, elevationContext.radius);
            context.save();
            context.beginPath();
            context.arc(layer.center, layer.center, layer.radius, 0, Math.PI * 2);
            context.clip();
            context.fillStyle = style.fill;
            context.strokeStyle = style.stroke;
            context.lineWidth = style.lineWidth;
            (elevationContext.buildingData || []).forEach(function (building) {
                if (selectedFeatures && !selectedFeatures.has(building.feature)) return;
                if (!traceGeometry(
                    context,
                    building.geojson && building.geojson.geometry,
                    elevationContext.origin,
                    scale,
                    layer.center
                )) return;
                context.fill("evenodd");
                context.stroke();
            });
            context.restore();
        }

        function renderBuildingOverview(elevationContext, hits) {
            var cacheKey = [
                elevationContext.origin[0].toFixed(7),
                elevationContext.origin[1].toFixed(7),
                elevationContext.radius,
                (elevationContext.buildingData || []).length,
                bearingDial.clientWidth
            ].join(":");
            if (miniMapCacheKey !== cacheKey) {
                drawBuildings(buildingCanvas, elevationContext, null, {
                    fill: theme.rgba(colors.surfaceEstimated, 0.76),
                    stroke: theme.rgba(colors.muted, 0.58),
                    lineWidth: 0.7
                });
                miniMapCacheKey = cacheKey;
            }
            drawBuildings(
                hitCanvas,
                elevationContext,
                new Set(hits.map(function (hit) { return hit.feature; })),
                {
                    fill: theme.rgba(colors.accentSoft, 0.76),
                    stroke: theme.rgba(colors.accent, 0.94),
                    lineWidth: 1
                }
            );
        }

        function clearBuildingOverview() {
            miniMapCacheKey = null;
            [buildingCanvas, hitCanvas].forEach(function (canvas) {
                canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
            });
        }

        function blockingBuildingHits(ray, hits) {
            if (!ray || ray.cause !== "building") return [];
            return hits.filter(function (hit) {
                return Math.abs(hit.distance - ray.cutoff) <= 0.05;
            }).slice(0, 1);
        }

        function higherBuildingHits(ray, hits) {
            var eyeElevation = Number(ray && ray.eyeElevation);
            if (!Number.isFinite(eyeElevation)) return [];
            return hits.filter(function (hit) {
                var roofElevation = Number(hit.roofElevation);
                return Number.isFinite(roofElevation) &&
                    roofElevation + 1e-9 >= eyeElevation;
            });
        }

        function updateReviewSummary(ray, hits, blockingHits) {
            var first = blockingHits[0];
            var count = document.getElementById("reviewHitCount");
            var heightLabel = document.getElementById("reviewFirstHeightLabel");
            var height = document.getElementById("reviewFirstHeight");
            var distance = document.getElementById("reviewFirstDistance");
            var summary = document.getElementById("reviewInfo");

            count.textContent = hits.length + "개";
            if (first) {
                var firstProfile = ray.profile.find(function (point) {
                    return point.building && String(point.buildingId) === String(first.id);
                });
                var heightText = firstProfile && Number.isFinite(firstProfile.roof)
                    ? firstProfile.roof.toFixed(1) + "m"
                    : "확인 불가";
                var distanceText = first.distance.toFixed(1) + "m";
                heightLabel.textContent = "차폐 옥상 해발";
                height.textContent = heightText;
                distance.textContent = distanceText;
                summary.setAttribute("aria-label", "경로 교차 건물 " + hits.length +
                    "개, 차폐 건물 옥상 해발고도 " + heightText + ", 거리 " + distanceText);
                return;
            }

            if (ray.cause === "terrain") {
                heightLabel.textContent = "차폐 원인";
                height.textContent = "지형";
                distance.textContent = ray.cutoff.toFixed(1) + "m";
                summary.setAttribute("aria-label", "경로 교차 건물 " + hits.length +
                    "개, 지형 차폐 " + ray.cutoff.toFixed(1) + "미터");
                return;
            }

            heightLabel.textContent = "차폐 원인";
            height.textContent = "없음";
            distance.textContent = "반경 끝";
            summary.setAttribute("aria-label", "경로 교차 건물 " + hits.length +
                "개, 반경 끝까지 관측 가능");
        }

        function show(bearing, animateDirection) {
            var elevationContext = options.getElevationContext();
            if (!elevationContext || !options.isScanCompleted()) return;

            bearing = geoMath.normalizeBearing(bearing);
            var cacheKey = bearing.toFixed(3);
            var ray = rayCache.get(cacheKey);
            if (!ray) {
                ray = options.analyzeRay(copyWithBearing(elevationContext, bearing));
                rayCache.set(cacheKey, ray);
            }
            var hits = ray.hits;
            var blockingHits = blockingBuildingHits(ray, hits);
            var highlightedHits = higherBuildingHits(ray, hits);
            var bearingText = bearing.toFixed(1);
            var directionText = bearingText + "° " + compassLabel(bearing);

            updateBearingDial(bearing, directionText);
            // 방향선과 교차한 건물 중 옥상 해발고도가 관측자 해발고도 이상인
            // 건물을 모두 강조합니다. 첫 차폐 건물은 blockingHits로 따로 유지하므로
            // 기존 고도 단면과 가시/차폐 계산은 바뀌지 않습니다.
            renderBuildingOverview(elevationContext, highlightedHits);
            document.getElementById("reviewBearingValue").textContent = directionText;
            options.elevationProfile.updateFromRay(ray, bearing, options.getRadius());
            options.mapLayers.drawViewDirection(
                options.getCenter(),
                bearing,
                options.getRadius(),
                directionText,
                Boolean(animateDirection)
            );
            if (typeof options.onDirectionChange === "function") {
                options.onDirectionChange(
                    options.getCenter(),
                    bearing,
                    options.getRadius(),
                    Boolean(animateDirection)
                );
            }

            options.buildingDisplay.clearHighlights(options.highlightedBuildings);

            highlightedHits.forEach(function (hit) {
                hit.feature.set("scanRevealed", true);
                hit.feature.setStyle(options.buildingDisplay.styleFor(hit.feature, "review"));
                options.highlightedBuildings.add(hit.feature);
            });
            if (typeof options.onBuildingHighlightsChange === "function") {
                options.onBuildingHighlightsChange(highlightedHits.map(function (hit) {
                    return hit.id;
                }));
            }

            updateReviewSummary(ray, hits, blockingHits);
        }

        function pointAt(coordinate) {
            var center = options.getCenter();
            if (resultPanel.hidden || !reviewAvailable || !options.isScanCompleted() ||
                    !Array.isArray(center) || !Array.isArray(coordinate)) {
                return false;
            }
            // 상세 건물을 누른 지점을 기준으로 즉시 방향을 바꿔 선택 정보와 분석선이 어긋나지 않게 합니다.
            show(geoMath.bearingDegrees(center, coordinate), false);
            return true;
        }

        function bearingFromPointer(event) {
            var bounds = bearingDial.getBoundingClientRect();
            var x = event.clientX - (bounds.left + bounds.width / 2);
            var y = event.clientY - (bounds.top + bounds.height / 2);
            return geoMath.normalizeBearing(Math.atan2(x, -y) * 180 / Math.PI);
        }

        function reviewFromPointer(event) {
            event.preventDefault();
            scheduleShow(bearingFromPointer(event));
        }

        function finishPointer(event) {
            if (activePointerId !== event.pointerId) return;
            if (bearingDial.hasPointerCapture(event.pointerId)) {
                bearingDial.releasePointerCapture(event.pointerId);
            }
            activePointerId = null;
        }

        function handleMapClick(clickedLonLat, screenAlignedBearing) {
            var center = options.getCenter();
            if (center === null || !options.isScanCompleted()) return false;
            if (observationSelectionMode) return false;
            if (resultPanel.hidden) return false;

            var distance = turf.distance(center, clickedLonLat, { units: "meters" });
            if (distance <= options.getRadius() + 1) {
                options.hideAlert();
                var bearing = Number.isFinite(screenAlignedBearing)
                    ? geoMath.normalizeBearing(screenAlignedBearing)
                    : geoMath.normalizeBearing(turf.bearing(center, clickedLonLat));
                cancelScheduledReview();
                show(bearing, true);
                return true;
            }
            return false;
        }

        function reset() {
            cancelScheduledReview();
            rayCache.clear();
            currentBearing = 0;
            clearBuildingOverview();
            setObservationSelectionMode(false);
            setAvailable(false);
        }

        bearingDial.addEventListener("pointerdown", function (event) {
            activePointerId = event.pointerId;
            bearingDial.setPointerCapture(event.pointerId);
            reviewFromPointer(event);
        });
        bearingDial.addEventListener("pointermove", function (event) {
            if (activePointerId !== event.pointerId) return;
            reviewFromPointer(event);
        });
        bearingDial.addEventListener("pointerup", finishPointer);
        bearingDial.addEventListener("pointercancel", finishPointer);
        bearingDial.addEventListener("keydown", function (event) {
            var nextBearing = currentBearing;
            var step = event.shiftKey ? 10 : 1;
            if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                nextBearing += step;
            } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                nextBearing -= step;
            } else if (event.key === "PageUp") {
                nextBearing += 10;
            } else if (event.key === "PageDown") {
                nextBearing -= 10;
            } else if (event.key === "Home") {
                nextBearing = 0;
            } else if (event.key === "End") {
                nextBearing = 359.9;
            } else {
                return;
            }
            event.preventDefault();
            cancelScheduledReview();
            show(nextBearing);
        });
        analysisButton.addEventListener("click", function () {
            if (!reviewAvailable || !options.isScanCompleted()) return;
            var opening = resultPanel.hidden;
            if (opening) setObservationSelectionMode(false);
            setVisible(opening, !opening);
            if (opening) {
                // 패널 표시를 먼저 반영한 뒤 방향 계산을 실행해 열기 버튼의 체감 지연을 줄입니다.
                global.setTimeout(function () {
                    if (!resultPanel.hidden) show(currentBearing, true);
                }, 0);
            }
        });
        analysisCloseButton.addEventListener("click", function () {
            setVisible(false, true);
        });
        observationButton.addEventListener("click", function () {
            if (!options.isScanCompleted()) return;
            var nextSelectionMode = !observationSelectionMode;
            if (nextSelectionMode) setVisible(false);
            setObservationSelectionMode(nextSelectionMode);
        });

        return {
            handleMapClick: handleMapClick,
            isObservationSelectionMode: function () { return observationSelectionMode; },
            pointAt: pointAt,
            reset: reset,
            setAvailable: setAvailable,
            setVisible: setVisible
        };
    }

    global.GisDirectionReview = {
        create: create
    };
})(window);
