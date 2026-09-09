// The ink field: a small alpha raster of where text sits over the scene.
// The static field is rebuilt on relayout and page turns; a coarser moving
// field follows the outgoing notes every frame of the out-stroke while the
// blade shoves them. The shader samples both and clamps the scene toward
// the page ground under the greater.
import { INK_DILATE_PX, INK_FEATHER_PX, INK_FIELD_HEIGHT, INK_FIELD_WIDTH } from './renderer/shaders/constants';

export interface InkRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface InkFieldOptions {
	width?: number;
	height?: number;
	dilatePx?: number;
	featherPx?: number;
}

/** Euclidean distance from a point to a rect's edge (0 inside). */
export function distanceToRect(x: number, y: number, rect: InkRect): number {
	const dx = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
	const dy = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
	return Math.hypot(dx, dy);
}

/**
 * Rasterise text rects (CSS px, relative to the scene box) into an 8-bit
 * field of `width x height` texels covering the box. 255 inside a dilated
 * rect, feathering to 0 over `featherPx`.
 */
export function rasterizeInkField(
	rects: readonly InkRect[],
	box: { width: number; height: number },
	options: InkFieldOptions = {},
): Uint8Array {
	const width = options.width ?? INK_FIELD_WIDTH;
	const height = options.height ?? INK_FIELD_HEIGHT;
	const dilate = options.dilatePx ?? INK_DILATE_PX;
	const feather = Math.max(options.featherPx ?? INK_FEATHER_PX, 1e-6);
	const out = new Uint8Array(width * height);
	if (rects.length === 0 || box.width <= 0 || box.height <= 0) return out;
	const cellW = box.width / width;
	const cellH = box.height / height;
	const reach = dilate + feather;
	// Each rect touches only the texels within its dilation and feather; the
	// field is the max over rects, so a rect never lowers what another set.
	for (const rect of rects) {
		const tx0 = Math.max(0, Math.floor((rect.left - reach) / cellW));
		const tx1 = Math.min(width - 1, Math.ceil((rect.left + rect.width + reach) / cellW));
		const ty0 = Math.max(0, Math.floor((rect.top - reach) / cellH));
		const ty1 = Math.min(height - 1, Math.ceil((rect.top + rect.height + reach) / cellH));
		for (let ty = ty0; ty <= ty1; ty += 1) {
			const y = (ty + 0.5) * cellH;
			const row = ty * width;
			for (let tx = tx0; tx <= tx1; tx += 1) {
				const x = (tx + 0.5) * cellW;
				const d = distanceToRect(x, y, rect);
				if (d >= reach) continue;
				const alpha = Math.min(Math.max(1 - (d - dilate) / feather, 0), 1);
				const value = Math.round(alpha * 255);
				if (value > out[row + tx]) out[row + tx] = value;
			}
		}
	}
	return out;
}
