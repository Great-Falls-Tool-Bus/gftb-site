import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND_BLOB_COLORS } from '../brand-blob-colors';
import { WIPER_DETENTS } from './schedule';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');

// The parts of the wiper the browser rows cannot see from a single state:
// where the masks may live, that the pane is not a card, that every timed
// rule sits behind the motion preference, and that the stalk is the one
// Skeleton control with radius 0 on every part.
describe('the wiper source contract', () => {
	const css = read('src/app.css');
	const blockStart = css.indexOf('/* ===== The Notes & Goals wiper');
	const blockEnd = css.indexOf('@media (forced-colors: active)', blockStart);
	const block = css.slice(blockStart, blockEnd);

	it('keeps the stylesheet block and the component in place', () => {
		expect(blockStart).toBeGreaterThan(0);
		expect(blockEnd).toBeGreaterThan(blockStart);
	});

	it('paints the pane as nothing: no background, no border', () => {
		const pane = /\.wiper \{([^}]*)\}/u.exec(block);
		expect(pane).not.toBeNull();
		expect(pane![1]).not.toMatch(/background|border(?!-radius)|box-shadow|backdrop/u);
	});

	it('masks only paged notes, only by their wipe role, with the shared unit and span', () => {
		const masks = [...block.matchAll(/^([^\n{]+)\{\n[^}]*mask-image:/gmu)].map((match) => match[1].trim());
		expect(masks).toEqual([".goal-list--paged > li[data-wipe='out']", ".goal-list--paged > li[data-wipe='in']"]);
		expect(block).toMatch(/transparent 0 calc\(var\(--wipe-u\) \* var\(--wipe-span\)\)/u);
		expect(block).toMatch(/#000 0 calc\(var\(--wipe-u\) \* var\(--wipe-span\)\)/u);
		expect(css).not.toMatch(/\.goal-list > li[^{]*\{[^}]*mask-image/u);
	});

	it('declares no timed rule at all: a detent click repaints, nothing slides or sweeps in CSS', () => {
		const timed = [...block.matchAll(/^\s*(transition|animation)(?:-[a-z]+)?:\s*([^;]+);/gmu)].filter(
			(match) => match[2].trim() !== 'none',
		);
		expect(timed.map((match) => match[0].trim())).toEqual([]);
		expect(block).not.toMatch(/@keyframes|prefers-reduced-motion: no-preference/u);
	});

	it('gives the stalk radius 0 on every part and the ratified focus edge', () => {
		for (const part of ['.wiper-stalk', '.wiper-stalk__control', '.wiper-stalk__item']) {
			const rule = new RegExp(`${part.replace(/[.$]/gu, '\\$&')} \\{([^}]*)\\}`, 'u').exec(block);
			expect(rule, part).not.toBeNull();
			expect(rule![1], part).toMatch(/border-radius: 0;/u);
		}
		expect(block).toMatch(
			/\.wiper-stalk__item\[data-focus-visible\] \{\n\toutline: 2px solid var\(--highlight-edge\);/u,
		);
		// Interim text treatment: the active detent is accent ink with a rule under it; no part is a box.
		expect(block).toMatch(
			/\.wiper-stalk__item\[data-state='checked'\] \{\n\tcolor: var\(--link\);\n\ttext-decoration: underline;/u,
		);
		for (const part of ['.wiper-stalk', '.wiper-stalk__control', '.wiper-stalk__item']) {
			const rule = new RegExp(`${part.replace(/[.$]/gu, '\\$&')} \\{([^}]*)\\}`, 'u').exec(block);
			expect(rule![1], `${part} is text, not a box`).not.toMatch(/background|box-shadow|border(?!-radius)/u);
		}
	});

	it('unwinds the paging on paper and hides the stalk', () => {
		const print = css.slice(css.indexOf('@media print {'));
		expect(print).toMatch(/\.goal-list--paged > li \{[^}]*mask-image: none !important;/u);
		expect(print).toMatch(/\.wiper-stalk,\n\t\.wiper__scene,\n\t\.goal-edit \{\n\t\tdisplay: none !important;/u);
	});

	it('renders one Skeleton SegmentedControl with the four detents and no other control', () => {
		const controls = read('src/lib/components/WiperControls.svelte');
		expect(controls).toContain("import { SegmentedControl } from '@skeletonlabs/skeleton-svelte';");
		expect(controls).toContain('{#each WIPER_DETENTS as detent (detent.id)}');
		expect(controls).toContain('<ItemHiddenInput />');
		expect(controls).toContain('const { Label, Control, Item, ItemText, ItemHiddenInput } = SegmentedControl;');
		expect(controls).not.toMatch(/Switch|<button|Indicator/u);
		expect(WIPER_DETENTS.map((entry) => entry.id)).toEqual(['off', 'intermittent', 'low', 'high']);
		const goals = read('src/lib/components/NotesAndGoals.svelte');
		expect(goals).toContain("import { WiperEngine } from '$lib/wiper/engine.svelte';");
		expect(goals).toContain('{#if view.rotatable}');
		expect(goals).toContain('<WiperControls {engine} />');
		expect(goals).toContain('class:goal-list--paged={view.paged}');
		expect(goals).toContain('data-wipe={wipeRole(index)}');
		expect(goals).not.toMatch(/svelte\/transition|svelte\/motion|requestAnimationFrame/u);
	});

	it('writes one number per frame and never a keyframe', () => {
		const engine = read('src/lib/wiper/engine.svelte.ts');
		expect(engine).toContain("this.#pane?.style.setProperty('--wipe-u', unit.toFixed(4));");
		expect(engine).not.toMatch(/animate\(|@keyframes/u);
		expect(engine).toContain("const FREEZE_ATTR = 'wiperFreeze';");
	});

	it('keeps the scene behind the notes, sharp, inert, and gone on paper and under forced colours', () => {
		const scene = /\.wiper__scene \{([^}]*)\}/u.exec(css);
		expect(scene).not.toBeNull();
		expect(scene![1]).toMatch(/position: absolute;/u);
		expect(scene![1]).toMatch(/z-index: 0;/u);
		expect(scene![1]).toMatch(/pointer-events: none;/u);
		expect(scene![1]).toMatch(/border-radius: 0;/u);
		expect(css).toMatch(/\.wiper__glass > \.goal-list \{[^}]*z-index: 1;/u);
		const print = css.slice(css.indexOf('@media print {'));
		expect(print).toMatch(/\.wiper__scene,\n\t\.goal-edit \{\n\t\tdisplay: none !important;/u);
		const forced = css.slice(css.indexOf('@media (forced-colors: active) {\n\t.wiper__scene'));
		expect(forced).toMatch(/\.wiper__scene \{\n\t\tdisplay: none;/u);
		const host = read('src/lib/components/WiperScene.svelte');
		expect(host).toContain('aria-hidden="true"');
		expect(host).toContain('inkAlpha: INK_SAFE_ALPHA');
		expect(host).not.toMatch(/console\./u);
		const goals = read('src/lib/components/NotesAndGoals.svelte');
		expect(goals).toContain('{#if view.paged && glassEl}');
		expect(goals).toContain('<WiperScene {engine} colors={BRAND_BLOB_COLORS} glass={glassEl} />');
	});

	it('ships shaders as strings with no host or mailbox in them and no console in the renderer', () => {
		const shader = read('src/lib/wiper/renderer/shaders/scene.glsl.ts');
		expect(shader).not.toMatch(/https?:|[\w.-]+@[\w.-]+\.\w{2,}/u);
		expect(shader).toContain('u_inkAlpha');
		const renderer = read('src/lib/wiper/renderer/webgl2.ts');
		expect(renderer).not.toMatch(/console\./u);
		expect(renderer).toContain("addEventListener('webglcontextlost'");
		expect(renderer).not.toContain('getShaderInfoLog');
	});

	it('feeds the scene the layout blob colours and the layout tilt vector', () => {
		const layout = read('src/routes/+layout.svelte');
		const literal = /colors=\{\[([^\]]+)\]\}/u.exec(layout);
		expect(literal).not.toBeNull();
		const layoutColors = literal![1].match(/#[0-9a-f]{6}/giu)?.map((hex) => hex.toLowerCase());
		expect(layoutColors).toEqual([...BRAND_BLOB_COLORS]);
		expect(layout).toContain('onDeviceMotion={setDeviceTilt}');
	});
});
