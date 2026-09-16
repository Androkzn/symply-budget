/**
 * Room Surface Model — the runtime-agnostic core.
 *
 * Polygon arithmetic, sub-area rules, tiling layout and the takeoff. It lives
 * in the contracts package rather than in the app because **both runtimes need
 * the same answer**: the phone draws a wall and counts its tiles, and the
 * Worker builds the scale brief that constrains an AI preview from the same
 * stored document. Two implementations of "how big is this region" would agree
 * until the day they did not, and the one that disagreed would be the one a
 * member ordered material against.
 *
 * Nothing here imports React, react-native, a network client or a database.
 * The app's `src/features/house/surfaces/` adds only what genuinely cannot be
 * shared: pixels (`project.ts`) and the household's display units (`units.ts`).
 */

export * from './geometry';
export * from './derive';
export * from './subareas';
export * from './materials';
export * from './takeoff';
export * from './serialize';
export * from './preview';
