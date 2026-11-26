\set ON_ERROR_STOP on

BEGIN;

DO $safety$
DECLARE
    staged_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO staged_count
    FROM gis_import.water_stage;

    IF staged_count < 10 THEN
        RAISE EXCEPTION 'Staging table has only % water areas; merge cancelled for safety', staged_count;
    END IF;
END
$safety$;

LOCK TABLE gis.water IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM gis.water AS target
WHERE target.osm_type IN ('way', 'relation')
  AND ST_Intersects(
      target.geom,
      ST_MakeEnvelope(126.73, 37.41, 127.27, 37.72, 4326)
  );

WITH source_data AS (
    SELECT
        CASE WHEN area_id < 0 THEN 'relation' ELSE 'way' END AS osm_type,
        ABS(area_id) AS osm_id,
        water_type,
        name,
        tags,
        source_updated_at,
        ST_Multi(
            ST_CollectionExtract(ST_MakeValid(geom), 3)
        )::geometry(MultiPolygon, 4326) AS geom
    FROM gis_import.water_stage
    WHERE ST_Intersects(
        geom,
        ST_MakeEnvelope(126.73, 37.41, 127.27, 37.72, 4326)
    )
),
valid_water AS (
    SELECT *
    FROM source_data
    WHERE NOT ST_IsEmpty(geom)
)
INSERT INTO gis.water (
    osm_type,
    osm_id,
    water_type,
    name,
    tags,
    geom,
    source_updated_at,
    imported_at
)
SELECT
    osm_type,
    osm_id,
    water_type,
    name,
    tags,
    geom,
    source_updated_at,
    CURRENT_TIMESTAMP
FROM valid_water
ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    water_type = EXCLUDED.water_type,
    name = EXCLUDED.name,
    tags = EXCLUDED.tags,
    geom = EXCLUDED.geom,
    source_updated_at = EXCLUDED.source_updated_at,
    imported_at = EXCLUDED.imported_at;

ANALYZE gis.water;

COMMIT;

SELECT
    COUNT(*) AS water_count,
    COUNT(*) FILTER (WHERE water_type = 'river') AS river_count,
    COUNT(*) FILTER (WHERE water_type = 'reservoir') AS reservoir_count
FROM gis.water;
