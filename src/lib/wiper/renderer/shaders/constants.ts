// Numbers shared by the shaders, the scene host and the unit tests.

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
export const DROP_SPEC = 0.22;
/** A bead's rim: the field darkens by this factor in light, brightens by this much in dark. */
export const DROP_RIM_DARKEN = 0.72;
export const DROP_RIM_LIGHTEN = 0.06;
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
export const FROST_MAX: readonly [number, number] = [0.16, 0.1];
/** The field clock's stamp for passes that happened before the field existed. */
export const FROST_PRESEED_S = -3;
