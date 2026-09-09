/**
 * First-gesture device-motion handshake (operator ruling 2026-09-09).
 *
 * Browsers that gate the accelerometer behind a permission API (iOS Safari)
 * only answer `DeviceOrientationEvent.requestPermission()` from inside a user
 * gesture; a gesture-less call is rejected and tinyvectors 0.3.7 latches the
 * instance to `denied` (DeviceMotion.ts:180-208 at v0.3.7). So there is no
 * "prompt automatically" on iOS. What there is: the visitor's first neutral
 * tap inside the page, which this module borrows once. Nothing is rendered.
 *
 * - Desktop and Android: `requiresPermission` is false, the package starts
 *   listening on its own, `available()` is false, and nothing ever arms.
 * - Reduced motion: nothing arms; turning Reduce Motion on mid-session
 *   disarms, turning it off re-arms only if no request was ever made.
 * - Interactive targets (links, buttons, form fields, the mode switch) never
 *   trigger the handshake: a navigation tap must not raise a system dialog.
 * - The native call is made synchronously inside the click stack (awaiting a
 *   tick first forfeits transient activation). `attempted` latches only once
 *   the package reports a settled state (granted, denied, or listening), so a
 *   tap that lands before the deferred component has physics does not burn
 *   the one shot; the listener re-arms for the next neutral tap instead.
 * - Denial is silent: the package stops listening, the blobs keep their idle
 *   drift, and this module never asks again for the life of the page.
 */

/** The existing TinyVectors instance API; physics and sensor IO stay in the package. */
export interface DeviceMotionTarget {
	getDeviceMotionStatus(): {
		enabled: boolean;
		supported: boolean;
		requiresPermission: boolean;
		active: boolean;
		permissionState?: 'unknown' | 'unsupported' | 'insecure' | 'prompt' | 'granted' | 'denied';
	};
	requestDeviceMotionPermission(): Promise<boolean>;
}

export interface MotionPreference {
	readonly matches: boolean;
	addEventListener(type: 'change', listener: () => void): void;
	removeEventListener(type: 'change', listener: () => void): void;
}

/** A DOM-shaped source of click gestures (the main landmark in production). */
export interface GestureSource {
	addEventListener(type: 'click', listener: (event: Event) => void, options?: AddEventListenerOptions): void;
	removeEventListener(type: 'click', listener: (event: Event) => void, options?: EventListenerOptions): void;
}

export type MotionHandshakeState = 'idle' | 'armed' | 'asking' | 'asked';

export interface MotionHandshakeOptions {
	/** Elements whose taps are never borrowed (a navigation tap must not raise a dialog). */
	interactiveSelector?: string;
	/** The gesture source itself is never an interactive target, even if it carries tabindex. */
	root?: Element | null;
	/** Route-time veto, checked at gesture time (the contact form page never prompts). */
	eligible?: () => boolean;
	publish?: (state: MotionHandshakeState) => void;
}

export const INTERACTIVE_TARGET_SELECTOR =
	'a, button, input, select, textarea, summary, label, [role="button"], [contenteditable], [tabindex]';

const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

export function createDeviceMotionHandshake(
	preference: MotionPreference,
	gestures: GestureSource,
	options: MotionHandshakeOptions = {},
) {
	const interactive = options.interactiveSelector ?? INTERACTIVE_TARGET_SELECTOR;
	const root = options.root ?? null;
	const eligible = options.eligible ?? (() => true);
	const publish = options.publish ?? (() => {});

	let target: DeviceMotionTarget | undefined;
	let attempted = false;
	let inFlight = false;
	let armed = false;
	let disposed = false;

	function available() {
		if (disposed || attempted || inFlight || preference.matches || !target) return false;
		const status = target.getDeviceMotionStatus();
		return (
			status.enabled &&
			status.supported &&
			status.requiresPermission &&
			!status.active &&
			status.permissionState !== 'granted' &&
			status.permissionState !== 'denied'
		);
	}

	function state(): MotionHandshakeState {
		if (attempted) return 'asked';
		if (inFlight) return 'asking';
		return armed ? 'armed' : 'idle';
	}

	function arm() {
		if (armed) return;
		gestures.addEventListener('click', onGesture, LISTENER_OPTIONS);
		armed = true;
	}

	function disarm() {
		if (!armed) return;
		gestures.removeEventListener('click', onGesture, { capture: true });
		armed = false;
	}

	function update() {
		if (disposed) return;
		if (available()) arm();
		else disarm();
		publish(state());
	}

	function isInteractive(event: Event) {
		// Duck-typed (no Element global under the node test runner).
		const element = event.target as { closest?: (selector: string) => Element | null } | null;
		if (!element || typeof element.closest !== 'function') return false;
		const hit = element.closest(interactive);
		return hit !== null && hit !== root;
	}

	/** Settled means the platform answered (or the sensor is already live). */
	function settled(): boolean {
		if (!target) return false;
		const status = target.getDeviceMotionStatus();
		return status.active || status.permissionState === 'granted' || status.permissionState === 'denied';
	}

	function onGesture(event: Event) {
		if (isInteractive(event)) return;
		if (!eligible() || !available() || !target) {
			update();
			return;
		}
		const current = target;
		inFlight = true;
		disarm();
		publish(state());
		// Synchronous inside the click stack: an await first forfeits transient activation.
		let request: Promise<boolean>;
		try {
			request = current.requestDeviceMotionPermission();
		} catch {
			request = Promise.resolve(false);
		}
		void request
			.then(
				(granted) => granted || settled(),
				() => settled(),
			)
			.then((done) => {
				inFlight = false;
				// A request that never reached the platform (component not yet
				// mounted, capability not yet resolved) keeps the one shot.
				if (done || settled()) attempted = true;
				update();
			});
	}

	// The package also listens to this media query and resets its own
	// permission state when Reduce Motion is lifted (reduce reads as
	// 'denied' inside tinyvectors). Listener order follows registration, so
	// re-check once the package has had its turn.
	function onPreferenceChange() {
		update();
		setTimeout(update, 0);
	}

	preference.addEventListener('change', onPreferenceChange);
	update();

	return {
		setTarget(next: DeviceMotionTarget | undefined) {
			if (disposed) return;
			target = next;
			update();
		},
		getState: state,
		destroy() {
			disposed = true;
			disarm();
			target = undefined;
			preference.removeEventListener('change', onPreferenceChange);
		},
	};
}
