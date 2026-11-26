import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(root, "src", "main", "webapp");
const pagesSource = path.join(root, "pages-src");
const docs = path.join(root, "docs");
const krdsCandidates = [
  process.env.KRDS_RESOURCES,
  process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, "Downloads", "krds-uiux-main", "krds-uiux-main", "resources")
    : null
].filter(Boolean);
const krds = krdsCandidates.find((candidate) => fs.existsSync(candidate));

function copyDirectory(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const jspPath = path.join(webRoot, "map.jsp");
const fragmentPath = path.join(webRoot, "WEB-INF", "jsp", "gis", "fragments", "map-content.jsp");
let page = fs.readFileSync(jspPath, "utf8");
let fragment = fs.readFileSync(fragmentPath, "utf8")
  .replace(/^<%@[^%]*%>\s*/m, "")
  .replace(/<%--[\s\S]*?--%>/g, "")
  .replace(/<%=request\.getContextPath\(\)%>/g, ".");

page = page
  .replace(/^<%@[^%]*%>\s*/m, "")
  .replace(/^<%[\s\S]*?%>\s*/m, "")
  .replace(/<%@ include file="\/WEB-INF\/jsp\/gis\/fragments\/map-content\.jsp"%>/, fragment)
  .replace(/<%=request\.getContextPath\(\)%>/g, ".")
  .replace(/<%=cesiumIonToken%>/g, "")
  .replace("<html lang=\"ko\">", "<html lang=\"ko\" data-krds-mode=\"light\">")
  .replace("<title>GIS 방향 스캔</title>", "<title>GIS 360° 방향 스캔 | 정적 데모</title>")
  .replace("<link rel=\"stylesheet\"\n\t\thref=\"./css/gis/gis-scan.css?v=20261013-4\">",
    "<link rel=\"stylesheet\" href=\"./krds/krds.min.css\">\n" +
    "<link rel=\"stylesheet\" href=\"./css/gis/gis-scan.css?v=20261013-4\">\n" +
    "<link rel=\"stylesheet\" href=\"./css/krds-gis-overrides.css?v=20261127-1\">")
  .replace("<body>", "<body>\n" +
    "<aside class=\"static-demo-notice\" aria-label=\"정적 데모 안내\">" +
    "<div><strong>GitHub Pages 정적 GIS 데모</strong>" +
    "<span>표시된 데모 영역에서 관측점을 선택해 방향 스캔을 실행할 수 있습니다.</span></div></aside>")
  .replace("src=\"./js/gis/app/json-api.js?v=20261001-1\"></script>",
    "src=\"./js/gis/app/json-api.js?v=20261001-1\"></script>\n" +
    "<script src=\"./js/gis/app/static-data-api.js?v=20261127-1\"></script>")
  .replace("id=\"scanButton\" type=\"button\"", "id=\"scanButton\" class=\"krds-btn primary\" type=\"button\"")
  .replace("id=\"toggleRadiusButton\" type=\"button\"", "id=\"toggleRadiusButton\" class=\"krds-btn secondary\" type=\"button\"")
  .replace("</body>", "<script src=\"./krds/krds.min.js\"></script>\n</body>");

copyDirectory(path.join(webRoot, "js", "gis"), path.join(docs, "js", "gis"));
copyDirectory(path.join(webRoot, "css", "gis"), path.join(docs, "css", "gis"));
copyDirectory(path.join(webRoot, "images"), path.join(docs, "images"));
copyFile(path.join(pagesSource, "static-data-api.js"), path.join(docs, "js", "gis", "app", "static-data-api.js"));
copyFile(path.join(pagesSource, "krds-gis-overrides.css"), path.join(docs, "css", "krds-gis-overrides.css"));
if (krds) {
  copyFile(path.join(krds, "cdn", "krds.min.css"), path.join(docs, "krds", "krds.min.css"));
  copyFile(path.join(krds, "cdn", "krds.min.js"), path.join(docs, "krds", "krds.min.js"));
  copyDirectory(path.join(krds, "fonts"), path.join(docs, "krds", "fonts"));
} else if (!fs.existsSync(path.join(docs, "krds", "krds.min.css"))) {
  throw new Error("KRDS resources were not found. Set KRDS_RESOURCES or place the unpacked package in Downloads.");
}

const demName = "Copernicus_DSM_COG_10_N37_00_E126_00_DEM";
fs.mkdirSync(path.join(docs, "dem"), { recursive: true });
fs.writeFileSync(path.join(docs, "dem", "dem-index.json"), JSON.stringify({
  version: 1,
  crs: "EPSG:4326",
  surfaceModel: "DSM",
  dataSource: "Copernicus DEM GLO-30 Public (DSM), 2021",
  attribution: "© DLR e.V. / Airbus Defence and Space / European Union / ESA",
  noData: -32767,
  tiles: [{
    id: "N37E126",
    url: "./tiles/N37E126.tif",
    bounds: [126, 37, 127, 38],
    band: 0,
    noData: -32767
  }]
}, null, 2), "utf8");

fs.writeFileSync(path.join(docs, "index.html"), page, "utf8");
fs.writeFileSync(path.join(docs, ".nojekyll"), "", "utf8");
console.log(`GitHub Pages demo built: ${path.join(docs, "index.html")}`);
