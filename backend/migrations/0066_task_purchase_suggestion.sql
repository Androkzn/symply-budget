-- Purchase → planned-spending suggestion.
-- AI task enrichment flags tasks that require buying something (is_purchase)
-- with a rough cost range in CENTS, so the app can offer an OPTIONAL "add to
-- planned spending" chip. Nothing is ever auto-added to the budget.
ALTER TABLE tasks ADD COLUMN is_purchase INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN purchase_estimated_cost_min INTEGER;
ALTER TABLE tasks ADD COLUMN purchase_estimated_cost_max INTEGER;
ALTER TABLE tasks ADD COLUMN purchase_suggestion_dismissed INTEGER DEFAULT 0;
-- FK to budget_items when the user accepts the suggestion (convenience pointer
-- for the chip's "added" state; cleared when that budget item is deleted).
ALTER TABLE tasks ADD COLUMN budget_item_id TEXT;

-- Lets the app cheaply find outstanding purchase suggestions.
CREATE INDEX IF NOT EXISTS tasks_is_purchase_idx ON tasks(is_purchase);
