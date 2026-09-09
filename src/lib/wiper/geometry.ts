// Pure, DOM-free geometry for the Notes & Goals wiper. Angles are signed from
// straight up at the arm's pivot, clockwise positive, which is exactly the
// CSS conic-gradient convention, so the same number drives the DOM mask and
// the rendered blade. Coordinates are pane-local CSS pixels, y down.

export interface PaneBox {
	readonly width: number;
	readonly height: number;
}

export interface ArmSpec {
	/** Pivot, pane-local px. The hub sits below the pane (pivotY > height). */
	readonly pivotX: number;
	readonly pivotY: number;
	/** Hub to blade tip, px. */
	readonly length: number;
	/** Half of the fan, radians; a stroke runs -halfSweep -> +halfSweep. */
	readonly halfSweep: number;
	/** The x range this arm owns, [from, to). */
	readonly span: readonly [number, number];
}

export interface WiperGeometry {
	readonly box: PaneBox;
	readonly arms: readonly ArmSpec[];
	/** The blade's soft edge in the mask, degrees. */
	readonly featherDeg: number;
}

export interface MaskVars {
	/** Park angle in the conic convention, degrees. */
	'--wipe-from': string;
	/** Pivot in the item's own border-box coordinates. */
	'--wipe-x': string;
	'--wipe-y': string;
}

/** Widest fan a wiper may open before it reads as a fan, not a wiper. */
export const PHI_MAX_DEG = 55;
/** Two arms from this pane width up; one below. */
export const TWO_ARM_MIN_WIDTH = 640;
export const FEATHER_DEG = 1.2;
/** The hub's minimum drop below the pane, as a fraction of the pane height. */
const HUB_DROP = 0.06;
/** Blade tip margin past the farthest covered corner. */
const TIP_MARGIN = 1.02;

const toRadians = (deg: number) => (deg * Math.PI) / 180;
const toDegrees = (rad: number) => (rad * 180) / Math.PI;

function armFor(span: readonly [number, number], box: PaneBox): ArmSpec {
	const pivotX = (span[0] + span[1]) / 2;
	const reach = Math.max(pivotX - span[0], span[1] - pivotX);
	// The bottom corners of the span sit closest to the hub and therefore
	// at the widest angle. Drop the hub until that angle fits inside the fan
	// cap; then the fan covers every point of the span and the top corners
	// set the length.
	const pivotY = Math.max(box.height * (1 + HUB_DROP), box.height + reach / Math.tan(toRadians(PHI_MAX_DEG)));
	const halfSweep = Math.atan(reach / (pivotY - box.height));
	const length = TIP_MARGIN * Math.hypot(reach, pivotY);
	return { pivotX, pivotY, length, halfSweep, span };
}

export function deriveGeometry(box: PaneBox): WiperGeometry {
	const width = Math.max(box.width, 1);
	const height = Math.max(box.height, 1);
	const safe = { width, height };
	const spans: Array<readonly [number, number]> =
		width >= TWO_ARM_MIN_WIDTH
			? [
					[0, width / 2],
					[width / 2, width],
				]
			: [[0, width]];
	return { box: safe, arms: spans.map((span) => armFor(span, safe)), featherDeg: FEATHER_DEG };
}

/** The arm that owns a pane-local x coordinate. */
export function armAt(geometry: WiperGeometry, x: number): ArmSpec {
	const found = geometry.arms.find((arm) => x >= arm.span[0] && x < arm.span[1]);
	return found ?? geometry.arms[geometry.arms.length - 1];
}

/** Signed angle (radians) and distance from an arm's pivot to a pane-local point. */
export function polar(arm: ArmSpec, x: number, y: number): { phi: number; distance: number } {
	const dx = x - arm.pivotX;
	const dy = arm.pivotY - y; // up is positive
	return { phi: Math.atan2(dx, dy), distance: Math.hypot(dx, dy) };
}

/** Whether a stroke from park to end passes the blade over the point. */
export function sweptBy(arm: ArmSpec, x: number, y: number): boolean {
	const { phi, distance } = polar(arm, x, y);
	return Math.abs(phi) <= arm.halfSweep + 1e-9 && distance <= arm.length + 1e-6;
}

/** Every sampled point of the pane is swept by the arm that owns it. */
export function coversPane(geometry: WiperGeometry, samples = 24): boolean {
	const { width, height } = geometry.box;
	for (let i = 0; i <= samples; i += 1) {
		for (let j = 0; j <= samples; j += 1) {
			const x = (width * i) / samples;
			const y = (height * j) / samples;
			if (!sweptBy(armAt(geometry, Math.min(x, width - 1e-6)), x, y)) return false;
		}
	}
	return true;
}

/** The blade angle (radians) at unit progress `t` of a stroke. */
export function phiAt(arm: ArmSpec, t: number, stroke: 'out' | 'back', ease: (t: number) => number): number {
	const swept = 2 * arm.halfSweep * ease(t);
	return stroke === 'out' ? -arm.halfSweep + swept : arm.halfSweep - swept;
}

/** The mask's swept angle from park, degrees, for a blade at `phi`. */
export function wipeAngleDeg(arm: ArmSpec, phi: number): number {
	return toDegrees(phi + arm.halfSweep);
}

/** Static per-item custom properties; item and pane rects are in the same coordinate space. */
export function maskVarsFor(
	arm: ArmSpec,
	item: { left: number; top: number },
	pane: { left: number; top: number },
): MaskVars {
	const round = (value: number) => Math.round(value * 100) / 100;
	return {
		'--wipe-from': `${round(toDegrees(-arm.halfSweep))}deg`,
		'--wipe-x': `${round(arm.pivotX - (item.left - pane.left))}px`,
		'--wipe-y': `${round(arm.pivotY - (item.top - pane.top))}px`,
	};
}

/** Degrees form of the fan, for tests and status readouts. */
export function halfSweepDeg(arm: ArmSpec): number {
	return toDegrees(arm.halfSweep);
}
