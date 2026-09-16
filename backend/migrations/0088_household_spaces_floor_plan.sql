-- Link household spaces to floor plans with bounding-box placement
ALTER TABLE household_spaces ADD COLUMN floor_plan_id TEXT REFERENCES floor_plans(id) ON DELETE SET NULL;
ALTER TABLE household_spaces ADD COLUMN plan_x_percent REAL;
ALTER TABLE household_spaces ADD COLUMN plan_y_percent REAL;
ALTER TABLE household_spaces ADD COLUMN plan_width_percent REAL;
ALTER TABLE household_spaces ADD COLUMN plan_height_percent REAL;
