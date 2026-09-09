import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	DEFAULT_WIPER_POSITION,
	DEFAULT_WIPER_SKIN,
	WIPER_POSITIONS,
	WIPER_SKINS,
	pageCountFor,
	pageOf,
	stepWiperPosition,
	wiperEntry,
} from './wiper-rotator';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

// Extract the bodies of every `@media (prefers-reduced-motion: no-preference)`
// block by brace matching, and the stylesheet with those blocks blanked out.
function splitMotionBlocks(css: string): { inside: string; outside: string } {
	const marker = /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{/gu;
	let inside = '';
	let outside = '';
	let cursor = 0;
	for (const match of css.matchAll(marker)) {
		const open = match.index! + match[0].length;
		let depth = 1;
		let i = open;
		while (i < css.length && depth > 0) {
			if (css[i] === '{') depth += 1;
			else if (css[i] === '}') depth -= 1;
			i += 1;
		}
		outside += css.slice(cursor, match.index!);
		inside += css.slice(open, i - 1);
		cursor = i;
	}
	outside += css.slice(cursor);
	return { inside, outside };
}

describe('the wiper stalk table', () => {
	it('starts at Off and gets strictly faster down the stalk', () => {
		expect(WIPER_POSITIONS[0].id).toBe('off');
		expect(WIPER_POSITIONS[0].dwellMs).toBe(0);
		expect(WIPER_POSITIONS[0].sweepMs).toBe(0);
		const active = WIPER_POSITIONS.slice(1);
		expect(active.map((entry) => entry.id)).toEqual(['intermittent', 'low', 'high']);
		for (let i = 1; i < active.length; i += 1) {
			expect(active[i].dwellMs).toBeLessThan(active[i - 1].dwellMs);
			expect(active[i].sweepMs).toBeLessThanOrEqual(active[i - 1].sweepMs);
		}
	});

	it('always shows the notes for longer than the blades cover them', () => {
		for (const entry of WIPER_POSITIONS.slice(1)) {
			expect(entry.sweepMs).toBeLessThan(entry.dwellMs);
			// Dwell stays inside the "cards visible between wipes for ~1 to 5 s" brief.
			expect(entry.dwellMs).toBeGreaterThanOrEqual(1000);
			expect(entry.dwellMs).toBeLessThanOrEqual(5000);
		}
		expect(wiperEntry(DEFAULT_WIPER_POSITION).id).toBe('intermittent');
		expect(() => wiperEntry('turbo' as never)).toThrow();
	});

	it('steps through the detents with wrap-around and pages the list', () => {
		expect(stepWiperPosition('off', 1)).toBe('intermittent');
		expect(stepWiperPosition('high', 1)).toBe('off');
		expect(stepWiperPosition('off', -1)).toBe('high');
		expect(pageOf(0, 3)).toBe(0);
		expect(pageOf(5, 3)).toBe(1);
		expect(pageOf(4, 1)).toBe(4);
		expect(pageCountFor(8, 3)).toBe(3);
		expect(pageCountFor(8, 1)).toBe(8);
		expect(pageCountFor(0, 3)).toBe(1);
	});
});

describe('the wiper rotator source contract', () => {
	const rotator = read('src/lib/components/WiperRotator.svelte');
	const goals = read('src/lib/components/NotesAndGoals.svelte');
	const home = read('src/routes/+page.svelte');
	const appCss = read('src/app.css');

	it('retired the Skeleton carousel and did not replace it with a JS motion loop', () => {
		expect(existsSync(path.join(repoRoot, 'src/lib/components/GoalCarousel.svelte'))).toBe(false);
		const sources = walk(path.join(repoRoot, 'src')).filter(
			(f) => (f.endsWith('.svelte') || f.endsWith('.ts')) && !f.endsWith('wiper-rotator.test.ts'),
		);
		for (const file of sources) {
			const source = readFileSync(file, 'utf8');
			expect(source, file).not.toMatch(/import\s*\{[^}]*\bCarousel\b[^}]*\}\s*from\s*'@skeletonlabs/u);
			expect(source, file).not.toContain('.goal-carousel__');
			expect(source, file).not.toContain('goal-list--enhanced');
		}
		expect(rotator).not.toContain('@skeletonlabs');
		expect(rotator).not.toContain('svelte/transition');
		expect(rotator).not.toContain('svelte/motion');
		expect(rotator).not.toContain('requestAnimationFrame');
		// The mode switch still rides Skeleton: the pair stays pinned.
		expect(read('src/lib/components/ThemeSwitcher.svelte')).toContain("from '@skeletonlabs/skeleton-svelte'");
	});

	it('mounts every control, blade and inline style only after hydration', () => {
		expect(rotator).toContain('let enhanced = $state(false);');
		expect(rotator).toMatch(/\$effect\(\(\) => \{\s*enhanced = true;\s*\}\);/u);
		const gate = rotator.indexOf('{#if enhanced && cycle.rotatable');
		expect(gate).toBeGreaterThan(-1);
		for (const marker of ['role="switch"', 'role="radiogroup"', 'role="radio"', '<svg', 'aria-hidden="true"']) {
			const first = rotator.indexOf(marker);
			expect(first, marker).toBeGreaterThan(gate);
		}
		// The list never carries an inline style (the served grid must stay
		// style-free); the timing custom properties ride the pane, enhanced only.
		expect(rotator).toMatch(/style:--wiper-dwell=\{enhanced \?/u);
		expect(rotator).toMatch(/style:--wiper-stroke=\{enhanced \?/u);
		expect(rotator).not.toMatch(/<ol[^>]*\sstyle[=:]/u);
		expect(rotator).toContain("new MediaQuery('(prefers-reduced-motion: reduce)')");
		expect(rotator).toContain("new MediaQuery('(min-width: 48rem)')");
		expect(rotator).toMatch(/aria-live=\{cycle\.running \? 'off' : 'polite'\}/u);
	});

	it('builds every GitHub link from the source map and the manifest, never a literal', () => {
		expect(goals).toContain("import sourceMap from '$lib/generated/source-map.json';");
		expect(goals).toContain('${sourceMap.repoUrl}/edit/${sourceMap.branch}/${goal.sourcePath}');
		expect(goals).toContain('${sourceMap.repoUrl}/tree/${sourceMap.branch}/src/content/goals');
		expect(goals).not.toContain('github.com');
		expect(rotator).not.toContain('github.com');
		expect(rotator).not.toContain('sourceMap');
		// Edit links are not CTAs (the e2e pins every .goal-cta link to /contact)
		// and not the D06 ExternalLink (print would expand eight repo URLs).
		expect(goals).toMatch(/<p class="goal-edit">\s*<a[^>]*rel="noopener external"/u);
		expect(goals).not.toContain('<ExternalLink');
		expect(home).toContain('<h2 id="goals-title">Notes &amp; Goals</h2>');
		expect(home).toContain('<NotesAndGoals');
		expect(home).not.toContain('Near-term goals');
	});

	it('keeps every wiper animation inside the no-preference media block', () => {
		// Comments mention selectors freely; only rules count.
		const { inside, outside } = splitMotionBlocks(appCss.replace(/\/\*[\s\S]*?\*\//gu, ''));
		expect(inside).toContain('@keyframes wiper-sweep');
		expect(outside).not.toContain('@keyframes wiper-');
		// No .wiper* rule outside the block may declare animation or a timed transition.
		const outsideWiperRules = outside.matchAll(/\.wiper[^{]*\{([^}]*)\}/gu);
		for (const rule of outsideWiperRules) {
			expect(rule[1]).not.toMatch(/\banimation\b/u);
			expect(rule[1]).not.toMatch(/\btransition:(?!\s*none\b)/u);
		}
		// The paged stack: one shared grid row, so the pane never shifts height.
		expect(appCss).toMatch(/\.wiper-list--paged > li \{[^}]*grid-row: 1;/u);
		expect(appCss).toMatch(/\.wiper-list--paged > li \{[^}]*opacity: 0;/u);
		expect(appCss).toMatch(/\.wiper-list--paged > li\.is-current \{[^}]*opacity: 1;/u);
		// The resting grid keeps its preferred width but shrinks inside a narrow pane.
		expect(appCss).toMatch(
			/\.goal-list \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(17rem, 100%\), 1fr\)\);/u,
		);
	});
});

describe('the dash light-pipe and the aero skin (operator rulings 2026-09-09)', () => {
	const rotator = read('src/lib/components/WiperRotator.svelte');
	const goals = read('src/lib/components/NotesAndGoals.svelte');
	const appCss = read('src/app.css');
	const rule = (selector: string) => {
		// The body of the first top-level rule whose selector line is exactly `selector {`.
		const marker = `\n${selector} {\n`;
		const at = appCss.indexOf(marker);
		expect(at, `a rule for ${selector}`).toBeGreaterThan(-1);
		const close = appCss.indexOf('\n}', at);
		return appCss.slice(at + marker.length, close);
	};

	it('names its skins and ships the aero skin on the goals surface with dash as the rollback', () => {
		expect(WIPER_SKINS).toEqual(['dash', 'aero']);
		expect(DEFAULT_WIPER_SKIN).toBe('dash');
		expect(rotator).toContain('data-skin={skin}');
		expect(goals).toContain('skin="aero"');
		// Every aero rule is scoped; the dash skin never inherits one. Counting
		// scoped rules cannot prove that, so this pins the converse: no rule
		// whose selector lacks data-skin declares an aero-only property (the
		// gloss token, the gel background-image on the pane, a painted ::after),
		// and the dash keys keep their transparent fill and invisible bevel.
		const aeroRules =
			appCss.match(/^\.wiper\[data-skin='aero'\]|^\[data-mode='dark'\] \.wiper\[data-skin='aero'\]/gmu) ?? [];
		expect(aeroRules.length).toBeGreaterThanOrEqual(4);
		const stripped = appCss.replace(/\/\*[\s\S]*?\*\//gu, '');
		for (const rule of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
			const [, selector, body] = rule;
			if (!/\.wiper\b/u.test(selector) || selector.includes('data-skin')) continue;
			expect(body, selector.trim()).not.toMatch(/--wiper-gloss/u);
			expect(body, selector.trim()).not.toMatch(/background-image:\s*linear-gradient/u);
			if (/::after/u.test(selector)) expect(body, selector.trim()).not.toMatch(/content:\s*''/u);
		}
		const base = stripped.match(/\n\.wiper \{([^}]*)\}/u)?.[1] ?? '';
		expect(base).toMatch(/--wiper-key: transparent;/u);
		expect(base).toMatch(/--wiper-bevel: 0 0 #0000;/u);
	});

	it('gives each dash key exactly one border, the 2px accent top edge the 1.4.11 collector reads', () => {
		for (const selector of ['.wiper-switch', '.wiper-stalk__detent']) {
			const body = rule(selector);
			expect(body, selector).toMatch(/\n\tborder: 0;\n/u);
			expect(body, selector).toMatch(/\n\tborder-top: 2px solid var\(--accent\);\n/u);
			expect(body, selector).not.toMatch(/border-(left|right|bottom)/u);
			expect(body, selector).toMatch(/\n\tborder-radius: 0;\n/u);
			expect(body, selector).toMatch(/box-shadow: var\(--wiper-bevel\)/u);
		}
		expect(rule('.wiper-controls')).not.toMatch(/border-top/u);
		expect(rule('.wiper-switch__track')).toMatch(/\n\tborder: 0;\n/u);
		expect(appCss).not.toMatch(/\.wiper-stalk__detent \+ \.wiper-stalk__detent/u);
		// The invisible base keeps `ring, var(--wiper-bevel)` a valid shadow list.
		expect(rule('.wiper')).toMatch(/--wiper-bevel: 0 0 #0000;/u);
		expect(appCss).toMatch(
			/\n\t\t0 0 0 4px color-mix\(in oklab, var\(--highlight\) 56%, transparent\),\n\t\tvar\(--wiper-bevel\);/u,
		);
		expect(appCss).toMatch(
			/@media \(forced-colors: active\) \{\n\t\.wiper-switch,\n\t\.wiper-stalk__detent \{\n\t\tborder: 1px solid ButtonText;/u,
		);
	});

	it('darkens only in dark mode inside the glass (the direction contract)', () => {
		const dark = rule("[data-mode='dark'] .wiper[data-skin='aero']");
		expect(dark).toMatch(/--wiper-gloss: #000;/u);
		// The pane's own paint (the measured surface) darkens only; the key
		// bevel highlight is a descendant and may stay light.
		const paint = dark.match(/background-image:[^;]*;/u)?.[0] ?? '';
		expect(paint).toMatch(/color-mix\(in oklab, #000 10%, transparent\)/u);
		expect(paint).not.toMatch(/#fff|var\(--wiper-gloss\)/u);
		const light = rule(".wiper[data-skin='aero']");
		expect(light).toMatch(/--wiper-gloss: #fff;/u);
	});

	it('keeps the round forms out of the arms and names one arm for each phase event', () => {
		expect(rotator).not.toContain('<circle');
		expect(rotator.match(/onanimationiteration=/gu)).toHaveLength(1);
		expect(rotator.match(/onanimationend=/gu)).toHaveLength(1);
		expect(rotator).toContain("side === 'left' && ghost === 0 ? onSweepIteration");
		expect(rotator).toContain("side === 'left' && ghost === 2 ? onSweepEnd");
		expect(rotator).toContain('wiper-arm--ghost-${ghost}');
	});

	it('puts the slap easing, the ghost delays and the sheen inside the no-preference block', () => {
		const { inside, outside } = splitMotionBlocks(appCss.replace(/\/\*[\s\S]*?\*\//gu, ''));
		const slap = inside.match(/animation-timing-function: linear\(/gu) ?? [];
		expect(slap).toHaveLength(1);
		expect(outside).not.toMatch(/linear\(/u);
		// The longhand follows the sweep shorthand so a browser without linear() keeps the bezier.
		const shorthandAt = inside.indexOf(
			'animation: wiper-sweep var(--wiper-stroke) cubic-bezier(0.45, 0, 0.55, 1) 2 alternate both;',
		);
		const longhandAt = inside.indexOf('animation-timing-function: linear(');
		expect(shorthandAt).toBeGreaterThan(-1);
		expect(longhandAt).toBeGreaterThan(shorthandAt);
		expect(inside).toMatch(
			/\.wiper--wiping \.wiper-arm--ghost-1 \{\s*animation-delay: calc\(var\(--wiper-stroke\) \* 0\.06\);/u,
		);
		expect(inside).toMatch(
			/\.wiper--wiping \.wiper-arm--ghost-2 \{\s*animation-delay: calc\(var\(--wiper-stroke\) \* 0\.12\);/u,
		);
		expect(inside).toMatch(/@keyframes wiper-sheen/u);
		expect(outside).not.toMatch(/wiper-sheen/u);
		// The sheen pseudo exists only while wiping, and paper drops it.
		expect(appCss).toMatch(/\.wiper\[data-skin='aero'\]::after \{\n\tcontent: none;\n\}/u);
		expect(appCss).toMatch(/\.wiper::before,\n\t\.wiper::after,\n\t\.wiper-arms,/u);
	});
});

describe('the instruments (rain accumulation, dwell gauge)', () => {
	const rotator = read('src/lib/components/WiperRotator.svelte');
	const appCss = read('src/app.css');

	it('mounts the gauge inside the dash, after the hydration gate, hidden from AT', () => {
		const gate = rotator.indexOf('{#if enhanced && cycle.rotatable');
		const gauge = rotator.indexOf('<span class="wiper-gauge" aria-hidden="true"></span>');
		const dash = rotator.indexOf('<div class="wiper-controls"');
		expect(gate).toBeGreaterThan(-1);
		expect(dash).toBeGreaterThan(gate);
		expect(gauge).toBeGreaterThan(dash);
	});

	it('times the rain and the gauge only inside the no-preference block and keys them on the pane state', () => {
		const { inside, outside } = splitMotionBlocks(appCss.replace(/\/\*[\s\S]*?\*\//gu, ''));
		for (const name of ['wiper-rain-fill', 'wiper-gauge']) {
			expect(inside).toMatch(new RegExp(`@keyframes ${name}\\b`, 'u'));
			expect(outside).not.toMatch(new RegExp(`@keyframes ${name}\\b`, 'u'));
		}
		expect(outside).not.toMatch(/animation-play-state|animation-delay/u);
		expect(inside).toMatch(
			/\.wiper--paged\.wiper--rain\[data-state='paused'\]::before \{\s*animation-play-state: paused;/u,
		);
		expect(inside).toMatch(/\.wiper\[data-state='paused'\] \.wiper-gauge::before \{\s*animation-play-state: paused;/u);
		// The clearing sweep is a timed transition, so it belongs inside the block too.
		expect(inside).toMatch(
			/\.wiper--rain\[data-stroke='back'\]::before \{\s*transition: opacity var\(--wiper-stroke\) linear;/u,
		);
		// Static end states: full through the outbound stroke, cleared at the return.
		expect(outside).toMatch(/\.wiper--rain\[data-stroke='out'\]::before \{\s*opacity: 1;/u);
		expect(outside).toMatch(/\.wiper--rain\[data-stroke='back'\]::before \{\s*opacity: 0\.15;/u);
		expect(outside).toMatch(/\.wiper-gauge::before \{[^}]*transform: scaleX\(0\);/u);
		expect(outside).toMatch(/\.wiper\[data-state='wiping'\] \.wiper-gauge::before \{\s*transform: scaleX\(1\);/u);
	});
});

describe('the dwell timer and the instruments share one clock', () => {
	const rotator = read('src/lib/components/WiperRotator.svelte');
	const cycle = read('src/lib/components/wiper-rotator.svelte.ts');

	it('banks the remaining dwell on a pause and resumes from it', () => {
		expect(cycle).toContain('dwellRemainingMs: number | null = $state(null);');
		expect(rotator).toContain('const remaining = untrack(() => cycle.dwellRemainingMs) ?? cycle.dwellMs;');
		expect(rotator).toContain('cycle.dwellRemainingMs = Math.max(0, remaining - (performance.now() - armedAt));');
	});

	it('wipes at once on a detent change so every clock restarts together', () => {
		expect(cycle).toContain("if (changed && next !== 'off' && this.phase === 'dwell') this.startWipe(true);");
		expect(cycle).toContain('if (force ? !(this.rotatable && this.enabled) : !this.running) return;');
	});
});
