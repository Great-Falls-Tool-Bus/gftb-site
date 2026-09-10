// The shove's per-page train (geometry.ts trainFor): one contact per page,
// the row rides the first blade to touch it, and the run puts the leftmost
// note's left edge on the glass's right edge at the turnaround.
import { describe, expect, it } from 'vitest';
import { deriveGeometry, trainFor } from './geometry';

const px = (value: string) => Number.parseFloat(value);
const rad = (value: string) => (Number.parseFloat(value) * Math.PI) / 180;

function readTrain(vars: ReturnType<typeof trainFor>) {
	const tx = px(vars['--wipe-tx']);
	const ty = px(vars['--wipe-ty']);
	const from = rad(vars['--wipe-tfrom']);
	const span = rad(vars['--wipe-tspan']);
	const run = px(vars['--wipe-run']);
	const contact = Number.parseFloat(vars['--wipe-contact']);
	const reachAt = (u: number) => tx + ty * Math.tan(from + u * span);
	return { tx, ty, from, span, run, contact, reachAt };
}

describe('the shove train', () => {
	it('rides a single blade exactly off the glass when one note fills the page', () => {
		const geometry = deriveGeometry({ width: 375, height: 420 });
		const train = readTrain(trainFor(geometry, [{ left: 0, top: 0, width: 375, height: 300 }]));
		expect(train.contact).toBeGreaterThan(0);
		expect(train.contact).toBeLessThanOrEqual(0.98);
		// At the contact unit the blade's ray passes through the note's corner.
		expect(Math.abs(train.reachAt(train.contact))).toBeLessThan(1);
		// The blade's own reach at the turnaround already clears the glass.
		expect(train.run).toBe(0);
		expect(train.reachAt(1)).toBeGreaterThanOrEqual(375);
	});

	it('moves a three-column page as one row that clears the right edge at the turnaround', () => {
		const geometry = deriveGeometry({ width: 1200, height: 340 });
		const notes = [0, 415, 830].map((left) => ({ left, top: 0, width: 370, height: 300 }));
		const vars = trainFor(geometry, notes);
		const train = readTrain(vars);
		expect(train.contact).toBeGreaterThanOrEqual(0);
		expect(train.contact).toBeLessThanOrEqual(0.98);
		// Every note on the page is given the same contact, so the row is rigid.
		expect(trainFor(geometry, notes)).toEqual(vars);
		// Blade reach plus run puts the leftmost note's left edge on the glass's right edge.
		const travel = train.reachAt(1) + train.run;
		expect(travel).toBeGreaterThanOrEqual(1200 - 0.5);
		if (train.run > 0) expect(travel).toBeLessThan(1200 + 0.5);
		// The contact is a real rubber contact: the corner sits within the blade's length.
		const arm = geometry.arms.find((candidate) =>
			notes.some((note) => Math.abs(candidate.pivotX - note.left - train.tx) < 0.01),
		);
		expect(arm).toBeDefined();
		expect(Math.hypot(train.tx, train.ty)).toBeLessThanOrEqual(arm!.length);
	});

	it('gives a short last page its own contact', () => {
		const geometry = deriveGeometry({ width: 1200, height: 340 });
		const full = readTrain(
			trainFor(
				geometry,
				[0, 415, 830].map((left) => ({ left, top: 0, width: 370, height: 300 })),
			),
		);
		// A last page holding only the middle column: its own corner is the
		// contact, and the row only has to carry that note off the glass.
		const last = readTrain(trainFor(geometry, [{ left: 415, top: 0, width: 370, height: 300 }]));
		expect(Math.abs(last.reachAt(last.contact))).toBeLessThan(1);
		expect(last.reachAt(1) + last.run).toBeGreaterThanOrEqual(1200 - 415 - 0.5);
		expect(last.contact).not.toBe(full.contact);
	});
});
