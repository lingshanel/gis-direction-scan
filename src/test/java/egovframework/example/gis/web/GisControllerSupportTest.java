package egovframework.example.gis.web;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class GisControllerSupportTest {

    @Test
    public void acceptsSupportedSpatialQuery() {
        GisControllerSupport.SpatialQuery query =
                GisControllerSupport.parseSpatialQuery("37.5665", "126.9780", "300", 100, 500);

        assertEquals(37.5665, query.getLatitude(), 0.000001);
        assertEquals(126.9780, query.getLongitude(), 0.000001);
        assertEquals(300, query.getRadiusMeters());
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsRadiusOutsideSupportedRange() {
        GisControllerSupport.parseSpatialQuery("37.5665", "126.9780", "501", 100, 500);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsCoordinatesOutsideSupportedArea() {
        GisControllerSupport.parseSpatialQuery("0", "0", "300", 100, 500);
    }
}

