(function (global) {
    "use strict";

    function create(viewer) {
        var colors = global.GisVisualTheme.colors;
        var currentDataSource = null;
        var currentAnimatedPrimitive = null;
        var blockedEntities = [];
        var visibleEntities = [];
        var revealEntries = [];
        var revealStateByEntity = new Map();
        var revealIndex = 0;
        var excludedVisible = true;
        var visibleAreaVisible = true;
        var loadVersion = 0;

        function removeAnimatedPrimitive() {
            if (currentAnimatedPrimitive === null) return;
            viewer.scene.groundPrimitives.remove(currentAnimatedPrimitive);
            currentAnimatedPrimitive = null;
        }

        function colorFor(state) {
            if (state === "visible") {
                return Cesium.Color.fromCssColorString(colors.visibleRegion3d)
                    .withAlpha(0.48);
            }
            if (state === "blocked") {
                return Cesium.Color.fromCssColorString(colors.blockedRegion3d)
                    .withAlpha(0.52);
            }
            return Cesium.Color.fromCssColorString(colors.noDataRegion3d)
                .withAlpha(0.12);
        }

        function clear() {
            loadVersion++;
            blockedEntities = [];
            visibleEntities = [];
            revealEntries = [];
            revealStateByEntity.clear();
            revealIndex = 0;
            removeAnimatedPrimitive();
            if (currentDataSource !== null) {
                viewer.dataSources.remove(currentDataSource, true);
                currentDataSource = null;
            }
            viewer.scene.requestRender();
        }

        function stateIsVisible(state) {
            if (state === "blocked") return excludedVisible;
            if (state === "visible") return visibleAreaVisible;
            return true;
        }

        function styleEntity(entity, time, nextBlockedEntities, nextVisibleEntities) {
            if (!entity.polygon) return;

            var properties = entity.properties
                ? entity.properties.getValue(time) || {}
                : {};
            var state = properties.visibilityState || "nodata";
            entity.polygon.material = colorFor(state);
            entity.polygon.outline = false;
            entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN;
            // 주제지도보다 항상 위에 그려 분석 결과 색상이 가려지지 않게 합니다.
            entity.polygon.zIndex = 100;
            entity.show = stateIsVisible(state);
            if (state === "blocked") nextBlockedEntities.push(entity);
            if (state === "visible") nextVisibleEntities.push(entity);
        }

        function replace(featureCollection) {
            var version = ++loadVersion;

            if (!featureCollection || !Array.isArray(featureCollection.features) ||
                    featureCollection.features.length === 0) {
                var previous = currentDataSource;
                currentDataSource = null;
                blockedEntities = [];
                visibleEntities = [];
                revealEntries = [];
                revealStateByEntity.clear();
                revealIndex = 0;
                removeAnimatedPrimitive();
                if (previous !== null) viewer.dataSources.remove(previous, true);
                viewer.scene.requestRender();
                return Promise.resolve(null);
            }

            return Cesium.GeoJsonDataSource.load(featureCollection, {
                clampToGround: true
            }).then(function (dataSource) {
                if (version !== loadVersion) return null;

                var time = Cesium.JulianDate.now();
                var nextBlockedEntities = [];
                var nextVisibleEntities = [];
                dataSource.entities.values.forEach(function (entity) {
                    styleEntity(entity, time, nextBlockedEntities, nextVisibleEntities);
                });
                return Promise.resolve(viewer.dataSources.add(dataSource)).then(function () {
                    if (version !== loadVersion) {
                        viewer.dataSources.remove(dataSource, true);
                        return null;
                    }
                    if (currentDataSource !== null) {
                        viewer.dataSources.remove(currentDataSource, true);
                    }
                    removeAnimatedPrimitive();
                    currentDataSource = dataSource;
                    blockedEntities = nextBlockedEntities;
                    visibleEntities = nextVisibleEntities;
                    revealEntries = [];
                    revealStateByEntity.clear();
                    revealIndex = 0;
                    viewer.scene.requestRender();
                    return dataSource;
                });
            });
        }

        function polygonPositions(feature) {
            var geometry = feature && feature.geometry;
            var ring = geometry && geometry.type === "Polygon"
                ? geometry.coordinates[0]
                : null;
            if (!Array.isArray(ring) || ring.length < 4) return null;
            var lastIndex = ring.length - 1;
            var source = ring[0][0] === ring[lastIndex][0] &&
                ring[0][1] === ring[lastIndex][1]
                ? ring.slice(0, lastIndex)
                : ring;
            var degrees = [];
            source.forEach(function (coordinate) {
                degrees.push(coordinate[0], coordinate[1]);
            });
            return Cesium.Cartesian3.fromDegreesArray(degrees);
        }

        function setAnimatedEntryVisible(entry) {
            if (currentAnimatedPrimitive === null ||
                    !currentAnimatedPrimitive.ready) return;
            var attributes = currentAnimatedPrimitive.getGeometryInstanceAttributes(
                entry.id
            );
            attributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(
                entry.revealed && stateIsVisible(entry.state),
                attributes.show
            );
        }

        function prepare(featureCollection) {
            var version = ++loadVersion;
            var features = featureCollection && Array.isArray(featureCollection.features)
                ? featureCollection.features
                : [];
            var geometryInstances = [];
            var nextRevealEntries = [];

            features.forEach(function (feature, index) {
                var positions = polygonPositions(feature);
                if (positions === null) return;
                var properties = feature.properties || {};
                var state = properties.visibilityState || "nodata";
                var id = "animated-visibility-" + version + "-" + index;
                geometryInstances.push(new Cesium.GeometryInstance({
                    id: id,
                    geometry: new Cesium.PolygonGeometry({
                        polygonHierarchy: new Cesium.PolygonHierarchy(positions),
                        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
                    }),
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                            colorFor(state)
                        ),
                        show: new Cesium.ShowGeometryInstanceAttribute(false)
                    }
                }));
                nextRevealEntries.push({
                    bearing: Number(properties.revealBearing) || 0,
                    state: state,
                    id: id,
                    revealed: false
                });
            });
            nextRevealEntries.sort(function (left, right) {
                return left.bearing - right.bearing;
            });

            if (geometryInstances.length === 0) {
                clear();
                return Promise.resolve(null);
            }

            // 1° 영역을 각각 Entity로 만들면 매 프레임 지면 도형이 재구성됩니다.
            // 하나의 GroundPrimitive로 묶고 show 속성만 바꾸면 정밀한 경계를
            // 유지하면서도 스캔선과 같은 프레임 흐름으로 공개할 수 있습니다.
            var primitive = viewer.scene.groundPrimitives.add(
                new Cesium.GroundPrimitive({
                    geometryInstances: geometryInstances,
                    appearance: new Cesium.PerInstanceColorAppearance({
                        flat: true,
                        translucent: true,
                        closed: true
                    }),
                    classificationType: Cesium.ClassificationType.TERRAIN,
                    allowPicking: false,
                    asynchronous: true
                })
            );

            return new Promise(function (resolve) {
                function finishWhenReady() {
                    if (version !== loadVersion) {
                        viewer.scene.groundPrimitives.remove(primitive);
                        resolve(null);
                        return;
                    }
                    if (!primitive.ready) {
                        viewer.scene.requestRender();
                        global.requestAnimationFrame(finishWhenReady);
                        return;
                    }
                    if (currentDataSource !== null) {
                        viewer.dataSources.remove(currentDataSource, true);
                        currentDataSource = null;
                    }
                    removeAnimatedPrimitive();
                    currentAnimatedPrimitive = primitive;
                    blockedEntities = [];
                    visibleEntities = [];
                    revealEntries = nextRevealEntries;
                    revealStateByEntity.clear();
                    revealIndex = 0;
                    viewer.scene.groundPrimitives.raiseToTop(primitive);
                    viewer.scene.requestRender();
                    resolve(primitive);
                }
                finishWhenReady();
            });
        }

        function revealThrough(bearing) {
            var changed = false;
            while (revealIndex < revealEntries.length &&
                    revealEntries[revealIndex].bearing <= bearing + 0.0001) {
                var entry = revealEntries[revealIndex++];
                entry.revealed = true;
                if (entry.entity) entry.entity.show = stateIsVisible(entry.state);
                else setAnimatedEntryVisible(entry);
                changed = true;
            }
            if (changed) viewer.scene.requestRender();
        }

        function setExcludedVisible(visible) {
            excludedVisible = Boolean(visible);
            blockedEntities.forEach(function (entity) {
                var revealState = revealStateByEntity.get(entity);
                entity.show = excludedVisible &&
                    (revealState === undefined || revealState.revealed);
            });
            revealEntries.forEach(function (entry) {
                if (entry.state === "blocked" && !entry.entity) {
                    setAnimatedEntryVisible(entry);
                }
            });
            viewer.scene.requestRender();
        }

        function setVisibleAreaVisible(visible) {
            visibleAreaVisible = Boolean(visible);
            visibleEntities.forEach(function (entity) {
                var revealState = revealStateByEntity.get(entity);
                entity.show = visibleAreaVisible &&
                    (revealState === undefined || revealState.revealed);
            });
            revealEntries.forEach(function (entry) {
                if (entry.state === "visible" && !entry.entity) {
                    setAnimatedEntryVisible(entry);
                }
            });
            viewer.scene.requestRender();
        }

        return {
            clear: clear,
            prepare: prepare,
            replace: replace,
            revealThrough: revealThrough,
            setExcludedVisible: setExcludedVisible,
            setVisibleAreaVisible: setVisibleAreaVisible
        };
    }

    global.GisCesiumVisibilityRegions = {
        create: create
    };
})(window);
