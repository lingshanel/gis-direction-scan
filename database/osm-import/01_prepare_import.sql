\if :{?import_role}
\else
\set import_role gis_scan_app
\endif

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS gis_import AUTHORIZATION :"import_role";
ALTER SCHEMA gis_import OWNER TO :"import_role";
GRANT USAGE, CREATE ON SCHEMA gis_import TO :"import_role";

GRANT USAGE ON SCHEMA gis TO :"import_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE gis.building TO :"import_role";

CREATE TABLE IF NOT EXISTS gis.water (
    osm_type VARCHAR(16) NOT NULL,
    osm_id BIGINT NOT NULL,
    water_type TEXT NOT NULL,
    name TEXT,
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    source_updated_at TIMESTAMPTZ,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT water_pkey PRIMARY KEY (osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS water_geom_gix
    ON gis.water USING GIST (geom);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE gis.water TO :"import_role";

CREATE TABLE IF NOT EXISTS gis.landcover (
    osm_type VARCHAR(16) NOT NULL,
    osm_id BIGINT NOT NULL,
    landcover_type TEXT NOT NULL,
    name TEXT,
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    source_updated_at TIMESTAMPTZ,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT landcover_pkey PRIMARY KEY (osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS landcover_geom_gix
    ON gis.landcover USING GIST (geom);
CREATE INDEX IF NOT EXISTS landcover_type_idx
    ON gis.landcover (landcover_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE gis.landcover TO :"import_role";

CREATE TABLE IF NOT EXISTS gis.road (
    osm_type VARCHAR(16) NOT NULL,
    osm_id BIGINT NOT NULL,
    road_type TEXT NOT NULL,
    name TEXT,
    ref TEXT,
    bridge TEXT,
    tunnel TEXT,
    layer TEXT,
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    geom geometry(MultiLineString, 4326) NOT NULL,
    source_updated_at TIMESTAMPTZ,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT road_pkey PRIMARY KEY (osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS road_geom_gix
    ON gis.road USING GIST (geom);
CREATE INDEX IF NOT EXISTS road_type_idx
    ON gis.road (road_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE gis.road TO :"import_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA gis TO :"import_role";
