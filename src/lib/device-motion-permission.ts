/** The existing TinyVectors instance API; physics and sensor IO stay in the package. */
export interface DeviceMotionTarget {
	getDeviceMotionStatus(): { enabled: boolean; supported: boolean; requiresPermission: boolean; active: boolean };
	requestDeviceMotionPermission(): Promise<boolean>;
}

export interface MotionPreference {
	readonly matches: boolean;
	addEventListener(type: 'change', listener: () => void): void;
	removeEventListener(type: 'change', listener: () => void): void;
}

export interface MotionPermissionState {
	visible: boolean;
	busy: boolean;
}

/** Browser-only control lifetime, independent of the deferred component's mount time. */
export function createDeviceMotionPermission(
	preference: MotionPreference,
	publish: (state: MotionPermissionState) => void,
) {
	let target: DeviceMotionTarget | undefined;
	let attempted = false;
	let busy = false;
	let disposed = false;

	function available() {
		if (disposed || attempted || preference.matches || !target) return false;
		const status = target.getDeviceMotionStatus();
		return status.enabled && status.supported && status.requiresPermission && !status.active;
	}

	function update() {
		if (!disposed) publish({ visible: available(), busy });
	}

	preference.addEventListener('change', update);
	update();

	return {
		setTarget(next: DeviceMotionTarget | undefined) {
			if (disposed) return;
			target = next;
			update();
		},
		async request() {
			if (busy || !available() || !target) return;
			busy = true;
			update();
			try {
				// Invoke immediately in the click stack: awaiting a tick first loses
				// the browser's transient user activation needed for permission.
				await target.requestDeviceMotionPermission();
			} catch {
				// Rejection is an unavailable enhancement, never an unhandled error.
			} finally {
				attempted = true;
				busy = false;
				update();
			}
		},
		destroy() {
			disposed = true;
			target = undefined;
			preference.removeEventListener('change', update);
		},
	};
}
