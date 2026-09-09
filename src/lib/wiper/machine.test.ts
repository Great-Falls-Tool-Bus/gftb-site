import { describe, expect, it } from 'vitest';
import { WiperMachine, MAX_STEP_MS } from './machine';
import { wiperDetent } from './schedule';

function make(overrides: Partial<ConstructorParameters<typeof WiperMachine>[0]> = {}) {
	return new WiperMachine({
		pageSize: () => 3,
		itemCount: () => 10,
		motionOk: () => true,
		initial: 'low',
		random: () => 0.5,
		...overrides,
	});
}

/** Run the clock forward in small steps, returning the ticks that changed anything. */
function run(machine: WiperMachine, from: number, to: number, step = 16) {
	const events: Array<{ at: number; apex?: boolean; finish?: boolean; unit?: number }> = [];
	for (let now = from; now <= to; now += step) {
		const r = machine.tick(now);
		if (r.view || r.unit !== null)
			events.push({ at: now, apex: r.apex || undefined, finish: r.finish || undefined, unit: r.unit ?? undefined });
	}
	return events;
}

describe('WiperMachine', () => {
	it('starts in dwell on the requested detent with four pages of three', () => {
		const m = make();
		const v = m.view();
		expect(v).toMatchObject({
			detent: 'low',
			phase: 'dwell',
			state: 'dwell',
			page: 0,
			pageCount: 4,
			pageSize: 3,
			paged: true,
			running: true,
		});
		expect(m.needsFrames).toBe(true);
	});

	it('is off, unpaged and frame-free when motion is not allowed or there is one page', () => {
		expect(make({ motionOk: () => false }).view()).toMatchObject({ state: 'off', paged: false, rotatable: false });
		expect(make({ itemCount: () => 3 }).view()).toMatchObject({ state: 'off', pageCount: 1, paged: false });
		expect(make({ motionOk: () => false }).needsFrames).toBe(false);
	});

	it('wipes after the dwell: out-stroke masks page 0 out and page 1 in, the apex turns the page, the back-stroke ends in dwell', () => {
		const m = make();
		const { dwellMs, sweepMs } = wiperDetent('low');
		m.resume(0);
		run(m, 0, dwellMs - 16);
		expect(m.phase).toBe('dwell');
		m.tick(dwellMs + 16);
		expect(m.view()).toMatchObject({ phase: 'out', state: 'wiping', outgoing: 0, incoming: 1, page: 0 });
		const half = sweepMs / 2;
		const mid = m.tick(dwellMs + 16 + half / 2);
		expect(mid.unit).toBeGreaterThan(0.3);
		expect(mid.unit).toBeLessThan(0.7);
		const atApex = m.tick(dwellMs + 16 + half + 1);
		expect(atApex.apex).toBe(true);
		expect(m.view()).toMatchObject({ phase: 'back', page: 1, outgoing: -1, incoming: -1 });
		const atEnd = m.tick(dwellMs + 16 + 2 * half + 2);
		expect(atEnd.finish).toBe(true);
		expect(m.view()).toMatchObject({ phase: 'dwell', page: 1, state: 'dwell' });
	});

	it('gives every page its turn and wraps', () => {
		const m = make({ pageSize: () => 1, itemCount: () => 3, initial: 'high' });
		const pages: number[] = [];
		m.resume(0);
		for (let now = 0; now < 30_000; now += 16) {
			const r = m.tick(now);
			if (r.apex) pages.push(m.page);
			if (pages.length === 4) break;
		}
		expect(pages).toEqual([1, 2, 0, 1]);
	});

	it('banks the dwell across a hover pause and resumes where it left off', () => {
		const m = make();
		m.resume(0);
		run(m, 0, 1000);
		const remaining = m.dwellRemainingMs;
		m.hover = true;
		expect(m.view()).toMatchObject({ state: 'paused', running: false });
		run(m, 1016, 60_000);
		expect(m.dwellRemainingMs).toBe(remaining);
		expect(m.phase).toBe('dwell');
		m.hover = false;
		m.resume(60_016);
		run(m, 60_016, 60_016 + remaining + 40);
		expect(m.phase).toBe('out');
	});

	it('lets a stroke in flight complete even under a pause', () => {
		const m = make({ initial: 'high' });
		const { dwellMs, sweepMs } = wiperDetent('high');
		m.resume(0);
		run(m, 0, dwellMs + 20);
		expect(m.phase).toBe('out');
		const started = dwellMs + 20;
		m.hover = true;
		run(m, started, started + sweepMs / 2 + 40);
		expect(m.phase).toBe('back');
		run(m, started + sweepMs / 2 + 40, started + sweepMs + 80);
		expect(m.phase).toBe('dwell');
		expect(m.needsFrames).toBe(false);
	});

	it('Off is immediate and abandons a stroke; turning back on restarts the dwell', () => {
		const m = make({ initial: 'high' });
		m.resume(0);
		run(m, 0, wiperDetent('high').dwellMs + 20);
		expect(m.phase).toBe('out');
		m.setDetent('off', 2000);
		expect(m.view()).toMatchObject({
			detent: 'off',
			phase: 'dwell',
			state: 'off',
			outgoing: -1,
			incoming: -1,
			paged: false,
		});
		expect(m.needsFrames).toBe(false);
		m.setDetent('intermittent', 2100);
		expect(m.view()).toMatchObject({ state: 'dwell', running: true });
		expect(m.dwellRemainingMs).toBeGreaterThan(0);
		expect(m.dwellRemainingMs).toBeLessThanOrEqual(wiperDetent('intermittent').dwellMs * 1.3);
	});

	it('a faster detent never waits out the slower dwell', () => {
		const m = make({ initial: 'intermittent', random: () => 1 });
		m.resume(0);
		m.tick(100);
		const before = m.dwellRemainingMs;
		expect(before).toBeGreaterThan(wiperDetent('high').dwellMs);
		m.setDetent('high', 100);
		expect(m.dwellRemainingMs).toBeLessThanOrEqual(wiperDetent('high').dwellMs);
	});

	it('reveal shows the focused page at once, with no wipe', () => {
		const m = make({ initial: 'high' });
		m.resume(0);
		run(m, 0, wiperDetent('high').dwellMs + 20);
		expect(m.phase).toBe('out');
		m.reveal(7, 5000);
		expect(m.view()).toMatchObject({ phase: 'dwell', page: 2, currentPage: 2, outgoing: -1, incoming: -1 });
		expect(m.unit).toBe(0);
	});

	it('clamps the current page when the page size grows', () => {
		let size = 1;
		const m = make({ pageSize: () => size, itemCount: () => 10, initial: 'high' });
		m.reveal(9, 0);
		expect(m.currentPage).toBe(9);
		size = 3;
		expect(m.pageCount).toBe(4);
		expect(m.currentPage).toBe(3);
	});

	it('takes at most a bounded step when a throttled tab returns', () => {
		const m = make();
		m.resume(0);
		m.tick(0);
		m.tick(50_000);
		expect(m.dwellRemainingMs).toBeGreaterThanOrEqual(wiperDetent('low').dwellMs - MAX_STEP_MS);
	});

	it('holds an out-stroke at a unit and resumes from that angle when released', () => {
		const m = make({ initial: 'high' });
		const { dwellMs, sweepMs } = wiperDetent('high');
		m.resume(0);
		run(m, 0, dwellMs + 20);
		expect(m.phase).toBe('out');
		const held = m.holdStrokeAt(0.5, 10_000);
		expect(held).toBe(0.5);
		expect(m.unit).toBe(0.5);
		// Released: progress continues upward from the held unit, never back.
		const units: number[] = [];
		for (let now = 10_016; now < 10_000 + sweepMs; now += 16) {
			const r = m.tick(now);
			if (r.unit !== null) units.push(r.unit);
			if (r.apex) break;
		}
		expect(units.length).toBeGreaterThan(3);
		expect(units[0]).toBeGreaterThanOrEqual(0.5);
		for (let index = 1; index < units.length; index += 1) expect(units[index]).toBeGreaterThanOrEqual(units[index - 1]);
		expect(m.phase).toBe('back');
		// Holding outside an out-stroke is a no-op.
		expect(m.holdStrokeAt(0.2, 20_000)).toBe(0);
	});
});

describe('the stroke counters', () => {
	it('bump at a stroke start, the turnaround and park, and never on Off or a page jump', () => {
		const m = make({ initial: 'high', random: () => 0.5 });
		m.resume(0);
		m.tick(0);
		expect(m.strokeSample(0)).toMatchObject({ phase: 'dwell', t: 0, strokeIndex: 0, passesDone: 0 });
		const dwell = wiperDetent('high').dwellMs;
		for (let now = 100; now <= dwell + 100; now += 100) m.tick(now);
		expect(m.phase).toBe('out');
		expect(m.strokeSample(dwell + 100)).toMatchObject({ phase: 'out', strokeIndex: 1, passesDone: 0 });
		const half = wiperDetent('high').sweepMs / 2;
		for (let now = dwell + 200; now <= dwell + half + 100; now += 100) m.tick(now);
		expect(m.phase).toBe('back');
		expect(m.strokeSample(dwell + half + 100)).toMatchObject({ strokeIndex: 2, passesDone: 1 });
		for (let now = dwell + half + 200; now <= dwell + 2 * half + 200; now += 100) m.tick(now);
		expect(m.phase).toBe('dwell');
		expect(m.passesDone).toBe(2);
		m.reveal(4, dwell + 2 * half + 300);
		m.setDetent('off', dwell + 2 * half + 400);
		expect(m.strokeSample(dwell + 2 * half + 400)).toMatchObject({ strokeIndex: 2, passesDone: 2 });
	});
});
