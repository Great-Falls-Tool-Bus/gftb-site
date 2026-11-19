/**
 * On iOS, request accelerometer access during the first neutral tap. Interactive controls and
 * reduced motion must never trigger the prompt. If physics is still loading, try the next
 * neutral tap. Once the request settles, stop asking for the rest of the page load.
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

/** Gesture source inside the main landmark. */
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
		// Request permission synchronously while the gesture still has transient activation.
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
