// The renderer ladder: webgpu, then webgl2, then none (the plain grid: no
// canvas, no scene). Silent by construction: every rung's failure comes back
// as a selection result, never as a console line. A page-wide ceiling only
// lowers: a rung that fails or is lost is never probed again on this page,
// and `<html data-wiper-tier-max="webgl2|none">` caps it from the outside
// (a test and LOOK hook; no URL query, no storage). Nothing GPU-shaped is
// imported statically, so the SSR graph stays clean.
import type { RendererOptions, RendererSelection, RendererTier } from './types';

const RANK: Record<RendererTier, number> = { none: 0, webgl2: 1, webgpu: 2 };

let pageCeiling: RendererTier = 'webgpu';

function lowerCeiling(to: RendererTier): void {
	if (RANK[to] < RANK[pageCeiling]) pageCeiling = to;
}

/** The highest rung to try, given the html attribute and the page's own ceiling. */
export function resolveCeiling(raw: string | undefined, ceiling: RendererTier = pageCeiling): RendererTier {
	const asked: RendererTier = raw === 'webgl2' || raw === 'none' ? raw : 'webgpu';
	return RANK[asked] < RANK[ceiling] ? asked : ceiling;
}

/** Test seam: the page ceiling as it stands. */
export function currentCeiling(): RendererTier {
	return pageCeiling;
}

export function masksSupported(): boolean {
	return typeof CSS !== 'undefined' && CSS.supports('mask-image', 'conic-gradient(#000, #000)');
}

export async function selectRenderer(
	canvas: HTMLCanvasElement,
	options: RendererOptions = { layer: 'scene' },
): Promise<RendererSelection> {
	const raw = typeof document === 'undefined' ? undefined : document.documentElement.dataset.wiperTierMax;
	const top = resolveCeiling(raw, pageCeiling);
	if (top === 'none') return { ok: false, why: { kind: 'no-api' } };
	if (top === 'webgpu' && typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
		try {
			const { createWebGPURenderer } = await import('./webgpu');
			const picked = await createWebGPURenderer(canvas, options);
			if (picked.ok) {
				picked.handle.onLost(() => lowerCeiling('webgl2'));
				return picked;
			}
		} catch {
			// Silent: the rung below takes over.
		}
		lowerCeiling('webgl2');
	}
	if (typeof WebGL2RenderingContext === 'undefined') return { ok: false, why: { kind: 'no-api' } };
	try {
		const { createWebGL2Renderer } = await import('./webgl2');
		const picked = createWebGL2Renderer(canvas, options);
		if (picked.ok) picked.handle.onLost(() => lowerCeiling('none'));
		return picked;
	} catch {
		return { ok: false, why: { kind: 'no-context' } };
	}
}
