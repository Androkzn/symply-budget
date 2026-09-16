-- Migration: Add waste_regulations field and seed GVA municipalities
-- Date: 2026-01-30

-- Step 1: Add waste_regulations column to municipality_configs
-- Already-migrated remotes have this column (it was added when this file
-- originally ran, before someone commented it out "defensively"); a fresh
-- database never gets it without this statement, breaking the seed below.
ALTER TABLE municipality_configs ADD COLUMN waste_regulations TEXT;

-- Step 2: Seed 14 Greater Vancouver Area municipalities with waste regulations
-- Each municipality includes links to their official waste regulations

-- Vancouver
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_vancouver',
  'Vancouver',
  'VAN',
  'City of Vancouver',
  'https://vancouver.ca/home-property-development/garbage-and-recycling-collection-schedules.aspx',
  json('{"garbage":[{"title":"Garbage Collection Schedule","url":"https://vancouver.ca/home-property-development/garbage-and-recycling-collection-schedules.aspx"},{"title":"What Goes in Garbage","url":"https://vancouver.ca/home-property-development/garbage.aspx"}],"recycling":[{"title":"Recycling Guidelines","url":"https://vancouver.ca/home-property-development/recycling.aspx"},{"title":"Blue Box Recycling","url":"https://vancouver.ca/home-property-development/blue-box-recycling.aspx"}],"organics":[{"title":"Green Bin Organics","url":"https://vancouver.ca/home-property-development/food-scraps-and-yard-trimmings.aspx"},{"title":"Composting Guide","url":"https://vancouver.ca/home-property-development/composting.aspx"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- Burnaby
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_burnaby',
  'Burnaby',
  'BUR',
  'City of Burnaby',
  'https://www.burnaby.ca/services-and-payments/garbage-and-recycling',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.burnaby.ca/services-and-payments/garbage-and-recycling/garbage-collection"},{"title":"Garbage Guidelines","url":"https://www.burnaby.ca/services-and-payments/garbage-and-recycling"}],"recycling":[{"title":"Recycling Collection","url":"https://www.burnaby.ca/services-and-payments/garbage-and-recycling/recycling"},{"title":"What to Recycle","url":"https://www.burnaby.ca/services-and-payments/garbage-and-recycling/recycling"}],"organics":[{"title":"Organics Collection","url":"https://www.burnaby.ca/services-and-payments/garbage-and-recycling/food-scraps-and-yard-waste"},{"title":"Green Bin Program","url":"https://www.burnaby.ca/services-and-payments/garbage-and-recycling"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- Surrey
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_surrey',
  'Surrey',
  'SUR',
  'City of Surrey',
  'https://www.surrey.ca/services-payments/garbage-recycling-yard-waste',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.surrey.ca/services-payments/garbage-recycling-yard-waste/garbage"},{"title":"Garbage Schedule","url":"https://www.surrey.ca/services-payments/garbage-recycling-yard-waste"}],"recycling":[{"title":"Recycling Program","url":"https://www.surrey.ca/services-payments/garbage-recycling-yard-waste/recycling"},{"title":"Blue Box Recycling","url":"https://www.surrey.ca/services-payments/garbage-recycling-yard-waste"}],"organics":[{"title":"Green Waste Collection","url":"https://www.surrey.ca/services-payments/garbage-recycling-yard-waste/yard-waste"},{"title":"Organics Guidelines","url":"https://www.surrey.ca/services-payments/garbage-recycling-yard-waste"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- Richmond
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_richmond',
  'Richmond',
  'RIC',
  'City of Richmond',
  'https://www.richmond.ca/services/recycling.htm',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.richmond.ca/services/recycling/garbage.htm"},{"title":"Waste Guidelines","url":"https://www.richmond.ca/services/recycling.htm"}],"recycling":[{"title":"Recycling Services","url":"https://www.richmond.ca/services/recycling/recycling.htm"},{"title":"Blue Box Program","url":"https://www.richmond.ca/services/recycling.htm"}],"organics":[{"title":"Organics Collection","url":"https://www.richmond.ca/services/recycling/organics.htm"},{"title":"Green Cart Program","url":"https://www.richmond.ca/services/recycling.htm"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- Coquitlam
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_coquitlam',
  'Coquitlam',
  'COQ',
  'City of Coquitlam',
  'https://www.coquitlam.ca/481/Garbage-Recycling',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.coquitlam.ca/481/Garbage-Recycling"},{"title":"Waste Guidelines","url":"https://www.coquitlam.ca/481/Garbage-Recycling"}],"recycling":[{"title":"Recycling Program","url":"https://www.coquitlam.ca/481/Garbage-Recycling"},{"title":"What to Recycle","url":"https://www.coquitlam.ca/481/Garbage-Recycling"}],"organics":[{"title":"Organics Collection","url":"https://www.coquitlam.ca/481/Garbage-Recycling"},{"title":"Green Bin Guidelines","url":"https://www.coquitlam.ca/481/Garbage-Recycling"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- North Vancouver (City)
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_north_vancouver_city',
  'North Vancouver',
  'NV_CITY',
  'City of North Vancouver',
  'https://www.cnv.org/property-development/garbage-and-recycling',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.cnv.org/property-development/garbage-and-recycling"},{"title":"Waste Guidelines","url":"https://www.cnv.org/property-development/garbage-and-recycling"}],"recycling":[{"title":"Recycling Services","url":"https://www.cnv.org/property-development/garbage-and-recycling"},{"title":"Blue Box Program","url":"https://www.cnv.org/property-development/garbage-and-recycling"}],"organics":[{"title":"Organics Program","url":"https://www.cnv.org/property-development/garbage-and-recycling"},{"title":"Green Bin Collection","url":"https://www.cnv.org/property-development/garbage-and-recycling"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- West Vancouver
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_west_vancouver',
  'West Vancouver',
  'WV',
  'District of West Vancouver',
  'https://westvancouver.ca/parks-recreation/environmental-stewardship/waste-recycling',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://westvancouver.ca/parks-recreation/environmental-stewardship/waste-recycling"},{"title":"Waste Guidelines","url":"https://westvancouver.ca/parks-recreation/environmental-stewardship/waste-recycling"}],"recycling":[{"title":"Recycling Program","url":"https://westvancouver.ca/parks-recreation/environmental-stewardship/waste-recycling"},{"title":"Recycling Guidelines","url":"https://westvancouver.ca/parks-recreation/environmental-stewardship/waste-recycling"}],"organics":[{"title":"Organics Collection","url":"https://westvancouver.ca/parks-recreation/environmental-stewardship/waste-recycling"},{"title":"Green Cart Program","url":"https://westvancouver.ca/parks-recreation/environmental-stewardship/waste-recycling"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- New Westminster
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_new_westminster',
  'New Westminster',
  'NEW',
  'City of New Westminster',
  'https://www.newwestcity.ca/services/garbage-and-recycling',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.newwestcity.ca/services/garbage-and-recycling"},{"title":"Waste Guidelines","url":"https://www.newwestcity.ca/services/garbage-and-recycling"}],"recycling":[{"title":"Recycling Services","url":"https://www.newwestcity.ca/services/garbage-and-recycling"},{"title":"Blue Box Recycling","url":"https://www.newwestcity.ca/services/garbage-and-recycling"}],"organics":[{"title":"Organics Collection","url":"https://www.newwestcity.ca/services/garbage-and-recycling"},{"title":"Green Bin Program","url":"https://www.newwestcity.ca/services/garbage-and-recycling"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- Port Coquitlam
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_port_coquitlam',
  'Port Coquitlam',
  'PC',
  'City of Port Coquitlam',
  'https://www.portcoquitlam.ca/city-services/garbage-recycling',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.portcoquitlam.ca/city-services/garbage-recycling"},{"title":"Waste Guidelines","url":"https://www.portcoquitlam.ca/city-services/garbage-recycling"}],"recycling":[{"title":"Recycling Program","url":"https://www.portcoquitlam.ca/city-services/garbage-recycling"},{"title":"Recycling Guidelines","url":"https://www.portcoquitlam.ca/city-services/garbage-recycling"}],"organics":[{"title":"Organics Collection","url":"https://www.portcoquitlam.ca/city-services/garbage-recycling"},{"title":"Green Bin Program","url":"https://www.portcoquitlam.ca/city-services/garbage-recycling"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- Port Moody
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_port_moody',
  'Port Moody',
  'PM',
  'City of Port Moody',
  'https://www.portmoody.ca/en/living-in-port-moody/garbage-and-recycling.aspx',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.portmoody.ca/en/living-in-port-moody/garbage-and-recycling.aspx"},{"title":"Waste Guidelines","url":"https://www.portmoody.ca/en/living-in-port-moody/garbage-and-recycling.aspx"}],"recycling":[{"title":"Recycling Services","url":"https://www.portmoody.ca/en/living-in-port-moody/garbage-and-recycling.aspx"},{"title":"Recycling Guidelines","url":"https://www.portmoody.ca/en/living-in-port-moody/garbage-and-recycling.aspx"}],"organics":[{"title":"Organics Collection","url":"https://www.portmoody.ca/en/living-in-port-moody/garbage-and-recycling.aspx"},{"title":"Green Bin Program","url":"https://www.portmoody.ca/en/living-in-port-moody/garbage-and-recycling.aspx"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- Delta
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_delta',
  'Delta',
  'DEL',
  'Corporation of Delta',
  'https://www.delta.ca/services/garbage-recycling-yard-waste',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.delta.ca/services/garbage-recycling-yard-waste"},{"title":"Waste Guidelines","url":"https://www.delta.ca/services/garbage-recycling-yard-waste"}],"recycling":[{"title":"Recycling Program","url":"https://www.delta.ca/services/garbage-recycling-yard-waste"},{"title":"Recycling Guidelines","url":"https://www.delta.ca/services/garbage-recycling-yard-waste"}],"organics":[{"title":"Organics Collection","url":"https://www.delta.ca/services/garbage-recycling-yard-waste"},{"title":"Green Bin Program","url":"https://www.delta.ca/services/garbage-recycling-yard-waste"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- Langley (Township)
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_langley',
  'Langley',
  'LANG',
  'Township of Langley',
  'https://www.tol.ca/services/garbage-recycling/',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.tol.ca/services/garbage-recycling/"},{"title":"Waste Guidelines","url":"https://www.tol.ca/services/garbage-recycling/"}],"recycling":[{"title":"Recycling Services","url":"https://www.tol.ca/services/garbage-recycling/"},{"title":"Recycling Guidelines","url":"https://www.tol.ca/services/garbage-recycling/"}],"organics":[{"title":"Organics Collection","url":"https://www.tol.ca/services/garbage-recycling/"},{"title":"Green Bin Program","url":"https://www.tol.ca/services/garbage-recycling/"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- Maple Ridge
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_maple_ridge',
  'Maple Ridge',
  'MR',
  'City of Maple Ridge',
  'https://www.mapleridge.ca/1306/Garbage-Recycling',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.mapleridge.ca/1306/Garbage-Recycling"},{"title":"Waste Guidelines","url":"https://www.mapleridge.ca/1306/Garbage-Recycling"}],"recycling":[{"title":"Recycling Program","url":"https://www.mapleridge.ca/1306/Garbage-Recycling"},{"title":"Recycling Guidelines","url":"https://www.mapleridge.ca/1306/Garbage-Recycling"}],"organics":[{"title":"Organics Collection","url":"https://www.mapleridge.ca/1306/Garbage-Recycling"},{"title":"Green Bin Program","url":"https://www.mapleridge.ca/1306/Garbage-Recycling"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');

-- White Rock
INSERT INTO municipality_configs (
  id, name, code,
  garbage_provider, garbage_schedule_lookup_url,
  waste_regulations,
  last_updated, created_at, updated_at, version
) VALUES (
  'muni_white_rock',
  'White Rock',
  'WR',
  'City of White Rock',
  'https://www.whiterockcity.ca/197/Garbage-Recycling',
  json('{"garbage":[{"title":"Garbage Collection","url":"https://www.whiterockcity.ca/197/Garbage-Recycling"},{"title":"Waste Guidelines","url":"https://www.whiterockcity.ca/197/Garbage-Recycling"}],"recycling":[{"title":"Recycling Services","url":"https://www.whiterockcity.ca/197/Garbage-Recycling"},{"title":"Recycling Guidelines","url":"https://www.whiterockcity.ca/197/Garbage-Recycling"}],"organics":[{"title":"Organics Collection","url":"https://www.whiterockcity.ca/197/Garbage-Recycling"},{"title":"Green Bin Program","url":"https://www.whiterockcity.ca/197/Garbage-Recycling"}]}'),
  datetime('now'), datetime('now'), datetime('now'), 1
) ON CONFLICT(name) DO UPDATE SET
  waste_regulations = excluded.waste_regulations,
  updated_at = datetime('now');
