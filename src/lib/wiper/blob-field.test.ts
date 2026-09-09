import { describe, expect, it } from 'vitest';
import { BlobPhysics } from '@tummycrypt/tinyvectors/core';
import { createBlobField, raiseCruise } from './blob-field';
import { CRUISE_SPEED } from './renderer/shaders/constants';

const COLORS = ['#cb6738', '#d99d6a', '#a14a52', '#6b4f3a', '#3d6b8c'];

async function displacementAfter(cruise: readonly [number, number], seconds: number): Promise<number> {
	const physics = new BlobPhysics(5, {});
	await physics.init();
	const blobs = physics.getBlobs(COLORS);
	raiseCruise(blobs, cruise, () => 0.5);
	const start = blobs.map((blob) => [blob.currentX, blob.currentY]);
	const step = 1 / 60;
	for (let t = 0; t < seconds; t += step) physics.tick(step, t);
	const after = physics.getBlobs(COLORS);
	let total = 0;
	for (const [index, blob] of after.entries())
		total += Math.hypot(blob.currentX - start[index][0], blob.currentY - start[index][1]);
	physics.dispose();
	return total / after.length;
}

describe('the scene blob field', () => {
	it('still honours driftSpeed on the live blob references (a tinyvectors upgrade that stops would fail here)', async () => {
		const slow = await displacementAfter([0.05, 0.05], 2);
		const fast = await displacementAfter([0.5, 0.5], 2);
		expect(fast).toBeGreaterThan(slow * 1.5);
	});

	it('creates a ready field whose blobs cruise inside the ratified range', async () => {
		const field = await createBlobField({ count: 5, colors: COLORS, random: () => 0.25 });
		expect(field.ready).toBe(true);
		const blobs = field.blobs() as Array<{ driftSpeed?: number }>;
		expect(blobs).toHaveLength(5);
		for (const blob of blobs) {
			expect(blob.driftSpeed).toBeGreaterThanOrEqual(CRUISE_SPEED[0]);
			expect(blob.driftSpeed).toBeLessThanOrEqual(CRUISE_SPEED[1]);
		}
		field.tick(1 / 60, 0);
		field.setTilt({ x: 0, y: 0, z: 0 });
		field.dispose();
		expect(field.ready).toBe(false);
	});
});
