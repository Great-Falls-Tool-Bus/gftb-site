// The renderer ladder. M2 ships the WebGL2 rung; the WebGPU rung joins at
// M5 in front of it. `none` means the plain grid: no canvas, no scene.
import type { RendererOptions, RendererSelection } from './types';

export function masksSupported(): boolean {
	return typeof CSS !== 'undefined' && CSS.supports('mask-image', 'conic-gradient(#000, #000)');
}

export async function selectRenderer(
	canvas: HTMLCanvasElement,
	options: RendererOptions = { layer: 'scene' },
): Promise<RendererSelection> {
	if (typeof WebGL2RenderingContext === 'undefined') return { ok: false, why: { kind: 'no-api' } };
	try {
		const { createWebGL2Renderer } = await import('./webgl2');
		return createWebGL2Renderer(canvas, options);
	} catch {
		return { ok: false, why: { kind: 'no-context' } };
	}
}
