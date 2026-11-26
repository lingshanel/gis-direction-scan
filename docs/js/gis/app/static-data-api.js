(function (global) {
    "use strict";

    var nativeFetch = global.fetch.bind(global);
    var fallbackFetch = global.GisJsonApi.fetch.bind(global.GisJsonApi);
    var buildingCatalog = null;
    var thematicCatalog = null;

    function loadJson(url) {
        return nativeFetch(url, { headers: { "Accept": "application/json" } })
            .then(function (response) {
                if (!response.ok) throw new Error("정적 데모 데이터를 불러오지 못했습니다.");
                return response.json();
            });
    }

    function buildings() {
        if (buildingCatalog === null) {
            buildingCatalog = loadJson("./data/buildings.geojson");
        }
        return buildingCatalog;
    }

    function thematic() {
        if (thematicCatalog === null) {
            thematicCatalog = loadJson("./data/thematic-map.json");
        }
        return thematicCatalog;
    }

    function insideCoverage(coordinate, bounds) {
        return coordinate[0] >= bounds[0] && coordinate[0] <= bounds[2] &&
            coordinate[1] >= bounds[1] && coordinate[1] <= bounds[3];
    }

    function requestBuildings(url) {
        var parsed = new URL(url, global.location.href);
        var coordinate = [
            Number(parsed.searchParams.get("lon")),
            Number(parsed.searchParams.get("lat"))
        ];
        var radius = Math.max(100, Math.min(500,
            Number(parsed.searchParams.get("radius")) || 300));
        return buildings().then(function (catalog) {
            var coverage = catalog.metadata.coverage;
            if (!insideCoverage(coordinate, coverage.bounds)) {
                throw new Error("GitHub Pages 정적 데모 영역 안에서 관측점을 선택해 주세요.");
            }
            var searchArea = turf.buffer(turf.point(coordinate), radius, { units: "meters" });
            var features = catalog.features.filter(function (feature) {
                try {
                    return turf.booleanIntersects(searchArea, feature);
                } catch (error) {
                    return turf.distance(turf.centroid(feature), turf.point(coordinate),
                        { units: "meters" }) <= radius;
                }
            });
            return {
                type: "FeatureCollection",
                features: features,
                metadata: Object.assign({}, catalog.metadata, {
                    radius: radius,
                    buildingCount: features.length,
                    timestamp: new Date().toISOString()
                })
            };
        });
    }

    function requestBuildingDetail(url) {
        var parsed = new URL(url, global.location.href);
        var buildingId = parsed.searchParams.get("buildingId");
        return buildings().then(function (catalog) {
            var feature = catalog.features.find(function (item) {
                return String(item.id) === String(buildingId);
            });
            if (!feature) throw new Error("정적 데모에서 건물 정보를 찾을 수 없습니다.");
            return feature.properties;
        });
    }

    function requestThematicMap(url) {
        var parsed = new URL(url, global.location.href);
        var coordinate = [
            Number(parsed.searchParams.get("lon")),
            Number(parsed.searchParams.get("lat"))
        ];
        return thematic().then(function (catalog) {
            if (!insideCoverage(coordinate, catalog.metadata.coverage.bounds)) {
                throw new Error("정적 데모 영역을 벗어났습니다.");
            }
            return catalog;
        });
    }

    function staticFetch(options) {
        var url = String(options.url || "");
        var request;
        if (url.indexOf("/gis/buildings.do") >= 0) {
            request = requestBuildings(url);
        } else if (url.indexOf("/gis/building-detail.do") >= 0) {
            request = requestBuildingDetail(url);
        } else if (url.indexOf("/gis/thematic-map.do") >= 0) {
            request = requestThematicMap(url);
        } else {
            return fallbackFetch(options);
        }
        return request.then(function (data) {
            if (!options.validate(data)) throw new Error(options.invalidMessage);
            return data;
        });
    }

    global.GisJsonApi = { fetch: staticFetch };
})(window);
