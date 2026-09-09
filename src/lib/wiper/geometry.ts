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
	/** Half of the fan, radians; a stroke runs from park across 2 * halfSweep. */
	readonly halfSweep: number;
	/** The x range this arm owns, [from, to). */
	readonly span: readonly [number, number];
	/**
	 * Sweep direction. 1 parks at -halfSweep and sweeps clockwise; -1 parks at
	 * +halfSweep and sweeps counter-clockwise. Two arms run opposed (the bus
	 * pattern): both park out of frame at the outer bottom corners and meet
	 * over the centre at the turnaround, so no parked blade ever lies across
	 * the other half's notes.
	 */
	readonly dir: 1 | -1;
}

/** A blade's pose for the renderer, pane-local CSS px and radians. */
export interface BladePose {
	readonly pivotX: number;
	readonly pivotY: number;
	readonly length: number;
	/** Blade angle in the conic convention. */
	readonly phi: number;
	/** Arm width at the hinge, px; every part of the blade scales from it. */
	readonly width: number;
	/** Where the rubber starts along the arm, px from the hub; always below the glass edge. */
	readonly bladeFrom: number;
	/** Rubber lag against the direction of travel, -1..1; 0 at rest and at the ends. */
	readonly flex: number;
	/** The arm's sweep direction; the anatomy mirrors with it (an opposed pair is a mirror pair). */
	readonly dir: 1 | -1;
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
/** Arm width: a real arm is about a thirty-sixth of its length, never a tenth of a phone. */
const ARM_WIDTH_RATIO = 1 / 36;
const ARM_WIDTH_OF_PANE = 0.028;
const ARM_WIDTH_PX: readonly [number, number] = [6, 22];
/** A note must reach this far into a neighbouring span before that arm wipes it too. */
const STRADDLE_MIN_PX = 4;
/** The rubber starts this far along the arm, or nearer when the hub is close to the glass. */
const BLADE_FROM_RATIO = 0.3;
const BLADE_FROM_OF_DROP = 0.85;

const toRadians = (deg: number) => (deg * Math.PI) / 180;
const toDegrees = (rad: number) => (rad * 180) / Math.PI;

function armFor(span: readonly [number, number], box: PaneBox, dir: 1 | -1): ArmSpec {
	const pivotX = (span[0] + span[1]) / 2;
	const reach = Math.max(pivotX - span[0], span[1] - pivotX);
	// The bottom corners of the span sit closest to the hub and therefore
	// at the widest angle. Drop the hub until that angle fits inside the fan
	// cap; then the fan covers every point of the span and the top corners
	// set the length.
	const pivotY = Math.max(box.height * (1 + HUB_DROP), box.height + reach / Math.tan(toRadians(PHI_MAX_DEG)));
	const halfSweep = Math.atan(reach / (pivotY - box.height));
	const length = TIP_MARGIN * Math.hypot(reach, pivotY);
	return { pivotX, pivotY, length, halfSweep, span, dir };
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
	// Two arms run opposed; the second sweeps from the right edge inward.
	return {
		box: safe,
		arms: spans.map((span, index) => armFor(span, safe, index === 1 ? -1 : 1)),
		featherDeg: FEATHER_DEG,
	};
}

/** Where the blade rests between wipes, radians in the conic convention. */
export function parkAngle(arm: ArmSpec): number {
	return -arm.dir * arm.halfSweep;
}

/** The arm that owns a pane-local x coordinate. */
export function armAt(geometry: WiperGeometry, x: number): ArmSpec {
	const found = geometry.arms.find((arm) => x >= arm.span[0] && x < arm.span[1]);
	return found ?? geometry.arms[geometry.arms.length - 1];
}

/**
 * The arms whose spans a pane-local x range meets, the owner of its centre
 * first. A note that straddles the boundary of an opposed pair is wiped by
 * both blades, each where it passes (two masks, composited in app.css).
 */
export function armsAcross(geometry: WiperGeometry, left: number, right: number): ArmSpec[] {
	const owner = armAt(geometry, (left + right) / 2);
	const others = geometry.arms.filter(
		(arm) => arm !== owner && right - STRADDLE_MIN_PX > arm.span[0] && left + STRADDLE_MIN_PX < arm.span[1],
	);
	return [owner, ...others];
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
	return arm.dir * (stroke === 'out' ? -arm.halfSweep + swept : arm.halfSweep - swept);
}

/** The mask's swept angle from park, degrees, for a blade at `phi`. */
export function wipeAngleDeg(arm: ArmSpec, phi: number): number {
	return toDegrees(arm.dir * phi + arm.halfSweep);
}

/**
 * The blade the renderer draws for an arm at eased stroke progress `unit`
 * (the same number the mask uses, so blade and mask edge cannot drift) and
 * raw progress `t` (which shapes the rubber's lag). Dwell parks it.
 */
export function bladePoseAt(
	arm: ArmSpec,
	box: PaneBox,
	phase: 'dwell' | 'out' | 'back',
	unit: number,
	t: number,
): BladePose {
	const swept = 2 * arm.halfSweep * Math.min(Math.max(unit, 0), 1);
	const phi =
		phase === 'dwell' ? parkAngle(arm) : arm.dir * (phase === 'out' ? -arm.halfSweep + swept : arm.halfSweep - swept);
	// The rubber trails the frame by the angular speed, which the cosine ease
	// makes sin(pi t): nothing at the ends, most through the middle.
	const travel = phase === 'dwell' ? 0 : (phase === 'out' ? 1 : -1) * arm.dir;
	const flex = travel * Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
	const width = Math.min(
		Math.max(Math.min(arm.length * ARM_WIDTH_RATIO, box.width * ARM_WIDTH_OF_PANE), ARM_WIDTH_PX[0]),
		ARM_WIDTH_PX[1],
	);
	const bladeFrom = Math.min(arm.length * BLADE_FROM_RATIO, (arm.pivotY - box.height) * BLADE_FROM_OF_DROP);
	return { pivotX: arm.pivotX, pivotY: arm.pivotY, length: arm.length, phi, width, bladeFrom, flex, dir: arm.dir };
}

/** Static per-item custom properties; item and pane rects are in the same coordinate space. */
export function maskVarsFor(
	arm: ArmSpec,
	item: { left: number; top: number },
	pane: { left: number; top: number },
): MaskVars {
	const round = (value: number) => Math.round(value * 100) / 100;
	return {
		'--wipe-from': `${round(toDegrees(parkAngle(arm)))}deg`,
		'--wipe-x': `${round(arm.pivotX - (item.left - pane.left))}px`,
		'--wipe-y': `${round(arm.pivotY - (item.top - pane.top))}px`,
	};
}

/** Degrees form of the fan, for tests and status readouts. */
export function halfSweepDeg(arm: ArmSpec): number {
	return toDegrees(arm.halfSweep);
}
