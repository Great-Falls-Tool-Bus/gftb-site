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
	/** Half of the coverage fan, radians; the blade reaches +halfSweep at the turnaround. */
	readonly halfSweep: number;
	/**
	 * Park angle, radians, at least halfSweep: the blade rests at -park with
	 * its tip on or below the glass line, so nothing of it lies over the
	 * notes between wipes. A stroke runs from -park to +halfSweep; the first
	 * part of it is the blade rising into frame (operator ruling at LOOK 3:
	 * both blades travel the same way, tandem, and never cross).
	 */
	readonly park: number;
	/** The x range this arm owns, [from, to). */
	readonly span: readonly [number, number];
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
	/** The arm's fan, radians: the stroke runs from -park to +halfSweep. */
	readonly park: number;
	readonly halfSweep: number;
	/** 1 on the out-stroke, -1 on the back-stroke, 0 parked. */
	readonly travel: -1 | 0 | 1;
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
/** At park the tip sits this far below the glass line, CSS px. */
const PARK_TIP_DROP = 12;
/** Arm width: a real arm is about a thirty-sixth of its length, never a tenth of a phone. */
const ARM_WIDTH_RATIO = 1 / 36;
const ARM_WIDTH_OF_PANE = 0.028;
const ARM_WIDTH_PX: readonly [number, number] = [6, 22];
/** The rubber starts this far along the arm, or nearer when the hub is close to the glass. */
const BLADE_FROM_RATIO = 0.3;
const BLADE_FROM_OF_DROP = 0.85;

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
	// Parked, the tip is on or below the glass line: cos(park) * length is
	// the tip's height above the hub, which must not exceed the hub's drop.
	const park = Math.max(halfSweep, Math.acos(Math.min(1, Math.max(0, pivotY - box.height - PARK_TIP_DROP) / length)));
	return { pivotX, pivotY, length, halfSweep, park, span };
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

/** Where the blade rests between wipes, radians in the conic convention. */
export function parkAngle(arm: ArmSpec): number {
	return -arm.park;
}

/** The whole stroke, park to turnaround, radians. */
export function sweepSpan(arm: ArmSpec): number {
	return arm.park + arm.halfSweep;
}

/** The arm that owns a pane-local x coordinate. */
export function armAt(geometry: WiperGeometry, x: number): ArmSpec {
	const found = geometry.arms.find((arm) => x >= arm.span[0] && x < arm.span[1]);
	return found ?? geometry.arms[geometry.arms.length - 1];
}

/**
 * Every arm whose blade passes over any part of a pane-local box, the owner
 * of its centre first. In tandem the second blade's tip crosses the first
 * span's lower reaches on its way up and the first blade reaches into the
 * second span at the turnaround, and a note straddling the boundary meets
 * both fans outright; such a note carries a mask per arm (composited in
 * app.css), so every blade wipes exactly what it passes.
 */
export function armsOver(geometry: WiperGeometry, box: ItemBox): ArmSpec[] {
	const owner = armAt(geometry, box.left + box.width / 2);
	const xs = [box.left, box.left + box.width / 2, box.left + box.width];
	const ys = [box.top, box.top + box.height / 2, box.top + box.height];
	const others = geometry.arms.filter((arm) => arm !== owner && xs.some((x) => ys.some((y) => sweptBy(arm, x, y))));
	return [owner, ...others];
}

/** The arms left to right by hub, for masks that must know which is which. */
export function leftToRight(arms: readonly ArmSpec[]): ArmSpec[] {
	return [...arms].sort((a, b) => a.pivotX - b.pivotX);
}

export interface ItemBox {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** Signed angle (radians) and distance from an arm's pivot to a pane-local point. */
export function polar(arm: ArmSpec, x: number, y: number): { phi: number; distance: number } {
	const dx = x - arm.pivotX;
	const dy = arm.pivotY - y; // up is positive
	return { phi: Math.atan2(dx, dy), distance: Math.hypot(dx, dy) };
}

/** Whether a stroke from park to the turnaround passes the blade over the point. */
export function sweptBy(arm: ArmSpec, x: number, y: number): boolean {
	const { phi, distance } = polar(arm, x, y);
	return phi >= -arm.park - 1e-9 && phi <= arm.halfSweep + 1e-9 && distance <= arm.length + 1e-6;
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
	const swept = sweepSpan(arm) * ease(t);
	return stroke === 'out' ? -arm.park + swept : arm.halfSweep - swept;
}

/** The mask's swept angle from park, degrees, for a blade at `phi`. */
export function wipeAngleDeg(arm: ArmSpec, phi: number): number {
	return toDegrees(phi + arm.park);
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
	const swept = sweepSpan(arm) * Math.min(Math.max(unit, 0), 1);
	const phi = phase === 'dwell' ? parkAngle(arm) : phase === 'out' ? -arm.park + swept : arm.halfSweep - swept;
	// The rubber trails the frame by the angular speed, which the cosine ease
	// makes sin(pi t): nothing at the ends, most through the middle.
	const travel = phase === 'dwell' ? 0 : phase === 'out' ? 1 : -1;
	const flex = travel * Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
	const width = Math.min(
		Math.max(Math.min(arm.length * ARM_WIDTH_RATIO, box.width * ARM_WIDTH_OF_PANE), ARM_WIDTH_PX[0]),
		ARM_WIDTH_PX[1],
	);
	const bladeFrom = Math.min(arm.length * BLADE_FROM_RATIO, (arm.pivotY - box.height) * BLADE_FROM_OF_DROP);
	return {
		pivotX: arm.pivotX,
		pivotY: arm.pivotY,
		length: arm.length,
		phi,
		width,
		bladeFrom,
		flex,
		park: arm.park,
		halfSweep: arm.halfSweep,
		travel,
	};
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

/** The shove's static inputs for one page of notes (app.css --wipe-push). */
export interface TrainVars {
	/** Pivot of the driving arm in the contact note's border-box coordinates. */
	'--wipe-tx': string;
	'--wipe-ty': string;
	/** The driving arm's park angle and stroke span, degrees. */
	'--wipe-tfrom': string;
	'--wipe-tspan': string;
	/** Distance the row must travel beyond what the blade delivers, px. */
	'--wipe-run': string;
	/** Eased stroke unit at which the blade touches the contact note, 0..0.98. */
	'--wipe-contact': string;
}

/**
 * A page's notes leave as one row. The first blade whose rubber reaches a
 * note's top-left corner (its ray crossing that corner earliest in the
 * stroke) drives the row at its own speed from that contact, so the row
 * rides the blade and no note overtakes the next; the run is the extra
 * distance, spread over the rest of the stroke, that puts the leftmost
 * note's left edge on the glass's right edge exactly at the turnaround.
 * Notes out of every blade's reach still ride the earliest ray.
 */
export function trainFor(geometry: WiperGeometry, notes: readonly ItemBox[]): TrainVars {
	const round = (value: number) => Math.round(value * 100) / 100;
	let best: { arm: ArmSpec; x: number; y: number; u: number; reachable: boolean } | null = null;
	for (const note of notes) {
		for (const arm of geometry.arms) {
			const x = arm.pivotX - note.left;
			const y = arm.pivotY - note.top;
			const reachable = Math.hypot(x, y) <= arm.length;
			const u = (Math.atan2(-x, y) - parkAngle(arm)) / sweepSpan(arm);
			if (!best || (reachable && !best.reachable) || (reachable === best.reachable && u < best.u))
				best = { arm, x, y, u, reachable };
		}
	}
	if (!best) {
		return {
			'--wipe-tx': '0px',
			'--wipe-ty': '0px',
			'--wipe-tfrom': '0deg',
			'--wipe-tspan': '0deg',
			'--wipe-run': '0px',
			'--wipe-contact': '0',
		};
	}
	const leftmost = Math.min(...notes.map((note) => note.left));
	const reachEnd = best.x + best.y * Math.tan(parkAngle(best.arm) + sweepSpan(best.arm));
	const run = Math.max(0, geometry.box.width - leftmost - reachEnd);
	const contact = Math.min(Math.max(best.u, 0), 0.98);
	return {
		'--wipe-tx': `${round(best.x)}px`,
		'--wipe-ty': `${round(best.y)}px`,
		'--wipe-tfrom': `${round(toDegrees(parkAngle(best.arm)))}deg`,
		'--wipe-tspan': `${round(sweepSpanDeg(best.arm))}deg`,
		'--wipe-run': `${round(run)}px`,
		'--wipe-contact': contact.toFixed(4),
	};
}

/** Degrees form of the fan, for tests and status readouts. */
export function halfSweepDeg(arm: ArmSpec): number {
	return toDegrees(arm.halfSweep);
}

/** Degrees form of the whole stroke, the mask's `--wipe-span`. */
export function sweepSpanDeg(arm: ArmSpec): number {
	return toDegrees(sweepSpan(arm));
}
