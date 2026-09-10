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
	const base = { reduce: false, pathname: '/', hash: '', off: false };
	it('arms on the plain home path with motion allowed and no hook, every load', () => {
		expect(shouldArm(base)).toBe(true);
		expect(shouldArm({ ...base, reduce: true })).toBe(false);
		expect(shouldArm({ ...base, hash: '#goals' })).toBe(false);
		expect(shouldArm({ ...base, pathname: '/log' })).toBe(false);
		expect(shouldArm({ ...base, off: true })).toBe(false);
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

/** Drive a machine to the scroll phase at `now`, with the page at the top. */
function toScroll(m: IntroMachine): number {
	m.markReady();
	expect(m.step(T.minVeilMs, 0, 900)).toEqual({ kind: 'lift' });
	m.liftEnded(T.minVeilMs + T.liftMs);
	const start = T.minVeilMs + T.liftMs + T.holdMs;
	m.step(start, 0, 900);
	expect(m.phase).toBe('scroll');
	return start;
}

describe('IntroMachine', () => {
	it('holds the veil for the minimum dwell even when the wiper is ready at once', () => {
		const m = new IntroMachine(0);
		m.markReady();
		expect(m.step(T.minVeilMs - 1, 0, 900)).toEqual({ kind: 'idle' });
		expect(m.phase).toBe('veil');
		expect(m.step(T.minVeilMs, 0, 900)).toEqual({ kind: 'lift' });
		expect(m.phase).toBe('lift');
	});

	it('waits for the wiper stack past the minimum, then lifts at the cap regardless', () => {
		const m = new IntroMachine(0);
		expect(m.step(T.veilCapMs - 1, 0, 900)).toEqual({ kind: 'idle' });
		expect(m.phase).toBe('veil');
		expect(m.step(T.veilCapMs, 0, 900)).toEqual({ kind: 'lift' });
	});

	it('lifts as soon as the wiper reports ready after the minimum', () => {
		const m = new IntroMachine(0);
		m.step(T.minVeilMs + 500, 0, 900);
		expect(m.phase).toBe('veil');
		m.markReady();
		expect(m.step(T.minVeilMs + 516, 0, 900)).toEqual({ kind: 'lift' });
	});

	it('cancels on a foreign scroll in any phase, the veil included', () => {
		const veil = new IntroMachine(0);
		expect(veil.step(100, T.deviationPx + 1, 900)).toEqual({ kind: 'cancel', reason: 'scrolled' });
		const lift = new IntroMachine(0);
		lift.markReady();
		lift.step(T.minVeilMs, 0, 900);
		expect(lift.step(T.minVeilMs + 50, 655, 900)).toEqual({ kind: 'cancel', reason: 'scrolled' });
	});

	it('moves from the lift to the hold on animationend, or by the grace timer', () => {
		const a = new IntroMachine(0);
		a.markReady();
		a.step(T.minVeilMs, 0, 900);
		a.liftEnded(T.minVeilMs + 400);
		expect(a.phase).toBe('hold');

		const b = new IntroMachine(0);
		b.markReady();
		b.step(T.minVeilMs, 0, 900);
		b.step(T.minVeilMs + T.liftMs + T.liftGraceMs - 1, 0, 900);
		expect(b.phase).toBe('lift');
		b.step(T.minVeilMs + T.liftMs + T.liftGraceMs, 0, 900);
		expect(b.phase).toBe('hold');
	});

	it('holds header and hero for the hold, then scrolls', () => {
		const m = new IntroMachine(0);
		m.markReady();
		m.step(T.minVeilMs, 0, 900);
		m.liftEnded(T.minVeilMs + T.liftMs);
		m.step(T.minVeilMs + T.liftMs + T.holdMs - 1, 0, 900);
		expect(m.phase).toBe('hold');
		m.step(T.minVeilMs + T.liftMs + T.holdMs, 0, 900);
		expect(m.phase).toBe('scroll');
	});

	it('writes a monotone tween from the start to the target and lands exactly on it', () => {
		const m = new IntroMachine(0);
		const start = toScroll(m);
		let last = 0;
		let y = 0;
		for (let now = start + 16; now < start + T.scrollMs; now += 16) {
			const command = m.step(now, y, 900);
			expect(command.kind).toBe('write');
			if (command.kind === 'write') {
				expect(command.y).toBeGreaterThanOrEqual(last);
				expect(command.y).toBeLessThanOrEqual(900);
				last = command.y;
				y = command.y;
			}
		}
		expect(m.step(start + T.scrollMs, y, 900)).toEqual({ kind: 'done', y: 900 });
		expect(m.phase).toBe('done');
		expect(m.step(99_999, 900, 900)).toEqual({ kind: 'idle' });
	});

	it('cancels when the page moves by more than the deviation in the hold and the scroll', () => {
		const held = new IntroMachine(0);
		held.markReady();
		held.step(T.minVeilMs, 0, 900);
		held.liftEnded(T.minVeilMs + T.liftMs);
		expect(held.step(T.minVeilMs + T.liftMs + 10, T.deviationPx + 1, 900)).toEqual({
			kind: 'cancel',
			reason: 'scrolled',
		});
		expect(held.phase).toBe('cancelled');

		const scrolling = new IntroMachine(0);
		const start = toScroll(scrolling);
		const first = scrolling.step(start + 400, 0, 900);
		expect(first.kind).toBe('write');
		const written = first.kind === 'write' ? first.y : 0;
		expect(scrolling.step(start + 416, written + T.deviationPx + 1, 900)).toEqual({
			kind: 'cancel',
			reason: 'scrolled',
		});
		expect(scrolling.step(start + 432, 0, 900)).toEqual({ kind: 'idle' });
	});

	it('tolerates a page that follows its own writes within the deviation', () => {
		const m = new IntroMachine(0);
		const start = toScroll(m);
		const first = m.step(start + 400, 0, 900);
		const written = first.kind === 'write' ? first.y : 0;
		expect(m.step(start + 416, Math.round(written), 900).kind).toBe('write');
	});

	it('is terminal once cancelled', () => {
		const m = new IntroMachine(0);
		m.cancel('input');
		expect(m.phase).toBe('cancelled');
		expect(m.reason).toBe('input');
		m.liftEnded(5);
		m.cancel('other');
		expect(m.reason).toBe('input');
		expect(m.step(10, 0, 900)).toEqual({ kind: 'idle' });
	});
});
