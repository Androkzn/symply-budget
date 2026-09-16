-- Vectorized representations of uploaded floor plans.
--
-- Two complementary layers are stored in R2:
--   * vector_trace_key   : literal pixel-perfect Potrace/VTracer SVG
--                          (filled in by an external trace worker; see
--                          floor-plan-vectorization-service.traceFloorPlan).
--   * vector_semantic_key: AI-generated SVG with semantic ids
--                          (data-room-id, data-wall-id, data-door-id, ...)
--                          produced from Claude Vision.
--
-- Either may be null until the corresponding pipeline finishes.
ALTER TABLE floor_plans ADD COLUMN vector_trace_key TEXT;
ALTER TABLE floor_plans ADD COLUMN vector_semantic_key TEXT;
ALTER TABLE floor_plans ADD COLUMN vectorization_status TEXT DEFAULT 'pending';
ALTER TABLE floor_plans ADD COLUMN vectorization_error TEXT;
ALTER TABLE floor_plans ADD COLUMN vectorized_at TEXT;
