\set ON_ERROR_STOP on

\if :{?runtime_role}
\else
\echo 'runtime_role 변수가 필요합니다.'
\quit 3
\endif

GRANT USAGE ON SCHEMA gis TO :"runtime_role";
GRANT SELECT ON ALL TABLES IN SCHEMA gis TO :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA gis TO :"runtime_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA gis
    GRANT SELECT ON TABLES TO :"runtime_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA gis
    GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";

