export type RendererTier = 'webgpu' | 'webgl2' | 'none';

export interface SceneBlob {
	/** Canvas CSS px. */
	x: number;
	y: number;
	/** Rendered body radius, CSS px. */
	r: number;
	/** 0..1 linear-ish sRGB. */
	color: readonly [number, number, number];
}

/** One wiper arm as the scene draws it; CSS px and radians, pane-local. */
export interface SceneArm {
	pivotX: number;
	pivotY: number;
	/** Blade angle in the conic convention: from straight up, clockwise positive. */
	phi: number;
	/** Hub to blade tip. */
	length: number;
	/** Arm width at the hinge; every part scales from it. */
	width: number;
	/** Where the rubber starts along the arm, from the hub. */
	bladeFrom: number;
	/** Rubber lag against travel, -1..1. */
	flex: number;
	/** Sweep direction; the anatomy mirrors with it. */
	dir: 1 | -1;
}

export interface SceneFrame {
	/** Seconds. */
	time: number;
	ground: readonly [number, number, number];
	/** The SVG layer's own convention: multiply in light, screen in dark. */
	blend: 'multiply' | 'screen';
	blobs: readonly SceneBlob[];
	arms: readonly SceneArm[];
	inkAlpha: number;
}

export type RendererFailure =
	| { readonly kind: 'no-api' }
	| { readonly kind: 'no-context' }
	| { readonly kind: 'compile'; readonly stage: 'vertex' | 'fragment' | 'link' }
	| { readonly kind: 'context-lost' };

export interface RendererHandle {
	readonly tier: Exclude<RendererTier, 'none'>;
	/** CSS size and device pixel ratio; the backing store follows. */
	resize(cssWidth: number, cssHeight: number, dpr: number): void;
	uploadInk(field: Uint8Array, width: number, height: number): void;
	render(frame: SceneFrame): void;
	onLost(callback: (failure: RendererFailure) => void): void;
	destroy(): void;
}

export type RendererSelection = { ok: true; handle: RendererHandle } | { ok: false; why: RendererFailure };
