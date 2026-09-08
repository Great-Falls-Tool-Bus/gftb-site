import { describe, expect, it, vi } from 'vitest';
import { createDeviceMotionPermission, type DeviceMotionTarget } from './device-motion-permission';

function preference(initial = false) {
	let matches = initial;
	const listeners = new Set<() => void>();
	return {
		get matches() {
			return matches;
		},
		listeners,
		addEventListener(_type: 'change', listener: () => void) {
			listeners.add(listener);
		},
		removeEventListener(_type: 'change', listener: () => void) {
			listeners.delete(listener);
		},
		change(value: boolean) {
			matches = value;
			for (const listener of listeners) listener();
		},
	};
}

function component(overrides: Partial<ReturnType<DeviceMotionTarget['getDeviceMotionStatus']>> = {}) {
	return {
		getDeviceMotionStatus: vi.fn(() => ({
			enabled: true,
			supported: true,
			requiresPermission: true,
			active: false,
			...overrides,
		})),
		requestDeviceMotionPermission: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
	};
}

describe('phone motion permission control', () => {
	it('waits for the deferred component and never requests permission on mount', () => {
		const query = preference();
		const publish = vi.fn();
		const control = createDeviceMotionPermission(query, publish);
		const target = component();
		expect(publish).toHaveBeenLastCalledWith({ visible: false, busy: false });
		control.setTarget(target);
		expect(publish).toHaveBeenLastCalledWith({ visible: true, busy: false });
		expect(target.requestDeviceMotionPermission).not.toHaveBeenCalled();
		control.setTarget(undefined);
		expect(publish).toHaveBeenLastCalledWith({ visible: false, busy: false });
		control.destroy();
		expect(query.listeners.size).toBe(0);
	});

	it.each([{ enabled: false }, { supported: false }, { requiresPermission: false }, { active: true }])(
		'has no prompt or permission call for an ineligible component: %j',
		async (status) => {
			const publish = vi.fn();
			const target = component(status);
			const control = createDeviceMotionPermission(preference(), publish);
			control.setTarget(target);
			await control.request();
			expect(publish).toHaveBeenLastCalledWith({ visible: false, busy: false });
			expect(target.requestDeviceMotionPermission).not.toHaveBeenCalled();
			control.destroy();
		},
	);

	it('tracks reduced motion before and after binding without an automatic permission request', async () => {
		const query = preference(true);
		const publish = vi.fn();
		const target = component();
		const control = createDeviceMotionPermission(query, publish);
		control.setTarget(target);
		await control.request();
		expect(publish).toHaveBeenLastCalledWith({ visible: false, busy: false });
		query.change(false);
		expect(publish).toHaveBeenLastCalledWith({ visible: true, busy: false });
		query.change(true);
		await control.request();
		expect(publish).toHaveBeenLastCalledWith({ visible: false, busy: false });
		expect(target.requestDeviceMotionPermission).not.toHaveBeenCalled();
		control.destroy();
	});

	it('calls permission synchronously in the gesture and admits only one pending request', async () => {
		let finish!: (granted: boolean) => void;
		const target = component();
		target.requestDeviceMotionPermission.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const publish = vi.fn();
		const query = preference();
		const control = createDeviceMotionPermission(query, publish);
		control.setTarget(target);
		const pending = control.request();
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		expect(publish).toHaveBeenLastCalledWith({ visible: true, busy: true });
		await control.request();
		query.change(true);
		expect(publish).toHaveBeenLastCalledWith({ visible: false, busy: true });
		finish(true);
		await pending;
		query.change(false);
		expect(publish).toHaveBeenLastCalledWith({ visible: false, busy: false });
		await control.request();
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		control.destroy();
	});

	it.each(['denied', 'rejected'] as const)('settles %s without errors or repeated prompts', async (outcome) => {
		const target = component();
		if (outcome === 'denied') target.requestDeviceMotionPermission.mockResolvedValue(false);
		else target.requestDeviceMotionPermission.mockRejectedValue(new Error('permission unavailable'));
		const publish = vi.fn();
		const query = preference();
		const control = createDeviceMotionPermission(query, publish);
		control.setTarget(target);
		await expect(control.request()).resolves.toBeUndefined();
		expect(publish).toHaveBeenLastCalledWith({ visible: false, busy: false });
		query.change(true);
		query.change(false);
		await control.request();
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		control.destroy();
	});

	it('removes its listener and ignores pending results or late bindings after teardown', async () => {
		let finish!: (granted: boolean) => void;
		const target = component();
		target.requestDeviceMotionPermission.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const query = preference();
		const publish = vi.fn();
		const control = createDeviceMotionPermission(query, publish);
		control.setTarget(target);
		const pending = control.request();
		control.destroy();
		expect(query.listeners.size).toBe(0);
		publish.mockClear();
		query.change(true);
		control.setTarget(component());
		finish(true);
		await pending;
		await control.request();
		expect(publish).not.toHaveBeenCalled();
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
	});
});
