-- Track which reference image source produced an AI-generated garden plan.
-- Drives the mobile UI caption: "AI-traced from your lot" for satellite or
-- user-attached photos, "Stylized concept" for the text-only fallback. NULL
-- on legacy rows + manually-uploaded plans.

ALTER TABLE garden_plans ADD COLUMN reference_image_source TEXT;
