import { describe, expect, it } from 'vitest';
import { INTRO_TIMING, IntroMachine, easeInOutCubic, shouldArm, wiperReady } from './machine';

const T = INTRO_TIMING;

describe('easeInOutCubic', () => {
	it('is pinned at the ends and the middle, and climbs monotonically', () => {
		expect(easeInOutCubic(0)).toBe(0);
		expect(easeInOutCubic(0.5)).toBe(0.5);
		expect(easeInOutCubic(1)).toBe(1);
		let last = 0;
		for (let i = 1; i <= 100; i += 1) {
			const value = easeInOutCubic(i / 100);
			expect(value).toBeGreaterThanOrEqual(last);
			last = value;
		}
		expect(easeInOutCubic(-1)).toBe(0);
		expect(easeInOutCubic(2)).toBe(1);
	});
});

describe('shouldArm', () => {
	const base = { reduce: false, pathname: '/', hash: '', played: false };
	it('arms only on the plain home path with motion allowed and nothing played', () => {
		expect(shouldArm(base)).toBe(true);
		expect(shouldArm({ ...base, reduce: true })).toBe(false);
		expect(shouldArm({ ...base, hash: '#goals' })).toBe(false);
		expect(shouldArm({ ...base, pathname: '/log' })).toBe(false);
		expect(shouldArm({ ...base, played: true })).toBe(false);
	});
});

describe('wiperReady', () => {
	it('treats no canvas as ready and any pending rung as not', () => {
		expect(wiperReady([])).toBe(true);
		expect(wiperReady(['pending', 'webgl2'])).toBe(false);
		expect(wiperReady(['webgpu', 'webgpu'])).toBe(true);
		expect(wiperReady(['webgl2', 'webgl2'])).toBe(true);
	});
});

describe('IntroMachine', () => {
	it('moves from the veil to the hold when the animation ends', () => {
		const m = new IntroMachine(0);
		expect(m.phase).toBe('veil');
		expect(m.step(100, 0, 900)).toEqual({ kind: 'idle' });
		m.veilEnded(1000);
		expect(m.phase).toBe('hold');
	});

	it('falls back to the grace timer when animationend never arrives', () => {
		const m = new IntroMachine(0);
		m.step(T.veilMs + T.veilGraceMs - 1, 0, 900);
		expect(m.phase).toBe('veil');
		m.step(T.veilMs + T.veilGraceMs, 0, 900);
		expect(m.phase).toBe('hold');
	});

	it('holds the full hold even when the wiper is ready at once', () => {
		const m = new IntroMachine(0);
		m.veilEnded(1000);
		m.markReady();
		m.step(1000 + T.holdMs - 1, 0, 900);
		expect(m.phase).toBe('hold');
		m.step(1000 + T.holdMs, 0, 900);
		expect(m.phase).toBe('scroll');
	});

	it('waits for the wiper up to the cap, then goes anyway', () => {
		const m = new IntroMachine(0);
		m.veilEnded(1000);
		m.step(1000 + T.readyCapMs - 1, 0, 900);
		expect(m.phase).toBe('hold');
		m.step(1000 + T.readyCapMs, 0, 900);
		expect(m.phase).toBe('scroll');
	});

	it('writes a monotone tween from the start to the target and lands exactly on it', () => {
		const m = new IntroMachine(0);
		m.veilEnded(1000);
		m.markReady();
		m.step(1500, 0, 900); // enters scroll at 1500
		let last = 0;
		let y = 0;
		for (let now = 1516; now < 1500 + T.scrollMs; now += 16) {
			const command = m.step(now, y, 900);
			expect(command.kind).toBe('write');
			if (command.kind === 'write') {
				expect(command.y).toBeGreaterThanOrEqual(last);
				expect(command.y).toBeLessThanOrEqual(900);
				last = command.y;
				y = command.y; // the page follows the write
			}
		}
		const done = m.step(1500 + T.scrollMs, y, 900);
		expect(done).toEqual({ kind: 'done', y: 900 });
		expect(m.phase).toBe('done');
		expect(m.step(9999, 900, 900)).toEqual({ kind: 'idle' });
	});

	it('cancels when the page moves by more than the deviation in any phase', () => {
		const veil = new IntroMachine(0);
		expect(veil.step(10, T.deviationPx + 1, 900)).toEqual({ kind: 'cancel', reason: 'scrolled' });
		expect(veil.phase).toBe('cancelled');

		const scrolling = new IntroMachine(0);
		scrolling.veilEnded(1000);
		scrolling.markReady();
		scrolling.step(1500, 0, 900);
		const first = scrolling.step(1900, 0, 900);
		expect(first.kind).toBe('write');
		const written = first.kind === 'write' ? first.y : 0;
		expect(scrolling.step(1916, written + T.deviationPx + 1, 900)).toEqual({ kind: 'cancel', reason: 'scrolled' });
		expect(scrolling.step(1932, 0, 900)).toEqual({ kind: 'idle' });
	});

	it('tolerates a page that follows its own writes within the deviation', () => {
		const m = new IntroMachine(0);
		m.veilEnded(1000);
		m.markReady();
		m.step(1500, 0, 900);
		const first = m.step(1900, 0, 900);
		const written = first.kind === 'write' ? first.y : 0;
		expect(m.step(1916, Math.round(written), 900).kind).toBe('write');
	});

	it('is terminal once cancelled', () => {
		const m = new IntroMachine(0);
		m.cancel('input');
		expect(m.phase).toBe('cancelled');
		expect(m.reason).toBe('input');
		m.veilEnded(5);
		m.cancel('other');
		expect(m.phase).toBe('cancelled');
		expect(m.reason).toBe('input');
		expect(m.step(10, 0, 900)).toEqual({ kind: 'idle' });
	});
});
