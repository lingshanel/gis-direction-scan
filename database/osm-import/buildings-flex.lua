local buildings = osm2pgsql.define_area_table('building_stage', {
    { column = 'name', type = 'text' },
    { column = 'tags', type = 'jsonb', not_null = true },
    { column = 'source_updated_at', type = 'timestamptz' },
    { column = 'geom', type = 'multipolygon', projection = 4326, not_null = true },
}, {
    schema = 'gis_import',
})

local waters = osm2pgsql.define_area_table('water_stage', {
    { column = 'name', type = 'text' },
    { column = 'water_type', type = 'text' },
    { column = 'tags', type = 'jsonb', not_null = true },
    { column = 'source_updated_at', type = 'timestamptz' },
    { column = 'geom', type = 'multipolygon', projection = 4326, not_null = true },
}, {
    schema = 'gis_import',
})

local landcovers = osm2pgsql.define_area_table('landcover_stage', {
    { column = 'name', type = 'text' },
    { column = 'landcover_type', type = 'text', not_null = true },
    { column = 'tags', type = 'jsonb', not_null = true },
    { column = 'source_updated_at', type = 'timestamptz' },
    { column = 'geom', type = 'multipolygon', projection = 4326, not_null = true },
}, {
    schema = 'gis_import',
})

local roads = osm2pgsql.define_way_table('road_stage', {
    { column = 'name', type = 'text' },
    { column = 'ref', type = 'text' },
    { column = 'road_type', type = 'text', not_null = true },
    { column = 'bridge', type = 'text' },
    { column = 'tunnel', type = 'text' },
    { column = 'layer', type = 'text' },
    { column = 'tags', type = 'jsonb', not_null = true },
    { column = 'source_updated_at', type = 'timestamptz' },
    { column = 'geom', type = 'linestring', projection = 4326, not_null = true },
}, {
    schema = 'gis_import',
})

local function insert_building(object)
    local building_type = object.tags.building
    if building_type == nil or building_type == 'no' then
        return
    end

    local geom = object:as_multipolygon()
    if geom:is_null() then
        return
    end

    buildings:insert({
        name = object.tags.name,
        tags = object.tags,
        source_updated_at = object.timestamp,
        geom = geom,
    })
end

local function water_type(tags)
    if tags.natural == 'water' or tags.natural == 'bay' then
        return tags.water or tags.natural
    end
    if tags.waterway == 'riverbank' then
        return tags.water or tags.waterway
    end
    if tags.landuse == 'reservoir' or tags.water == 'reservoir' then
        return 'reservoir'
    end
    return nil
end

local function insert_water(object)
    local kind = water_type(object.tags)
    if kind == nil then
        return
    end

    local geom = object:as_multipolygon()
    if geom:is_null() then
        return
    end

    waters:insert({
        name = object.tags.name,
        water_type = kind,
        tags = object.tags,
        source_updated_at = object.timestamp,
        geom = geom,
    })
end

local function landcover_type(tags)
    if tags.natural == 'wood' or tags.landuse == 'forest' then
        return 'forest'
    end
    if tags.leisure == 'park' or tags.leisure == 'garden' or
            tags.leisure == 'nature_reserve' or tags.landuse == 'recreation_ground' then
        return 'park'
    end
    if tags.natural == 'grassland' or tags.landuse == 'grass' or
            tags.landuse == 'meadow' then
        return 'grass'
    end
    if tags.landuse == 'residential' then
        return 'residential'
    end
    if tags.landuse == 'commercial' or tags.landuse == 'retail' then
        return 'commercial'
    end
    if tags.landuse == 'industrial' then
        return 'industrial'
    end
    if tags.landuse == 'farmland' or tags.landuse == 'farmyard' or
            tags.landuse == 'orchard' or tags.landuse == 'vineyard' then
        return 'farmland'
    end
    if tags.natural == 'wetland' then
        return 'wetland'
    end
    if tags.natural == 'scrub' or tags.natural == 'heath' then
        return 'scrub'
    end
    if tags.natural == 'bare_rock' or tags.natural == 'scree' or
            tags.natural == 'sand' or tags.natural == 'beach' or
            tags.landuse == 'quarry' then
        return 'bare'
    end
    if tags.landuse == 'construction' or tags.landuse == 'brownfield' then
        return 'construction'
    end
    if tags.landuse == 'cemetery' then
        return 'cemetery'
    end
    return nil
end

local function insert_landcover(object)
    local kind = landcover_type(object.tags)
    if kind == nil then
        return
    end

    local geom = object:as_multipolygon()
    if geom:is_null() then
        return
    end

    landcovers:insert({
        name = object.tags.name,
        landcover_type = kind,
        tags = object.tags,
        source_updated_at = object.timestamp,
        geom = geom,
    })
end

local major_road_types = {
    motorway = true,
    motorway_link = true,
    trunk = true,
    trunk_link = true,
    primary = true,
    primary_link = true,
    secondary = true,
    secondary_link = true,
    tertiary = true,
    tertiary_link = true,
}

local function insert_road(object)
    local kind = object.tags.highway
    if kind == nil or major_road_types[kind] ~= true then
        return
    end

    local geom = object:as_linestring()
    if geom:is_null() then
        return
    end

    roads:insert({
        name = object.tags.name,
        ref = object.tags.ref,
        road_type = kind,
        bridge = object.tags.bridge,
        tunnel = object.tags.tunnel,
        layer = object.tags.layer,
        tags = object.tags,
        source_updated_at = object.timestamp,
        geom = geom,
    })
end

function osm2pgsql.process_way(object)
    insert_road(object)
    if not object.is_closed then
        return
    end
    insert_building(object)
    insert_water(object)
    insert_landcover(object)
end

function osm2pgsql.process_relation(object)
    if object.tags.type ~= 'multipolygon' then
        return
    end
    insert_building(object)
    insert_water(object)
    insert_landcover(object)
end
