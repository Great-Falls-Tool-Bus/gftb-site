// Source pins for the home intro (operator ruling 2026-09-10): the pre-paint
// arm, the stylesheet's zero-timed-rule contract under reduce, the veil's
// self-hiding keyframes, paper, the decorative components, and a controller
// that registers no scroll listener and never moves focus.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INTRO_TIMING } from './machine';
import {
	INTRO_ARMED_CLASS,
	INTRO_LIFTING_CLASS,
	INTRO_LIVE_CLASS,
	INTRO_OFF_ATTR,
	INTRO_OFF_GLOBAL,
} from './controller';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf8');

describe('home intro contract', () => {
	it('arms before first paint on every load with no storage, and disarms on input or the failsafe', () => {
		const html = read('src/app.html');
		expect(html).not.toMatch(/sessionStorage|intro-played/u);
		expect(html).toContain("location.pathname === '/'");
		expect(html).toContain("location.hash === ''");
		expect(html).toContain(`!document.documentElement.hasAttribute('${INTRO_OFF_ATTR}')`);
		expect(html).toContain(`!window.${INTRO_OFF_GLOBAL} &&`);
		expect(html).toContain(`classList.add('${INTRO_ARMED_CLASS}')`);
		expect(html).toContain("['wheel', 'touchstart', 'pointerdown', 'keydown']");
		expect(html).toContain('{ capture: true, passive: true, once: true }');
		// The arm sits inside the motion gate and after the failsafe is set.
		const gate = html.indexOf('if (!reduceMotion) {');
		const failsafe = html.indexOf('window.__gftbRevealFailsafe = setTimeout');
		const arm = html.indexOf(`classList.add('${INTRO_ARMED_CLASS}')`);
		expect(gate).toBeGreaterThan(-1);
		expect(failsafe).toBeGreaterThan(gate);
		expect(arm).toBeGreaterThan(failsafe);
		const failsafeBody = html.slice(failsafe, html.indexOf('}, 3000);', failsafe));
		expect(failsafeBody).toContain("classList.remove('motion-safe-ready')");
		expect(failsafeBody).toContain(`classList.remove('${INTRO_ARMED_CLASS}')`);
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
		expect(inside).toContain(`html.${INTRO_ARMED_CLASS} .home-intro {`);
		expect(inside).toContain(`html.${INTRO_ARMED_CLASS}.${INTRO_LIVE_CLASS} .home-intro {`);
		expect(inside).toContain(`html.${INTRO_ARMED_CLASS}.${INTRO_LIFTING_CLASS} .home-intro {`);
		// Armed alone times out in the fail-open window; live holds steady; lifting fades.
		expect(inside).toMatch(/animation: intro-veil 3000ms linear both;/u);
		expect(inside).toMatch(/animation: intro-lift 900ms ease-out both;/u);
		expect(inside).toMatch(/animation: intro-mark-in 700ms ease-out both;/u);
		expect(inside).toMatch(/animation: intro-mark-out 900ms ease-in both;/u);
		// The lift and the mark's fade share one duration, so the mark never
		// outlives the veil; the lift is longer than the fade-in by ruling.
		expect(INTRO_TIMING.liftMs).toBe(900);
		// Forced colours: never painted, never armed; scroll anchoring is off while the intro owns the page.
		expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.home-intro \{\s*display: none !important;/u);
		expect(css).toMatch(/html\.intro-live \{\s*overflow-anchor: none;/u);
		expect(read('src/app.html')).toContain("window.matchMedia('(forced-colors: active)').matches");
		// The veil and the lift both end hidden on their own.
		for (const name of ['intro-veil', 'intro-lift']) {
			const from = block.indexOf(`@keyframes ${name}`);
			const frames = block.slice(from, block.indexOf('@keyframes', from + 1));
			expect(frames.slice(frames.lastIndexOf('100%'))).toContain('visibility: hidden;');
		}
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
		expect(controller).toContain("matchMedia('(forced-colors: active)')");
		expect(controller).toContain('document.hidden ||');
		expect(controller).toContain('machine.setReady(wiperReady(canvases()))');
		expect(controller).toContain('canvas.dataset.warm !== undefined');
		expect(controller).toContain('{ capture: true, passive: true, signal }');
		expect(controller).not.toMatch(/sessionStorage|localStorage/u);
		const machine = read('src/lib/intro/machine.ts');
		expect(machine).not.toMatch(/document|window|navigator|console\.|Storage/u);
		expect(INTRO_OFF_ATTR).toBe('data-intro-off');
	});

	it('mounts the veil first on the home page only', () => {
		const page = read('src/routes/+page.svelte');
		expect(page.indexOf('<HomeIntro />')).toBeLessThan(page.indexOf('<section class="hero"'));
		expect(read('src/routes/+layout.svelte')).not.toContain('HomeIntro');
	});
});
