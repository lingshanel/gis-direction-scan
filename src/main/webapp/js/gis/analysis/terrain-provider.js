(function (global) {
    "use strict";

    function intersects(a, b) {
        return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    }
    function contains(outer, inner) {
        return outer && outer[0] <= inner[0] && outer[1] <= inner[1] &&
            outer[2] >= inner[2] && outer[3] >= inner[3];
    }
    function searchBounds(center, radiusMeters) {
        var latitudeDelta = radiusMeters / 111320;
        var longitudeDelta = radiusMeters / (111320 * Math.max(0.2, Math.cos(center[1] * Math.PI / 180)));
        return [center[0] - longitudeDelta, center[1] - latitudeDelta,
                center[0] + longitudeDelta, center[1] + latitudeDelta];
    }
    function absoluteUrl(path, base) {
        return new URL(path, new URL(base, global.location.href)).href;
    }
    function settle(promise) {
        return promise.then(function (value) {
            return { status: "fulfilled", value: value };
        }, function (reason) {
            return { status: "rejected", reason: reason };
        });
    }

    function TerrainProvider(options) {
        this.manifestUrl = options.manifestUrl;
        this.manifest = null;
        this.loadedTiles = [];
        this.loadedBounds = null;
        this.pending = null;
        this.lastStatus = { state: "idle", message: "DEM 조회 대기 중", tileCount: 0 };
    }
    TerrainProvider.prototype.covers = function (center, radiusMeters) {
        return this.loadedTiles.length > 0 && contains(this.loadedBounds, searchBounds(center, radiusMeters));
    };
    TerrainProvider.prototype.getSurfaceModel = function () {
        var value = this.manifest && this.manifest.surfaceModel;
        value = String(value || "DTM").toUpperCase();
        return value === "DSM" ? "DSM" : "DTM";
    };
    TerrainProvider.prototype.loadManifest = function () {
        var self = this;
        if (this.manifest) return Promise.resolve(this.manifest);
        return fetch(this.manifestUrl, {
            cache: "no-store", headers: { "Accept": "application/json" }
        }).then(function (response) {
            if (!response.ok) throw new Error("DEM 목록을 불러오지 못했습니다. HTTP " + response.status);
            return response.json();
        }).then(function (manifest) {
            if (!manifest || !Array.isArray(manifest.tiles)) throw new Error("DEM 목록 형식이 올바르지 않습니다.");
            if ((manifest.crs || "EPSG:4326") !== "EPSG:4326") {
                throw new Error("현재 DEM 샘플러는 EPSG:4326 COG만 지원합니다.");
            }
            self.manifest = manifest;
            return manifest;
        });
    };
    TerrainProvider.prototype.readTile = function (tile, bounds, manifest) {
        var url = absoluteUrl(tile.url, this.manifestUrl);
        var image;
        return global.GeoTIFF.fromUrl(url).then(function (tiff) {
            return tiff.getImage();
        }).then(function (loadedImage) {
            image = loadedImage;
            var bbox = image.getBoundingBox();
            var width = image.getWidth();
            var height = image.getHeight();
            var clipped = [Math.max(bounds[0], bbox[0]), Math.max(bounds[1], bbox[1]),
                           Math.min(bounds[2], bbox[2]), Math.min(bounds[3], bbox[3])];
            var x0 = Math.max(0, Math.floor((clipped[0] - bbox[0]) / (bbox[2] - bbox[0]) * width) - 2);
            var x1 = Math.min(width, Math.ceil((clipped[2] - bbox[0]) / (bbox[2] - bbox[0]) * width) + 2);
            var y0 = Math.max(0, Math.floor((bbox[3] - clipped[3]) / (bbox[3] - bbox[1]) * height) - 2);
            var y1 = Math.min(height, Math.ceil((bbox[3] - clipped[1]) / (bbox[3] - bbox[1]) * height) + 2);
            if (x1 <= x0 || y1 <= y0) throw new Error("DEM 타일과 검색 영역이 겹치지 않습니다.");
            return image.readRasters({
                window: [x0, y0, x1, y1],
                samples: [tile.band == null ? 0 : tile.band],
                interleave: true
            }).then(function (raster) {
                var noData = tile.noData;
                if (noData == null) noData = image.getGDALNoData();
                if (noData == null) noData = manifest.noData;
                return {
                    id: tile.id || tile.url, config: tile, url: url, bounds: tile.bounds,
                    bbox: [bbox[0] + (bbox[2] - bbox[0]) * x0 / width,
                        bbox[3] - (bbox[3] - bbox[1]) * y1 / height,
                        bbox[0] + (bbox[2] - bbox[0]) * x1 / width,
                        bbox[3] - (bbox[3] - bbox[1]) * y0 / height],
                    width: x1 - x0, height: y1 - y0, data: raster,
                    noData: noData == null ? null : Number(noData)
                };
            });
        });
    };
    TerrainProvider.prototype.prepare = function (center, radiusMeters, options) {
        var self = this;
        var settings = options || {};
        var preloadRadius = Math.max(radiusMeters, Number(settings.preloadRadius) || radiusMeters);
        var requestedBounds = searchBounds(center, radiusMeters);
        var loadBounds = searchBounds(center, preloadRadius);

        if (this.loadedTiles.length && contains(this.loadedBounds, requestedBounds)) {
            this.lastStatus = {
                state: "ready", message: this.getSurfaceModel() + " 캐시 재사용 · 즉시 분석 가능",
                tileCount: this.loadedTiles.length, surfaceModel: this.getSurfaceModel(), cached: true
            };
            return Promise.resolve(this.lastStatus);
        }
        if (this.pending && contains(this.pending.bounds, requestedBounds)) return this.pending.promise;
        if (!global.GeoTIFF || typeof global.GeoTIFF.fromUrl !== "function") {
            return Promise.resolve({ state: "error", message: "geotiff.js를 불러오지 못했습니다.", tileCount: 0 });
        }

        this.lastStatus = { state: "loading", message: "DEM 고도 격자를 준비하고 있습니다.", tileCount: 0 };
        var work = this.loadManifest().then(function (manifest) {
            var selected = manifest.tiles.filter(function (tile) {
                return Array.isArray(tile.bounds) && tile.bounds.length === 4 && intersects(tile.bounds, loadBounds);
            });
            if (!selected.length) {
                self.loadedTiles = [];
                self.loadedBounds = null;
                self.lastStatus = { state: "nodata", message: "선택 영역에 설치된 DEM 타일이 없습니다.", tileCount: 0 };
                return self.lastStatus;
            }
            return Promise.all(selected.map(function (tile) {
                return settle(self.readTile(tile, loadBounds, manifest));
            })).then(function (attempts) {
                var firstFailure;
                self.loadedTiles = attempts.filter(function (item) {
                    if (item.status === "rejected" && !firstFailure) firstFailure = item;
                    return item.status === "fulfilled";
                }).map(function (item) { return item.value; });
                if (!self.loadedTiles.length) {
                    var detail = firstFailure && firstFailure.reason ?
                        (firstFailure.reason.message || String(firstFailure.reason)) : "원인을 확인할 수 없습니다.";
                    throw new Error("선택 영역의 DEM 타일을 읽지 못했습니다: " + detail);
                }
                self.loadedBounds = loadBounds;
                var failedCount = attempts.length - self.loadedTiles.length;
                self.lastStatus = {
                    state: "ready",
                    message: (manifest.dataSource ? manifest.dataSource + " · " : "") +
                        self.getSurfaceModel() + " " + self.loadedTiles.length + "개 타일 준비 완료" +
                        (failedCount ? " / " + failedCount + "개 NoData" : ""),
                    tileCount: self.loadedTiles.length, surfaceModel: self.getSurfaceModel(), cached: false
                };
                return self.lastStatus;
            });
        }).catch(function (error) {
            self.loadedTiles = [];
            self.loadedBounds = null;
            self.lastStatus = {
                state: "error", message: error.message || "DEM을 준비하지 못했습니다.", tileCount: 0
            };
            return self.lastStatus;
        }).then(function (status) {
            self.pending = null;
            return status;
        });
        this.pending = { bounds: loadBounds, promise: work };
        return work;
    };
    TerrainProvider.prototype.sample = function (lonLat) {
        for (var i = 0; i < this.loadedTiles.length; i++) {
            var tile = this.loadedTiles[i];
            if (lonLat[0] < tile.bounds[0] || lonLat[0] > tile.bounds[2] ||
                    lonLat[1] < tile.bounds[1] || lonLat[1] > tile.bounds[3]) continue;
            var bbox = tile.bbox;
            var x = Math.floor((lonLat[0] - bbox[0]) / (bbox[2] - bbox[0]) * tile.width);
            var y = Math.floor((bbox[3] - lonLat[1]) / (bbox[3] - bbox[1]) * tile.height);
            x = Math.max(0, Math.min(tile.width - 1, x));
            y = Math.max(0, Math.min(tile.height - 1, y));
            var value = Number(tile.data[y * tile.width + x]);
            if (!isFinite(value)) return null;
            if (tile.noData != null && Math.abs(value - tile.noData) < 1e-9) return null;
            return value;
        }
        return null;
    };
    global.GisTerrain = { TerrainProvider: TerrainProvider };
})(window);

