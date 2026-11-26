\set ON_ERROR_STOP on

BEGIN;

DO $safety$
DECLARE
    staged_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO staged_count
    FROM gis_import.road_stage;

    IF staged_count < 100 THEN
        RAISE EXCEPTION 'Staging table has only % major roads; merge cancelled for safety', staged_count;
    END IF;
END
$safety$;

LOCK TABLE gis.road IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM gis.road AS target
WHERE target.osm_type = 'way'
  AND ST_Intersects(
      target.geom,
      ST_MakeEnvelope(126.73, 37.41, 127.27, 37.72, 4326)
  );

WITH source_data AS (
    SELECT
        'way'::text AS osm_type,
        way_id AS osm_id,
        road_type,
        name,
        ref,
        bridge,
        tunnel,
        layer,
        tags,
        source_updated_at,
        ST_Multi(
            ST_CollectionExtract(ST_MakeValid(geom), 2)
        )::geometry(MultiLineString, 4326) AS geom
    FROM gis_import.road_stage
    WHERE ST_Intersects(
        geom,
        ST_MakeEnvelope(126.73, 37.41, 127.27, 37.72, 4326)
    )
),
valid_roads AS (
    SELECT *
    FROM source_data
    WHERE NOT ST_IsEmpty(geom)
)
INSERT INTO gis.road (
    osm_type,
    osm_id,
    road_type,
    name,
    ref,
    bridge,
    tunnel,
    layer,
    tags,
    geom,
    source_updated_at,
    imported_at
)
SELECT
    osm_type,
    osm_id,
    road_type,
    name,
    ref,
    bridge,
    tunnel,
    layer,
    tags,
    geom,
    source_updated_at,
    CURRENT_TIMESTAMP
FROM valid_roads
ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    road_type = EXCLUDED.road_type,
    name = EXCLUDED.name,
    ref = EXCLUDED.ref,
    bridge = EXCLUDED.bridge,
    tunnel = EXCLUDED.tunnel,
    layer = EXCLUDED.layer,
    tags = EXCLUDED.tags,
    geom = EXCLUDED.geom,
    source_updated_at = EXCLUDED.source_updated_at,
    imported_at = EXCLUDED.imported_at;

ANALYZE gis.road;

COMMIT;

SELECT road_type, COUNT(*) AS feature_count
FROM gis.road
GROUP BY road_type
ORDER BY road_type;
