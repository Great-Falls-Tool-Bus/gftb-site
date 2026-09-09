import { describe, expect, it } from 'vitest';
import { DropletField, legAngles, strokeLegs } from './droplet-field';
import { bladePoseAt, deriveGeometry, phiAt, polar } from './geometry';
import { WiperMachine, type StrokeSample } from './machine';
import { DROP_GROW_S, DROP_OCCUPANCY } from './renderer/shaders/constants';
import { strokeEase, strokeEaseInverse, wiperDetent } from './schedule';

/** A small deterministic generator so every run sees the same field. */
function lcg(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

const sample = (phase: StrokeSample['phase'], t: number, strokeIndex: number, passesDone: number): StrokeSample => ({
	phase,
	t,
	strokeIndex,
	passesDone,
});

describe('strokeLegs', () => {
	it('returns nothing across a rest and the partial leg of a stroke in flight', () => {
		expect(strokeLegs(sample('dwell', 0, 4, 4), sample('dwell', 0, 4, 4))).toEqual([]);
		expect(strokeLegs(sample('out', 0.2, 5, 4), sample('out', 0.45, 5, 4))).toEqual([
			{ stroke: 'out', from: 0.2, to: 0.45 },
		]);
		// A hold: the same progress twice is a zero-width leg.
		expect(strokeLegs(sample('out', 0.5, 5, 4), sample('out', 0.5, 5, 4))).toEqual([
			{ stroke: 'out', from: 0.5, to: 0.5 },
		]);
	});

	it('opens the out-stroke from park when a rest ends and finishes legs across the turnaround and park', () => {
		expect(strokeLegs(sample('dwell', 0, 4, 4), sample('out', 0.3, 5, 4))).toEqual([
			{ stroke: 'out', from: 0, to: 0.3 },
		]);
		expect(strokeLegs(sample('out', 0.8, 5, 4), sample('back', 0.1, 6, 5))).toEqual([
			{ stroke: 'out', from: 0.8, to: 1 },
			{ stroke: 'back', from: 0, to: 0.1 },
		]);
		expect(strokeLegs(sample('back', 0.9, 6, 5), sample('dwell', 0, 6, 6))).toEqual([
			{ stroke: 'back', from: 0.9, to: 1 },
		]);
	});

	it('covers a whole cycle when a frame gap swallowed one, and ignores an abandoned stroke', () => {
		expect(strokeLegs(sample('dwell', 0, 4, 4), sample('out', 0.2, 7, 6))).toEqual([
			{ stroke: 'out', from: 0, to: 1 },
			{ stroke: 'back', from: 0, to: 1 },
			{ stroke: 'out', from: 0, to: 0.2 },
		]);
		// Off mid-stroke: no pass completed, nothing crossed on record.
		expect(strokeLegs(sample('out', 0.4, 5, 4), sample('dwell', 0, 5, 4))).toEqual([]);
	});

	it('maps a leg to the angles the mask edge swept', () => {
		const arm = deriveGeometry({ width: 1152, height: 620 }).arms[0];
		const box = { width: 1152, height: 620 };
		for (const t of [0.1, 0.5, 0.9]) {
			const { hi, lo } = legAngles(arm, { stroke: 'out', from: 0, to: t });
			expect(hi).toBeCloseTo(bladePoseAt(arm, box, 'out', strokeEase(t), t).phi, 12);
			expect(lo).toBeCloseTo(phiAt(arm, 0, 'out', strokeEase), 12);
		}
		expect(strokeEaseInverse(strokeEase(0.37))).toBeCloseTo(0.37, 12);
	});
});

describe('DropletField', () => {
	const box = { width: 1152, height: 620 };
	const geometry = deriveGeometry(box);

	function drive(machine: WiperMachine, field: DropletField, fromMs: number, toMs: number, stepMs: number) {
		let last = fromMs;
		for (let now = fromMs + stepMs; now <= toMs; now += stepMs) {
			machine.tick(now);
			field.step((now - last) / 1000, machine.strokeSample(now));
			last = now;
		}
	}

	function make(seed = 3) {
		const machine = new WiperMachine({
			pageSize: () => 3,
			itemCount: () => 6,
			motionOk: () => true,
			initial: 'high',
			random: () => 0.5,
		});
		machine.resume(0);
		machine.tick(0);
		const field = new DropletField(geometry, { random: lcg(seed), preseed: 0 });
		field.step(0, machine.strokeSample(0));
		return { machine, field };
	}

	it('fills the glass through a rest and stays under the occupancy ceiling', () => {
		const { machine, field } = make();
		expect(field.occupancy()).toBe(0);
		drive(machine, field, 0, 2500, 50);
		expect(machine.phase).toBe('dwell');
		expect(field.occupancy()).toBeGreaterThan(0.25);
		expect(field.occupancy()).toBeLessThanOrEqual(DROP_OCCUPANCY);
		// Grown beads report full alpha and their final radius.
		const stride = field.cols + 2;
		let grown = 0;
		for (let j = 1; j <= field.rows; j += 1) {
			for (let i = 1; i <= field.cols; i += 1) {
				const a = field.data[(j * stride + i) * 4 + 3];
				if (a === 1) grown += 1;
			}
		}
		expect(grown).toBeGreaterThan(0);
	});

	it('holds still under a hold and never leaves a bead behind a moving edge', () => {
		const { machine, field } = make();
		drive(machine, field, 0, 2500, 50);
		const before = field.data.slice();
		// The rest ends at 3000 ms on High; run into the out-stroke and hold at the midpoint.
		const dwell = wiperDetent('high').dwellMs;
		drive(machine, field, 2500, dwell + 100, 50);
		expect(machine.phase).toBe('out');
		expect(before.some((value, index) => value !== field.data[index])).toBe(true);
		const held = machine.holdStrokeAt(0.5, dwell + 100);
		expect(held).toBe(0.5);
		const clock = machine.strokeSample(dwell + 100);
		// The hold jumped the blade to the midpoint: that jump is a leg and
		// clears what it crossed; a second frame on the same hold changes nothing.
		field.step(0, clock);
		expect(field.step(0, clock)).toBe(false);
		// Everything the blades crossed so far is gone: no live bead has its
		// far edge behind its arm's current edge.
		const stride = field.cols + 2;
		for (const arm of geometry.arms) {
			const edge = phiAt(arm, clock.t, 'out', strokeEase);
			for (let j = 1; j <= field.rows; j += 1) {
				for (let i = 1; i <= field.cols; i += 1) {
					const offset = (j * stride + i) * 4;
					if (field.data[offset + 3] <= 0) continue;
					const bead = polar(arm, field.data[offset], field.data[offset + 1]);
					if (bead.phi < -arm.park || bead.phi > arm.halfSweep || bead.distance > arm.length) continue;
					expect(bead.phi + field.data[offset + 2] / bead.distance).toBeGreaterThanOrEqual(edge - 1e-9);
				}
			}
		}
	});

	it('clears the glass by the end of a stroke and regrows afterwards', () => {
		const { machine, field } = make();
		const dwell = wiperDetent('high').dwellMs;
		drive(machine, field, 0, dwell - 100, 50);
		const filled = field.occupancy();
		expect(filled).toBeGreaterThan(0.25);
		// Through the out-stroke and the back-stroke: every bead in either fan was crossed.
		drive(machine, field, dwell - 100, dwell + wiperDetent('high').sweepMs + 200, 40);
		expect(machine.phase).toBe('dwell');
		expect(field.occupancy()).toBeLessThanOrEqual(0.03);
		drive(machine, field, dwell + wiperDetent('high').sweepMs + 200, dwell + wiperDetent('high').sweepMs + 2600, 50);
		expect(field.occupancy()).toBeGreaterThan(0.15);
	});

	it('survives a frame gap that swallows a whole stroke', () => {
		const { machine, field } = make(9);
		const dwell = wiperDetent('high').dwellMs;
		drive(machine, field, 0, dwell - 100, 50);
		expect(field.occupancy()).toBeGreaterThan(0.25);
		// The machine ticks through the whole sweep while the field sees one
		// step: the legs between its two samples cover both strokes.
		const half = wiperDetent('high').sweepMs / 2;
		machine.tick(dwell);
		expect(machine.phase).toBe('out');
		machine.tick(dwell + half + 50);
		expect(machine.phase).toBe('back');
		const now = dwell + 2 * half + 200;
		machine.tick(now);
		expect(machine.phase).toBe('dwell');
		field.step(1, machine.strokeSample(now));
		expect(field.occupancy()).toBeLessThanOrEqual(0.03);
	});

	it('preseeds grown beads and rebuilds on relayout', () => {
		const field = new DropletField(geometry, { random: lcg(1), preseed: 0.5 });
		expect(field.occupancy()).toBeGreaterThan(0.35);
		expect(field.occupancy()).toBeLessThan(0.65);
		expect(field.data).toHaveLength((field.cols + 2) * (field.rows + 2) * 4);
		expect(field.time).toBe(0);
		expect(DROP_GROW_S).toBeGreaterThan(0);
		field.relayout(deriveGeometry({ width: 358, height: 400 }));
		expect(field.cols).toBeLessThan(20);
	});
});
