import { describe, expect, it } from 'vitest';
import { FROST_MAX, MAX_ARMS, MAX_BLOBS } from './shaders/constants';
import { SCENE_WGSL } from './shaders/scene.wgsl';
import type { SceneFrame } from './types';
import {
	UNIFORM_BLOCK_BYTES,
	UNIFORM_OFFSETS,
	createUniformBlock,
	packUniformBlock,
	scaleDroplets,
} from './uniform-block';

const frame: SceneFrame = {
	time: 12.5,
	ground: [0.9, 0.8, 0.7],
	blend: 'screen',
	frost: 0.4,
	blobs: [
		{ x: 10, y: 20, r: 30, color: [0.1, 0.2, 0.3] },
		{ x: 40, y: 50, r: 60, color: [0.4, 0.5, 0.6] },
	],
	arms: [
		{
			pivotX: 100,
			pivotY: 700,
			phi: 0.25,
			length: 800,
			width: 12,
			bladeFrom: 200,
			flex: 0.5,
			park: 1.2,
			halfSweep: 0.9,
			travel: 1,
		},
		{
			pivotX: 300,
			pivotY: 700,
			phi: -0.25,
			length: 800,
			width: 12,
			bladeFrom: 200,
			flex: -0.5,
			park: 1.2,
			halfSweep: 0.9,
			travel: -1,
		},
	],
};

describe('the uniform block', () => {
	it('packs a frame into the slots the shaders read, in device px', () => {
		const block = createUniformBlock();
		const counts = packUniformBlock(block, frame, 'blades', 2, 32, 2880, 1200);
		const o = UNIFORM_OFFSETS;
		expect(counts).toEqual({ blobCount: 2, armCount: 2 });
		expect(block.f32[o.resolution]).toBe(2880);
		expect(block.f32[o.resolution + 1]).toBe(1200);
		expect(block.f32[o.time]).toBe(12.5);
		expect(block.f32[o.dropCell]).toBe(64);
		expect([...block.f32.slice(o.ground, o.ground + 3)].map((v) => Math.round(v * 100) / 100)).toEqual([0.9, 0.8, 0.7]);
		expect(block.i32[o.blend]).toBe(1);
		expect(block.f32[o.frost]).toBeCloseTo(0.4, 6);
		expect(block.f32[o.frostMax]).toBeCloseTo(FROST_MAX[1], 6);
		expect(block.i32[o.layer]).toBe(1);
		expect(block.i32[o.blobCount]).toBe(2);
		expect(block.i32[o.armCount]).toBe(2);
		expect([...block.f32.slice(o.blobs + 4, o.blobs + 8)]).toEqual([80, 100, 120, 0]);
		expect([...block.f32.slice(o.blobColors + 4, o.blobColors + 7)].map((v) => Math.round(v * 10) / 10)).toEqual([
			0.4, 0.5, 0.6,
		]);
		expect([...block.f32.slice(o.arms + 4, o.arms + 8)].map((v) => Math.round(v * 100) / 100)).toEqual([
			600, 1400, -0.25, 1600,
		]);
		expect([...block.f32.slice(o.armStyle + 4, o.armStyle + 8)]).toEqual([24, 400, -0.5, 0]);
		expect(block.f32[o.armFan]).toBeCloseTo(Math.cos(-1.2), 6);
		expect(block.f32[o.armFan + 3]).toBeCloseTo(Math.sin(0.9), 6);
		expect([...block.f32.slice(o.armEdge + 4, o.armEdge + 8)].map((v) => Math.round(v * 1000) / 1000)).toEqual([
			Math.round(Math.cos(-0.25) * 1000) / 1000,
			Math.round(Math.sin(-0.25) * 1000) / 1000,
			-1,
			2,
		]);
		// Nothing past the last member; the scene layer flips the layer slot only.
		expect(block.buffer.byteLength).toBe(UNIFORM_BLOCK_BYTES);
		expect(o.armEdge + MAX_ARMS * 4).toBe(UNIFORM_BLOCK_BYTES / 4);
		packUniformBlock(block, frame, 'scene', 2, 32, 2880, 1200);
		expect(block.i32[o.layer]).toBe(0);
	});

	it('caps the counts at the shader arrays and zeroes what it does not fill', () => {
		const block = createUniformBlock();
		const many = {
			...frame,
			blobs: Array.from({ length: MAX_BLOBS + 3 }, (_, i) => ({ x: i, y: i, r: 1, color: [0, 0, 0] as const })),
		};
		expect(packUniformBlock(block, many, 'scene', 1, 32, 100, 100).blobCount).toBe(MAX_BLOBS);
		const single = { ...frame, arms: frame.arms.slice(0, 1) };
		packUniformBlock(block, single, 'scene', 1, 32, 100, 100);
		expect([...block.f32.slice(UNIFORM_OFFSETS.arms + 4, UNIFORM_OFFSETS.arms + 8)]).toEqual([0, 0, 0, 0]);
	});

	it('reproduces the WGSL struct layout from its text', () => {
		// The struct declares members in order; WGSL uniform layout rules give
		// f32 and i32 4/4, vec2 8/8, vec3 12/16, vec4 and array<vec4> 16/16.
		const struct = /struct Uniforms \{([\s\S]*?)\n\}/u.exec(SCENE_WGSL)![1];
		const sizes: Record<string, [number, number]> = {
			f32: [4, 4],
			i32: [4, 4],
			'vec2<f32>': [8, 8],
			'vec3<f32>': [12, 16],
			'vec4<f32>': [16, 16],
		};
		let offset = 0;
		const found: Record<string, number> = {};
		for (const line of struct.split('\n')) {
			const member = /^\s*(u_\w+)\s*:\s*(array<vec4<f32>,\s*(\d+)>|vec[234]<f32>|f32|i32),/u.exec(line);
			if (!member) continue;
			const [, name, type, count] = member;
			const [size, align] = count ? [16 * Number(count), 16] : sizes[type];
			offset = Math.ceil(offset / align) * align;
			found[name] = offset / 4;
			offset += size;
		}
		expect(Math.ceil(offset / 16) * 16).toBe(UNIFORM_BLOCK_BYTES);
		expect(found.u_resolution).toBe(UNIFORM_OFFSETS.resolution);
		expect(found.u_time).toBe(UNIFORM_OFFSETS.time);
		expect(found.u_dropCell).toBe(UNIFORM_OFFSETS.dropCell);
		expect(found.u_ground).toBe(UNIFORM_OFFSETS.ground);
		expect(found.u_blend).toBe(UNIFORM_OFFSETS.blend);
		expect(found.u_frost).toBe(UNIFORM_OFFSETS.frost);
		expect(found.u_frostMax).toBe(UNIFORM_OFFSETS.frostMax);
		expect(found.u_layer).toBe(UNIFORM_OFFSETS.layer);
		expect(found.u_blobCount).toBe(UNIFORM_OFFSETS.blobCount);
		expect(found.u_armCount).toBe(UNIFORM_OFFSETS.armCount);
		expect(found.u_blobs).toBe(UNIFORM_OFFSETS.blobs);
		expect(found.u_blobColors).toBe(UNIFORM_OFFSETS.blobColors);
		expect(found.u_arms).toBe(UNIFORM_OFFSETS.arms);
		expect(found.u_armStyle).toBe(UNIFORM_OFFSETS.armStyle);
		expect(found.u_armFan).toBe(UNIFORM_OFFSETS.armFan);
		expect(found.u_armEdge).toBe(UNIFORM_OFFSETS.armEdge);
	});

	it('scales the bead field to device px and leaves alpha alone', () => {
		expect([...scaleDroplets(new Float32Array([1, 2, 3, 0.5, 4, 5, 6, 1]), 2)]).toEqual([2, 4, 6, 0.5, 8, 10, 12, 1]);
	});
});
