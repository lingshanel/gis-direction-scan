package egovframework.example.gis.web;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * 브라우저가 Copernicus COG를 동일 출처로 읽을 수 있도록 Range 응답을 중계합니다.
 * 고정된 타일 ID와 최대 전송 크기를 함께 검사해 이 경로가 임의 URL 프록시가 되지 않게 합니다.
 */
@Controller
public class DemTileController {
    private static final Pattern TILE_ID = Pattern.compile("N(3[3-8])E(12[4-9]|13[01])");
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d+)-(\\d*)");
    private static final int MAX_RANGE_BYTES = 8 * 1024 * 1024;

    @RequestMapping(value = "/gis/dem.do", method = {RequestMethod.GET, RequestMethod.HEAD})
    public void dem(@RequestParam(value = "tile", required = false) String tile,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        Matcher tileMatcher = TILE_ID.matcher(tile == null ? "" : tile);
        if (!tileMatcher.matches()) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid DEM tile id");
            return;
        }

        int latitude = Integer.parseInt(tileMatcher.group(1));
        int longitude = Integer.parseInt(tileMatcher.group(2));
        String name = String.format("Copernicus_DSM_COG_10_N%02d_00_E%03d_00_DEM", latitude, longitude);
        URL remote = new URL("https://copernicus-dem-30m.s3.amazonaws.com/" + name + "/" + name + ".tif");
        final String range;
        try {
            range = validatedRange(request.getHeader("Range"));
        } catch (IllegalArgumentException ex) {
            response.sendError(HttpServletResponse.SC_REQUESTED_RANGE_NOT_SATISFIABLE,
                    "Invalid or oversized DEM byte range");
            return;
        }

        HttpURLConnection connection = (HttpURLConnection) remote.openConnection();
        connection.setConnectTimeout(7000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(request.getMethod());
        connection.setRequestProperty("Accept", "image/tiff,application/octet-stream");
        connection.setRequestProperty("User-Agent", "GisScan/2.0 (eGovFrame DEM viewshed)");
        if (range != null) connection.setRequestProperty("Range", range);

        try {
            int status = connection.getResponseCode();
            if (status != HttpServletResponse.SC_OK && status != HttpServletResponse.SC_PARTIAL_CONTENT) {
                response.sendError(status == HttpServletResponse.SC_NOT_FOUND ?
                        HttpServletResponse.SC_NOT_FOUND : HttpServletResponse.SC_BAD_GATEWAY,
                        "DEM source returned HTTP " + status);
                return;
            }
            long length = connection.getContentLengthLong();
            if (range == null && "GET".equals(request.getMethod()) && length > MAX_RANGE_BYTES) {
                response.sendError(HttpServletResponse.SC_REQUESTED_RANGE_NOT_SATISFIABLE,
                        "Range header is required for DEM COG access");
                return;
            }
            if ("GET".equals(request.getMethod()) && length > MAX_RANGE_BYTES) {
                response.sendError(HttpServletResponse.SC_REQUESTED_RANGE_NOT_SATISFIABLE,
                        "Requested DEM range is too large");
                return;
            }

            response.setStatus(status);
            response.setContentType("image/tiff");
            response.setHeader("Accept-Ranges", "bytes");
            response.setHeader("Cache-Control", "public, max-age=86400");
            copyHeader(connection, response, "Content-Range");
            copyHeader(connection, response, "ETag");
            copyHeader(connection, response, "Last-Modified");
            if (length >= 0) response.setContentLengthLong(length);
            if ("HEAD".equals(request.getMethod())) return;

            try (InputStream input = connection.getInputStream(); OutputStream output = response.getOutputStream()) {
                byte[] buffer = new byte[32768];
                int read;
                int total = 0;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_RANGE_BYTES) throw new IOException("DEM range exceeded limit");
                    output.write(buffer, 0, read);
                }
            }
        } finally {
            connection.disconnect();
        }
    }

    private static String validatedRange(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        Matcher matcher = RANGE.matcher(raw.trim());
        if (!matcher.matches()) throw new IllegalArgumentException("Unsupported Range header");

        try {
            long start = Long.parseLong(matcher.group(1));
            if (matcher.group(2).isEmpty()) {
                if (start > Long.MAX_VALUE - MAX_RANGE_BYTES + 1) {
                    throw new IllegalArgumentException("Range end exceeds long capacity");
                }
                return "bytes=" + start + "-" + (start + MAX_RANGE_BYTES - 1);
            }

            long end = Long.parseLong(matcher.group(2));
            // 두 값이 모두 음수가 아니므로 차이를 먼저 비교하면 +1 오버플로도 피할 수 있습니다.
            if (end < start || end - start >= MAX_RANGE_BYTES) {
                throw new IllegalArgumentException("Range exceeds the supported window");
            }
            return "bytes=" + start + "-" + end;
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("Range number exceeds long capacity", ex);
        }
    }

    private static void copyHeader(HttpURLConnection source, HttpServletResponse target, String name) {
        String value = source.getHeaderField(name);
        if (value != null) target.setHeader(name, value);
    }
}
