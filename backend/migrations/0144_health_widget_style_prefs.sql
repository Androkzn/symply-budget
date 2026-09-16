-- Symply Health — widget STYLE preferences (Small widget style, Medium widget
-- layout + which two metrics it pairs).
--
-- Why: `widget_preferences` (0120) only ever stored WHAT the widget shows
-- (`small_widget_metric`, `chart_type`/`chart_metric`, the three `show_*`
-- toggles). It never stored HOW the Small/Medium families are laid out. The
-- donor app's widget offers real layout variety there (Small: standard /
-- compact / minimal; Medium: standard / dual / grid, with two independently
-- chosen metrics) — this migration adds the columns so the in-app settings
-- screen and the Swift widget can agree on a layout choice the same way they
-- already agree on `chart_type`.
--
-- Defaults match the donor's own defaults (`SDWidgetPreferences`) so an
-- existing row reads exactly as "standard everything" — the same layout the
-- widget already rendered before this column existed.
--
-- No CHECK constraint, deliberately — same reasoning as 0122/0143: SQLite
-- cannot add one to an existing table without a full rebuild, and validation
-- lives in zod at the route boundary.

ALTER TABLE widget_preferences ADD COLUMN small_widget_style TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE widget_preferences ADD COLUMN medium_widget_layout TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE widget_preferences ADD COLUMN medium_primary_metric TEXT NOT NULL DEFAULT 'steps';
ALTER TABLE widget_preferences ADD COLUMN medium_secondary_metric TEXT NOT NULL DEFAULT 'calories';
ALTER TABLE widget_preferences ADD COLUMN medium_show_all_metrics INTEGER NOT NULL DEFAULT 1;
