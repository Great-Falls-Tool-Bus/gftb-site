import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WEBGPU_ACQUIRE_DEADLINE_MS } from './renderer/shaders/constants';
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
		const masked = [...block.matchAll(/^([^\n{]+)\{\n[^}]*mask-image:/gmu)].map((match) => match[1].trim());
		// The blade canvas feathers itself top and bottom; every other mask is a note's wipe.
		expect(masked.filter((selector) => !selector.startsWith('.goal-list'))).toEqual(['.wiper__blades']);
		const masks = masked.filter((selector) => selector.startsWith('.goal-list'));
		expect(masks).toEqual([
			".goal-list--paged > li[data-wipe='out']",
			".goal-list--paged > li[data-wipe='in']",
			".goal-list--paged > li[data-wipe='out'][data-wipe-arms='both']",
			".goal-list--paged > li[data-wipe='in'][data-wipe-arms='both']",
		]);
		// A note both blades pass over: the right wedge is cut to its span.
		expect(block).toMatch(/\[data-wipe='out'\]\[data-wipe-arms='both'\] \{[^}]*mask-composite: intersect, add;/u);
		expect(block).toMatch(/\[data-wipe='in'\]\[data-wipe-arms='both'\] \{[^}]*mask-composite: add, intersect;/u);
		// The second wedge is cut to the right blade's disc, not to its span.
		expect(block.match(/radial-gradient\(\n\t\t\tcircle at /gu)).toHaveLength(2);
		expect(block.match(/var\(--wipe-len-2\)/gu)).toHaveLength(4);
		expect(block).not.toMatch(/--wipe-split|linear-gradient\(90deg/u);
		const engineSource = read('src/lib/wiper/engine.svelte.ts');
		expect(engineSource).toContain("'--wipe-len-2'");
		expect(engineSource).toContain('leftToRight([owner, second])');
		expect(block).toMatch(
			/transparent var\(--wipe-feather\) calc\(var\(--wipe-feather\) \+ var\(--wipe-u\) \* var\(--wipe-span\)\)/u,
		);
		expect(block).toMatch(
			/#000 var\(--wipe-feather\) calc\(var\(--wipe-feather\) \+ var\(--wipe-u\) \* var\(--wipe-span\)\)/u,
		);
		expect(block).toMatch(/--wipe-start: calc\(var\(--wipe-from\) - var\(--wipe-feather\)\);/u);
		expect(block).not.toMatch(/data-wipe-dir/u);
		expect(block.match(/from var\(--wipe-start\)/gu)).toHaveLength(4);
		// Clearing masks pivot against the push; revealing masks stay put.
		expect(block.match(/at calc\(var\(--wipe-x\) - var\(--wipe-push, 0px\)\) var\(--wipe-y\)/gu)).toHaveLength(2);
		expect(block.match(/at var\(--wipe-x\) var\(--wipe-y\)/gu)).toHaveLength(2);
		const push =
			/@supports \(width: calc\(1px \* tan\(45deg\)\)\) \{\n\t\.goal-list--paged > li\[data-wipe='out'\] \{([^}]*)\}/u.exec(
				block,
			);
		expect(push).not.toBeNull();
		expect(push![1]).toMatch(/transform: translateX\(var\(--wipe-push\)\);/u);
		// One row per page: the first blade's contact drives every note, and the
		// run carries the row the rest of the way by the turnaround.
		expect(push![1]).toMatch(/tan\(var\(--wipe-tphi\)\)/u);
		expect(push![1]).toMatch(/--wipe-push: calc\(max\(0px, var\(--wipe-reach\)\) \+ var\(--wipe-slide\)\);/u);
		expect(push![1]).toMatch(
			/var\(--wipe-run, 0px\) \* max\(0, \(var\(--wipe-u\) - var\(--wipe-contact, 0\)\) \/ \(1 - var\(--wipe-contact, 0\)\)\)/u,
		);
		expect(push![1]).not.toMatch(/--wipe-shove|--wipe-h\b|--wipe-reach-2/u);
		expect(engineSource).toContain('trainFor(geometry, entries)');
		expect(block.match(/from var\(--wipe-start-2\)/gu)).toHaveLength(2);
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

	it('gives every note and the asides one glass pane, and the goals section none', () => {
		const inks = /\.goal-list > li,\n\.goal-asides \{([^}]*)\}/u.exec(css);
		expect(inks).not.toBeNull();
		expect(inks![1]).toMatch(/border-radius: 0;/u);
		expect(inks![1]).toMatch(/--fg: var\(--glass-fg\);/u);
		expect(inks![1]).not.toMatch(/border(?!-radius)|box-shadow|background|backdrop/u);
		// The fill sits on a pseudo under the note, and no pane carries a
		// backdrop-filter: masks and backdrop filters do not compose (Chromium
		// drops the mask, Firefox skips the filtered child, the spec makes the
		// masked note a backdrop root with nothing behind it).
		const pane = /\.goal-list > li::before \{([^}]*)\}/u.exec(css);
		expect(pane).not.toBeNull();
		expect(pane![1]).toMatch(/background: color-mix\(in oklab, var\(--glass-panel\) 70%, transparent\);/u);
		expect(pane![1]).toMatch(/z-index: -1;/u);
		expect(pane![1]).not.toMatch(/backdrop-filter/u);
		expect(css).not.toMatch(/\.goal-list > li::before,\n\t\.goal-asides \{\n\t\tbackdrop-filter/u);
		expect(css).not.toMatch(/\.goal-(list > li|asides)[^{]*\{[^}]*backdrop-filter:(?! none)/u);
		// Forced colours unwind the wipe in the stylesheet too.
		const forced = css.slice(css.lastIndexOf('@media (forced-colors: active) {'));
		expect(forced).toMatch(
			/\.goal-list--paged > li \{\n\t\topacity: 1 !important;\n\t\tpointer-events: auto !important;\n\t\tmask-image: none !important;\n\t\ttransform: none !important;/u,
		);
		const notes = read('src/lib/components/NotesAndGoals.svelte');
		expect(notes).toMatch(/new MediaQuery\('\(forced-colors: active\)'\)/u);
		expect(notes).toMatch(/motionOk: \(\) => enhanced && !prefersReduced\.current && !forcedColors\.current/u);
		expect(notes).toMatch(/\|\| view\.phase === 'out'\)\)\n\t\t\t\tengine\.reveal\(index\)/u);
		expect(css).toMatch(/\.page-shell > \.section:not\(\.section--bare\),/u);
		expect(css).not.toMatch(/\.page-shell > \.section,/u);
		// On screen the bare section has no surface; on paper it takes the ink
		// like every section. The surfaced sections keep their own selector so
		// the paper inks outrank the screen surface's glass inks.
		expect(css.slice(css.indexOf('@media print {'))).toMatch(
			/\.page-shell > \.section:not\(\.section--bare\),\n\t\.page-shell > \.section--bare,\n/u,
		);
		const page = read('src/routes/+page.svelte');
		expect(page).toMatch(/class="section section--bare reveal-armed"[\s\S]{0,120}id="goals"/u);
		const print = css.slice(css.indexOf('@media print {'));
		expect(print).toMatch(/\.goal-list > li,\n\t\.goal-asides \{\n\t\tbackground: none !important;/u);
		expect(print).toMatch(/\.goal-list > li::before \{\n\t\tdisplay: none !important;/u);
	});

	it('unwinds the paging on paper and hides the stalk', () => {
		const print = css.slice(css.indexOf('@media print {'));
		expect(print).toMatch(/\.goal-list--paged > li \{[^}]*mask-image: none !important;/u);
		expect(print).toMatch(
			/\.wiper-stalk,\n\t\.wiper__scene,\n\t\.wiper__blades,\n\t\.goal-edit \{\n\t\tdisplay: none !important;/u,
		);
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
		// The rest hold: a dwell held open while the scene keeps running.
		expect(engine).toContain("const REST_HOLD = 'rest';");
		expect(engine).toContain("if (frozen === REST_HOLD && this.machine.phase === 'dwell') {");
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
		expect(print).toMatch(/\.wiper__scene,\n\t\.wiper__blades,\n\t\.goal-edit \{\n\t\tdisplay: none !important;/u);
		const forced = css.slice(css.indexOf('@media (forced-colors: active) {\n\t.wiper__scene'));
		expect(forced).toMatch(/\.wiper__scene,\n\t\.wiper__blades \{\n\t\tdisplay: none;/u);
		// The blade layer sits over the notes, inert and sharp, feathered top and bottom.
		const blades = /\.wiper__blades \{([^}]*)\}/u.exec(css);
		expect(blades).not.toBeNull();
		expect(blades![1]).toMatch(/z-index: 2;/u);
		expect(blades![1]).toMatch(/pointer-events: none;/u);
		expect(blades![1]).toMatch(/border-radius: 0;/u);
		expect(blades![1]).toMatch(
			/mask-image: linear-gradient\(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%\);/u,
		);
		// The band feathers like the hero backdrop and clips what the blade shoves out.
		expect(css).toMatch(
			/\.wiper--paged \.wiper__glass \{\n\toverflow: clip;\n\tborder-radius: var\(--bleed-radius\) var\(--bleed-radius\) 0 0;/u,
		);
		// The mirror: the hero band's bottom corners on the same token.
		expect(css).toMatch(/\.hero__media \{[^}]*border-radius: 0 0 var\(--bleed-radius\) var\(--bleed-radius\);/u);
		expect(css).toMatch(/--bleed-radius: clamp\(1\.75rem, 5vw, 3\.5rem\);/u);
		expect(css).toMatch(/\.wiper--paged \.wiper__glass::after \{[^}]*z-index: 0;[^}]*pointer-events: none;/u);
		const host = read('src/lib/components/WiperScene.svelte');
		expect(host).toContain('aria-hidden="true"');
		expect(host).toContain("selectRenderer(element, { layer: 'scene' })");
		expect(host).toContain("selectRenderer(bladesElement, { layer: 'blades' })");
		expect(host).toContain('scene.render({ ...frame, arms });');
		// M4: the bead field and the frost ride the scene's own clock.
		expect(host).toContain('strokeClock(now)');
		expect(host).toContain('uploadDroplets(');
		expect(host).toContain('uploadFrost(');
		expect(host).toContain('frostClock.note(clock, drops.time);');
		expect(host).toContain('over.render({ ...frame, arms, scissor: idle ? null : armsBox(arms, width, height) });');
		expect(host).not.toMatch(/console\./u);
		const goals = read('src/lib/components/NotesAndGoals.svelte');
		expect(goals).toContain('{#if view.paged && glassEl}');
		expect(goals).toMatch(/<WiperScene\s+\{engine\}\s+colors=\{BRAND_BLOB_COLORS\}\s+glass=\{glassEl\}\s+onlost=/u);
		// A device lost after selection remounts the scene on fresh canvases,
		// a bounded number of times, at the ceiling the loss lowered.
		expect(goals).toContain('{#key sceneGeneration}');
		expect(goals).toContain('SCENE_RELAUNCH_LIMIT = 2');
		expect(host).toContain('renderer.onLost(() => lose());');
		expect(host).toContain('blades.onLost(() => lose());');
		expect(host).not.toContain('onLost(() => demote())');
	});

	it('keeps the glass on the scene layer, before the clamp, and the blades away from it', () => {
		const shader = read('src/lib/wiper/renderer/shaders/scene.glsl.ts');
		const fragment = shader.slice(shader.indexOf('export const SCENE_FRAGMENT'));
		const [, rest] = fragment.split('if (u_layer == 0) {');
		const [sceneBranch, bladeBranch] = rest.split('return;\n\t}');
		expect(shader).toContain('uniform highp sampler2D u_drops;');
		expect(sceneBranch).toContain('outColor = vec4(droplets(p, frost(uv, blobs, swept), swept), 1.0);');
		for (const call of ['sweptNow(', 'frost(', 'droplets(']) expect(sceneBranch).toContain(call);
		expect(sceneBranch).not.toMatch(/armParts\(|shadeChrome\(/u);
		expect(bladeBranch).not.toMatch(/u_drops|u_frostTex|u_armEdge|u_armFan/u);
		// GLSL ES reserved words never appear as identifiers.
		expect(fragment).not.toMatch(/\b(half|sample|filter|input|output)\b/u);
		// Every uniform the fragment declares is one the renderer looks up.
		const renderer = read('src/lib/wiper/renderer/webgl2.ts');
		const declared = [...fragment.matchAll(/^uniform\s+(?:highp\s+)?\w+\s+(u_\w+)/gmu)].map((m) => m[1]);
		expect(declared.length).toBeGreaterThan(10);
		for (const name of declared) expect(renderer, name).toContain(`'${name}'`);
		expect(renderer).not.toContain('createFramebuffer');
		// The inverse ease lives in one place.
		for (const file of ['src/lib/wiper/machine.ts', 'src/lib/wiper/engine.svelte.ts']) {
			const source = read(file);
			expect(source).toContain('strokeEaseInverse');
			expect(source).not.toContain('Math.acos');
		}
	});

	it('keeps the two tiers in lockstep: one uniform set, one block, the WebGPU rung silent and last to the canvas', () => {
		const glsl = read('src/lib/wiper/renderer/shaders/scene.glsl.ts');
		const wgsl = read('src/lib/wiper/renderer/shaders/scene.wgsl.ts');
		const glslUniforms = [...glsl.matchAll(/^uniform\s+(?:highp\s+)?\w+\s+(u_\w+)/gmu)].map((m) => m[1]);
		expect(glslUniforms.length).toBeGreaterThan(10);
		for (const name of glslUniforms) {
			expect(wgsl, name).toMatch(new RegExp(`(?:^|\\s)(?:var\\s+)?${name}\\s*:`, 'mu'));
		}
		const wgslNames = [...wgsl.matchAll(/^\s*(?:@group\(0\) @binding\(\d\) var(?:<uniform>)?\s+)?(u_\w+)\s*:/gmu)].map(
			(m) => m[1],
		);
		for (const name of wgslNames) {
			if (name === 'u' || name === 'u_fieldSampler' || /^u_pad\d$/u.test(name)) continue;
			expect(glslUniforms, name).toContain(name);
		}
		expect(wgsl.match(/@binding\((\d)\)/gu)).toEqual(['@binding(0)', '@binding(1)', '@binding(2)', '@binding(3)']);
		// Sampling stays in uniform control flow; the bead field is fetched by texel.
		expect(wgsl.match(/textureSampleLevel\(/gu)).toHaveLength(1);
		expect(wgsl.match(/textureLoad\(/gu)).toHaveLength(1);
		expect(wgsl).not.toMatch(/textureSample\(/u);
		expect(wgsl).not.toMatch(/https?:|[\w.-]+@[\w.-]+\.\w{2,}/u);
		// The WGSL splits at the same layer test and keeps the glass on layer 0.
		const [, wgslRest] = wgsl.split('if (u.u_layer == 0) {');
		const [wgslScene, wgslBlades] = wgslRest.split('\n\t}\n');
		for (const call of ['sweptNow(', 'frost(', 'droplets(']) expect(wgslScene).toContain(call);
		expect(wgslBlades).not.toMatch(/u_drops|u_frostTex|u_armEdge|u_armFan/u);
		// Both renderers read the one block.
		const webgl2 = read('src/lib/wiper/renderer/webgl2.ts');
		const webgpu = read('src/lib/wiper/renderer/webgpu.ts');
		expect(webgl2).toContain("from './uniform-block'");
		expect(webgpu).toContain("from './uniform-block'");
		expect(webgpu).not.toMatch(/console\./u);
		expect(webgpu).not.toContain('createFramebuffer');
		expect(webgpu).not.toContain('copyBufferToTexture');
		// Silence by construction: handlers before resources, scopes around
		// creation, the compile log read, the canvas claimed last.
		const order = [
			'onuncapturederror',
			'device.lost',
			"pushErrorScope('validation')",
			'createShaderModule',
			'getCompilationInfo()',
			'createRenderPipelineAsync',
			"canvas.getContext('webgpu')",
		];
		const positions = order.map((needle) => webgpu.indexOf(needle));
		for (let index = 1; index < positions.length; index += 1) {
			expect(positions[index], `${order[index]} after ${order[index - 1]}`).toBeGreaterThan(positions[index - 1]);
		}
		expect(webgpu).toContain('preventDefault()');
		expect(webgpu).toContain("reason === 'destroyed'");
		expect(webgpu).toContain("'unfilterable-float'");
		expect(webgpu).toContain("alphaMode: options.layer === 'blades' ? 'premultiplied' : 'opaque'");
		expect(webgpu.match(/requestDevice\(/gu)).toHaveLength(1);
		// The handshake is bounded: the adapter and device request sit under a
		// deadline that steps the ladder down to WebGL2, a late device is closed
		// on arrival, and the deadline covers acquisition only (the handlers and
		// the compile come after it).
		expect(WEBGPU_ACQUIRE_DEADLINE_MS).toBe(1500);
		expect(WEBGPU_ACQUIRE_DEADLINE_MS * 4).toBeLessThan(15_000); // awaitTier's budget
		expect(webgpu).toContain("from './deadline'");
		expect(webgpu).toContain('WEBGPU_ACQUIRE_DEADLINE_MS');
		expect(webgpu).toContain("kind: 'timeout'");
		expect(webgpu.indexOf('requestDevice(')).toBeLessThan(webgpu.indexOf('withDeadline('));
		expect(webgpu.indexOf('withDeadline(')).toBeLessThan(webgpu.indexOf('onuncapturederror'));
		expect(webgpu).toMatch(/opening\s*\.then\(\(late\) => \{[^}]*late\.destroy\(\)/u);
		const deadline = read('src/lib/wiper/renderer/deadline.ts');
		expect(deadline).not.toMatch(/console\.|navigator|document/u);
		// The ladder: the hook, the order, nothing static.
		const select = read('src/lib/wiper/renderer/select.ts');
		expect(select).toContain('dataset.wiperTierMax');
		expect(select.indexOf("import('./webgpu')")).toBeLessThan(select.indexOf("import('./webgl2')"));
		expect(select).not.toMatch(/^import .* from '\.\/(webgpu|webgl2)';/mu);
		// The rung below is fetched alongside, so a demotion costs no round trip.
		expect(select.indexOf("import('./webgl2')")).toBeLessThan(select.indexOf('await createWebGPURenderer('));
		// The host follows the rung and refuses a mixed pair.
		const host = read('src/lib/components/WiperScene.svelte');
		expect(host).toContain('tier = renderer.tier;');
		expect(host).toContain('engine.tier = renderer.tier;');
		expect(host).toContain('if (blades.tier !== renderer.tier) {');
		expect(host).not.toMatch(/'webgpu'/u);
	});

	it('ships shaders as strings with no host or mailbox in them and no console in the renderer', () => {
		const shader = read('src/lib/wiper/renderer/shaders/scene.glsl.ts');
		expect(shader).not.toMatch(/https?:|[\w.-]+@[\w.-]+\.\w{2,}/u);
		// No clamp under text: the panes carry their inks (pane-composite.test.ts).
		expect(shader).not.toMatch(/u_ink|inkAlpha/u);
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

	it('goes full bleed only while paged, on the hero idiom, and gives paged notes their inner room', () => {
		const paged = /\.wiper--paged \{([^}]*)\}/u.exec(block);
		expect(paged).not.toBeNull();
		expect(paged![1]).toMatch(/width: 100vw;/u);
		expect(paged![1]).toMatch(/margin-left: calc\(50% - 50vw\);/u);
		const pane = /\.wiper \{([^}]*)\}/u.exec(block);
		expect(pane![1]).not.toMatch(/100vw/u);
		// Inner room lives on every note now that each note is a pane.
		expect(css).toMatch(/\.goal-list > li \{[^}]*padding: 1rem 1\.1rem 1\.25rem;\n\}/u);
		expect(block).not.toMatch(/\.goal-list--paged > li \{[^}]*padding/u);
		const print = css.slice(css.indexOf('@media print {'));
		expect(print).toMatch(/\.wiper--paged \{\n\t\twidth: auto !important;/u);
	});
});
