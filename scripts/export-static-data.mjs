import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const inputRoot = path.resolve(repositoryRoot, "..");
const outputRoot = path.join(repositoryRoot, "docs", "data");
const coverage = {
  center: [126.84139, 37.56833],
  bounds: [126.82139, 37.55033, 126.86139, 37.58633],
  label: "기본 관측점 주변 정적 데모 영역"
};

const tableInputs = {
  building: path.join(inputRoot, "building-data.sql"),
  landcover: path.join(inputRoot, "landcover-data.sql"),
  road: path.join(inputRoot, "road-data.sql"),
  water: path.join(inputRoot, "water-data.sql")
};

function requireInput(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`필요한 덤프 추출 파일이 없습니다: ${filePath}`);
  }
}

function readUInt32(buffer, state, littleEndian) {
  const value = littleEndian
    ? buffer.readUInt32LE(state.offset)
    : buffer.readUInt32BE(state.offset);
  state.offset += 4;
  return value;
}

function readDouble(buffer, state, littleEndian) {
  const value = littleEndian
    ? buffer.readDoubleLE(state.offset)
    : buffer.readDoubleBE(state.offset);
  state.offset += 8;
  return value;
}

function readGeometry(buffer, state = { offset: 0 }) {
  const littleEndian = buffer[state.offset++] === 1;
  const ewkbType = readUInt32(buffer, state, littleEndian);
  const hasSrid = (ewkbType & 0x20000000) !== 0;
  const geometryType = ewkbType & 0xff;
  if (hasSrid) readUInt32(buffer, state, littleEndian);

  const point = () => [
    readDouble(buffer, state, littleEndian),
    readDouble(buffer, state, littleEndian)
  ];
  const pointList = () => {
    const count = readUInt32(buffer, state, littleEndian);
    return Array.from({ length: count }, point);
  };

  if (geometryType === 1) return { type: "Point", coordinates: point() };
  if (geometryType === 2) return { type: "LineString", coordinates: pointList() };
  if (geometryType === 3) {
    const ringCount = readUInt32(buffer, state, littleEndian);
    return {
      type: "Polygon",
      coordinates: Array.from({ length: ringCount }, pointList)
    };
  }
  if (geometryType >= 4 && geometryType <= 6) {
    const count = readUInt32(buffer, state, littleEndian);
    const children = Array.from({ length: count }, () => readGeometry(buffer, state));
    const typeNames = { 4: "MultiPoint", 5: "MultiLineString", 6: "MultiPolygon" };
    return {
      type: typeNames[geometryType],
      coordinates: children.map((child) => child.coordinates)
    };
  }
  throw new Error(`지원하지 않는 EWKB geometry type: ${geometryType}`);
}

function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (value) => {
    if (Array.isArray(value) && value.length >= 2 &&
        Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      bounds[0] = Math.min(bounds[0], value[0]);
      bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]);
      bounds[3] = Math.max(bounds[3], value[1]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.coordinates);
  return bounds;
}

function intersects(left, right) {
  return left[0] <= right[2] && left[2] >= right[0] &&
    left[1] <= right[3] && left[3] >= right[1];
}

function decodeCopyValue(value) {
  if (value === "\\N") return null;
  return value.replace(/\\([btnrfv\\])/g, (_, code) => ({
    b: "\b", t: "\t", n: "\n", r: "\r", f: "\f", v: "\v", "\\": "\\"
  }[code]));
}

function parseCopyTable(filePath, tableName, onRow) {
  const text = fs.readFileSync(filePath, "utf8");
  const header = new RegExp(`COPY gis\\.${tableName} \\(([^)]+)\\) FROM stdin;\\r?\\n`);
  const match = header.exec(text);
  if (!match) throw new Error(`${tableName} COPY 헤더를 찾을 수 없습니다.`);
  const columns = match[1].split(",").map((column) => column.trim());
  let rowCount = 0;
  let selectedCount = 0;
  let offset = match.index + match[0].length;
  while (offset < text.length) {
    const nextLine = text.indexOf("\n", offset);
    const end = nextLine < 0 ? text.length : nextLine;
    let line = text.slice(offset, end);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    offset = end + 1;
    if (line === "\\.") break;
    if (!line) continue;
    const values = line.split("\t").map(decodeCopyValue);
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    rowCount += 1;
    if (onRow(row)) selectedCount += 1;
  }
  return { rowCount, selectedCount };
}

function numberOrNull(value) {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) =>
    item !== null && item !== undefined && item !== ""));
}

function addressFrom(tags) {
  const keys = ["addr:postcode", "addr:city", "addr:district", "addr:street", "addr:housenumber"];
  const address = keys.map((key) => tags[key]).filter(Boolean).join(" ").trim();
  return address || null;
}

function parseGeometry(hex) {
  return readGeometry(Buffer.from(hex, "hex"));
}

function exportBuildings() {
  const features = [];
  let latestData = "";
  const stats = parseCopyTable(tableInputs.building, "building", (row) => {
    const geometry = parseGeometry(row.footprint);
    if (!intersects(geometryBounds(geometry), coverage.bounds)) return false;
    const tags = row.tags ? JSON.parse(row.tags) : {};
    const explicitHeight = numberOrNull(row.height_m);
    const levels = numberOrNull(row.levels);
    const heightMeters = explicitHeight && explicitHeight > 0
      ? explicitHeight
      : levels && levels > 0
        ? Math.min(300, Math.max(2, levels * 3))
        : 10;
    const buildingId = `${row.osm_type}/${row.osm_id}`;
    const updatedAt = row.source_updated_at || row.imported_at || "";
    if (updatedAt > latestData) latestData = updatedAt;
    features.push({
      type: "Feature",
      id: buildingId,
      properties: compactObject({
        buildingId,
        name: row.name,
        buildingType: tags.building,
        heightMeters,
        heightEstimated: !(explicitHeight && explicitHeight > 0),
        heightSource: explicitHeight && explicitHeight > 0
          ? "height"
          : levels && levels > 0 ? "building:levels" : "default",
        minHeightMeters: numberOrNull(row.min_height_m),
        levels,
        address: addressFrom(tags),
        sourceUpdatedAt: row.source_updated_at,
        importedAt: row.imported_at,
        tags,
        additionalTags: tags
      }),
      geometry
    });
    return true;
  });
  return {
    data: {
      type: "FeatureCollection",
      features,
      metadata: {
        source: "OpenStreetMap / PostgreSQL / PostGIS 정적 내보내기",
        attribution: "© OpenStreetMap contributors",
        dataUpdatedAt: latestData,
        coverage
      }
    },
    stats
  };
}

function exportThematicLayer(tableName, geometryColumn, propertyFactory) {
  const features = [];
  const stats = parseCopyTable(tableInputs[tableName], tableName, (row) => {
    const geometry = parseGeometry(row[geometryColumn]);
    if (!intersects(geometryBounds(geometry), coverage.bounds)) return false;
    features.push({
      type: "Feature",
      id: `${tableName}/${row.osm_type}/${row.osm_id}`,
      properties: compactObject(propertyFactory(row)),
      geometry
    });
    return true;
  });
  return { collection: { type: "FeatureCollection", features }, stats };
}

for (const input of Object.values(tableInputs)) requireInput(input);
fs.mkdirSync(outputRoot, { recursive: true });

const buildings = exportBuildings();
const landcover = exportThematicLayer("landcover", "geom", (row) => ({
  landcoverType: row.landcover_type,
  name: row.name
}));
const water = exportThematicLayer("water", "geom", (row) => ({
  waterType: row.water_type,
  name: row.name
}));
const roads = exportThematicLayer("road", "geom", (row) => ({
  roadType: row.road_type,
  name: row.name,
  ref: row.ref,
  bridge: row.bridge,
  tunnel: row.tunnel
}));

fs.writeFileSync(
  path.join(outputRoot, "buildings.geojson"),
  JSON.stringify(buildings.data),
  "utf8"
);
fs.writeFileSync(
  path.join(outputRoot, "thematic-map.json"),
  JSON.stringify({
    type: "ThematicMap",
    landcover: landcover.collection,
    water: water.collection,
    roads: roads.collection,
    metadata: {
      source: "OpenStreetMap / PostgreSQL / PostGIS 정적 내보내기",
      attribution: "© OpenStreetMap contributors",
      coverage
    }
  }),
  "utf8"
);
fs.writeFileSync(
  path.join(outputRoot, "coverage.json"),
  JSON.stringify(coverage, null, 2),
  "utf8"
);

console.log(JSON.stringify({
  buildings: buildings.stats,
  landcover: landcover.stats,
  water: water.stats,
  roads: roads.stats,
  outputRoot
}, null, 2));
