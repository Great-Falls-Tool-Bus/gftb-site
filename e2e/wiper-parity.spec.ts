import { expect, test } from '@playwright/test';
import { DROP_CELL_PX, MAX_ARMS, MAX_BLOBS } from '../src/lib/wiper/renderer/shaders/constants';
import { SCENE_FRAGMENT, SCENE_VERTEX } from '../src/lib/wiper/renderer/shaders/scene.glsl';
import { SCENE_WGSL } from '../src/lib/wiper/renderer/shaders/scene.wgsl';
import type { SceneFrame } from '../src/lib/wiper/renderer/types';
import {
	UNIFORM_BLOCK_BYTES,
	UNIFORM_OFFSETS,
	createUniformBlock,
	packUniformBlock,
} from '../src/lib/wiper/renderer/uniform-block';

// The two tiers paint one picture: the same uniform block, the same textures,
// the same synthetic frame, drawn once by the GLSL through WebGL2 and once by
// the WGSL through WebGPU, read back and compared pixel by pixel. Runs only
// where a WebGPU adapter exists (the chromium-webgpu project on the rail, or
// any GPU browser); elsewhere it skips and says so. Outside the Bazel smoke
// list on purpose: the rail's default headless shell has no adapter.
const WIDTH = 640;
const HEIGHT = 320;
const DPR = 1;
const COLS = Math.ceil(WIDTH / DROP_CELL_PX);
const ROWS = Math.ceil(HEIGHT / DROP_CELL_PX);

function syntheticFrame(blend: 'multiply' | 'screen'): SceneFrame {
	const ground: [number, number, number] = blend === 'screen' ? [0.1, 0.09, 0.12] : [0.97, 0.94, 0.87];
	return {
		time: 3.25,
		ground,
		blend,
		frost: 0.55,
		blobs: [
			{ x: 160, y: 120, r: 110, color: [0.8, 0.4, 0.22] },
			{ x: 420, y: 200, r: 140, color: [0.24, 0.42, 0.55] },
			{ x: 560, y: 60, r: 80, color: [0.63, 0.29, 0.32] },
		],
		arms: [
			{
				pivotX: 160,
				pivotY: 420,
				phi: -0.35,
				length: 430,
				width: 10,
				bladeFrom: 110,
				flex: 0.7,
				park: 1.25,
				halfSweep: 0.85,
				travel: 1,
			},
			{
				pivotX: 480,
				pivotY: 420,
				phi: 0.2,
				length: 430,
				width: 10,
				bladeFrom: 110,
				flex: 0.7,
				park: 1.25,
				halfSweep: 0.85,
				travel: 1,
			},
		],
		scissor: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
	};
}

/** A few grown beads and a frost gradient, identical for both tiers. */
function textures() {
	const drops = new Float32Array((COLS + 2) * (ROWS + 2) * 4);
	const put = (col: number, row: number, x: number, y: number, r: number) => {
		const offset = ((row + 1) * (COLS + 2) + col + 1) * 4;
		drops[offset] = x;
		drops[offset + 1] = y;
		drops[offset + 2] = r;
		drops[offset + 3] = 1;
	};
	put(2, 1, 2 * DROP_CELL_PX + 14, DROP_CELL_PX + 12, 6.5);
	put(7, 3, 7 * DROP_CELL_PX + 9, 3 * DROP_CELL_PX + 20, 4);
	put(12, 5, 12 * DROP_CELL_PX + 16, 5 * DROP_CELL_PX + 16, 7.5);
	put(16, 2, 16 * DROP_CELL_PX + 5, 2 * DROP_CELL_PX + 6, 3);
	const frost = new Uint8Array(64 * 32);
	for (let y = 0; y < 32; y += 1)
		for (let x = 0; x < 64; x += 1) frost[y * 64 + x] = Math.round(((x % 9) / 8) * 160 + (y % 5) * 15);
	return { drops: Array.from(drops), frost: Array.from(frost) };
}

for (const blend of ['multiply', 'screen'] as const) {
	for (const layer of ['scene', 'blades'] as const) {
		test(`the WebGPU and WebGL2 rungs paint the same ${layer} layer (${blend})`, async ({ page }, testInfo) => {
			await page.goto('/');
			const hasAdapter = await page.evaluate(async () => {
				if (!('gpu' in navigator) || !navigator.gpu) return false;
				const adapter = await navigator.gpu.requestAdapter().catch(() => null);
				return adapter !== null;
			});
			testInfo.annotations.push({ type: 'webgpu-adapter', description: String(hasAdapter) });
			test.skip(!hasAdapter, 'no WebGPU adapter in this browser');

			const block = createUniformBlock();
			packUniformBlock(block, syntheticFrame(blend), layer, DPR, DROP_CELL_PX, WIDTH, HEIGHT);
			const shaders = {
				vertex: SCENE_VERTEX,
				fragment: SCENE_FRAGMENT,
				wgsl: SCENE_WGSL,
			};
			const result = await page.evaluate(
				async ({ shaders, block, offsets, width, height, cols, rows, tex, maxBlobs, maxArms, blockBytes }) => {
					const f32 = new Float32Array(block);
					const i32 = new Int32Array(f32.buffer);
					const dropsData = new Float32Array(tex.drops);
					const frostData = new Uint8Array(tex.frost);

					// ---- WebGL2 ----
					const glCanvas = document.createElement('canvas');
					glCanvas.width = width;
					glCanvas.height = height;
					const gl = glCanvas.getContext('webgl2', {
						alpha: true,
						premultipliedAlpha: true,
						preserveDrawingBuffer: true,
						antialias: false,
					})!;
					const compile = (type: number, source: string) => {
						const shader = gl.createShader(type)!;
						gl.shaderSource(shader, source);
						gl.compileShader(shader);
						if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
							throw new Error(gl.getShaderInfoLog(shader) ?? 'compile');
						return shader;
					};
					const program = gl.createProgram()!;
					gl.attachShader(program, compile(gl.VERTEX_SHADER, shaders.vertex));
					gl.attachShader(program, compile(gl.FRAGMENT_SHADER, shaders.fragment));
					gl.linkProgram(program);
					if (!gl.getProgramParameter(program, gl.LINK_STATUS))
						throw new Error(gl.getProgramInfoLog(program) ?? 'link');
					gl.useProgram(program);
					const u = (name: string) => gl.getUniformLocation(program, name);
					const dropsTex = gl.createTexture()!;
					gl.activeTexture(gl.TEXTURE2);
					gl.bindTexture(gl.TEXTURE_2D, dropsTex);
					gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cols + 2, rows + 2, 0, gl.RGBA, gl.FLOAT, dropsData);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
					const frostTex = gl.createTexture()!;
					gl.activeTexture(gl.TEXTURE3);
					gl.bindTexture(gl.TEXTURE_2D, frostTex);
					gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
					gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 64, 32, 0, gl.RED, gl.UNSIGNED_BYTE, frostData);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
					gl.viewport(0, 0, width, height);
					gl.clearColor(0, 0, 0, 0);
					gl.clear(gl.COLOR_BUFFER_BIT);
					gl.uniform1i(u('u_layer'), i32[offsets.layer]);
					gl.uniform2f(u('u_resolution'), f32[offsets.resolution], f32[offsets.resolution + 1]);
					gl.uniform3f(u('u_ground'), f32[offsets.ground], f32[offsets.ground + 1], f32[offsets.ground + 2]);
					gl.uniform1i(u('u_blend'), i32[offsets.blend]);
					gl.uniform1f(u('u_time'), f32[offsets.time]);
					gl.uniform1i(u('u_blobCount'), i32[offsets.blobCount]);
					gl.uniform4fv(u('u_blobs'), f32.subarray(offsets.blobs, offsets.blobs + maxBlobs * 4));
					gl.uniform4fv(u('u_blobColors'), f32.subarray(offsets.blobColors, offsets.blobColors + maxBlobs * 4));
					gl.uniform1i(u('u_armCount'), i32[offsets.armCount]);
					gl.uniform4fv(u('u_arms'), f32.subarray(offsets.arms, offsets.arms + maxArms * 4));
					gl.uniform4fv(u('u_armStyle'), f32.subarray(offsets.armStyle, offsets.armStyle + maxArms * 4));
					gl.uniform4fv(u('u_armFan'), f32.subarray(offsets.armFan, offsets.armFan + maxArms * 4));
					gl.uniform4fv(u('u_armEdge'), f32.subarray(offsets.armEdge, offsets.armEdge + maxArms * 4));
					gl.uniform1f(u('u_dropCell'), f32[offsets.dropCell]);
					gl.uniform1f(u('u_frost'), f32[offsets.frost]);
					gl.uniform1f(u('u_frostMax'), f32[offsets.frostMax]);
					gl.uniform1i(u('u_drops'), 2);
					gl.uniform1i(u('u_frostTex'), 3);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
					const glPixels = new Uint8Array(width * height * 4);
					gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, glPixels);
					// readPixels is bottom-up; flip to top-down.
					const glTop = new Uint8Array(width * height * 4);
					for (let y = 0; y < height; y += 1)
						glTop.set(glPixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);

					// ---- WebGPU ----
					const adapter = (await navigator.gpu.requestAdapter())!;
					const device = await adapter.requestDevice();
					const messages: string[] = [];
					device.pushErrorScope('validation');
					const module = device.createShaderModule({ code: shaders.wgsl });
					for (const m of (await module.getCompilationInfo()).messages)
						messages.push(`${m.type} ${m.lineNum}:${m.linePos} ${m.message}`);
					const layout = device.createBindGroupLayout({
						entries: [
							{
								binding: 0,
								visibility: GPUShaderStage.FRAGMENT,
								buffer: { type: 'uniform', minBindingSize: blockBytes },
							},
							{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
							{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
							{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
						],
					});
					const format: GPUTextureFormat = 'rgba8unorm';
					const pipeline = await device.createRenderPipelineAsync({
						layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
						vertex: { module, entryPoint: 'vs_main' },
						fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
						primitive: { topology: 'triangle-list' },
					});
					const target = device.createTexture({
						size: [width, height, 1],
						format,
						usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
					});
					const uniformBuffer = device.createBuffer({
						size: blockBytes,
						usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
					});
					device.queue.writeBuffer(uniformBuffer, 0, f32.buffer);
					const drops = device.createTexture({
						size: [cols + 2, rows + 2, 1],
						format: 'rgba32float',
						usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
					});
					device.queue.writeTexture(
						{ texture: drops },
						dropsData,
						{ bytesPerRow: (cols + 2) * 16, rowsPerImage: rows + 2 },
						[cols + 2, rows + 2, 1],
					);
					const frost = device.createTexture({
						size: [64, 32, 1],
						format: 'r8unorm',
						usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
					});
					device.queue.writeTexture({ texture: frost }, frostData, { bytesPerRow: 64, rowsPerImage: 32 }, [64, 32, 1]);
					const sampler = device.createSampler({
						magFilter: 'linear',
						minFilter: 'linear',
						addressModeU: 'clamp-to-edge',
						addressModeV: 'clamp-to-edge',
					});
					const bindGroup = device.createBindGroup({
						layout,
						entries: [
							{ binding: 0, resource: { buffer: uniformBuffer } },
							{ binding: 1, resource: sampler },
							{ binding: 2, resource: drops.createView() },
							{ binding: 3, resource: frost.createView() },
						],
					});
					const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
					const readback = device.createBuffer({
						size: bytesPerRow * height,
						usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
					});
					const encoder = device.createCommandEncoder();
					const pass = encoder.beginRenderPass({
						colorAttachments: [
							{ view: target.createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' },
						],
					});
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, bindGroup);
					pass.draw(3);
					pass.end();
					encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow, rowsPerImage: height }, [
						width,
						height,
						1,
					]);
					device.queue.submit([encoder.finish()]);
					await readback.mapAsync(GPUMapMode.READ);
					const mapped = new Uint8Array(readback.getMappedRange());
					const gpuTop = new Uint8Array(width * height * 4);
					for (let y = 0; y < height; y += 1)
						gpuTop.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
					readback.unmap();
					const scope = await device.popErrorScope();
					if (scope) messages.push(`scope ${scope.message}`);

					// ---- compare ----
					let sum = 0;
					let within2 = 0;
					let beyond8 = 0;
					let max = 0;
					let covered = 0;
					const total = width * height;
					for (let index = 0; index < total; index += 1) {
						let worst = 0;
						for (let channel = 0; channel < 4; channel += 1) {
							const diff = Math.abs(glTop[index * 4 + channel] - gpuTop[index * 4 + channel]);
							if (diff > worst) worst = diff;
						}
						sum += worst;
						if (worst <= 2) within2 += 1;
						if (worst > 8) beyond8 += 1;
						if (worst > max) max = worst;
						if (gpuTop[index * 4 + 3] > 0) covered += 1;
					}
					device.destroy();
					return {
						messages,
						mean: sum / total,
						within2: within2 / total,
						beyond8: beyond8 / total,
						max,
						covered: covered / total,
					};
				},
				{
					shaders,
					block: Array.from(block.f32),
					offsets: UNIFORM_OFFSETS,
					width: WIDTH,
					height: HEIGHT,
					cols: COLS,
					rows: ROWS,
					tex: textures(),
					maxBlobs: MAX_BLOBS,
					maxArms: MAX_ARMS,
					blockBytes: UNIFORM_BLOCK_BYTES,
				},
			);
			testInfo.annotations.push({ type: 'parity', description: JSON.stringify(result) });
			expect(result.messages, 'WGSL compile and validation messages').toEqual([]);
			if (layer === 'blades') {
				expect(result.covered, 'the blades cover part of the layer').toBeGreaterThan(0.05);
				expect(result.covered, 'the blades do not flood the layer').toBeLessThan(0.6);
			} else {
				expect(result.covered).toBe(1);
			}
			expect(result.mean, `mean channel difference (max ${result.max})`).toBeLessThan(1.5);
			expect(result.within2, 'pixels within 2 of 255').toBeGreaterThan(0.99);
			expect(result.beyond8, 'pixels beyond 8 of 255').toBeLessThan(0.002);
		});
	}
}
