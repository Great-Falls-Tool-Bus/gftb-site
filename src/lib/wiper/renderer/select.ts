// The renderer ladder: webgpu, then webgl2, then none (the plain grid: no
// canvas, no scene). Silent by construction: every rung's failure comes back
// as a selection result, never as a console line. A page-wide ceiling only
// lowers: a rung that fails or is lost is never probed again on this page,
// and `<html data-wiper-tier-max="webgl2|none">` caps it from the outside
// (a test and LOOK hook; no URL query, no storage). Nothing GPU-shaped is
// imported statically, so the SSR graph stays clean. The WebGL2 chunk is
// fetched alongside the WebGPU rung, so a demotion (a deadline, a refusal,
// a loss) costs no second round trip. A lost WebGL2 context does not lower
// the ceiling: the browser restores such contexts, and a GPU reset that
// takes one takes every rung with it, so the host tries WebGL2 again on
// fresh canvases and only a creation failure ends the ladder.
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
	const wantsWebGPU = top === 'webgpu' && typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
	const hasWebGL2 = typeof WebGL2RenderingContext !== 'undefined';
	const webgpuChunk = wantsWebGPU ? import('./webgpu') : null;
	// Warmed, not awaited: a chunk that fails to load surfaces where it is
	// awaited below, never as an unhandled rejection on the console.
	const webgl2Chunk = hasWebGL2 ? import('./webgl2') : null;
	webgl2Chunk?.catch(() => {});
	if (webgpuChunk) {
		try {
			const { createWebGPURenderer } = await webgpuChunk;
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
	if (!webgl2Chunk) return { ok: false, why: { kind: 'no-api' } };
	try {
		const { createWebGL2Renderer } = await webgl2Chunk;
		return createWebGL2Renderer(canvas, options);
	} catch {
		return { ok: false, why: { kind: 'no-context' } };
	}
}
