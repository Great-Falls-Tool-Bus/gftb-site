import { describe, expect, it } from 'vitest';
import { strokeEase } from './schedule';
import {
	FEATHER_DEG,
	PHI_MAX_DEG,
	TWO_ARM_MIN_WIDTH,
	armAt,
	armsOver,
	bladePoseAt,
	coversPane,
	deriveGeometry,
	halfSweepDeg,
	leftToRight,
	maskVarsFor,
	parkAngle,
	phiAt,
	sweepSpan,
	sweepSpanDeg,
	sweptBy,
	wipeAngleDeg,
} from './geometry';

// The pane boxes the acceptance suite meets: three-up rows on wide viewports,
// one-up rows on phones, plus a tall one-up page and a squat wide page.
const BOXES = [
	{ label: '1440 three-up', width: 1152, height: 620 },
	{ label: '1280 three-up', width: 1088, height: 640 },
	{ label: '768 two-arm floor', width: 720, height: 560 },
	{ label: '640 boundary', width: 640, height: 500 },
	{ label: '430 one-up', width: 398, height: 420 },
	{ label: '390 one-up', width: 358, height: 400 },
	{ label: '320 one-up', width: 288, height: 620 },
	{ label: 'squat', width: 1152, height: 240 },
];

describe('deriveGeometry', () => {
	it('uses two arms from the two-arm floor and one below it', () => {
		expect(deriveGeometry({ width: TWO_ARM_MIN_WIDTH, height: 400 }).arms).toHaveLength(2);
		expect(deriveGeometry({ width: TWO_ARM_MIN_WIDTH - 1, height: 400 }).arms).toHaveLength(1);
	});

	it('parks the hub below the pane and caps the fan', () => {
		for (const box of BOXES) {
			const geometry = deriveGeometry(box);
			for (const arm of geometry.arms) {
				expect(arm.pivotY, box.label).toBeGreaterThan(box.height);
				expect(halfSweepDeg(arm), box.label).toBeLessThanOrEqual(PHI_MAX_DEG + 1e-9);
				expect(halfSweepDeg(arm), box.label).toBeGreaterThan(10);
				expect(arm.length, box.label).toBeGreaterThan(arm.pivotY);
			}
			expect(geometry.featherDeg).toBe(FEATHER_DEG);
		}
	});

	it('parks every blade with its tip on or below the glass line, and starts the fan there', () => {
		for (const box of BOXES) {
			for (const arm of deriveGeometry(box).arms) {
				expect(arm.park, box.label).toBeGreaterThanOrEqual(arm.halfSweep);
				expect(parkAngle(arm)).toBe(-arm.park);
				const tipY = arm.pivotY - arm.length * Math.cos(arm.park);
				expect(tipY, box.label).toBeGreaterThanOrEqual(box.height - 1e-6);
				// The stroke is the whole span from park to the turnaround.
				expect(sweepSpan(arm)).toBeCloseTo(arm.park + arm.halfSweep, 12);
				expect(sweepSpanDeg(arm)).toBeCloseTo(halfSweepDeg(arm) + (arm.park * 180) / Math.PI, 9);
			}
		}
	});

	it('sweeps every point of the pane at every breakpoint', () => {
		for (const box of BOXES) {
			expect(coversPane(deriveGeometry(box)), box.label).toBe(true);
		}
	});

	it('does not claim to cover a point the fan cannot reach', () => {
		const geometry = deriveGeometry({ width: 1152, height: 620 });
		const [left] = geometry.arms;
		// Far outside the left arm's own span, well past its fan.
		expect(sweptBy(left, 1150, 600)).toBe(false);
		// Straight above the hub, inside the pane: always swept.
		expect(sweptBy(left, left.pivotX, 10)).toBe(true);
	});

	it('hands a note to every blade that passes over it, its owner first', () => {
		const geometry = deriveGeometry({ width: 1152, height: 620 });
		const [left, right] = geometry.arms;
		// High and far out in its own span, past the other blade's tip.
		expect(armsOver(geometry, { left: 20, top: 20, width: 200, height: 140 })).toEqual([left]);
		expect(armsOver(geometry, { left: 900, top: 20, width: 230, height: 140 })).toEqual([right]);
		// Lower down near the boundary the other blade's arc crosses the note.
		expect(armsOver(geometry, { left: 40, top: 20, width: 340, height: 200 })).toEqual([left, right]);
		// The middle column of a three-up row straddles the boundary.
		expect(armsOver(geometry, { left: 420, top: 20, width: 320, height: 500 })).toEqual([right, left]);
		expect(armsOver(geometry, { left: 400, top: 20, width: 330, height: 500 })).toEqual([left, right]);
		// A left note reaching the bottom meets the right blade's rising tip.
		expect(armsOver(geometry, { left: 40, top: 20, width: 500, height: 600 })).toEqual([left, right]);
		expect(
			armsOver(deriveGeometry({ width: 358, height: 400 }), { left: 0, top: 0, width: 358, height: 400 }),
		).toHaveLength(1);
	});

	it('orders a pair left to right by hub whichever owns the note', () => {
		const [left, right] = deriveGeometry({ width: 1152, height: 620 }).arms;
		expect(leftToRight([right, left])).toEqual([left, right]);
		expect(leftToRight([left, right])).toEqual([left, right]);
	});

	it('assigns an item to the arm owning its x and the last arm past the edge', () => {
		const geometry = deriveGeometry({ width: 1152, height: 620 });
		expect(armAt(geometry, 10)).toBe(geometry.arms[0]);
		expect(armAt(geometry, 1000)).toBe(geometry.arms[1]);
		expect(armAt(geometry, 5000)).toBe(geometry.arms[1]);
	});
});

describe('the stroke and the mask', () => {
	const arm = deriveGeometry({ width: 1152, height: 620 }).arms[0];

	it('runs the out-stroke from park to the turnaround and the back-stroke home, monotonically', () => {
		expect(phiAt(arm, 0, 'out', strokeEase)).toBeCloseTo(-arm.park, 12);
		expect(phiAt(arm, 1, 'out', strokeEase)).toBeCloseTo(arm.halfSweep, 12);
		expect(phiAt(arm, 0, 'back', strokeEase)).toBeCloseTo(arm.halfSweep, 12);
		expect(phiAt(arm, 1, 'back', strokeEase)).toBeCloseTo(-arm.park, 12);
		let previous = -Infinity;
		for (let step = 0; step <= 50; step += 1) {
			const phi = phiAt(arm, step / 50, 'out', strokeEase);
			expect(phi).toBeGreaterThanOrEqual(previous);
			previous = phi;
		}
	});

	it('maps the blade angle to a swept angle from park, in degrees', () => {
		expect(wipeAngleDeg(arm, -arm.park)).toBeCloseTo(0, 12);
		expect(wipeAngleDeg(arm, arm.halfSweep)).toBeCloseTo(sweepSpanDeg(arm), 12);
	});

	it('expresses the pivot in item coordinates and the park angle in the conic convention', () => {
		const pane = { left: 144, top: 900 };
		const item = { left: 144 + 400, top: 900 + 50 };
		const vars = maskVarsFor(arm, item, pane);
		expect(vars['--wipe-from']).toBe(`${Math.round(((-arm.park * 180) / Math.PI) * 100) / 100}deg`);
		expect(vars['--wipe-x']).toBe(`${Math.round((arm.pivotX - 400) * 100) / 100}px`);
		expect(vars['--wipe-y']).toBe(`${Math.round((arm.pivotY - 50) * 100) / 100}px`);
	});
});

describe('the blade pose', () => {
	const box = { width: 1152, height: 620 };
	const geometry = deriveGeometry(box);

	it('sits on the mask edge: the pose angle is phiAt for the same eased unit', () => {
		for (const arm of geometry.arms) {
			for (let step = 0; step <= 20; step += 1) {
				const t = step / 20;
				const out = bladePoseAt(arm, box, 'out', strokeEase(t), t);
				expect(out.phi).toBeCloseTo(phiAt(arm, t, 'out', strokeEase), 12);
				const back = bladePoseAt(arm, box, 'back', strokeEase(t), t);
				expect(back.phi).toBeCloseTo(phiAt(arm, t, 'back', strokeEase), 12);
			}
			expect(bladePoseAt(arm, box, 'dwell', 0, 0).phi).toBeCloseTo(parkAngle(arm), 12);
		}
	});

	it('lags the rubber against travel, nothing at the ends, most through the middle', () => {
		const [left, right] = geometry.arms;
		expect(bladePoseAt(left, box, 'out', 0, 0).flex).toBe(0);
		expect(bladePoseAt(left, box, 'out', 1, 1).flex).toBeCloseTo(0, 12);
		expect(bladePoseAt(left, box, 'out', 0.5, 0.5).flex).toBeCloseTo(1, 12);
		expect(bladePoseAt(left, box, 'back', 0.5, 0.5).flex).toBeCloseTo(-1, 12);
		expect(bladePoseAt(right, box, 'out', 0.5, 0.5).flex).toBeCloseTo(1, 12);
		expect(bladePoseAt(left, box, 'dwell', 0, 0).flex).toBe(0);
	});

	it('keeps the rubber reaching the glass edge and the arm a believable width at every breakpoint', () => {
		for (const candidate of BOXES) {
			for (const arm of deriveGeometry(candidate).arms) {
				const pose = bladePoseAt(arm, candidate, 'out', 0.5, 0.5);
				// The nearest glass crossing is straight up from the hub.
				expect(pose.bladeFrom, candidate.label).toBeLessThan(arm.pivotY - candidate.height);
				expect(pose.bladeFrom, candidate.label).toBeGreaterThan(0);
				expect(pose.width, candidate.label).toBeGreaterThanOrEqual(6);
				expect(pose.width, candidate.label).toBeLessThanOrEqual(22);
				expect(pose.width, candidate.label).toBeLessThanOrEqual(candidate.width * 0.03);
			}
		}
	});
});
