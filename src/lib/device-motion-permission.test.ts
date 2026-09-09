import { describe, expect, it, vi } from 'vitest';
import {
	INTERACTIVE_TARGET_SELECTOR,
	createDeviceMotionHandshake,
	type DeviceMotionTarget,
} from './device-motion-permission';

type Status = ReturnType<DeviceMotionTarget['getDeviceMotionStatus']>;

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

/** A click source whose taps carry a duck-typed target with `closest`. */
function gestures() {
	const listeners = new Set<(event: Event) => void>();
	const root = { id: 'main' } as unknown as Element;
	return {
		listeners,
		root,
		addEventListener(_type: 'click', listener: (event: Event) => void) {
			listeners.add(listener);
		},
		removeEventListener(_type: 'click', listener: (event: Event) => void) {
			listeners.delete(listener);
		},
		/** A tap on neutral space: the nearest interactive ancestor is the root itself. */
		tapNeutral() {
			const event = { target: { closest: () => root } } as unknown as Event;
			for (const listener of [...listeners]) listener(event);
		},
		/** A tap on a link, button or field. */
		tapInteractive() {
			const event = { target: { closest: () => ({}) as Element } } as unknown as Event;
			for (const listener of [...listeners]) listener(event);
		},
	};
}

/** A component whose reported permission state follows the platform answer. */
function component(overrides: Partial<Status> = {}, answer: 'granted' | 'denied' | 'unanswered' = 'granted') {
	const status: Status = {
		enabled: true,
		supported: true,
		requiresPermission: true,
		active: false,
		permissionState: 'prompt',
		...overrides,
	};
	const target = {
		status,
		getDeviceMotionStatus: vi.fn(() => ({ ...status })),
		requestDeviceMotionPermission: vi.fn<() => Promise<boolean>>(),
	};
	target.requestDeviceMotionPermission.mockImplementation(() => {
		if (answer === 'granted') {
			status.permissionState = 'granted';
			status.active = true;
			return Promise.resolve(true);
		}
		if (answer === 'denied') {
			status.permissionState = 'denied';
			return Promise.resolve(false);
		}
		return Promise.resolve(false);
	});
	return target;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('first-gesture phone motion handshake', () => {
	it('never arms before the deferred component binds and never calls on bind', () => {
		const query = preference();
		const source = gestures();
		const publish = vi.fn();
		const handshake = createDeviceMotionHandshake(query, source, { root: source.root, publish });
		expect(source.listeners.size).toBe(0);
		expect(publish).toHaveBeenLastCalledWith('idle');
		const target = component();
		handshake.setTarget(target);
		expect(source.listeners.size).toBe(1);
		expect(publish).toHaveBeenLastCalledWith('armed');
		expect(target.requestDeviceMotionPermission).not.toHaveBeenCalled();
		handshake.setTarget(undefined);
		expect(source.listeners.size).toBe(0);
		expect(publish).toHaveBeenLastCalledWith('idle');
		handshake.destroy();
		expect(query.listeners.size).toBe(0);
	});

	it.each<Partial<Status>>([
		{ enabled: false },
		{ supported: false },
		{ requiresPermission: false },
		{ active: true },
		{ permissionState: 'granted' },
		{ permissionState: 'denied' },
	])('never arms for an ineligible component: %j', (status) => {
		const source = gestures();
		const target = component(status);
		const handshake = createDeviceMotionHandshake(preference(), source, { root: source.root });
		handshake.setTarget(target);
		expect(source.listeners.size).toBe(0);
		source.tapNeutral();
		expect(target.requestDeviceMotionPermission).not.toHaveBeenCalled();
		handshake.destroy();
	});

	it('borrows one neutral tap, calls the platform synchronously, and latches once answered', async () => {
		const source = gestures();
		const publish = vi.fn();
		const target = component();
		const handshake = createDeviceMotionHandshake(preference(), source, { root: source.root, publish });
		handshake.setTarget(target);
		source.tapNeutral();
		// Synchronous inside the click stack (transient activation), and the
		// listener is already gone so a double tap cannot double-call.
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		expect(source.listeners.size).toBe(0);
		expect(publish).toHaveBeenLastCalledWith('asking');
		await flush();
		expect(publish).toHaveBeenLastCalledWith('asked');
		expect(handshake.getState()).toBe('asked');
		source.tapNeutral();
		await flush();
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		handshake.destroy();
	});

	it('ignores taps on links, buttons and fields and stays armed for the next neutral tap', async () => {
		const source = gestures();
		const target = component();
		const handshake = createDeviceMotionHandshake(preference(), source, { root: source.root });
		handshake.setTarget(target);
		source.tapInteractive();
		source.tapInteractive();
		expect(target.requestDeviceMotionPermission).not.toHaveBeenCalled();
		expect(handshake.getState()).toBe('armed');
		source.tapNeutral();
		await flush();
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		expect(handshake.getState()).toBe('asked');
		handshake.destroy();
	});

	it('names the interactive ancestors a tap is never borrowed from', () => {
		for (const tag of ['a', 'button', 'input', 'select', 'textarea', 'summary', 'label', '[role="button"]', '[tabindex]']) {
			expect(INTERACTIVE_TARGET_SELECTOR).toContain(tag);
		}
	});

	it('honours a route veto at gesture time and keeps the shot', async () => {
		const source = gestures();
		const target = component();
		let onContactPage = true;
		const handshake = createDeviceMotionHandshake(preference(), source, {
			root: source.root,
			eligible: () => !onContactPage,
		});
		handshake.setTarget(target);
		source.tapNeutral();
		await flush();
		expect(target.requestDeviceMotionPermission).not.toHaveBeenCalled();
		expect(handshake.getState()).toBe('armed');
		onContactPage = false;
		source.tapNeutral();
		await flush();
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		handshake.destroy();
	});

	it('re-arms when the request never reached the platform (component not yet ready)', async () => {
		const source = gestures();
		const target = component({}, 'unanswered');
		const handshake = createDeviceMotionHandshake(preference(), source, { root: source.root });
		handshake.setTarget(target);
		source.tapNeutral();
		await flush();
		// Resolved false with the state still 'prompt': the shot is kept.
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		expect(handshake.getState()).toBe('armed');
		expect(source.listeners.size).toBe(1);
		// The platform answers on the next neutral tap.
		target.requestDeviceMotionPermission.mockImplementation(() => {
			target.status.permissionState = 'denied';
			return Promise.resolve(false);
		});
		source.tapNeutral();
		await flush();
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(2);
		expect(handshake.getState()).toBe('asked');
		expect(source.listeners.size).toBe(0);
		handshake.destroy();
	});

	it.each(['denied', 'rejected'] as const)('settles %s silently and never asks again', async (outcome) => {
		const source = gestures();
		const target = component({}, 'denied');
		if (outcome === 'rejected') {
			target.requestDeviceMotionPermission.mockImplementation(() => {
				// The package catches the platform rejection and latches 'denied'.
				target.status.permissionState = 'denied';
				return Promise.reject(new Error('permission unavailable'));
			});
		}
		const query = preference();
		const handshake = createDeviceMotionHandshake(query, source, { root: source.root });
		handshake.setTarget(target);
		source.tapNeutral();
		await flush();
		expect(handshake.getState()).toBe('asked');
		query.change(true);
		query.change(false);
		expect(source.listeners.size).toBe(0);
		source.tapNeutral();
		await flush();
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		handshake.destroy();
	});

	it('tracks reduced motion: never arms under reduce, re-arms only while unasked', async () => {
		const query = preference(true);
		const source = gestures();
		const publish = vi.fn();
		const target = component();
		const handshake = createDeviceMotionHandshake(query, source, { root: source.root, publish });
		handshake.setTarget(target);
		expect(source.listeners.size).toBe(0);
		expect(publish).toHaveBeenLastCalledWith('idle');
		query.change(false);
		expect(source.listeners.size).toBe(1);
		expect(publish).toHaveBeenLastCalledWith('armed');
		query.change(true);
		expect(source.listeners.size).toBe(0);
		expect(publish).toHaveBeenLastCalledWith('idle');
		query.change(false);
		source.tapNeutral();
		await flush();
		expect(handshake.getState()).toBe('asked');
		query.change(true);
		query.change(false);
		expect(source.listeners.size).toBe(0);
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
		handshake.destroy();
	});

	it('re-checks after the package recovers from a reduce-induced denial', async () => {
		// Under Reduce Motion tinyvectors reports 'denied'; lifting it resets
		// the package to 'prompt' in ITS change listener, which runs after
		// ours. The deferred re-check must see the recovered state.
		const query = preference(true);
		const source = gestures();
		const target = component({ permissionState: 'denied' });
		const handshake = createDeviceMotionHandshake(query, source, { root: source.root });
		handshake.setTarget(target);
		expect(source.listeners.size).toBe(0);
		query.listeners.add(() => {
			// The package's own recovery, registered later than the handshake.
			target.status.permissionState = query.matches ? 'denied' : 'prompt';
		});
		query.change(false);
		expect(source.listeners.size).toBe(0);
		await flush();
		expect(source.listeners.size).toBe(1);
		expect(handshake.getState()).toBe('armed');
		handshake.destroy();
	});

	it('removes its listeners and ignores pending results or late bindings after teardown', async () => {
		let finish!: (granted: boolean) => void;
		const source = gestures();
		const target = component();
		target.requestDeviceMotionPermission.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const query = preference();
		const publish = vi.fn();
		const handshake = createDeviceMotionHandshake(query, source, { root: source.root, publish });
		handshake.setTarget(target);
		source.tapNeutral();
		handshake.destroy();
		expect(query.listeners.size).toBe(0);
		expect(source.listeners.size).toBe(0);
		publish.mockClear();
		query.change(true);
		handshake.setTarget(component());
		finish(true);
		await flush();
		expect(publish).not.toHaveBeenCalled();
		expect(source.listeners.size).toBe(0);
		expect(target.requestDeviceMotionPermission).toHaveBeenCalledTimes(1);
	});
});
