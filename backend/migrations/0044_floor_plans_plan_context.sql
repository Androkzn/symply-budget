-- Gardening / outdoor site plans: distinguish from interior floor plans
ALTER TABLE floor_plans ADD COLUMN plan_context TEXT NOT NULL DEFAULT 'interior';
