<script lang="ts">
	// The GPU scene behind the notes: an opaque canvas sized to the glass (the
	// list box), clearing to the page ground, drawing tinyvectors' blob field
	// and the chrome arms and blades (posed by the engine from the same clock
	// and easing as the DOM mask) under an ink clamp; frost and droplets join
	// at M4.
	// It sits behind the DOM notes, never over them; it is pointer-inert,
	// aria-hidden, absent under reduce, no-JS, print and forced colours, and
	// it never writes to the console: every failure demotes to the plain grid.
	import { onMount } from 'svelte';
	import { deviceTilt } from '$lib/motion/device-tilt.svelte';
	import { createBlobField, type BlobFieldHandle } from '$lib/wiper/blob-field';
	import type { WiperEngine } from '$lib/wiper/engine.svelte';
	import { rasterizeInkField, type InkRect } from '$lib/wiper/ink-field';
	import { selectRenderer } from '$lib/wiper/renderer/select';
	import {
		BLOB_RENDER_SCALE,
		BLOB_WINDOW_EXTENT,
		BLOB_WINDOW_ORIGIN,
		INK_FIELD_HEIGHT,
		INK_FIELD_WIDTH,
		INK_MOVING_HEIGHT,
		INK_MOVING_WIDTH,
		INK_SAFE_ALPHA,
		MAX_BLOBS,
	} from '$lib/wiper/renderer/shaders/constants';
	import type { RendererHandle, SceneArm, SceneBlob } from '$lib/wiper/renderer/types';

	interface Props {
		engine: WiperEngine;
		colors: readonly string[];
		/** The glass: the element the canvas fills and whose text is the ink. */
		glass: HTMLElement;
	}

	const { engine, colors, glass }: Props = $props();

	let canvas = $state<HTMLCanvasElement>();
	let bladesCanvas = $state<HTMLCanvasElement>();
	let tier = $state<'pending' | 'webgl2' | 'none'>('pending');
	const view = $derived(engine.view);
	let inkDirty = true;

	// The visible notes change at every page turn and during the out-stroke.
	$effect(() => {
		void view.page;
		void view.outgoing;
		void view.incoming;
		inkDirty = true;
	});

	function hexToRgb(hex: string): [number, number, number] {
		const value = Number.parseInt(hex.replace('#', ''), 16);
		return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
	}

	/** Resolve a role custom property (oklch or otherwise) to sRGB 0..1 through a 2D canvas. */
	function resolveRole(name: string): [number, number, number] {
		const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		const probe = document.createElement('canvas');
		probe.width = 1;
		probe.height = 1;
		const context = probe.getContext('2d', { willReadFrequently: true });
		if (!context) return [0.97, 0.94, 0.87];
		context.fillStyle = raw || '#f7f0df';
		context.fillRect(0, 0, 1, 1);
		const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
		return [r / 255, g / 255, b / 255];
	}

	/** The box the arms can touch this frame, CSS px, or null when every blade is out of frame. */
	function armsBox(arms: readonly SceneArm[], width: number, height: number) {
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		for (const arm of arms) {
			const tipX = arm.pivotX + arm.length * Math.sin(arm.phi);
			const tipY = arm.pivotY - arm.length * Math.cos(arm.phi);
			// Shadow and anatomy reach a few widths from the centreline.
			const margin = 4 * arm.width + 4;
			left = Math.min(left, tipX, arm.pivotX) - margin;
			right = Math.max(right, tipX, arm.pivotX) + margin;
			top = Math.min(top, tipY, arm.pivotY) - margin;
			bottom = Math.max(bottom, tipY, arm.pivotY) + margin;
		}
		const x = Math.max(0, left);
		const y = Math.max(0, top);
		const x2 = Math.min(width, right);
		const y2 = Math.min(height, bottom);
		if (!(x2 > x && y2 > y)) return null;
		return { x, y, width: x2 - x, height: y2 - y };
	}

	function inkRects(
		host: HTMLElement,
		rowSelector = '.goal-list > li.is-current, .goal-list > li[data-wipe]',
	): InkRect[] {
		const box = host.getBoundingClientRect();
		const rects: InkRect[] = [];
		const rows = host.querySelectorAll<HTMLElement>(rowSelector);
		for (const row of rows) {
			for (const el of row.querySelectorAll<HTMLElement>('h3, p, a')) {
				const r = el.getBoundingClientRect();
				if (r.width <= 0 || r.height <= 0) continue;
				rects.push({ left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height });
			}
		}
		return rects;
	}

	onMount(() => {
		const host = glass;
		const element = canvas;
		const bladesElement = bladesCanvas;
		if (!host || !element || !bladesElement) return;
		let alive = true;
		let renderer: RendererHandle | null = null;
		// The blade layer: a transparent canvas over the notes, so the arms pass
		// over the panes they wipe (operator ruling at LOOK 3).
		let blades: RendererHandle | null = null;
		let field: BlobFieldHandle | null = null;
		let raf = 0;
		let last = 0;
		let visible = true;
		let hidden = document.hidden;
		let width = 0;
		let height = 0;
		let ground = resolveRole('--bg');
		let blend: 'multiply' | 'screen' = document.documentElement.dataset.mode === 'dark' ? 'screen' : 'multiply';
		const palette = colors.slice(0, MAX_BLOBS).map(hexToRgb);
		const controller = new AbortController();
		const { signal } = controller;

		const demote = () => {
			alive = false;
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			renderer?.destroy();
			renderer = null;
			blades?.destroy();
			blades = null;
			field?.dispose();
			field = null;
			tier = 'none';
			engine.tier = 'none';
		};

		const measure = () => {
			const box = host.getBoundingClientRect();
			width = box.width;
			height = box.height;
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			renderer?.resize(width, height, ratio);
			blades?.resize(width, height, ratio);
			inkDirty = true;
		};

		const uploadInk = () => {
			if (!renderer || width <= 0 || height <= 0) return;
			renderer.uploadInk(rasterizeInkField(inkRects(host), { width, height }), INK_FIELD_WIDTH, INK_FIELD_HEIGHT);
			inkDirty = false;
		};

		// While the blade shoves the outgoing notes their text moves every
		// frame; the static field was rasterised where they started, so a
		// coarse moving field follows them and is cleared when they are gone.
		let movingOn = false;
		const uploadMovingInk = () => {
			if (!renderer || width <= 0 || height <= 0) return;
			const outgoing = inkRects(host, '.goal-list > li[data-wipe="out"]');
			if (outgoing.length === 0) {
				if (movingOn) renderer.uploadMovingInk(null, 1, 1);
				movingOn = false;
				return;
			}
			renderer.uploadMovingInk(
				rasterizeInkField(outgoing, { width, height }, { width: INK_MOVING_WIDTH, height: INK_MOVING_HEIGHT }),
				INK_MOVING_WIDTH,
				INK_MOVING_HEIGHT,
			);
			movingOn = true;
		};

		const needsFrames = () => alive && visible && !hidden && renderer !== null && blades !== null && field !== null;

		/** Draw the scene as it stands; the physics is advanced by the loop, not here. */
		const paint = (now: number) => {
			if (!renderer || !blades || !field) return;
			if (inkDirty) uploadInk();
			uploadMovingInk();
			// The field's window covers the glass the way the SVG's viewBox does (slice).
			const scale = Math.max(width, height) / BLOB_WINDOW_EXTENT;
			const offsetX = (width - BLOB_WINDOW_EXTENT * scale) / 2;
			const offsetY = (height - BLOB_WINDOW_EXTENT * scale) / 2;
			const blobs: SceneBlob[] = field
				.blobs()
				.slice(0, MAX_BLOBS)
				.map((blob, index) => ({
					x: (blob.currentX - BLOB_WINDOW_ORIGIN) * scale + offsetX,
					y: (blob.currentY - BLOB_WINDOW_ORIGIN) * scale + offsetY,
					r: blob.size * BLOB_RENDER_SCALE * scale,
					color: palette[index % palette.length],
				}));
			// The blades at this frame's timestamp: the engine derives them from
			// the machine clock through the mask's own easing, so the drawn blade
			// sits on the mask edge whichever callback the browser runs first.
			const arms: SceneArm[] = engine.blades(now);
			const frame = { time: now / 1000, ground, blend, blobs, inkAlpha: INK_SAFE_ALPHA };
			renderer.render({ ...frame, arms: [] });
			blades.render({ ...frame, arms, scissor: armsBox(arms, width, height) });
		};

		const frame = (now: number) => {
			raf = 0;
			if (!needsFrames() || !renderer || !blades || !field) return;
			const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
			last = now;
			field.setTilt({ x: deviceTilt.x, y: deviceTilt.y, z: deviceTilt.z });
			field.tick(dt, now / 1000);
			paint(now);
			raf = requestAnimationFrame(frame);
		};

		const arm = () => {
			if (raf || !needsFrames()) return;
			last = 0;
			raf = requestAnimationFrame(frame);
		};

		(async () => {
			const selection = await selectRenderer(element, { layer: 'scene' });
			if (!alive) return;
			if (!selection.ok) {
				demote();
				return;
			}
			renderer = selection.handle;
			renderer.onLost(() => demote());
			const bladeSelection = await selectRenderer(bladesElement, { layer: 'blades' });
			if (!alive) return;
			if (!bladeSelection.ok) {
				demote();
				return;
			}
			blades = bladeSelection.handle;
			blades.onLost(() => demote());
			try {
				field = await createBlobField({
					count: 5,
					colors: [...colors],
					coarse: window.matchMedia('(pointer: coarse)').matches,
				});
			} catch {
				demote();
				return;
			}
			if (!alive) {
				field.dispose();
				return;
			}
			tier = 'webgl2';
			engine.tier = 'webgl2';
			measure();
			// A page that loads in a background tab gets no animation frames until
			// it is shown; paint once now so the buffer never shows empty.
			paint(performance.now());
			arm();
		})();

		const resize = new ResizeObserver(() => {
			measure();
			arm();
		});
		resize.observe(host);
		const intersection = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) visible = entry.isIntersecting;
				arm();
			},
			{ rootMargin: '10%' },
		);
		intersection.observe(element);
		document.addEventListener(
			'visibilitychange',
			() => {
				hidden = document.hidden;
				arm();
			},
			{ signal },
		);
		const modeWatch = new MutationObserver(() => {
			ground = resolveRole('--bg');
			blend = document.documentElement.dataset.mode === 'dark' ? 'screen' : 'multiply';
		});
		modeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-theme'] });
		document.fonts?.ready.then(() => {
			inkDirty = true;
		});

		return () => {
			alive = false;
			if (raf) cancelAnimationFrame(raf);
			resize.disconnect();
			intersection.disconnect();
			modeWatch.disconnect();
			controller.abort();
			renderer?.destroy();
			blades?.destroy();
			field?.dispose();
		};
	});
</script>

{#if tier !== 'none'}
	<canvas class="wiper__scene" aria-hidden="true" data-tier={tier} bind:this={canvas}></canvas>
	<canvas class="wiper__blades" aria-hidden="true" data-tier={tier} bind:this={bladesCanvas}></canvas>
{/if}
