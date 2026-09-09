import { describe, expect, it } from 'vitest';
import { strokeEase } from './schedule';
import {
	FEATHER_DEG,
	PHI_MAX_DEG,
	TWO_ARM_MIN_WIDTH,
	armAt,
	coversPane,
	deriveGeometry,
	halfSweepDeg,
	maskVarsFor,
	phiAt,
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

	it('assigns an item to the arm owning its x and the last arm past the edge', () => {
		const geometry = deriveGeometry({ width: 1152, height: 620 });
		expect(armAt(geometry, 10)).toBe(geometry.arms[0]);
		expect(armAt(geometry, 1000)).toBe(geometry.arms[1]);
		expect(armAt(geometry, 5000)).toBe(geometry.arms[1]);
	});
});

describe('the stroke and the mask', () => {
	const arm = deriveGeometry({ width: 1152, height: 620 }).arms[0];

	it('runs the out-stroke from park to end and the back-stroke home, monotonically', () => {
		expect(phiAt(arm, 0, 'out', strokeEase)).toBeCloseTo(-arm.halfSweep, 12);
		expect(phiAt(arm, 1, 'out', strokeEase)).toBeCloseTo(arm.halfSweep, 12);
		expect(phiAt(arm, 0, 'back', strokeEase)).toBeCloseTo(arm.halfSweep, 12);
		expect(phiAt(arm, 1, 'back', strokeEase)).toBeCloseTo(-arm.halfSweep, 12);
		let previous = -Infinity;
		for (let step = 0; step <= 50; step += 1) {
			const phi = phiAt(arm, step / 50, 'out', strokeEase);
			expect(phi).toBeGreaterThanOrEqual(previous);
			previous = phi;
		}
	});

	it('maps the blade angle to a swept angle from park, in degrees', () => {
		expect(wipeAngleDeg(arm, -arm.halfSweep)).toBeCloseTo(0, 12);
		expect(wipeAngleDeg(arm, arm.halfSweep)).toBeCloseTo(2 * halfSweepDeg(arm), 12);
	});

	it('expresses the pivot in item coordinates and the park angle in the conic convention', () => {
		const pane = { left: 144, top: 900 };
		const item = { left: 144 + 400, top: 900 + 50 };
		const vars = maskVarsFor(arm, item, pane);
		expect(vars['--wipe-from']).toBe(`${Math.round(-halfSweepDeg(arm) * 100) / 100}deg`);
		expect(vars['--wipe-x']).toBe(`${Math.round((arm.pivotX - 400) * 100) / 100}px`);
		expect(vars['--wipe-y']).toBe(`${Math.round((arm.pivotY - 50) * 100) / 100}px`);
	});
});
