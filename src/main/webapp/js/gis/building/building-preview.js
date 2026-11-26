(function (global) {
    "use strict";

    function finiteNumber(value, fallback) {
        var number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function create(canvas) {
        var context = canvas.getContext("2d");

        function clear() {
            context.clearRect(0, 0, canvas.width, canvas.height);
        }

        function exteriorRings(feature) {
            var geometry = feature && feature.getGeometry ? feature.getGeometry() : null;
            if (!geometry) return [];
            if (geometry.getType() === "Polygon") {
                return [geometry.getCoordinates()[0]];
            }
            if (geometry.getType() === "MultiPolygon") {
                return geometry.getCoordinates().map(function (polygon) {
                    return polygon[0];
                });
            }
            return [];
        }

        function cleanRing(ring) {
            var points = (ring || []).filter(function (coordinate) {
                return Array.isArray(coordinate) &&
                    Number.isFinite(Number(coordinate[0])) &&
                    Number.isFinite(Number(coordinate[1]));
            });
            if (points.length > 1 && points[0][0] === points[points.length - 1][0] &&
                    points[0][1] === points[points.length - 1][1]) {
                points = points.slice(0, -1);
            }
            if (points.length <= 72) return points;
            var step = Math.ceil(points.length / 72);
            return points.filter(function (_, index) { return index % step === 0; });
        }

        function path(points, offsetY) {
            if (points.length < 3) return;
            context.beginPath();
            context.moveTo(points[0].x, points[0].y + offsetY);
            points.slice(1).forEach(function (point) {
                context.lineTo(point.x, point.y + offsetY);
            });
            context.closePath();
        }

        function fallbackRings() {
            return [[
                [-32, -20], [24, -20], [32, -7], [17, 15],
                [-21, 19], [-36, 4], [-32, -20]
            ]];
        }

        function render(feature, heightMeters) {
            clear();
            var rings = exteriorRings(feature).map(cleanRing).filter(function (ring) {
                return ring.length >= 3;
            });
            if (rings.length === 0) rings = fallbackRings().map(cleanRing);

            var allCoordinates = [].concat.apply([], rings);
            var center = allCoordinates.reduce(function (result, coordinate) {
                result[0] += Number(coordinate[0]);
                result[1] += Number(coordinate[1]);
                return result;
            }, [0, 0]).map(function (value) {
                return value / allCoordinates.length;
            });

            var projected = rings.map(function (ring) {
                return ring.map(function (coordinate) {
                    var x = Number(coordinate[0]) - center[0];
                    var y = Number(coordinate[1]) - center[1];
                    return {
                        x: x * 0.86 - y * 0.52,
                        y: x * 0.28 + y * 0.42
                    };
                });
            });
            var allProjected = [].concat.apply([], projected);
            var minX = Math.min.apply(null, allProjected.map(function (point) { return point.x; }));
            var maxX = Math.max.apply(null, allProjected.map(function (point) { return point.x; }));
            var minY = Math.min.apply(null, allProjected.map(function (point) { return point.y; }));
            var maxY = Math.max.apply(null, allProjected.map(function (point) { return point.y; }));
            var spanX = Math.max(1, maxX - minX);
            var spanY = Math.max(1, maxY - minY);
            var height = Math.max(22, Math.min(64,
                20 + finiteNumber(heightMeters, 10) * 0.72));
            var scale = Math.min(
                (canvas.width - 28) / spanX,
                (canvas.height - height - 26) / spanY
            );
            var usedWidth = spanX * scale;
            var offsetX = (canvas.width - usedWidth) / 2 - minX * scale;
            var offsetY = 11 - minY * scale;
            var screenRings = projected.map(function (ring) {
                return ring.map(function (point) {
                    return {
                        x: point.x * scale + offsetX,
                        y: point.y * scale + offsetY
                    };
                });
            });

            context.save();
            context.shadowColor = "rgba(55, 77, 68, .18)";
            context.shadowBlur = 14;
            context.shadowOffsetY = 7;
            screenRings.forEach(function (ring) {
                path(ring, height + 4);
                context.fillStyle = "rgba(47, 120, 103, .13)";
                context.fill();
            });
            context.restore();

            var sideFaces = [];
            screenRings.forEach(function (ring) {
                ring.forEach(function (point, index) {
                    var next = ring[(index + 1) % ring.length];
                    sideFaces.push({
                        points: [point, next],
                        depth: (point.y + next.y) / 2,
                        light: next.x >= point.x
                    });
                });
            });
            sideFaces.sort(function (left, right) { return left.depth - right.depth; });
            sideFaces.forEach(function (face) {
                var first = face.points[0];
                var second = face.points[1];
                context.beginPath();
                context.moveTo(first.x, first.y);
                context.lineTo(second.x, second.y);
                context.lineTo(second.x, second.y + height);
                context.lineTo(first.x, first.y + height);
                context.closePath();
                context.fillStyle = face.light ? "#d7d9d5" : "#c5c8c5";
                context.fill();
            });

            var roofGradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
            roofGradient.addColorStop(0, "#fffefa");
            roofGradient.addColorStop(1, "#e8e8e3");
            screenRings.forEach(function (ring) {
                path(ring, 0);
                context.fillStyle = roofGradient;
                context.fill();
                context.strokeStyle = "rgba(74, 91, 84, .2)";
                context.lineWidth = 1.4;
                context.stroke();
            });
        }

        return { clear: clear, render: render };
    }

    global.GisBuildingPreview = { create: create };
})(window);
