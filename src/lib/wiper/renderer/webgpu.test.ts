// The WebGPU rung in node: a fake host GPU and a manual timer drive the
// acquisition deadline. The fakes never reach the shader module (the
// compile-error device fails before any GPU constant is read).
import { describe, expect, it, vi } from 'vitest';
import { manualTimer } from './deadline';
import { createWebGPURenderer, type AcquireDeps } from './webgpu';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const UNSETTLED = Symbol('unsettled');
const probe = <T>(promise: Promise<T>) => Promise.race([promise, flush().then(() => UNSETTLED)]);

type Mode = 'hang-adapter' | 'hang-device' | 'compile-error';

function fakeDevice() {
	return {
		destroy: vi.fn(),
		pushErrorScope: vi.fn(),
		popErrorScope: () => Promise.resolve(null),
		createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [{ type: 'error' }] }) }),
		lost: new Promise(() => {}),
		onuncapturederror: null as unknown,
	};
}

function fakeGpu(mode: Mode) {
	let release: ((device: unknown) => void) | undefined;
	const requestAdapter = vi.fn(() => {
		if (mode === 'hang-adapter') return new Promise(() => {});
		return Promise.resolve({
			requestDevice: () => {
				if (mode === 'hang-device') {
					return new Promise((resolve) => {
						release = resolve;
					});
				}
				return Promise.resolve(fakeDevice());
			},
		});
	});
	const gpu = { requestAdapter, getPreferredCanvasFormat: () => 'bgra8unorm' } as unknown as GPU;
	return { gpu, requestAdapter, release: (device: unknown) => release?.(device) };
}

const canvas = {} as HTMLCanvasElement;

function deps(gpu: GPU | null, timer = manualTimer()): AcquireDeps & { timer: ReturnType<typeof manualTimer> } {
	return { gpu: () => gpu, deadlineMs: 1500, timer };
}

describe('createWebGPURenderer under the acquisition deadline', () => {
	it('reports a timeout when the adapter request never answers', async () => {
		const host = fakeGpu('hang-adapter');
		const d = deps(host.gpu);
		const selection = createWebGPURenderer(canvas, { layer: 'scene' }, d);
		expect(await probe(selection)).toBe(UNSETTLED);
		expect([...d.timer.pending.values()].map((entry) => entry.ms)).toEqual([1500]);
		d.timer.fire();
		expect(await selection).toEqual({ ok: false, why: { kind: 'timeout' } });
	});

	it('closes a device that lands after the deadline and does not share the stranded request', async () => {
		const host = fakeGpu('hang-device');
		const d = deps(host.gpu);
		const selection = createWebGPURenderer(canvas, { layer: 'scene' }, d);
		await flush();
		d.timer.fire();
		expect(await selection).toEqual({ ok: false, why: { kind: 'timeout' } });
		const late = fakeDevice();
		host.release(late);
		await flush();
		expect(late.destroy).toHaveBeenCalledTimes(1);
		expect(late.onuncapturederror).toBeNull();
		// The memo was reset: a second call opens a fresh request.
		const again = fakeGpu('hang-adapter');
		const d2 = deps(again.gpu);
		void createWebGPURenderer(canvas, { layer: 'blades' }, d2);
		await flush();
		expect(host.requestAdapter).toHaveBeenCalledTimes(1);
		expect(again.requestAdapter).toHaveBeenCalledTimes(1);
		d2.timer.fire();
	});

	it('passes a prompt answer through untimed', async () => {
		const host = fakeGpu('compile-error');
		const d = deps(host.gpu);
		const selection = await createWebGPURenderer(canvas, { layer: 'scene' }, d);
		expect(selection).toEqual({ ok: false, why: { kind: 'compile', stage: 'fragment' } });
		expect(d.timer.pending.size).toBe(0);
	});

	it('reports no api without arming a timer when the host has no gpu', async () => {
		const d = deps(null);
		expect(await createWebGPURenderer(canvas, { layer: 'scene' }, d)).toEqual({ ok: false, why: { kind: 'no-api' } });
		expect(d.timer.pending.size).toBe(0);
	});
});
