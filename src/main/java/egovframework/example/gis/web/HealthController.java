package egovframework.example.gis.web;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

/** 배포 플랫폼이 애플리케이션과 PostGIS 연결 상태를 확인하는 엔드포인트입니다. */
@Controller
public class HealthController {
    private static final Logger LOGGER = LoggerFactory.getLogger(HealthController.class);

    private final DataSource dataSource;

    @Autowired
    public HealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @RequestMapping(value = "/health.do", method = RequestMethod.GET,
            produces = "application/json;charset=UTF-8")
    @ResponseBody
    public ResponseEntity<String> health() {
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(3);
            try (ResultSet result = statement.executeQuery("SELECT 1")) {
                if (result.next() && result.getInt(1) == 1) {
                    return GisControllerSupport.jsonResponse(
                            HttpStatus.OK, "{\"status\":\"UP\",\"database\":\"UP\"}");
                }
            }
        } catch (SQLException ex) {
            LOGGER.warn("GIS health check database connection failed: sqlState={}",
                    ex.getSQLState());
        }
        return GisControllerSupport.jsonResponse(
                HttpStatus.SERVICE_UNAVAILABLE,
                "{\"status\":\"DOWN\",\"database\":\"DOWN\"}");
    }
}

