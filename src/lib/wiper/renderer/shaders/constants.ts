// Numbers shared by the shaders, the scene host and the unit tests. The ink
// clamp is the ratified blob-ground ceiling (src/lib/blob-ground-contrast.test.ts
// proves every text role clears its floor under one blob at this alpha), so
// the GPU scene inherits the analytic gate verbatim.

/** Under measured ink the scene may deviate from the page ground by this fraction at most. */
export const INK_SAFE_ALPHA = 0.15;
export const INK_FIELD_WIDTH = 256;
export const INK_FIELD_HEIGHT = 128;
/**
 * The moving ink field: the outgoing notes' text while the blade shoves them
 * across the glass, rasterised every frame of the out-stroke at a coarser
 * grid (the shove is horizontal and fast; the feather hides the grid).
 */
export const INK_MOVING_WIDTH = 128;
export const INK_MOVING_HEIGHT = 64;
/**
 * Text rects grow by this many CSS px before the feather starts: more than
 * one texel of the field at a 2560px glass, so bilinear sampling never lets
 * the clamp soften inside a text box (the blades are darker than any blob;
 * the mid-sweep ink gate found a 4.1:1 dip at a rect edge at 6px).
 */
export const INK_DILATE_PX = 14;
/** The clamp fades out over this many CSS px past the dilated rect. */
export const INK_FEATHER_PX = 96;

export const MAX_BLOBS = 8;
/** The window of the physics field the scene shows: the SVG's own viewBox. */
export const BLOB_WINDOW_ORIGIN = -33;
export const BLOB_WINDOW_EXTENT = 133;
/** Rendered body radius over the physics size, and the halo beyond it. */
export const BLOB_RENDER_SCALE = 1.15;
export const BLOB_GLOW_SCALE = 2.2;
/** Terminal cruise as tinyvectors driftSpeed (units per substep gain); the package default is 0.05 to 0.10. */
export const CRUISE_SPEED: readonly [number, number] = [0.18, 0.3];
export const CRUISE_SPEED_COARSE: readonly [number, number] = [0.1, 0.16];

/** Arms the scene can draw at once: the opposed pair. */
export const MAX_ARMS = 2;

// ---- M4: droplets and frost ------------------------------------------------

/** One bead at most per cell of this size, CSS px. */
export const DROP_CELL_PX = 32;
export const DROP_MAX_COLS = 96;
export const DROP_MAX_ROWS = 40;
/** Births per empty cell per second at full ramp and headroom. */
export const DROP_BIRTH_RATE = 0.28;
/** After a pass a cell stays dry this long, then ramps back to full births over DROP_RAMP_S. */
export const DROP_RAMP_DELAY_S = 0.5;
export const DROP_RAMP_S = 1.7;
/** Births stop as the live share of cells approaches this. */
export const DROP_OCCUPANCY = 0.6;
/** Final radius, CSS px: min + spread * u^2. */
export const DROP_RADIUS_MIN_PX = 2.2;
export const DROP_RADIUS_SPREAD_PX = 5.3;
/** A bead grows to its final size over this long. */
export const DROP_GROW_S = 0.45;
/** Beads at least this big creep down the glass at this speed. */
export const DROP_CREEP_MIN_R = 5;
export const DROP_CREEP_PX_S = 0.6;
/** Share of cells seeded, already grown, when the field mounts. */
export const DROP_PRESEED = 0.3;
/** How far inside a bead the blob field is sampled (a lens), as a fraction of the offset. */
export const DROP_LENS = 0.55;
/** Specular highlight strength on a bead. */
export const DROP_SPEC = 0.35;
/** No bead is born behind a moving edge or within this many radians ahead of it, past its own extent. */
export const DROP_EDGE_CLEARANCE_RAD = 0.03;

/** The static frost grain raster. */
export const FROST_FIELD_WIDTH = 256;
export const FROST_FIELD_HEIGHT = 128;
/** Two octaves of value noise at these scales, CSS px. */
export const FROST_SCALES_PX: readonly [number, number] = [90, 9];
/** Frost starts to return this long after a pass and grows on this time constant. */
export const FROST_DELAY_S = 1.8;
export const FROST_TAU_S = 3.5;
/** Full frost pulls the scene this far toward the frost tint: light scheme, dark scheme. */
export const FROST_MAX: readonly [number, number] = [0.16, 0.14];
/** The field clock's stamp for passes that happened before the field existed. */
export const FROST_PRESEED_S = -3;
