<script lang="ts">
	// The scene canvas draws the page ground, tinyvectors blobs, frost and beads beneath the
	// notes. The transparent canvas draws the blades above them on the mask clock. Both
	// canvases ignore pointer input and assistive technology. A failed renderer falls back to
	// the plain grid. After device loss, `onlost` requests fresh canvases at the lower ceiling
	// because a canvas cannot switch context kinds.
	import { onMount } from 'svelte';
	import { deviceTilt } from '#lib/motion/device-tilt.svelte.js';
	import { createBlobField, type BlobFieldHandle } from '#lib/wiper/blob-field.js';
	import { DropletField } from '#lib/wiper/droplet-field.js';
	import { FrostClock, rasterizeFrostField } from '#lib/wiper/frost-field.js';
	import { MAX_STEP_MS } from '#lib/wiper/machine.js';
	import type { WiperEngine } from '#lib/wiper/engine.svelte.js';
	import { selectRenderer } from '#lib/wiper/renderer/select.js';
	import {
		BLOB_RENDER_SCALE,
		BLOB_WINDOW_EXTENT,
		BLOB_WINDOW_ORIGIN,
		FROST_FIELD_HEIGHT,
		FROST_FIELD_WIDTH,
		FROST_SCALES_PX,
		MAX_BLOBS,
	} from '#lib/wiper/renderer/shaders/constants.js';
	import type { RendererHandle, RendererTier, SceneArm, SceneBlob } from '#lib/wiper/renderer/types.js';

	interface Props {
		engine: WiperEngine;
		colors: readonly string[];
		/** The glass: the element the canvas fills and whose text is the ink. */
		glass: HTMLElement;
		/** A device lost after selection: the parent remounts the scene on fresh canvases. */
		onlost?: () => void;
	}

	const { engine, colors, glass, onlost }: Props = $props();

	let canvas = $state<HTMLCanvasElement>();
	let bladesCanvas = $state<HTMLCanvasElement>();
	let tier = $state<'pending' | RendererTier>('pending');
	// Keep the intro veil up until several frames have drawn so an immediate device loss can
	// recover underneath it.
	let warm = $state(false);
	const WARM_FRAMES = 12;
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

	/** Track the area the arms can touch in CSS pixels. Return null while every blade is
	 * out of frame. */
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
		// Draw the blades on a transparent canvas above the notes as specified at LOOK 3.
		let blades: RendererHandle | null = null;
		let field: BlobFieldHandle | null = null;
		let raf = 0;
		let last = 0;
		let visible = true;
		let drawn = 0;
		let hidden = document.hidden;
		let width = 0;
		let height = 0;
		let ground = resolveRole('--bg');
		// M4: the bead field and the frost clock live on the scene's own clock.
		let drops: DropletField | null = null;
		let bladesIdle = false;
		let dropsBox = '';
		const frostClock = new FrostClock();
		let frostBox = '';
		let blend: 'multiply' | 'screen' = document.documentElement.dataset.mode === 'dark' ? 'screen' : 'multiply';
		const palette = colors.slice(0, MAX_BLOBS).map(hexToRgb);
		const controller = new AbortController();
		const { signal } = controller;

		const demote = () => {
			if (!alive) return;
			alive = false;
			delete element.dataset.glassTime;
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

		// The rung lowers the page ceiling on loss before the parent remounts. Without a
		// parent, fall back to the plain grid.
		const lose = () => {
			if (!alive) return;
			delete element.dataset.glassTime;
			if (!onlost) {
				demote();
				return;
			}
			alive = false;
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			renderer?.destroy();
			renderer = null;
			blades?.destroy();
			blades = null;
			field?.dispose();
			field = null;
			engine.tier = 'none';
			onlost();
		};

		const measure = () => {
			const box = host.getBoundingClientRect();
			width = box.width;
			height = box.height;
			const ratio = Math.min(window.devicePixelRatio || 1, 2);
			renderer?.resize(width, height, ratio);
			blades?.resize(width, height, ratio);
		};

		// Draw behind the intro veil even while off screen to catch failures on the first
		// frames.
		const veiled = () => document.documentElement.classList.contains('intro-live');
		const needsFrames = () =>
			alive && (visible || veiled()) && !hidden && renderer !== null && blades !== null && field !== null;

		/** Keep the bead grid and the frost grain matched to the glass box. */
		const syncGlass = () => {
			const geometry = engine.geometry;
			if (!renderer || !geometry || width <= 0 || height <= 0) return null;
			// Key the field on grid dimensions. Preserve beads and frost until the row or column count changes.
			if (!drops) drops = new DropletField(geometry);
			else drops.relayout(geometry);
			const key = `${drops.cols}x${drops.rows}`;
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
			// The machine clock and mask easing place the blades on the mask edge regardless
			// of which callback runs first.
			const arms: SceneArm[] = engine.blades(now);
			const frame = { time: now / 1000, ground, blend, blobs, frost };
			// A WebGPU draw can demote synchronously. Recheck the handles between the two
			// draws.
			const scene = renderer;
			const over = blades;
			// Layer 0 reads the arms for its swept edge only; it draws no blade.
			scene.render({ ...frame, arms });
			if (!alive || renderer !== scene || blades !== over) return;
			// Read the droplet clock after this canvas draws. Wall time can outrun the capped
			// field step.
			if (document.documentElement.dataset.wiperFreeze === 'rest' && drops && geometry)
				element.dataset.glassTime = String(drops.time);
			else delete element.dataset.glassTime;
			// Clear the layer once when the arms park. Redraw when they move.
			const idle = arms.every((arm) => arm.travel === 0);
			if (idle && bladesIdle) return;
			over.render({ ...frame, arms, scissor: idle ? null : armsBox(arms, width, height) });
			bladesIdle = idle;
		};

		const frame = (now: number) => {
			raf = 0;
			if (!needsFrames() || !renderer || !blades || !field) return;
			const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
			const gap = last ? (now - last) / 1000 : 1 / 60;
			last = now;
			// Pause the blobs with the stroke clock so the scene stays still during keyboard
			// reading.
			const clock = engine.strokeClock(now);
			field.setTilt({ x: deviceTilt.x, y: deviceTilt.y, z: deviceTilt.z });
			field.tick(clock.paused ? 0 : dt, now / 1000);
			// Use the stroke clock for the beads so they stay still during holds and follow
			// the machine’s step limit.
			const geometry = syncGlass();
			if (drops && geometry && renderer) {
				frostClock.note(clock, drops.time);
				const fieldDt = clock.held || (clock.paused && clock.phase === 'dwell') ? 0 : Math.min(gap, MAX_STEP_MS / 1000);
				if (drops.step(fieldDt, clock, geometry.arms)) {
					renderer.uploadDroplets(drops.data, drops.cols, drops.rows, drops.cellCss);
				}
			}
			paint(now);
			if (!warm && alive) {
				drawn += 1;
				if (drawn >= WARM_FRAMES) warm = true;
			}
			raf = requestAnimationFrame(frame);
		};

		const arm = () => {
			if (raf || !needsFrames()) return;
			last = 0;
			raf = requestAnimationFrame(frame);
		};

		(async () => {
			const selection = await selectRenderer(element, { layer: 'scene' });
			if (!alive) {
				// Unmounted while the ladder ran: release what it resolved.
				if (selection.ok) selection.handle.destroy();
				return;
			}
			if (!selection.ok) {
				demote();
				return;
			}
			renderer = selection.handle;
			renderer.onLost(() => lose());
			const bladeSelection = await selectRenderer(bladesElement, { layer: 'blades' });
			if (!alive) {
				if (bladeSelection.ok) bladeSelection.handle.destroy();
				return;
			}
			if (!bladeSelection.ok) {
				// The scene rung came up but the blades could not: a device that
				// died between the two calls, or a rung refused on the second
				// canvas. Fresh canvases at the ceiling the failure left.
				lose();
				return;
			}
			blades = bladeSelection.handle;
			blades.onLost(() => lose());
			// Both canvases need the same rung so their geometry uses the same floating-point
			// arithmetic. Remount both at the lower rung after the second canvas steps down.
			if (blades.tier !== renderer.tier) {
				lose();
				return;
			}
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
			tier = renderer.tier;
			engine.tier = renderer.tier;
			measure();
			// Paint once on load. A background tab receives no animation frames until it
			// becomes visible.
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
			// The veil arriving or leaving changes whether frames are due.
			arm();
		});
		modeWatch.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-mode', 'data-theme', 'class'],
		});

		return () => {
			alive = false;
			delete element.dataset.glassTime;
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
	<canvas class="wiper__scene" aria-hidden="true" data-tier={tier} data-warm={warm ? '' : undefined} bind:this={canvas}
	></canvas>
	<canvas
		class="wiper__blades"
		aria-hidden="true"
		data-tier={tier}
		data-warm={warm ? '' : undefined}
		bind:this={bladesCanvas}
	></canvas>
{/if}
