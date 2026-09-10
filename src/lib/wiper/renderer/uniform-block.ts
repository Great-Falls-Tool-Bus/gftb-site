// One uniform block for both tiers. The WGSL struct in shaders/scene.wgsl.ts
// and the GLSL uniforms in shaders/scene.glsl.ts read the same numbers from
// the same slots (WebGL2 uploads slices of this block with its named
// uniform calls; WebGPU writes the whole block to one buffer), so the two
// tiers cannot drift apart. Offsets are in f32 slots (byte offset / 4);
// every array member sits on a 16-byte boundary with a 16-byte stride, as
// WGSL's uniform address space requires. Pure: vitest pins the layout.
import { FROST_MAX, MAX_ARMS, MAX_BLOBS } from './shaders/constants';
import type { RendererLayer, SceneFrame } from './types';

export const UNIFORM_BLOCK_BYTES = 448;

/** f32 slot of every member (byte offset / 4). */
export const UNIFORM_OFFSETS = {
	resolution: 0,
	time: 2,
	dropCell: 3,
	ground: 4,
	blend: 7,
	frost: 8,
	frostMax: 9,
	layer: 10,
	blobCount: 11,
	armCount: 12,
	blobs: 16,
	blobColors: 16 + MAX_BLOBS * 4,
	arms: 16 + MAX_BLOBS * 8,
	armStyle: 16 + MAX_BLOBS * 8 + MAX_ARMS * 4,
	armFan: 16 + MAX_BLOBS * 8 + MAX_ARMS * 8,
	armEdge: 16 + MAX_BLOBS * 8 + MAX_ARMS * 12,
} as const;

export interface UniformBlock {
	readonly buffer: ArrayBuffer;
	readonly f32: Float32Array;
	readonly i32: Int32Array;
}

export function createUniformBlock(): UniformBlock {
	const buffer = new ArrayBuffer(UNIFORM_BLOCK_BYTES);
	return { buffer, f32: new Float32Array(buffer), i32: new Int32Array(buffer) };
}

export interface PackedCounts {
	blobCount: number;
	armCount: number;
}

/**
 * Write a frame into the block. Positions and lengths arrive in CSS px and
 * leave in device px; angles stay radians; the arm's fan and moving edge are
 * pre-projected for the glass on layer 0.
 */
export function packUniformBlock(
	block: UniformBlock,
	frame: SceneFrame,
	layer: RendererLayer,
	dpr: number,
	dropCellCss: number,
	deviceWidth: number,
	deviceHeight: number,
): PackedCounts {
	const { f32, i32 } = block;
	const o = UNIFORM_OFFSETS;
	f32.fill(0);
	f32[o.resolution] = deviceWidth;
	f32[o.resolution + 1] = deviceHeight;
	f32[o.time] = frame.time;
	f32[o.dropCell] = Math.max(dropCellCss * dpr, 1);
	f32[o.ground] = frame.ground[0];
	f32[o.ground + 1] = frame.ground[1];
	f32[o.ground + 2] = frame.ground[2];
	i32[o.blend] = frame.blend === 'screen' ? 1 : 0;
	f32[o.frost] = frame.frost;
	f32[o.frostMax] = frame.blend === 'screen' ? FROST_MAX[1] : FROST_MAX[0];
	i32[o.layer] = layer === 'blades' ? 1 : 0;
	const blobCount = Math.min(frame.blobs.length, MAX_BLOBS);
	const armCount = Math.min(frame.arms.length, MAX_ARMS);
	i32[o.blobCount] = blobCount;
	i32[o.armCount] = armCount;
	for (let index = 0; index < blobCount; index += 1) {
		const blob = frame.blobs[index];
		const at = o.blobs + index * 4;
		f32[at] = blob.x * dpr;
		f32[at + 1] = blob.y * dpr;
		f32[at + 2] = blob.r * dpr;
		const colour = o.blobColors + index * 4;
		f32[colour] = blob.color[0];
		f32[colour + 1] = blob.color[1];
		f32[colour + 2] = blob.color[2];
	}
	for (let index = 0; index < armCount; index += 1) {
		const arm = frame.arms[index];
		const at = o.arms + index * 4;
		f32[at] = arm.pivotX * dpr;
		f32[at + 1] = arm.pivotY * dpr;
		f32[at + 2] = arm.phi;
		f32[at + 3] = arm.length * dpr;
		const style = o.armStyle + index * 4;
		f32[style] = arm.width * dpr;
		f32[style + 1] = arm.bladeFrom * dpr;
		f32[style + 2] = arm.flex;
		const fan = o.armFan + index * 4;
		f32[fan] = Math.cos(-arm.park);
		f32[fan + 1] = Math.sin(-arm.park);
		f32[fan + 2] = Math.cos(arm.halfSweep);
		f32[fan + 3] = Math.sin(arm.halfSweep);
		const edge = o.armEdge + index * 4;
		f32[edge] = Math.cos(arm.phi);
		f32[edge + 1] = Math.sin(arm.phi);
		f32[edge + 2] = arm.travel;
		f32[edge + 3] = dpr;
	}
	return { blobCount, armCount };
}

/** The bead field in device px: x, y and r scaled, alpha untouched. */
export function scaleDroplets(data: Float32Array, dpr: number): Float32Array {
	const scaled = new Float32Array(data.length);
	for (let index = 0; index < data.length; index += 4) {
		scaled[index] = data[index] * dpr;
		scaled[index + 1] = data[index + 1] * dpr;
		scaled[index + 2] = data[index + 2] * dpr;
		scaled[index + 3] = data[index + 3];
	}
	return scaled;
}
