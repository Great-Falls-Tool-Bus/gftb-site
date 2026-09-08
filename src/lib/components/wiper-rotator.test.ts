import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	DEFAULT_WIPER_POSITION,
	WIPER_POSITIONS,
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
		// The resting grid the served HTML lays out as (never-cards, unchanged numbers).
		expect(appCss).toMatch(/\.goal-list \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(17rem, 1fr\)\);/u);
	});
});
