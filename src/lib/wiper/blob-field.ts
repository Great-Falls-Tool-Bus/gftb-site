// The scene's blob field: tinyvectors' public BlobPhysics (the Bazel-linked
// package, never npm) driven by the scene's own clock, with the idle cruise
// raised on the live blob references so the roam reads at blog liveliness.
// The site-wide SVG layer keeps its own instance; this one lives only under
// the glass.
import { BlobPhysics, type ConvexBlob, type TiltVector } from '@tummycrypt/tinyvectors/core';
import { CRUISE_SPEED, CRUISE_SPEED_COARSE } from './renderer/shaders/constants';

/** driftSpeed is a live physics field on every blob since 0.3.0; the type omits it. */
type CruisingBlob = ConvexBlob & { driftSpeed?: number; driftAngle?: number };

export interface BlobFieldOptions {
	count: number;
	colors: string[];
	/** Coarse pointers (phones) get a gentler cruise. */
	coarse?: boolean;
	random?: () => number;
}

export interface BlobFieldHandle {
	readonly ready: boolean;
	blobs(): ConvexBlob[];
	tick(deltaSeconds: number, timeSeconds: number): void;
	setTilt(tilt: TiltVector): void;
	dispose(): void;
}

/** Raise every blob's terminal cruise into `range`, spread by `random`. */
export function raiseCruise(
	blobs: readonly ConvexBlob[],
	range: readonly [number, number],
	random: () => number = Math.random,
): void {
	const [low, high] = range;
	for (const blob of blobs as CruisingBlob[]) {
		blob.driftSpeed = low + (high - low) * random();
	}
}

export async function createBlobField(options: BlobFieldOptions): Promise<BlobFieldHandle> {
	const physics = new BlobPhysics(options.count, {});
	await physics.init();
	const random = options.random ?? Math.random;
	raiseCruise(physics.getBlobs(options.colors), options.coarse ? CRUISE_SPEED_COARSE : CRUISE_SPEED, random);
	let ready = true;
	return {
		get ready() {
			return ready;
		},
		blobs: () => physics.getBlobs(options.colors),
		tick: (deltaSeconds, timeSeconds) => physics.tick(deltaSeconds, timeSeconds),
		setTilt: (tilt) => physics.setTilt(tilt),
		dispose: () => {
			ready = false;
			physics.dispose();
		},
	};
}
