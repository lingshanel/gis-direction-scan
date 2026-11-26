\set ON_ERROR_STOP on

BEGIN;

DO $safety$
DECLARE
    staged_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO staged_count
    FROM gis_import.building_stage;

    IF staged_count < 1000 THEN
        RAISE EXCEPTION 'Staging table has only % buildings; merge cancelled for safety', staged_count;
    END IF;
END
$safety$;

LOCK TABLE gis.building IN SHARE ROW EXCLUSIVE MODE;

-- 서울을 빠짐없이 포함하도록 행정경계보다 약간 넓은 영역을 교체합니다.
DELETE FROM gis.building AS target
WHERE target.osm_type IN ('way', 'relation')
  AND ST_Intersects(
      target.footprint,
      ST_MakeEnvelope(126.73, 37.41, 127.27, 37.72, 4326)
  );

WITH source_data AS (
    SELECT
        CASE WHEN area_id < 0 THEN 'relation' ELSE 'way' END AS osm_type,
        ABS(area_id) AS osm_id,
        tags,
        name,
        source_updated_at,
        ST_Multi(
            ST_CollectionExtract(ST_MakeValid(geom), 3)
        )::geometry(MultiPolygon, 4326) AS footprint,
        REPLACE(
            (regexp_match(tags ->> 'height', '([0-9]+([.,][0-9]+)?)'))[1],
            ',', '.'
        )::double precision AS parsed_height,
        REPLACE(
            (regexp_match(tags ->> 'min_height', '([0-9]+([.,][0-9]+)?)'))[1],
            ',', '.'
        )::double precision AS parsed_min_height,
        REPLACE(
            (regexp_match(tags ->> 'building:levels', '([0-9]+([.,][0-9]+)?)'))[1],
            ',', '.'
        )::double precision AS parsed_levels
    FROM gis_import.building_stage
    WHERE ST_Intersects(
        geom,
        ST_MakeEnvelope(126.73, 37.41, 127.27, 37.72, 4326)
    )
),
valid_buildings AS (
    SELECT *
    FROM source_data
    WHERE NOT ST_IsEmpty(footprint)
)
INSERT INTO gis.building (
    osm_type,
    osm_id,
    footprint,
    height_m,
    min_height_m,
    levels,
    name,
    tags,
    source_updated_at,
    imported_at
)
SELECT
    osm_type,
    osm_id,
    footprint,
    parsed_height,
    COALESCE(parsed_min_height, 0),
    parsed_levels,
    name,
    tags,
    source_updated_at,
    CURRENT_TIMESTAMP
FROM valid_buildings
ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    footprint = EXCLUDED.footprint,
    height_m = EXCLUDED.height_m,
    min_height_m = EXCLUDED.min_height_m,
    levels = EXCLUDED.levels,
    name = EXCLUDED.name,
    tags = EXCLUDED.tags,
    source_updated_at = EXCLUDED.source_updated_at,
    imported_at = EXCLUDED.imported_at;

ANALYZE gis.building;

COMMIT;

SELECT
    COUNT(*) AS building_count,
    COUNT(*) FILTER (WHERE height_m IS NOT NULL) AS explicit_height_count,
    COUNT(*) FILTER (WHERE height_m IS NULL AND levels IS NOT NULL) AS levels_only_count
FROM gis.building;
