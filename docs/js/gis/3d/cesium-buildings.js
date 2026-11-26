(function (global) {
    "use strict";

    var colors = global.GisVisualTheme.colors;

    function finiteNumber(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function create(viewer, options) {
        var settings = options || {};
        var currentDataSource = null;
        var baseMaterials = new Map();
        var baseGeometry = new Map();
        var entitiesByBuildingId = new Map();
        var highlightedEntities = new Set();
        var highlightedIds = [];
        var revealedIds = [];
        var revealedIdSet = new Set();
        var detailSelectedId = null;
        var hoveredId = null;
        var loadVersion = 0;
        var osmTileset = null;
        var defaultOsmStyle = null;
        var defaultColorBlendMode = null;
        var defaultColorBlendAmount = 0.5;
        var osmStyleAnimationId = null;
        var analysisStyleApplied = false;
        var osmState = settings.osmEnabled === false ? "fallback" : "loading";
        var osmReadyPromise = Promise.resolve(null);
        var analysisFocus = null;

        viewer.container.setAttribute("data-building-state", osmState);

        function styleEntity(entity, time, materialStore, geometryStore) {
            if (!entity.polygon) return;

            var properties = entity.properties
                ? entity.properties.getValue(time) || {}
                : {};
            var height = Math.max(2, finiteNumber(properties.heightMeters, 10));
            var baseHeight = Math.max(0, finiteNumber(properties.minHeightMeters, 0));
            var estimated = properties.heightEstimated === true ||
                properties.heightEstimated === "true";

            entity.polygon.height = baseHeight;
            entity.polygon.heightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
            entity.polygon.extrudedHeight = baseHeight + height;
            entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
            // 건물 면은 완전 불투명으로 유지합니다. 1에 가까운 반투명 값은
            // 겹친 벽면에서 카메라 이동 시 짙은 점묘 무늬를 만들 수 있습니다.
            var material = Cesium.Color.fromCssColorString(
                estimated ? colors.surfaceEstimated : colors.surface
            );
            entity.polygon.material = material;
            entity.polygon.outline = false;
            entity.polygon.shadows = Cesium.ShadowMode.DISABLED;
            entity.polygon.closeTop = true;
            entity.polygon.closeBottom = true;
            materialStore.set(entity, material);
            geometryStore.set(entity, {
                height: baseHeight,
                extrudedHeight: baseHeight + height
            });
        }

        function buildingId(entity, time) {
            var properties = entity.properties
                ? entity.properties.getValue(time) || {}
                : {};
            return String(properties.buildingId || entity.id);
        }

        function pickedProperty(picked, names) {
            if (!picked || typeof picked.getProperty !== "function") return null;
            var value = null;
            names.some(function (name) {
                value = picked.getProperty(name);
                return value !== null && value !== undefined && String(value).trim() !== "";
            });
            return value;
        }

        function buildingIdFromPick(picked) {
            // PostGIS GeoJSON 대체 건물은 Entity의 명시적인 buildingId만 인정합니다.
            // 분석 영역 Entity의 임의 ID가 건물로 오인되는 것을 방지합니다.
            if (picked.id && picked.id.properties) {
                var properties = picked.id.properties.getValue(Cesium.JulianDate.now()) || {};
                if (properties.buildingId) return String(properties.buildingId);
            }

            // Cesium OSM Buildings는 OSM 객체 종류와 번호를 별도 속성으로 제공합니다.
            var elementType = pickedProperty(picked, ["elementType", "element_type"]);
            var elementId = pickedProperty(picked, ["elementId", "element_id"]);
            if (elementType !== null && elementId !== null) {
                return String(elementType).toLowerCase() + "/" + String(elementId);
            }
            var explicitId = pickedProperty(picked, ["buildingId", "building_id"]);
            return explicitId === null || explicitId === undefined
                ? null
                : String(explicitId);
        }

        function pickBuildingId(screenPosition) {
            if (!screenPosition) return null;
            var picks = viewer.scene.drillPick(screenPosition, 12);
            var found = null;
            picks.some(function (picked) {
                found = buildingIdFromPick(picked);
                return found !== null;
            });
            return found;
        }

        function osmColorCondition(value, color) {
            var match = /^(node|way|relation)\/(\d+)$/.exec(String(value));
            if (!match) return null;
            return [
                "${feature['elementType']} === '" + match[1] +
                    "' && ${feature['elementId']} === " + match[2],
                "color('" + color + "')"
            ];
        }

        function osmHighlightConditions() {
            var conditions = [];
            var highlightedIdSet = new Set(highlightedIds.map(String));
            var detailCondition = detailSelectedId === null
                ? null
                : osmColorCondition(detailSelectedId, colors.accentSurface);
            if (detailCondition) conditions.push(detailCondition);
            highlightedIds.forEach(function (value) {
                if (String(value) === detailSelectedId) return;
                var condition = osmColorCondition(value, colors.highlightSurface);
                if (condition) conditions.push(condition);
            });
            revealedIdSet.forEach(function (value) {
                if (String(value) === detailSelectedId ||
                        highlightedIdSet.has(String(value))) return;
                var condition = osmColorCondition(value, colors.blockedSurface);
                if (condition) conditions.push(condition);
            });
            return conditions;
        }

        function restoreEntity(entity) {
            if (!entity.polygon || !baseGeometry.has(entity)) return;
            var geometry = baseGeometry.get(entity);
            entity.polygon.height = geometry.height;
            entity.polygon.extrudedHeight = geometry.extrudedHeight;
            entity.polygon.material = baseMaterials.get(entity);
            entity.show = osmState !== "ready";
        }

        function highlightEntity(entity) {
            if (!entity.polygon || !baseGeometry.has(entity)) return;
            var geometry = baseGeometry.get(entity);
            // OSM Buildings를 사용할 수 없을 때만 DB 건물을 대체 강조합니다.
            entity.polygon.height = geometry.height + 0.8;
            entity.polygon.extrudedHeight = geometry.extrudedHeight + 1.4;
            entity.polygon.material = Cesium.Color.fromCssColorString(
                colors.highlightSurface
            );
            entity.show = true;
            highlightedEntities.add(entity);
        }

        function emphasizeEntity(entity, color, alpha, baseLift, topLift) {
            if (!entity || !entity.polygon || !baseGeometry.has(entity)) return;
            var geometry = baseGeometry.get(entity);
            entity.polygon.height = geometry.height + baseLift;
            entity.polygon.extrudedHeight = geometry.extrudedHeight + topLift;
            entity.polygon.material = Cesium.Color.fromCssColorString(color).withAlpha(alpha);
            entity.show = true;
            highlightedEntities.add(entity);
        }

        function applyEntityState(entity, time) {
            if (!entity) return;
            var id = buildingId(entity, time);
            var directionHighlighted = highlightedIds.map(String).indexOf(id) >= 0;
            restoreEntity(entity);
            // OSM Buildings가 정상인 경우 모든 상태 색상을 실제 OSM 건물에만
            // 적용합니다. 같은 위치의 DB 형상을 겹치지 않아 깊이 떨림을 막습니다.
            if (osmState === "ready") {
                return;
            }

            if (detailSelectedId !== null && id === detailSelectedId) {
                emphasizeEntity(entity, colors.accentSurface, 1, 1.2, 2.2);
            } else if (hoveredId !== null && id === hoveredId) {
                emphasizeEntity(entity, colors.visibleSurface, 1, 1, 1.8);
            } else if (directionHighlighted) {
                highlightEntity(entity);
            } else if (revealedIdSet.has(id)) {
                emphasizeEntity(entity, colors.blockedSurface, 1, 0.8, 1.4);
            }
        }

        function refreshInteractionIds(ids) {
            var time = Cesium.JulianDate.now();
            new Set(ids.filter(function (id) { return id !== null; })).forEach(function (id) {
                applyEntityState(entitiesByBuildingId.get(String(id)), time);
            });
            viewer.scene.requestRender();
        }

        function applyDisplayMode() {
            highlightedEntities.clear();
            if (currentDataSource === null) {
                viewer.scene.requestRender();
                return;
            }

            var time = Cesium.JulianDate.now();
            currentDataSource.entities.values.forEach(function (entity) {
                applyEntityState(entity, time);
            });
            viewer.scene.requestRender();
        }

        function setHighlighted(ids) {
            highlightedIds = Array.isArray(ids) ? ids.slice() : [];
            applyOsmStyle(false);
            applyDisplayMode();
        }

        function setDetailSelected(id) {
            var previous = detailSelectedId;
            detailSelectedId = id === null || id === undefined ? null : String(id);
            applyOsmStyle(false);
            refreshInteractionIds([previous, detailSelectedId]);
        }

        function setHovered(id) {
            var next = id === null || id === undefined ? null : String(id);
            if (hoveredId === next) return;
            var previous = hoveredId;
            hoveredId = next;
            // OSM 3D Tiles 전체 스타일 재생성은 마우스 이동 중 가장 큰 병목입니다.
            // OSM이 정상인 경우 툴팁만 사용하고, 개별 엔티티를 쓰는 대체 모드에서만
            // 이전·현재 건물의 재질을 갱신합니다.
            if (osmState === "ready") {
                viewer.scene.requestRender();
                return;
            }
            refreshInteractionIds([previous, hoveredId, detailSelectedId]);
        }

        function setRevealed(ids) {
            revealedIds = Array.isArray(ids) ? ids.map(String) : [];
            revealedIdSet = new Set(revealedIds);
            applyOsmStyle(false);
            applyDisplayMode();
        }

        function countVisibleBuildingIds(ids) {
            if (currentDataSource === null || !Array.isArray(ids)) return null;
            var width = viewer.scene.canvas.clientWidth;
            var height = viewer.scene.canvas.clientHeight;
            if (width <= 0 || height <= 0) return null;

            var time = Cesium.JulianDate.now();
            var ellipsoid = viewer.scene.globe.ellipsoid;
            var occluder = new Cesium.EllipsoidalOccluder(
                ellipsoid,
                viewer.camera.positionWC
            );
            var count = 0;
            ids.forEach(function (id) {
                var entity = entitiesByBuildingId.get(String(id));
                if (!entity || !entity.polygon) return;
                var property = entity.polygon.hierarchy;
                var hierarchy = property && typeof property.getValue === "function"
                    ? property.getValue(time)
                    : property;
                if (!hierarchy || !Array.isArray(hierarchy.positions) ||
                        hierarchy.positions.length === 0) return;
                var center = Cesium.BoundingSphere.fromPoints(hierarchy.positions).center;
                if (!occluder.isPointVisible(center)) return;
                var screen = Cesium.SceneTransforms.worldToWindowCoordinates(
                    viewer.scene,
                    center
                );
                if (Cesium.defined(screen) && screen.x >= 0 && screen.x <= width &&
                        screen.y >= 0 && screen.y <= height) {
                    count++;
                }
            });
            return count;
        }

        function animateBlendAmount(target, onComplete) {
            if (osmStyleAnimationId !== null &&
                    typeof global.cancelAnimationFrame === "function") {
                global.cancelAnimationFrame(osmStyleAnimationId);
                osmStyleAnimationId = null;
            }
            var reduceMotion = !global.requestAnimationFrame ||
                (global.matchMedia &&
                global.matchMedia("(prefers-reduced-motion: reduce)").matches);
            if (reduceMotion) {
                osmTileset.colorBlendAmount = target;
                if (typeof onComplete === "function") onComplete();
                return;
            }

            var start = Number(osmTileset.colorBlendAmount) || 0;
            var startedAt = performance.now();
            function frame(now) {
                var linear = Math.min(1, (now - startedAt) / 560);
                var progress = 1 - Math.pow(1 - linear, 3);
                osmTileset.colorBlendAmount = start + (target - start) * progress;
                viewer.scene.requestRender();
                if (linear < 1) {
                    osmStyleAnimationId = global.requestAnimationFrame(frame);
                } else {
                    osmStyleAnimationId = null;
                    if (typeof onComplete === "function") onComplete();
                }
            }
            osmStyleAnimationId = global.requestAnimationFrame(frame);
        }

        function restoreDefaultOsmStyle() {
            osmTileset.style = defaultOsmStyle;
            osmTileset.colorBlendMode = defaultColorBlendMode;
            osmTileset.colorBlendAmount = defaultColorBlendAmount;
            analysisStyleApplied = false;
            viewer.scene.requestRender();
        }

        function applyOsmStyle(animate) {
            if (osmTileset === null) return;
            var highlightConditions = osmHighlightConditions();
            if (analysisFocus === null && highlightConditions.length === 0) {
                if (!analysisStyleApplied) {
                    restoreDefaultOsmStyle();
                    return;
                }
                osmTileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.MIX;
                animateBlendAmount(0, restoreDefaultOsmStyle);
                return;
            }

            if (analysisFocus === null) {
                highlightConditions.push([
                    "true",
                    "color('" + colors.surfaceEstimated + "')"
                ]);
                osmTileset.style = new Cesium.Cesium3DTileStyle({
                    color: { conditions: highlightConditions }
                });
                osmTileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.HIGHLIGHT;
                osmTileset.colorBlendAmount = 1;
                analysisStyleApplied = true;
                viewer.scene.requestRender();
                return;
            }

            var center = analysisFocus.center;
            var latitudeScale = Math.max(
                0.2,
                Math.cos(center[1] * Math.PI / 180)
            );
            var centerX = center[0] * latitudeScale;
            var radiusDegrees = analysisFocus.radius / 111320;
            var insideAnalysisRadius = "${distanceFromObservation} <= " + radiusDegrees;
            var colorConditions = highlightConditions.concat([
                [insideAnalysisRadius, "color('" + colors.buildingSurface3d + "')"],
                ["true", "color('" + colors.buildingSurface3d + "')"]
            ]);
            osmTileset.style = new Cesium.Cesium3DTileStyle({
                defines: {
                    distanceFromObservation: "distance(vec2(" +
                        "${feature['cesium#longitude']} * " + latitudeScale + ", " +
                        "${feature['cesium#latitude']}), vec2(" +
                        centerX + ", " + center[1] + "))"
                },
                color: { conditions: colorConditions },
                // 색상만 흐리게 바꾸면 범위 밖 건물도 계속 그려집니다.
                // show 조건으로 분석 반경 밖 feature를 렌더링 대상에서 제외합니다.
                show: insideAnalysisRadius
            });
            analysisStyleApplied = true;
            if (animate) {
                osmTileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.MIX;
                osmTileset.colorBlendAmount = 0;
                animateBlendAmount(1, function () {
                    osmTileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.HIGHLIGHT;
                    viewer.scene.requestRender();
                });
            } else {
                osmTileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.HIGHLIGHT;
                osmTileset.colorBlendAmount = 1;
                viewer.scene.requestRender();
            }
        }

        function setAnalysisFocus(center, radius, active) {
            var hadFocus = analysisFocus !== null;
            analysisFocus = active && Array.isArray(center)
                ? { center: center.slice(), radius: Math.max(0, Number(radius) || 0) }
                : null;
            applyOsmStyle(!hadFocus && analysisFocus !== null);
            applyDisplayMode();
        }

        function createWhiteBuildingShader() {
            if (!Cesium.CustomShader || !Cesium.CustomShaderMode ||
                    !Cesium.CustomShaderTranslucencyMode || !Cesium.LightingModel) {
                return null;
            }
            // OSM 원본의 회색 albedo를 사용하지 않습니다. emissive를 주광으로 삼고
            // diffuse를 조금 남겨 옥상과 측면에만 부드러운 명암이 생기게 합니다.
            return new Cesium.CustomShader({
                mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
                lightingModel: Cesium.LightingModel.PBR,
                translucencyMode: Cesium.CustomShaderTranslucencyMode.OPAQUE,
                fragmentShaderText: [
                    "void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {",
                    "    material.diffuse = vec3(0.40);",
                    "    material.emissive = vec3(0.56);",
                    "    material.specular = vec3(0.04);",
                    "    material.roughness = 1.0;",
                    "    material.alpha = 1.0;",
                    "}"
                ].join("\n")
            });
        }

        function loadOsmBuildings() {
            if (settings.osmEnabled === false) {
                applyDisplayMode();
                return Promise.resolve(null);
            }
            osmReadyPromise = Cesium.createOsmBuildingsAsync({
                enableShowOutline: true,
                showOutline: true,
                outlineColor: Cesium.Color.fromCssColorString("#4f5955").withAlpha(0.68)
            }).then(function (tileset) {
                osmTileset = viewer.scene.primitives.add(tileset);
                osmTileset.shadows = Cesium.ShadowMode.DISABLED;
                var whiteBuildingShader = createWhiteBuildingShader();
                if (whiteBuildingShader !== null) {
                    osmTileset.customShader = whiteBuildingShader;
                }
                defaultOsmStyle = new Cesium.Cesium3DTileStyle({
                    color: "color('" + colors.buildingSurface3d + "')"
                });
                // 백색 셰이더 결과에 분석 색을 곱하면 원본 재질은 되살아나지 않고
                // 선택·호버·차폐 색상만 동일한 명암을 유지한 채 입혀집니다.
                defaultColorBlendMode = Cesium.Cesium3DTileColorBlendMode.HIGHLIGHT;
                defaultColorBlendAmount = 1;
                osmState = "ready";
                viewer.container.setAttribute("data-building-state", osmState);
                applyOsmStyle(false);
                applyDisplayMode();
                return osmTileset;
            }).catch(function (error) {
                osmState = "fallback";
                viewer.container.setAttribute("data-building-state", osmState);
                applyDisplayMode();
                console.warn(
                    "Cesium OSM Buildings를 불러오지 못해 DB 건물을 표시합니다.",
                    error
                );
                return null;
            });
            return osmReadyPromise;
        }

        function replace(featureCollection) {
            var version = ++loadVersion;

            if (!featureCollection || !Array.isArray(featureCollection.features) ||
                    featureCollection.features.length === 0) {
                var previous = currentDataSource;
                currentDataSource = null;
                baseMaterials.clear();
                baseGeometry.clear();
                entitiesByBuildingId.clear();
                highlightedEntities.clear();
                if (previous !== null) viewer.dataSources.remove(previous, true);
                viewer.scene.requestRender();
                return Promise.resolve(null);
            }

            var nextBaseMaterials = new Map();
            var nextBaseGeometry = new Map();
            var nextEntitiesByBuildingId = new Map();
            return Cesium.GeoJsonDataSource.load(featureCollection, {
                clampToGround: false
            }).then(function (dataSource) {
                if (version !== loadVersion) return null;

                var time = Cesium.JulianDate.now();
                dataSource.entities.values.forEach(function (entity) {
                    styleEntity(
                        entity,
                        time,
                        nextBaseMaterials,
                        nextBaseGeometry
                    );
                    nextEntitiesByBuildingId.set(buildingId(entity, time), entity);
                });
                return Promise.resolve(viewer.dataSources.add(dataSource)).then(function () {
                    if (version !== loadVersion) {
                        viewer.dataSources.remove(dataSource, true);
                        return null;
                    }
                    var previous = currentDataSource;
                    currentDataSource = dataSource;
                    baseMaterials = nextBaseMaterials;
                    baseGeometry = nextBaseGeometry;
                    entitiesByBuildingId = nextEntitiesByBuildingId;
                    highlightedEntities.clear();
                    applyDisplayMode();
                    if (previous !== null) viewer.dataSources.remove(previous, true);
                    return dataSource;
                });
            });
        }

        loadOsmBuildings();

        return {
            countVisibleBuildingIds: countVisibleBuildingIds,
            getOsmReadyPromise: function () { return osmReadyPromise; },
            pickBuildingId: pickBuildingId,
            replace: replace,
            setAnalysisFocus: setAnalysisFocus,
            setDetailSelected: setDetailSelected,
            setHighlighted: setHighlighted,
            setHovered: setHovered,
            setRevealed: setRevealed
        };
    }

    global.GisCesiumBuildings = {
        create: create
    };
})(window);
