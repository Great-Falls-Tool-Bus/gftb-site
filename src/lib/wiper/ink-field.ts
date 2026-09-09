// The ink field: a small alpha raster of where text sits over the scene,
// rebuilt on relayout (never per frame). The shader samples it once per
// fragment and clamps the scene toward the page ground under ink.
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
	for (let ty = 0; ty < height; ty += 1) {
		const y = (ty + 0.5) * cellH;
		for (let tx = 0; tx < width; tx += 1) {
			const x = (tx + 0.5) * cellW;
			let nearest = Infinity;
			for (const rect of rects) {
				const d = distanceToRect(x, y, rect);
				if (d < nearest) nearest = d;
				if (nearest <= dilate) break;
			}
			const alpha = Math.min(Math.max(1 - (nearest - dilate) / feather, 0), 1);
			out[ty * width + tx] = Math.round(alpha * 255);
		}
	}
	return out;
}
