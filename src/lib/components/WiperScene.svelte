<script lang="ts">
	// The GPU scene behind the notes: an opaque canvas sized to the glass (the
	// list box), clearing to the page ground, drawing tinyvectors' blob field,
	// frost and beads; a second, transparent canvas over the notes draws the
	// chrome arms and blades, posed by the engine from the same clock and
	// easing as the DOM mask. The notes are glass panes whose inks read over
	// any backdrop, so no clamp under text (operator ruling, M4 ratification).
	// It sits behind the DOM notes, never over them; it is pointer-inert,
	// aria-hidden, absent under reduce, no-JS, print and forced colours, and
	// it never writes to the console: every failure demotes to the plain grid.
	import { onMount } from 'svelte';
	import { deviceTilt } from '$lib/motion/device-tilt.svelte';
	import { createBlobField, type BlobFieldHandle } from '$lib/wiper/blob-field';
	import { DropletField } from '$lib/wiper/droplet-field';
	import { FrostClock, rasterizeFrostField } from '$lib/wiper/frost-field';
	import { MAX_STEP_MS } from '$lib/wiper/machine';
	import type { WiperEngine } from '$lib/wiper/engine.svelte';
	import { selectRenderer } from '$lib/wiper/renderer/select';
	import {
		BLOB_RENDER_SCALE,
		BLOB_WINDOW_EXTENT,
		BLOB_WINDOW_ORIGIN,
		FROST_FIELD_HEIGHT,
		FROST_FIELD_WIDTH,
		FROST_SCALES_PX,
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
		// M4: the bead field and the frost clock live on the scene's own clock.
		let drops: DropletField | null = null;
		let dropsBox = '';
		const frostClock = new FrostClock();
		let frostBox = '';
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
		};

		const needsFrames = () => alive && visible && !hidden && renderer !== null && blades !== null && field !== null;

		/** Keep the bead grid and the frost grain matched to the glass box. */
		const syncGlass = () => {
			const geometry = engine.geometry;
			if (!renderer || !geometry || width <= 0 || height <= 0) return null;
			const key = `${Math.round(geometry.box.width)}x${Math.round(geometry.box.height)}`;
			if (!drops) drops = new DropletField(geometry);
			else if (dropsBox !== key) drops.relayout(geometry);
			if (dropsBox !== key) {
				dropsBox = key;
				renderer.uploadDroplets(drops.data, drops.cols, drops.rows, drops.cellCss);
			}
			if (frostBox !== key) {
				frostBox = key;
				renderer.uploadFrost(
					rasterizeFrostField(FROST_FIELD_WIDTH, FROST_FIELD_HEIGHT, geometry.box, FROST_SCALES_PX),
					FROST_FIELD_WIDTH,
					FROST_FIELD_HEIGHT,
				);
			}
			return geometry;
		};

		/** Draw the scene as it stands; the physics is advanced by the loop, not here. */
		const paint = (now: number) => {
			if (!renderer || !blades || !field) return;
			const geometry = syncGlass();
			const clock = engine.strokeClock(now);
			const frost = drops && geometry ? frostClock.value(clock.phase, drops.time) : 0;
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
			const frame = { time: now / 1000, ground, blend, blobs, frost };
			// Layer 0 reads the arms for its swept edge only; it draws no blade.
			renderer.render({ ...frame, arms });
			blades.render({ ...frame, arms, scissor: armsBox(arms, width, height) });
		};

		const frame = (now: number) => {
			raf = 0;
			if (!needsFrames() || !renderer || !blades || !field) return;
			const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
			const gap = last ? (now - last) / 1000 : 1 / 60;
			last = now;
			field.setTilt({ x: deviceTilt.x, y: deviceTilt.y, z: deviceTilt.z });
			field.tick(dt, now / 1000);
			// The bead field steps on the stroke clock: it stands still under a
			// hold or a paused rest, and never jumps more than the machine does.
			const geometry = syncGlass();
			if (drops && geometry && renderer) {
				const clock = engine.strokeClock(now);
				frostClock.note(clock, drops.time);
				const fieldDt = clock.held || (clock.paused && clock.phase === 'dwell') ? 0 : Math.min(gap, MAX_STEP_MS / 1000);
				if (drops.step(fieldDt, clock, geometry.arms)) {
					renderer.uploadDroplets(drops.data, drops.cols, drops.rows, drops.cellCss);
				}
			}
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
