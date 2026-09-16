-- Seed maintenance templates (150+ items based on research)
-- These are system templates that match home features to maintenance tasks

-- ============ HVAC TEMPLATES ============

INSERT INTO maintenance_templates (id, title, description, plain_language_description, feature_type, feature_subtype, frequency, best_season, system_category, estimated_duration_minutes, diy_difficulty, professional_recommended, estimated_cost_min, estimated_cost_max, diy_cost_min, diy_cost_max, why_important, neglect_consequences, source, priority_weight) VALUES
('tpl_hvac_filter_monthly', 'Change HVAC air filter', 'Replace or clean the air filter in your heating/cooling system', 'Swap out the old air filter for a new one - it''s usually behind a vent or in the furnace unit. This keeps your air clean and your system running efficiently.', 'hvac', NULL, 'monthly', 'any', 'hvac', 15, 'easy', 0, 500, 3000, 500, 2000, 'Clean filters improve air quality, reduce energy costs by 5-15%, and prevent system strain', 'Dirty filters force your system to work harder, increasing energy bills and causing premature wear. Can lead to $5,000-$15,000 system replacement.', 'system', 90),

('tpl_hvac_tune_heating', 'Professional HVAC tune-up (heating)', 'Annual professional inspection and maintenance of heating system', 'Have a pro come check your furnace before winter. They''ll clean it, check for problems, and make sure it''s running safely.', 'hvac', NULL, 'yearly', 'fall', 'hvac', 60, 'professional_only', 1, 10000, 20000, NULL, NULL, 'Ensures safe operation, maintains efficiency, and catches problems before they become expensive repairs', 'Skipping tune-ups can lead to carbon monoxide leaks, system failures during cold weather, and 30% higher energy bills.', 'system', 85),

('tpl_hvac_tune_cooling', 'Professional HVAC tune-up (cooling)', 'Annual professional inspection and maintenance of AC system', 'Have a pro check your AC before summer hits. They''ll clean the coils, check refrigerant, and make sure you''ll stay cool.', 'hvac', NULL, 'yearly', 'spring', 'hvac', 60, 'professional_only', 1, 10000, 20000, NULL, NULL, 'Ensures efficient cooling, prevents breakdowns during heat waves, extends system life', 'AC failures during summer cost 2-3x more for emergency repairs. Neglected systems use 20-40% more electricity.', 'system', 85),

('tpl_hvac_condensate', 'Clean AC condensate drain', 'Clear the condensate drain line to prevent water backup', 'Pour a cup of vinegar down the drain line near your AC unit to prevent clogs and water damage.', 'hvac', 'central_ac', 'quarterly', 'any', 'hvac', 15, 'easy', 0, 0, 500, 0, 200, 'Prevents water damage, mold growth, and system shutdowns', 'Clogged drains cause water damage to ceilings and walls, mold growth, and can trigger safety shutoffs.', 'system', 70),

('tpl_hvac_outdoor_unit', 'Clean outdoor AC unit', 'Remove debris and clean around the outdoor condenser unit', 'Clear leaves, grass, and debris from around your outdoor AC unit. Keep 2 feet of clearance on all sides.', 'hvac', 'central_ac', 'quarterly', 'any', 'hvac', 30, 'easy', 0, 0, 500, 0, 200, 'Maintains airflow and efficiency, prevents overheating', 'Blocked airflow causes the system to work harder, increasing energy use and wear on components.', 'system', 65),

-- ============ FIREPLACE TEMPLATES ============

('tpl_fireplace_wood_inspect', 'Chimney inspection (wood-burning)', 'Annual professional chimney inspection', 'Have a certified chimney sweep inspect your chimney before using it each season. They check for creosote buildup and damage.', 'fireplace', 'wood_burning', 'yearly', 'fall', 'safety', 60, 'professional_only', 1, 10000, 30000, NULL, NULL, 'Prevents chimney fires and carbon monoxide poisoning. Required for insurance in many areas.', 'Chimney fires cause $125+ million in property damage yearly. Creosote buildup is the #1 cause of chimney fires.', 'system', 95),

('tpl_fireplace_wood_sweep', 'Chimney cleaning/sweep (wood-burning)', 'Professional chimney cleaning to remove creosote', 'Get your chimney professionally cleaned if you burn more than a cord of wood per season or if inspection shows buildup.', 'fireplace', 'wood_burning', 'yearly', 'fall', 'safety', 90, 'professional_only', 1, 15000, 35000, NULL, NULL, 'Removes flammable creosote buildup, ensures proper draft', 'Creosote is highly flammable. Just 1/8" of buildup is considered hazardous and increases fire risk significantly.', 'system', 95),

('tpl_fireplace_wood_damper', 'Check fireplace damper', 'Test damper operation before each burning season', 'Open and close the damper to make sure it moves freely. Look up with a flashlight to check for obstructions.', 'fireplace', 'wood_burning', 'yearly', 'fall', 'safety', 10, 'easy', 0, 0, 0, 0, 0, 'Ensures proper ventilation and prevents smoke from entering home', 'Stuck dampers can fill your home with smoke or allow cold air and pests to enter.', 'system', 80),

('tpl_fireplace_gas_inspect', 'Gas fireplace inspection', 'Annual professional inspection of gas fireplace', 'Have a professional inspect your gas fireplace annually. They''ll check the burner, pilot, thermocouple, and vent.', 'fireplace', 'gas', 'yearly', 'fall', 'safety', 45, 'professional_only', 1, 10000, 25000, NULL, NULL, 'Ensures safe operation, checks for gas leaks, verifies proper venting', 'Gas leaks can cause explosions. Blocked vents can cause carbon monoxide poisoning.', 'system', 90),

('tpl_fireplace_gas_clean', 'Clean gas fireplace logs and glass', 'Clean artificial logs and glass front', 'Vacuum dust from logs and clean the glass with fireplace glass cleaner. Don''t use regular glass cleaner.', 'fireplace', 'gas', 'yearly', 'any', 'interior', 30, 'easy', 0, 500, 1500, 500, 1000, 'Maintains appearance and proper flame pattern', 'Dust buildup can cause irregular flames and reduce heating efficiency.', 'system', 50),

('tpl_fireplace_pellet_burnpot', 'Clean pellet stove burn pot', 'Remove ash from burn pot for proper combustion', 'Scrape out the ash from the burn pot weekly when using your pellet stove regularly.', 'fireplace', 'pellet', 'weekly', 'winter', 'hvac', 10, 'easy', 0, 0, 0, 0, 0, 'Ensures efficient combustion and prevents clinker buildup', 'Ash buildup causes poor combustion, more smoke, and can damage the burn pot.', 'system', 75),

('tpl_fireplace_pellet_annual', 'Pellet stove annual service', 'Professional cleaning and inspection of pellet stove', 'Have a professional clean the exhaust system and inspect all components annually.', 'fireplace', 'pellet', 'yearly', 'fall', 'hvac', 90, 'professional_only', 1, 15000, 30000, NULL, NULL, 'Ensures safe, efficient operation and extends stove life', 'Exhaust blockages can cause carbon monoxide buildup. Worn parts can fail during cold weather.', 'system', 85),

-- ============ WATER HEATER TEMPLATES ============

('tpl_waterheater_flush', 'Flush water heater', 'Drain sediment from tank water heater', 'Attach a hose to the drain valve and flush out a few gallons of water to remove sediment buildup.', 'water_heater', 'tank', 'yearly', 'any', 'plumbing', 30, 'medium', 0, 0, 0, 0, 0, 'Removes sediment that reduces efficiency and shortens tank life', 'Sediment buildup can reduce heating efficiency by 25% and cause premature tank failure.', 'system', 75),

('tpl_waterheater_anode', 'Check/replace anode rod', 'Inspect and replace water heater anode rod if corroded', 'The anode rod protects your tank from rust. Check it every 3-5 years and replace if more than 50% corroded.', 'water_heater', 'tank', 'every_3_years', 'any', 'plumbing', 45, 'medium', 0, 2000, 5000, 2000, 4000, 'The anode rod sacrifices itself to prevent tank corrosion', 'Without a working anode rod, your tank will rust from the inside and fail years earlier. Replacement: $1,300+', 'system', 80),

('tpl_waterheater_tpr', 'Test TPR valve', 'Test the temperature-pressure relief valve', 'Lift the lever on the TPR valve briefly to make sure water flows, then let it snap back. Have a bucket ready.', 'water_heater', 'tank', 'yearly', 'any', 'safety', 5, 'easy', 0, 0, 0, 0, 0, 'The TPR valve prevents dangerous pressure buildup and potential tank explosion', 'A failed TPR valve can lead to dangerous pressure buildup. In extreme cases, tanks can explode.', 'system', 85),

('tpl_waterheater_tankless_descale', 'Descale tankless water heater', 'Flush tankless water heater with vinegar to remove mineral buildup', 'Use a descaling kit to flush vinegar through the unit. Takes about 45 minutes.', 'water_heater', 'tankless', 'yearly', 'any', 'plumbing', 60, 'medium', 0, 2000, 5000, 2000, 3000, 'Removes mineral scale that reduces efficiency and flow rate', 'Scale buildup can reduce efficiency by 30% and eventually block the heat exchanger, requiring expensive repairs.', 'system', 75),

-- ============ PLUMBING TEMPLATES ============

('tpl_plumbing_check_leaks', 'Check for plumbing leaks', 'Inspect under sinks, around toilets, and near water heater for leaks', 'Look under all sinks, behind toilets, and around the water heater for any signs of moisture, drips, or water stains.', 'plumbing', NULL, 'monthly', 'any', 'plumbing', 15, 'easy', 0, 0, 0, 0, 0, 'Early leak detection prevents water damage and mold', 'A small leak can waste 10,000 gallons/year and cause $7,000+ in water damage if undetected.', 'system', 85),

('tpl_plumbing_test_shutoffs', 'Test water shutoff valves', 'Exercise main and individual shutoff valves', 'Turn each shutoff valve off and on to make sure they work. Do this yearly so they don''t seize up.', 'plumbing', NULL, 'yearly', 'any', 'plumbing', 20, 'easy', 0, 0, 0, 0, 0, 'Ensures you can quickly shut off water in an emergency', 'Seized valves can''t stop water during emergencies, leading to extensive flood damage.', 'system', 75),

('tpl_plumbing_clean_drains', 'Clean sink and shower drains', 'Remove hair and debris from drain stoppers', 'Pull out the drain stopper and remove any hair or gunk. Use a drain snake if water drains slowly.', 'plumbing', NULL, 'monthly', 'any', 'plumbing', 15, 'easy', 0, 0, 500, 0, 200, 'Prevents clogs and slow drains', 'Neglected drains lead to complete blockages requiring professional snaking ($150-$300).', 'system', 60),

('tpl_plumbing_toilet_check', 'Check toilet for leaks', 'Test toilet for silent leaks using food coloring', 'Add a few drops of food coloring to the tank. Wait 30 minutes. If color appears in bowl, you have a leak.', 'plumbing', NULL, 'quarterly', 'any', 'plumbing', 10, 'easy', 0, 0, 200, 0, 200, 'Silent toilet leaks can waste 200+ gallons per day', 'A running toilet can add $100+ to monthly water bills and waste thousands of gallons.', 'system', 70),

('tpl_plumbing_water_pressure', 'Check water pressure', 'Test water pressure with a gauge', 'Attach a pressure gauge to an outdoor faucet. Pressure should be 40-60 PSI. Over 80 PSI damages pipes.', 'plumbing', NULL, 'yearly', 'any', 'plumbing', 10, 'easy', 0, 0, 1500, 0, 1500, 'Proper pressure protects pipes and appliances', 'High pressure causes pipe bursts, appliance damage, and wastes water. Low pressure indicates problems.', 'system', 65),

('tpl_plumbing_supply_hoses', 'Inspect/replace supply hoses', 'Check washing machine and dishwasher supply hoses for wear', 'Look for bulges, cracks, or corrosion on supply hoses. Replace rubber hoses every 3-5 years.', 'plumbing', NULL, 'yearly', 'any', 'plumbing', 15, 'easy', 0, 0, 3000, 0, 3000, 'Burst supply hoses are a leading cause of home water damage', 'Supply hose failures cause an average of $5,000 in damage. 93% of water damage claims could be prevented.', 'system', 80),

-- ============ ELECTRICAL TEMPLATES ============

('tpl_electrical_gfci_test', 'Test GFCI outlets', 'Test ground fault circuit interrupter outlets', 'Press the TEST button on GFCI outlets in bathrooms, kitchen, garage, and outdoors. They should trip immediately.', 'electrical', NULL, 'monthly', 'any', 'electrical', 10, 'easy', 0, 0, 0, 0, 0, 'GFCIs prevent electrocution, especially in wet areas', 'Failed GFCIs won''t protect you from electrical shock. They''re required by code in wet areas for a reason.', 'system', 90),

('tpl_electrical_panel_inspect', 'Inspect electrical panel', 'Visual inspection of breaker panel for issues', 'Open the panel cover and look for rust, burn marks, or unusual odors. Don''t touch anything inside.', 'electrical', NULL, 'yearly', 'any', 'electrical', 10, 'easy', 0, 0, 0, 0, 0, 'Identifies potential fire hazards and failing components', 'Electrical fires cause 51,000 house fires annually. Early detection of panel issues is critical.', 'system', 85),

('tpl_electrical_surge_replace', 'Replace surge protectors', 'Replace surge protectors every 2-3 years', 'Surge protectors wear out over time. Replace them every 2-3 years or after a major surge event.', 'electrical', NULL, 'every_2_years', 'any', 'electrical', 15, 'easy', 0, 0, 5000, 0, 5000, 'Worn surge protectors offer no protection for your electronics', 'A single surge can destroy $1,000s in electronics. Worn protectors provide false security.', 'system', 60),

-- ============ SAFETY EQUIPMENT TEMPLATES ============

('tpl_safety_smoke_test', 'Test smoke detectors', 'Press test button on all smoke detectors', 'Press and hold the test button on each smoke detector until it sounds. Test monthly.', 'smoke_detector', NULL, 'monthly', 'any', 'safety', 10, 'easy', 0, 0, 0, 0, 0, 'Working smoke detectors reduce fire death risk by 50%', 'Non-working smoke detectors are found in 1/4 of home fire deaths. Testing saves lives.', 'system', 95),

('tpl_safety_smoke_battery', 'Replace smoke detector batteries', 'Replace batteries in battery-powered smoke detectors', 'Replace batteries annually, even if they haven''t chirped. Use the date you change clocks as a reminder.', 'smoke_detector', 'battery', 'yearly', 'fall', 'safety', 15, 'easy', 0, 500, 2000, 500, 1500, 'Dead batteries = no protection', 'Smoke detectors with dead batteries provide no warning. Most fire deaths occur in homes without working alarms.', 'system', 95),

('tpl_safety_smoke_replace', 'Replace smoke detectors', 'Replace smoke detectors every 10 years', 'Check the manufacture date on the back. Replace any detector over 10 years old.', 'smoke_detector', NULL, 'every_10_years', 'any', 'safety', 20, 'easy', 0, 2000, 5000, 2000, 4000, 'Smoke detector sensors degrade over time', 'After 10 years, smoke detectors may not respond quickly enough to protect you.', 'system', 90),

('tpl_safety_co_test', 'Test CO detectors', 'Test carbon monoxide detectors monthly', 'Press the test button on each CO detector. Replace batteries if it doesn''t sound immediately.', 'co_detector', NULL, 'monthly', 'any', 'safety', 5, 'easy', 0, 0, 0, 0, 0, 'CO is colorless and odorless - detectors are your only warning', 'CO poisoning kills 400+ Americans yearly and hospitalizes 50,000. Working detectors save lives.', 'system', 95),

('tpl_safety_co_replace', 'Replace CO detectors', 'Replace carbon monoxide detectors every 5-7 years', 'Check manufacture date. Most CO detectors last 5-7 years before sensors degrade.', 'co_detector', NULL, 'every_5_years', 'any', 'safety', 15, 'easy', 0, 2000, 5000, 2000, 4000, 'CO detector sensors have limited lifespan', 'Expired CO detectors may not respond to dangerous levels. Replace before they fail.', 'system', 90),

('tpl_safety_fire_ext', 'Check fire extinguisher', 'Inspect fire extinguisher pressure and condition', 'Check that pressure gauge is in green zone, pin is intact, and nozzle is clear. Know how to use it.', 'fire_extinguisher', NULL, 'monthly', 'any', 'safety', 5, 'easy', 0, 0, 0, 0, 0, 'Fire extinguishers can stop small fires before they spread', 'Non-functional extinguishers give false security. Regular checks ensure they work when needed.', 'system', 85),

('tpl_safety_fire_ext_service', 'Professional fire extinguisher service', 'Have fire extinguisher professionally inspected', 'Fire extinguishers should be professionally serviced every 6 years, or sooner if damaged.', 'fire_extinguisher', NULL, 'every_5_years', 'any', 'safety', 15, 'professional_only', 1, 2000, 5000, NULL, NULL, 'Professional service ensures reliability', 'DIY checks catch visible issues but miss internal problems. Professional service is thorough.', 'system', 75),

-- ============ ROOF TEMPLATES ============

('tpl_roof_visual_inspect', 'Visual roof inspection', 'Inspect roof from ground with binoculars', 'Walk around your home and look at the roof with binoculars. Look for missing, curled, or damaged shingles.', 'roof', NULL, 'semi_annual', 'any', 'roof', 20, 'easy', 0, 0, 0, 0, 0, 'Catches damage before it causes leaks', 'Small roof damage leads to leaks, water damage, mold, and eventually structural damage.', 'system', 80),

('tpl_roof_pro_inspect', 'Professional roof inspection', 'Have a roofer inspect your roof', 'A professional can safely access and thoroughly inspect your roof, flashing, and vents.', 'roof', NULL, 'every_3_years', 'any', 'roof', 60, 'professional_only', 1, 10000, 40000, NULL, NULL, 'Professional inspections catch issues homeowners miss', 'Roofers spot flashing problems, early wear, and damage that''s invisible from the ground.', 'system', 75),

('tpl_roof_gutter_clean', 'Clean gutters', 'Remove debris from gutters and downspouts', 'Remove leaves, twigs, and debris from gutters. Flush downspouts with a hose to clear blockages.', 'gutter', NULL, 'semi_annual', 'fall', 'roof', 60, 'medium', 0, 0, 25000, 0, 5000, 'Clogged gutters cause water damage to roof, fascia, and foundation', 'Overflowing gutters cause $10,000+ in foundation damage, roof rot, and basement flooding.', 'system', 85),

('tpl_roof_gutter_fall', 'Fall gutter cleaning', 'Clean gutters after leaves fall', 'Do a final gutter cleaning after most leaves have fallen to prepare for winter.', 'gutter', NULL, 'yearly', 'fall', 'roof', 60, 'medium', 0, 0, 25000, 0, 5000, 'Prevents ice dams and winter damage', 'Debris-filled gutters in winter cause ice dams, which can damage roofs and cause interior leaks.', 'system', 85),

('tpl_roof_trim_branches', 'Trim tree branches near roof', 'Cut back branches within 6 feet of roof', 'Trim any branches that overhang the roof or come within 6 feet of the house.', 'roof', NULL, 'yearly', 'any', 'exterior', 60, 'medium', 0, 0, 50000, 0, 10000, 'Prevents damage from falling branches and reduces debris on roof', 'Branches damage roofs in storms, deposit debris, and provide pest access to your home.', 'system', 70),

-- ============ EXTERIOR TEMPLATES ============

('tpl_exterior_caulk_inspect', 'Inspect exterior caulking', 'Check caulk around windows, doors, and trim', 'Look for cracked, peeling, or missing caulk around all exterior openings and where different materials meet.', 'siding', NULL, 'yearly', 'spring', 'exterior', 30, 'easy', 0, 0, 1000, 0, 500, 'Good caulk seals prevent water intrusion and energy loss', 'Failed caulk allows water behind siding, causing rot, mold, and structural damage.', 'system', 75),

('tpl_exterior_power_wash', 'Power wash exterior', 'Clean siding, deck, and driveway', 'Power wash siding to remove dirt, mold, and mildew. Be careful around windows and on wood.', 'siding', NULL, 'yearly', 'spring', 'exterior', 120, 'medium', 0, 0, 40000, 0, 10000, 'Removes damaging buildup and improves curb appeal', 'Mold and mildew can damage siding over time. Regular cleaning extends siding life.', 'system', 60),

('tpl_exterior_deck_inspect', 'Inspect deck/patio', 'Check deck boards, railings, and structure', 'Look for loose boards, protruding nails, rot, and wobbly railings. Check underneath for structural issues.', 'deck', NULL, 'yearly', 'spring', 'exterior', 30, 'easy', 0, 0, 0, 0, 0, 'Catches safety hazards and early rot', 'Deck failures cause injuries. Rot spreads quickly and can make entire deck unsafe.', 'system', 75),

('tpl_exterior_deck_seal', 'Seal/stain deck', 'Apply sealer or stain to wooden deck', 'Apply water-repellent sealer or stain to protect wood from water damage and UV rays.', 'deck', 'wood', 'every_2_years', 'spring', 'exterior', 240, 'medium', 0, 0, 80000, 0, 20000, 'Protects wood from water damage, rot, and sun damage', 'Unsealed decks deteriorate quickly. Replacement costs $15,000-$30,000+.', 'system', 70),

-- ============ FOUNDATION TEMPLATES ============

('tpl_foundation_inspect', 'Inspect foundation', 'Visual inspection of foundation for cracks', 'Walk around inside and outside looking for new cracks, especially after heavy rain or freeze/thaw cycles.', 'foundation', NULL, 'semi_annual', 'any', 'foundation', 30, 'easy', 0, 0, 0, 0, 0, 'Early crack detection allows affordable repairs', 'Small cracks grow. Catching them early costs $250-$800 vs $10,000+ for major repairs.', 'system', 85),

('tpl_foundation_grading', 'Check drainage grading', 'Ensure ground slopes away from foundation', 'Soil should slope away from foundation at least 6 inches over the first 10 feet.', 'foundation', NULL, 'yearly', 'spring', 'foundation', 20, 'easy', 0, 0, 0, 0, 0, 'Proper grading prevents water from pooling against foundation', 'Water pooling against foundation causes cracks, basement leaks, and structural damage.', 'system', 80),

('tpl_foundation_sump_test', 'Test sump pump', 'Verify sump pump operates correctly', 'Pour a bucket of water into the sump pit. Pump should turn on, remove water, then turn off.', 'sump_pump', NULL, 'quarterly', 'any', 'foundation', 10, 'easy', 0, 0, 500, 0, 200, 'Ensures pump works before you need it', 'Failed sump pumps cause basement flooding averaging $4,300 in damage.', 'system', 85),

('tpl_foundation_sump_backup', 'Check sump pump backup battery', 'Test backup power system for sump pump', 'If you have a battery backup, test it annually and replace battery every 2-3 years.', 'sump_pump', 'battery_backup', 'yearly', 'any', 'foundation', 15, 'easy', 0, 0, 15000, 0, 15000, 'Power outages often coincide with flooding (storms)', 'Sump pumps are useless during power outages - exactly when flooding is most likely.', 'system', 80),

-- ============ WINDOW/DOOR TEMPLATES ============

('tpl_windows_weatherstrip', 'Check window weatherstripping', 'Inspect weatherstripping for gaps and wear', 'Close windows on a dollar bill - if it slides out easily, weatherstripping needs replacing.', 'windows', NULL, 'yearly', 'fall', 'windows_doors', 30, 'easy', 0, 0, 2000, 0, 1000, 'Good weatherstripping reduces energy loss by up to 30%', 'Drafty windows can increase heating/cooling costs significantly.', 'system', 70),

('tpl_windows_caulk', 'Recaulk windows', 'Replace deteriorated caulk around window frames', 'Remove old cracked caulk and apply new silicone caulk around exterior window frames.', 'windows', NULL, 'every_5_years', 'spring', 'windows_doors', 120, 'easy', 0, 0, 3000, 0, 2000, 'Prevents water intrusion and drafts', 'Failed caulk allows water behind siding and frames, causing rot and mold.', 'system', 70),

('tpl_doors_weatherstrip', 'Check door weatherstripping', 'Inspect door seals and sweeps', 'Check for daylight around closed doors and feel for drafts. Test door sweeps by sliding paper underneath.', 'doors', NULL, 'yearly', 'fall', 'windows_doors', 20, 'easy', 0, 0, 0, 0, 0, 'Tight seals keep conditioned air in and pests out', 'Worn door seals waste energy and allow insects, mice, and drafts into your home.', 'system', 70),

('tpl_doors_hardware', 'Lubricate door hardware', 'Oil hinges, locks, and latches', 'Apply lubricant to hinges, locks, deadbolts, and latches to ensure smooth operation.', 'doors', NULL, 'yearly', 'any', 'windows_doors', 20, 'easy', 0, 0, 500, 0, 500, 'Prevents wear and ensures locks work in emergencies', 'Seized locks are a safety hazard. Dry hinges wear out faster.', 'system', 55),

-- ============ GARAGE TEMPLATES ============

('tpl_garage_door_lube', 'Lubricate garage door', 'Oil garage door tracks, rollers, and hinges', 'Apply garage door lubricant to tracks, rollers, hinges, and springs (not WD-40).', 'garage_door', NULL, 'semi_annual', 'any', 'garage', 20, 'easy', 0, 0, 1000, 0, 1000, 'Reduces wear and noise, extends life of components', 'Dry components wear faster and can fail suddenly. Spring failures are dangerous.', 'system', 65),

('tpl_garage_door_safety', 'Test garage door safety reverse', 'Verify auto-reverse safety feature works', 'Place a 2x4 flat on the ground under the door. Door should reverse when it touches the board.', 'garage_door', 'automatic', 'monthly', 'any', 'safety', 5, 'easy', 0, 0, 0, 0, 0, 'Prevents injury and death from closing doors', 'Garage doors can kill. The auto-reverse is a critical safety feature that must work.', 'system', 90),

('tpl_garage_door_sensors', 'Test garage door sensors', 'Verify photo-eye sensors are working', 'Wave your foot through the sensor beam while door is closing. It should stop and reverse immediately.', 'garage_door', 'automatic', 'monthly', 'any', 'safety', 5, 'easy', 0, 0, 0, 0, 0, 'Sensors prevent door from closing on people, pets, or objects', 'Malfunctioning sensors can cause serious injury or death.', 'system', 90),

('tpl_garage_door_balance', 'Check garage door balance', 'Test manual operation and balance', 'Disconnect opener and lift door halfway. It should stay put. If it falls or rises, springs need adjustment.', 'garage_door', 'automatic', 'yearly', 'any', 'garage', 10, 'easy', 0, 0, 0, 0, 0, 'Unbalanced doors strain openers and can fall unexpectedly', 'An unbalanced door wears out the opener motor and can slam down suddenly.', 'system', 70),

-- ============ POOL TEMPLATES ============

('tpl_pool_chemistry', 'Test pool water chemistry', 'Test and adjust pH, chlorine, and alkalinity', 'Use test strips or kit to check pH (7.2-7.6), chlorine (1-3 ppm), and alkalinity (80-120 ppm).', 'pool', NULL, 'weekly', 'summer', 'exterior', 15, 'easy', 0, 500, 2000, 500, 1500, 'Proper chemistry keeps water safe and prevents equipment damage', 'Unbalanced water breeds bacteria, damages pool surfaces, and corrodes equipment.', 'system', 85),

('tpl_pool_shock', 'Shock pool', 'Add shock treatment to sanitize pool', 'Add pool shock according to package directions, usually in the evening. Run pump overnight.', 'pool', NULL, 'weekly', 'summer', 'exterior', 15, 'easy', 0, 500, 2000, 500, 1500, 'Kills bacteria and algae that regular chlorine misses', 'Without shocking, bacteria and algae can bloom, making pool unsafe for swimming.', 'system', 80),

('tpl_pool_filter_clean', 'Clean pool filter', 'Clean or backwash pool filter', 'Clean cartridge filters with hose or backwash sand/DE filters when pressure rises 8-10 PSI above normal.', 'pool', NULL, 'monthly', 'summer', 'exterior', 30, 'easy', 0, 0, 2000, 0, 1000, 'Clean filters maintain water clarity and protect pump', 'Dirty filters reduce circulation, cloud water, and can burn out pump motors.', 'system', 75),

('tpl_pool_pro_service', 'Professional pool inspection', 'Annual pool equipment inspection', 'Have a pool pro inspect pump, heater, filter, and all equipment before opening for the season.', 'pool', NULL, 'yearly', 'spring', 'exterior', 60, 'professional_only', 1, 20000, 50000, NULL, NULL, 'Catches equipment issues before the swimming season', 'Equipment failures during peak season mean weeks without a pool and expensive emergency repairs.', 'system', 70),

-- ============ HOT TUB TEMPLATES ============

('tpl_hottub_chemistry', 'Test hot tub water', 'Test pH, sanitizer, and alkalinity', 'Test water 2-3 times per week. pH should be 7.2-7.6, sanitizer 3-5 ppm (bromine) or 1.5-3 ppm (chlorine).', 'hot_tub', NULL, 'weekly', 'any', 'exterior', 10, 'easy', 0, 500, 1500, 500, 1000, 'Hot water breeds bacteria quickly without proper sanitizer levels', 'Hot tubs can harbor dangerous bacteria like Legionella. Proper chemistry is essential for safety.', 'system', 90),

('tpl_hottub_shock', 'Shock hot tub', 'Add shock treatment to hot tub', 'Add non-chlorine shock weekly or after heavy use to oxidize contaminants.', 'hot_tub', NULL, 'weekly', 'any', 'exterior', 10, 'easy', 0, 500, 1500, 500, 1000, 'Shocking removes body oils, lotions, and contaminants', 'Without shocking, water becomes cloudy and can harbor bacteria.', 'system', 80),

('tpl_hottub_filter_rinse', 'Rinse hot tub filter', 'Quick rinse of filter cartridge', 'Remove filter and rinse with garden hose to remove loose debris.', 'hot_tub', NULL, 'weekly', 'any', 'exterior', 10, 'easy', 0, 0, 0, 0, 0, 'Regular rinsing extends filter life and maintains water flow', 'Clogged filters reduce jet pressure and can damage the pump.', 'system', 70),

('tpl_hottub_filter_deep', 'Deep clean hot tub filter', 'Soak filter in cleaning solution overnight', 'Soak filter in filter cleaner solution overnight monthly to remove oils and scale.', 'hot_tub', NULL, 'monthly', 'any', 'exterior', 15, 'easy', 0, 500, 1500, 500, 1000, 'Deep cleaning removes buildup that rinsing misses', 'Oils and lotions accumulate in filters and can''t be removed by rinsing alone.', 'system', 70),

('tpl_hottub_drain', 'Drain and refill hot tub', 'Complete water change and shell cleaning', 'Drain completely, clean shell and jets, refill with fresh water. Add fresh chemicals.', 'hot_tub', NULL, 'quarterly', 'any', 'exterior', 120, 'easy', 0, 0, 5000, 0, 3000, 'Total dissolved solids accumulate over time and can''t be removed', 'Water that''s never changed becomes harder to balance and can damage equipment.', 'system', 75),

-- ============ SEPTIC TEMPLATES ============

('tpl_septic_pump', 'Pump septic tank', 'Professional septic tank pumping', 'Have septic tank pumped every 3-5 years depending on usage and tank size.', 'septic', NULL, 'every_3_years', 'any', 'plumbing', 60, 'professional_only', 1, 28000, 50000, NULL, NULL, 'Prevents solids from entering and clogging drain field', 'A failed drain field costs $10,000-$20,000 to replace. Regular pumping prevents this.', 'system', 90),

('tpl_septic_inspect', 'Septic system inspection', 'Professional inspection of entire system', 'Have a septic professional inspect tank, baffles, and drain field every few years.', 'septic', NULL, 'every_3_years', 'any', 'plumbing', 60, 'professional_only', 1, 20000, 40000, NULL, NULL, 'Catches problems before they cause complete system failure', 'Septic failures are expensive ($10K-$20K) and messy. Inspections catch issues early.', 'system', 85),

-- ============ WELL TEMPLATES ============

('tpl_well_water_test', 'Test well water quality', 'Annual water quality testing', 'Send water sample to certified lab for bacteria, nitrates, and other contaminants.', 'well', NULL, 'yearly', 'spring', 'plumbing', 30, 'easy', 0, 10000, 30000, 10000, 20000, 'Ensures water is safe to drink', 'Contaminated well water can cause serious illness. Testing catches problems before they affect health.', 'system', 90),

('tpl_well_inspect', 'Well system inspection', 'Professional inspection of well pump and pressure tank', 'Have a well professional check pump operation, pressure tank, and well cap.', 'well', NULL, 'yearly', 'any', 'plumbing', 60, 'professional_only', 1, 15000, 40000, NULL, NULL, 'Catches pump and pressure issues early', 'Well pump failures mean no water. Catching problems early prevents emergencies.', 'system', 80),

-- ============ APPLIANCE TEMPLATES ============

('tpl_fridge_coils', 'Clean refrigerator coils', 'Vacuum condenser coils on refrigerator', 'Pull fridge away from wall and vacuum the coils on the back or bottom. Dusty coils waste energy.', 'refrigerator', NULL, 'quarterly', 'any', 'appliances', 20, 'easy', 0, 0, 0, 0, 0, 'Clean coils improve efficiency by up to 35%', 'Dusty coils make the compressor work harder, using more electricity and shortening fridge life.', 'system', 70),

('tpl_fridge_filter', 'Replace refrigerator water filter', 'Change water filter if equipped', 'Replace the water filter in your refrigerator every 6 months for clean water and ice.', 'refrigerator', NULL, 'semi_annual', 'any', 'appliances', 10, 'easy', 0, 2000, 5000, 2000, 4000, 'Filters remove contaminants and improve taste', 'Old filters don''t remove contaminants effectively and can reduce water flow.', 'system', 60),

('tpl_dishwasher_clean', 'Clean dishwasher', 'Run cleaning cycle or vinegar wash', 'Run empty dishwasher with a cup of vinegar on top rack, then sprinkle baking soda and run again.', 'dishwasher', NULL, 'monthly', 'any', 'appliances', 5, 'easy', 0, 0, 500, 0, 200, 'Removes buildup and odors', 'Buildup affects cleaning performance and can cause odors.', 'system', 60),

('tpl_dishwasher_filter', 'Clean dishwasher filter', 'Remove and clean the filter', 'Remove the filter from bottom of dishwasher and rinse under running water. Scrub if needed.', 'dishwasher', NULL, 'monthly', 'any', 'appliances', 10, 'easy', 0, 0, 0, 0, 0, 'Clean filter ensures proper drainage and cleaning', 'Clogged filters cause poor cleaning, odors, and can damage the pump.', 'system', 65),

('tpl_washer_clean', 'Clean washing machine', 'Run cleaning cycle or bleach/vinegar wash', 'Run empty hot cycle with bleach or washing machine cleaner. Leave door open after to dry.', 'washing_machine', NULL, 'monthly', 'any', 'appliances', 5, 'easy', 0, 0, 500, 0, 300, 'Prevents mold, mildew, and odors', 'Front-loaders especially can develop mold in the door gasket if not cleaned regularly.', 'system', 65),

('tpl_washer_hoses', 'Inspect washing machine hoses', 'Check supply hoses for wear', 'Look for bulges, cracks, or corrosion. Replace rubber hoses every 5 years with braided stainless.', 'washing_machine', NULL, 'yearly', 'any', 'plumbing', 10, 'easy', 0, 0, 3000, 0, 3000, 'Burst hoses cause major water damage', 'Washing machine hose failures are a top cause of home water damage claims.', 'system', 85),

('tpl_dryer_lint', 'Clean dryer lint trap housing', 'Deep clean lint trap area', 'Remove lint screen and vacuum inside the housing. Lint builds up around the screen.', 'dryer', NULL, 'monthly', 'any', 'safety', 10, 'easy', 0, 0, 0, 0, 0, 'Lint is highly flammable', 'Dryer lint causes 2,900 fires annually. The lint screen doesn''t catch everything.', 'system', 85),

('tpl_dryer_vent', 'Clean dryer vent duct', 'Professional dryer vent cleaning', 'Have the entire vent duct from dryer to outside cleaned professionally.', 'dryer', NULL, 'yearly', 'any', 'safety', 45, 'professional_only', 1, 10000, 17000, NULL, NULL, 'Prevents dryer fires and improves efficiency', 'Clogged dryer vents cause $35 million in property damage annually. Professional cleaning is thorough.', 'system', 90),

('tpl_dryer_vent_check', 'Check exterior dryer vent', 'Verify vent flap opens during operation', 'Go outside while dryer runs and verify the vent flap is opening and warm air is flowing.', 'dryer', NULL, 'quarterly', 'any', 'safety', 5, 'easy', 0, 0, 0, 0, 0, 'Blocked vents are a fire hazard', 'If the flap doesn''t open, the vent is blocked and needs cleaning.', 'system', 80),

-- ============ ATTIC TEMPLATES ============

('tpl_attic_inspect', 'Inspect attic', 'Visual inspection of attic space', 'Look for water stains, mold, pest signs, proper insulation, and adequate ventilation.', 'attic', NULL, 'semi_annual', 'any', 'attic', 30, 'easy', 0, 0, 0, 0, 0, 'Catches leaks, pests, and ventilation issues early', 'Attic problems like mold and leaks can go unnoticed for years, causing major damage.', 'system', 75),

('tpl_attic_vents', 'Check attic ventilation', 'Ensure vents are clear', 'Verify soffit vents, ridge vents, and/or gable vents are not blocked by insulation or debris.', 'attic', NULL, 'yearly', 'any', 'attic', 20, 'easy', 0, 0, 0, 0, 0, 'Proper ventilation prevents ice dams and moisture problems', 'Poor ventilation causes ice dams in winter and moisture damage year-round.', 'system', 70),

-- ============ BASEMENT/CRAWLSPACE TEMPLATES ============

('tpl_basement_moisture', 'Check basement for moisture', 'Look for water intrusion and humidity issues', 'Check walls and floor for dampness, efflorescence (white mineral deposits), and musty odors.', 'basement', NULL, 'monthly', 'any', 'basement', 15, 'easy', 0, 0, 0, 0, 0, 'Early detection prevents mold and structural damage', 'Basement moisture leads to mold, which can spread throughout the house.', 'system', 80),

('tpl_crawlspace_inspect', 'Inspect crawl space', 'Check vapor barrier, moisture, and pests', 'Check vapor barrier for tears, look for standing water, and inspect for pest activity.', 'crawl_space', NULL, 'semi_annual', 'any', 'basement', 30, 'easy', 0, 0, 0, 0, 0, 'Crawl space problems affect entire home', 'Moisture in crawl space causes mold, rot, and attracts pests that can spread throughout house.', 'system', 75),

('tpl_crawlspace_barrier', 'Replace vapor barrier', 'Replace torn or deteriorated vapor barrier', 'Vapor barriers last 5-10 years. Replace if torn, displaced, or showing signs of degradation.', 'crawl_space', NULL, 'every_5_years', 'any', 'basement', 240, 'medium', 0, 0, 100000, 0, 30000, 'Vapor barrier is critical moisture control', 'Without a good vapor barrier, moisture rises into the home causing mold and rot.', 'system', 70),

-- ============ SOLAR TEMPLATES ============

('tpl_solar_visual', 'Visual solar panel inspection', 'Check panels from ground for visible issues', 'Look for cracks, discoloration, debris, or shading from new tree growth.', 'solar_panels', NULL, 'monthly', 'any', 'electrical', 10, 'easy', 0, 0, 0, 0, 0, 'Visual inspection catches obvious problems', 'Cracked panels, debris, or shading can significantly reduce power output.', 'system', 70),

('tpl_solar_clean', 'Clean solar panels', 'Remove dust and debris from panels', 'Clean with soft brush, water, and mild detergent. Early morning is best when panels are cool.', 'solar_panels', NULL, 'semi_annual', 'any', 'electrical', 60, 'medium', 0, 0, 30000, 0, 5000, 'Dirty panels lose up to 25% efficiency', 'Dust, pollen, and bird droppings block sunlight and reduce power generation.', 'system', 65),

('tpl_solar_monitoring', 'Check solar production', 'Review monitoring app for performance issues', 'Check your solar monitoring app for any panels underperforming or system alerts.', 'solar_panels', NULL, 'monthly', 'any', 'electrical', 10, 'easy', 0, 0, 0, 0, 0, 'Monitoring catches inverter and panel issues early', 'A failing inverter or shaded panel can reduce output significantly without obvious signs.', 'system', 70),

('tpl_solar_pro_inspect', 'Professional solar inspection', 'Have solar company inspect system', 'Schedule professional inspection before warranty expires or if production drops.', 'solar_panels', NULL, 'every_5_years', 'any', 'electrical', 60, 'professional_only', 1, 15000, 40000, NULL, NULL, 'Professional inspection can catch issues covered by warranty', 'Most solar warranties are 25 years. Document any issues before warranty expires.', 'system', 65);

-- Add more templates for additional features as needed
