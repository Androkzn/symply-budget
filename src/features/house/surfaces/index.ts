/**
 * Room Surface Model — per-surface finish planning, app side.
 *
 * A room is its floor, its ceiling and one wall per plan edge. Every surface
 * carries a polygon (so a gable, an alcove or an L-shaped floor is expressible
 * without a special case), its openings, and any number of sub-areas that each
 * take their own material — which is how "the bottom metre is panelling and the
 * rest is paint" is stored.
 *
 * **The arithmetic is not here.** It lives in `@symply/contracts`
 * (`room-surface/`), because the Worker needs the identical answer when it
 * builds the scale brief for an AI preview. This module re-exports it so app
 * code has one import, and adds the two things that genuinely cannot be shared:
 * `project.ts` (metres → pixels) and `units.ts` (the household's metric /
 * imperial display).
 *
 * The document itself is stored in `home_project_geometry.payload_json` with
 * `schema_version: 2` — one JSON value under last-writer-wins, which is the
 * only merge semantics a polygon can survive. See the contract header.
 */

export * from '@symply/contracts/room-surface';
export * from './project';
export * from './units';
