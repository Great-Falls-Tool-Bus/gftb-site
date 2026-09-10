// Source pins for the home intro (operator ruling 2026-09-10): the pre-paint
// arm, the stylesheet's zero-timed-rule contract under reduce, the veil's
// self-hiding keyframes, paper, the decorative components, and a controller
// that registers no scroll listener and never moves focus.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INTRO_PLAYED_KEY } from './machine';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8');

describe('home intro contract', () => {
	it('arms before first paint with the four checks and disarms on input or the failsafe', () => {
		const html = read('src/app.html');
		expect(html).toContain(`sessionStorage.getItem('${INTRO_PLAYED_KEY}') === null`);
		expect(html).toContain("location.pathname === '/'");
		expect(html).toContain("location.hash === ''");
		expect(html).toContain("classList.add('intro-armed')");
		expect(html).toContain("['wheel', 'touchstart', 'pointerdown', 'keydown']");
		expect(html).toContain('{ capture: true, passive: true, once: true }');
		// The arm sits inside the motion gate and after the failsafe is set, so a
		// throwing storage call can never leave the reveal system without its timer.
		const gate = html.indexOf('if (!reduceMotion) {');
		const failsafe = html.indexOf('window.__gftbRevealFailsafe = setTimeout');
		const arm = html.indexOf("classList.add('intro-armed')");
		expect(gate).toBeGreaterThan(-1);
		expect(failsafe).toBeGreaterThan(gate);
		expect(arm).toBeGreaterThan(failsafe);
		const failsafeBody = html.slice(failsafe, html.indexOf('}, 3000);', failsafe));
		expect(failsafeBody).toContain("classList.remove('motion-safe-ready')");
		expect(failsafeBody).toContain("classList.remove('intro-armed')");
	});

	it('paints the veil only under the armed class, with every timed rule under no-preference', () => {
		const css = read('src/app.css');
		const zToken = /--z-intro: (\d+);/u.exec(css);
		const zToast = /--z-toast: (\d+);/u.exec(css);
		const zSticky = /--z-sticky: (\d+);/u.exec(css);
		expect(zToken && zToast && zSticky).toBeTruthy();
		expect(Number(zToken?.[1])).toBeLessThan(Number(zToast?.[1]));
		expect(Number(zToken?.[1])).toBeGreaterThan(Number(zSticky?.[1]));

		const start = css.indexOf('/* ===== Home intro');
		expect(start).toBeGreaterThan(-1);
		const end = css.indexOf('/* =====', start + 1);
		const block = css.slice(start, end);
		const base = block.slice(block.indexOf('.home-intro {'), block.indexOf('.home-intro__mark {'));
		for (const line of [
			'position: fixed;',
			'inset: 0;',
			'z-index: var(--z-intro);',
			'overflow: clip;',
			'pointer-events: none;',
			'visibility: hidden;',
			'opacity: 0;',
		])
			expect(base).toContain(line);
		expect(block).not.toMatch(/transition/u);
		expect(block).not.toMatch(/border-radius/u);
		// Every animation declaration lives inside the no-preference media rule.
		const media = block.indexOf('@media (prefers-reduced-motion: no-preference)');
		expect(media).toBeGreaterThan(-1);
		const before = block.slice(0, media);
		expect(before).not.toMatch(/^\s*animation:/mu);
		const inside = block.slice(media);
		expect(inside).toContain('html.intro-armed .home-intro {');
		expect(inside).toContain('html.intro-armed .home-intro__mark {');
		expect(inside).toMatch(/animation: intro-veil 1000ms linear both;/u);
		expect(inside).toMatch(/animation: intro-mark 800ms ease-in-out both;/u);
		// The veil ends hidden on its own.
		const veil = block.slice(block.indexOf('@keyframes intro-veil'), block.indexOf('@keyframes intro-mark'));
		const lastFrame = veil.slice(veil.lastIndexOf('100%'));
		expect(lastFrame).toContain('visibility: hidden;');
		// Paper drops it.
		const print = css.slice(css.indexOf('@media print {'));
		const hidden = print.slice(0, print.indexOf('display: none !important;'));
		expect(hidden).toContain('.home-intro');
	});

	it('ships decorative components with no focusable node and the favicon path', () => {
		const intro = read('src/lib/components/HomeIntro.svelte');
		const mark = read('src/lib/components/BusMark.svelte');
		for (const source of [intro, mark]) {
			expect(source).not.toMatch(/<a\b|<button|tabindex|role=|aria-label|alt=/u);
		}
		expect(intro).toContain('aria-hidden="true"');
		expect(intro).toContain('{@attach intro}');
		expect(intro).not.toMatch(/svelte\/transition|svelte\/motion/u);
		expect(mark).toContain('focusable="false"');
		expect(mark).toContain('fill="currentColor"');
		const favicon = read('static/favicon.svg');
		const faviconPath = /<path fill="#f2c84b" d="([^"]+)"/u.exec(favicon)?.[1];
		const markPath = /d="([^"]+)"/u.exec(mark)?.[1];
		expect(faviconPath).toBeTruthy();
		expect(markPath).toBe(faviconPath);
	});

	it('drives the scroll without a scroll listener, focus calls or console output', () => {
		const controller = read('src/lib/intro/controller.ts');
		expect(controller).not.toMatch(/addEventListener\(\s*['"]scroll['"]/u);
		expect(controller).not.toMatch(/scrollIntoView|\.focus\(|console\.|preventDefault|stopPropagation/u);
		expect(controller).toContain("behavior: 'instant'");
		expect(controller).toContain('{ capture: true, passive: true, signal }');
		expect(controller).toContain(`sessionStorage.setItem(INTRO_PLAYED_KEY, '1')`);
		const machine = read('src/lib/intro/machine.ts');
		expect(machine).not.toMatch(/document|window|navigator|console\./u);
		expect(INTRO_PLAYED_KEY).toBe('intro-played');
	});

	it('mounts the veil first on the home page only', () => {
		const page = read('src/routes/+page.svelte');
		expect(page.indexOf('<HomeIntro />')).toBeLessThan(page.indexOf('<section class="hero"'));
		expect(read('src/routes/+layout.svelte')).not.toContain('HomeIntro');
	});
});
