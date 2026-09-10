// WebGPU tier: one shared device, one shader module, one pipeline; a handle
// per canvas (the scene, opaque; the blades, premultiplied over the notes).
// Every failure returns through the selection result or the handle's loss
// callbacks; nothing here writes to the console (the no-JS spec fails the
// home page on any console error or warning): the uncaptured-error handler
// and the loss promise are installed before the first resource, creation
// runs under error scopes, the canvas is claimed last so a failure leaves
// it free for WebGL2, and a frame that throws counts as a loss.
import { SCENE_WGSL } from './shaders/scene.wgsl';
import type { RendererFailure, RendererHandle, RendererOptions, RendererSelection, SceneFrame } from './types';
import { UNIFORM_BLOCK_BYTES, createUniformBlock, packUniformBlock, scaleDroplets } from './uniform-block';

interface Shared {
	device: GPUDevice;
	format: GPUTextureFormat;
	layout: GPUBindGroupLayout;
	pipeline: GPURenderPipeline;
	sampler: GPUSampler;
	handles: Set<HandleState>;
	refs: number;
	destroying: boolean;
	lost: boolean;
}

interface HandleState {
	lostCallbacks: Array<(failure: RendererFailure) => void>;
	failed: boolean;
}

let shared: Promise<Shared | RendererFailure> | null = null;

function fail(state: Shared): void {
	if (state.lost) return;
	state.lost = true;
	shared = null;
	for (const handle of state.handles) {
		if (handle.failed) continue;
		handle.failed = true;
		for (const callback of handle.lostCallbacks) callback({ kind: 'context-lost' });
	}
}

async function popScopes(device: GPUDevice, count: number): Promise<boolean> {
	let errored = false;
	for (let index = 0; index < count; index += 1) {
		const error = await device.popErrorScope().catch(() => null);
		if (error) errored = true;
	}
	return errored;
}

/** The device and pipeline, once per page; the canvas is untouched here. */
async function acquire(): Promise<Shared | RendererFailure> {
	if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) return { kind: 'no-api' };
	const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' }).catch(() => null);
	if (!adapter) return { kind: 'no-api' };
	let device: GPUDevice;
	try {
		device = await adapter.requestDevice();
	} catch {
		return { kind: 'no-context' };
	}
	const state = {
		device,
		handles: new Set<HandleState>(),
		refs: 0,
		destroying: false,
		lost: false,
	} as Shared;
	device.onuncapturederror = (event) => {
		event.preventDefault();
		fail(state);
	};
	device.lost
		.then((info) => {
			if (info.reason === 'destroyed' || state.destroying) return;
			fail(state);
		})
		.catch(() => {});
	device.pushErrorScope('validation');
	device.pushErrorScope('out-of-memory');
	device.pushErrorScope('internal');
	try {
		const module = device.createShaderModule({ code: SCENE_WGSL });
		const info = await module.getCompilationInfo();
		if (info.messages.some((message) => message.type === 'error')) {
			await popScopes(device, 3);
			state.destroying = true;
			device.destroy();
			return { kind: 'compile', stage: 'fragment' };
		}
		const layout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: 'uniform', minBindingSize: UNIFORM_BLOCK_BYTES },
				},
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			],
		});
		const format = navigator.gpu.getPreferredCanvasFormat();
		const pipeline = await device.createRenderPipelineAsync({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module, entryPoint: 'vs_main' },
			fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
			primitive: { topology: 'triangle-list' },
		});
		const sampler = device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});
		const errored = await popScopes(device, 3);
		if (errored) {
			state.destroying = true;
			device.destroy();
			return { kind: 'compile', stage: 'link' };
		}
		state.format = format;
		state.layout = layout;
		state.pipeline = pipeline;
		state.sampler = sampler;
		return state;
	} catch {
		await popScopes(device, 3);
		state.destroying = true;
		device.destroy();
		return { kind: 'compile', stage: 'link' };
	}
}

export async function createWebGPURenderer(
	canvas: HTMLCanvasElement,
	options: RendererOptions = { layer: 'scene' },
): Promise<RendererSelection> {
	shared ??= acquire();
	const acquired = await shared;
	if (!('device' in acquired)) {
		shared = null;
		return { ok: false, why: acquired };
	}
	const state = acquired;
	if (state.lost) return { ok: false, why: { kind: 'context-lost' } };
	const { device } = state;

	const makeTexture = (width: number, height: number, format: GPUTextureFormat): GPUTexture =>
		device.createTexture({
			size: [width, height, 1],
			format,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

	device.pushErrorScope('validation');
	const uniformBuffer = device.createBuffer({
		size: UNIFORM_BLOCK_BYTES,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	let drops = makeTexture(1, 1, 'rgba32float');
	let dropsSize = '1x1';
	let frost = makeTexture(1, 1, 'r8unorm');
	let frostSize = '1x1';
	device.queue.writeTexture({ texture: drops }, new Float32Array(4), { bytesPerRow: 16, rowsPerImage: 1 }, [1, 1, 1]);
	device.queue.writeTexture({ texture: frost }, new Uint8Array(1), { bytesPerRow: 1, rowsPerImage: 1 }, [1, 1, 1]);
	const creationError = await device.popErrorScope().catch(() => null);
	if (creationError) {
		uniformBuffer.destroy();
		drops.destroy();
		frost.destroy();
		return { ok: false, why: { kind: 'compile', stage: 'link' } };
	}

	// The canvas last: a failure above leaves it free for the WebGL2 rung.
	const context = canvas.getContext('webgpu');
	if (!context) {
		uniformBuffer.destroy();
		drops.destroy();
		frost.destroy();
		return { ok: false, why: { kind: 'no-context' } };
	}
	try {
		context.configure({
			device,
			format: state.format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
			alphaMode: options.layer === 'blades' ? 'premultiplied' : 'opaque',
			colorSpace: 'srgb',
		});
	} catch {
		uniformBuffer.destroy();
		drops.destroy();
		frost.destroy();
		return { ok: false, why: { kind: 'no-context' } };
	}
	state.refs += 1;
	const me: HandleState = { lostCallbacks: [], failed: false };
	state.handles.add(me);

	const block = createUniformBlock();
	let bindGroup: GPUBindGroup | null = null;
	let cssWidth = 0;
	let cssHeight = 0;
	let dpr = 1;
	let dropCellCss = 0;
	const maxSide = device.limits.maxTextureDimension2D;

	const rebind = () => {
		bindGroup = device.createBindGroup({
			layout: state.layout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: state.sampler },
				{ binding: 2, resource: drops.createView() },
				{ binding: 3, resource: frost.createView() },
			],
		});
	};

	const handle: RendererHandle = {
		tier: 'webgpu',
		layer: options.layer,
		resize(width, height, ratio) {
			cssWidth = width;
			cssHeight = height;
			dpr = ratio;
			const backingWidth = Math.min(maxSide, Math.max(1, Math.round(width * ratio)));
			const backingHeight = Math.min(maxSide, Math.max(1, Math.round(height * ratio)));
			if (canvas.width !== backingWidth) canvas.width = backingWidth;
			if (canvas.height !== backingHeight) canvas.height = backingHeight;
		},
		uploadDroplets(data, cols, rows, cellCss) {
			dropCellCss = cellCss;
			if (state.lost) return;
			const width = cols + 2;
			const height = rows + 2;
			const size = `${width}x${height}`;
			if (size !== dropsSize) {
				drops.destroy();
				drops = makeTexture(width, height, 'rgba32float');
				dropsSize = size;
				bindGroup = null;
			}
			device.queue.writeTexture(
				{ texture: drops },
				scaleDroplets(data, dpr),
				{ bytesPerRow: width * 16, rowsPerImage: height },
				[width, height, 1],
			);
		},
		uploadFrost(field, width, height) {
			if (state.lost) return;
			const size = `${width}x${height}`;
			if (size !== frostSize) {
				frost.destroy();
				frost = makeTexture(width, height, 'r8unorm');
				frostSize = size;
				bindGroup = null;
			}
			device.queue.writeTexture({ texture: frost }, field, { bytesPerRow: width, rowsPerImage: height }, [
				width,
				height,
				1,
			]);
		},
		render(frame: SceneFrame) {
			if (state.lost || cssWidth <= 0 || cssHeight <= 0) return;
			try {
				if (!bindGroup) rebind();
				packUniformBlock(block, frame, options.layer, dpr, dropCellCss, canvas.width, canvas.height);
				device.queue.writeBuffer(uniformBuffer, 0, block.buffer);
				const view = context.getCurrentTexture().createView();
				const encoder = device.createCommandEncoder();
				const pass = encoder.beginRenderPass({
					colorAttachments: [{ view, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
				});
				let draw = true;
				if (options.layer === 'blades') {
					// Shade only the box the arms can touch; parked blades cost nothing.
					const box = frame.scissor;
					if (!box || box.width <= 0 || box.height <= 0) draw = false;
					else {
						const x = Math.max(0, Math.floor(box.x * dpr));
						const top = Math.max(0, Math.floor(box.y * dpr));
						const right = Math.min(canvas.width, Math.ceil((box.x + box.width) * dpr));
						const bottom = Math.min(canvas.height, Math.ceil((box.y + box.height) * dpr));
						if (right <= x || bottom <= top) draw = false;
						else pass.setScissorRect(x, top, right - x, bottom - top);
					}
				}
				if (draw && bindGroup) {
					pass.setPipeline(state.pipeline);
					pass.setBindGroup(0, bindGroup);
					pass.draw(3);
				}
				pass.end();
				device.queue.submit([encoder.finish()]);
			} catch {
				fail(state);
			}
		},
		onLost(callback) {
			me.lostCallbacks.push(callback);
		},
		destroy() {
			state.handles.delete(me);
			uniformBuffer.destroy();
			drops.destroy();
			frost.destroy();
			try {
				context.unconfigure();
			} catch {
				// The context may already be gone with its device.
			}
			state.refs -= 1;
			if (state.refs <= 0 && !state.lost) {
				state.destroying = true;
				device.destroy();
				shared = null;
			}
		},
	};
	return { ok: true, handle };
}
