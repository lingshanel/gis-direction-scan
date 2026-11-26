\set ON_ERROR_STOP on

BEGIN;

DO $safety$
DECLARE
    staged_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO staged_count
    FROM gis_import.landcover_stage;

    IF staged_count < 100 THEN
        RAISE EXCEPTION 'Staging table has only % landcover areas; merge cancelled for safety', staged_count;
    END IF;
END
$safety$;

LOCK TABLE gis.landcover IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM gis.landcover AS target
WHERE target.osm_type IN ('way', 'relation')
  AND ST_Intersects(
      target.geom,
      ST_MakeEnvelope(126.73, 37.41, 127.27, 37.72, 4326)
  );

WITH source_data AS (
    SELECT
        CASE WHEN area_id < 0 THEN 'relation' ELSE 'way' END AS osm_type,
        ABS(area_id) AS osm_id,
        landcover_type,
        name,
        tags,
        source_updated_at,
        ST_Multi(
            ST_CollectionExtract(ST_MakeValid(geom), 3)
        )::geometry(MultiPolygon, 4326) AS geom
    FROM gis_import.landcover_stage
    WHERE ST_Intersects(
        geom,
        ST_MakeEnvelope(126.73, 37.41, 127.27, 37.72, 4326)
    )
),
valid_landcover AS (
    SELECT *
    FROM source_data
    WHERE NOT ST_IsEmpty(geom)
)
INSERT INTO gis.landcover (
    osm_type,
    osm_id,
    landcover_type,
    name,
    tags,
    geom,
    source_updated_at,
    imported_at
)
SELECT
    osm_type,
    osm_id,
    landcover_type,
    name,
    tags,
    geom,
    source_updated_at,
    CURRENT_TIMESTAMP
FROM valid_landcover
ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    landcover_type = EXCLUDED.landcover_type,
    name = EXCLUDED.name,
    tags = EXCLUDED.tags,
    geom = EXCLUDED.geom,
    source_updated_at = EXCLUDED.source_updated_at,
    imported_at = EXCLUDED.imported_at;

ANALYZE gis.landcover;

COMMIT;

SELECT landcover_type, COUNT(*) AS feature_count
FROM gis.landcover
GROUP BY landcover_type
ORDER BY landcover_type;
