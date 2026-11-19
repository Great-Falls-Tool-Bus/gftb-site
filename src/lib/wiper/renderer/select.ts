// Try WebGPU, then WebGL2, then the plain grid. Load both GPU modules dynamically so SSR
// imports neither and demotion needs no extra round trip. A failed rung lowers the page
// ceiling. A lost WebGL2 context can recover on fresh canvases. data-wiper-tier-max can lower
// the ceiling for tests.
import type { RendererOptions, RendererSelection, RendererTier } from './types';

const RANK: Record<RendererTier, number> = { none: 0, webgl2: 1, webgpu: 2 };

let pageCeiling: RendererTier = 'webgpu';

function lowerCeiling(to: RendererTier): void {
	if (RANK[to] < RANK[pageCeiling]) pageCeiling = to;
}

/**
 * Start a reload on WebGL2. Chrome can drop the new document’s WebGPU device while tearing down
 * the old one.
 */
export function resolveCeiling(
	raw: string | undefined,
	ceiling: RendererTier = pageCeiling,
	navigation: string | undefined = navigationType(),
): RendererTier {
	const asked: RendererTier = raw === 'webgl2' || raw === 'none' ? raw : navigation === 'reload' ? 'webgl2' : 'webgpu';
	return RANK[asked] < RANK[ceiling] ? asked : ceiling;
}

/** How this document was reached, from the navigation timing entry; unknown where the API is absent. */
export function navigationType(): string | undefined {
	if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return undefined;
	const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
	return entry?.type;
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
	// Start loading now and handle errors when the chunk is awaited.
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
