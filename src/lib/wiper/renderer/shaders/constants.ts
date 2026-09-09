// Numbers shared by the shaders, the scene host and the unit tests. The ink
// clamp is the ratified blob-ground ceiling (src/lib/blob-ground-contrast.test.ts
// proves every text role clears its floor under one blob at this alpha), so
// the GPU scene inherits the analytic gate verbatim.

/** Under measured ink the scene may deviate from the page ground by this fraction at most. */
export const INK_SAFE_ALPHA = 0.15;
export const INK_FIELD_WIDTH = 256;
export const INK_FIELD_HEIGHT = 128;
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
