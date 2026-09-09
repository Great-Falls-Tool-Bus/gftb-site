// The bead field (M4): one droplet at most per grid cell over the glass,
// simulated on the CPU from the machine's stroke clock and uploaded to the
// scene shader as a small float texture. Births come during the rest and
// ahead of a moving blade; a pass kills every bead whose whole extent the
// blade crossed, so beads are eaten under the rubber, never popped. Two
// stroke samples reconstruct every angle a blade crossed between frames,
// whatever the frame gap, so a slow rig clears the same beads a fast one
// does. Pure TypeScript: vitest drives it with a real WiperMachine.
import { phiAt, polar, type ArmSpec, type WiperGeometry } from './geometry';
import type { StrokeSample } from './machine';
import {
	DROP_BIRTH_RATE,
	DROP_CELL_PX,
	DROP_CREEP_MIN_R,
	DROP_CREEP_PX_S,
	DROP_EDGE_CLEARANCE_RAD,
	DROP_GROW_S,
	DROP_MAX_COLS,
	DROP_MAX_ROWS,
	DROP_OCCUPANCY,
	DROP_PRESEED,
	DROP_RADIUS_MIN_PX,
	DROP_RADIUS_SPREAD_PX,
	DROP_RAMP_DELAY_S,
	DROP_RAMP_S,
} from './renderer/shaders/constants';
import { strokeEase } from './schedule';

export interface StrokeLeg {
	stroke: 'out' | 'back';
	/** Raw progress the blade covered during the leg, from <= to. */
	from: number;
	to: number;
}

/**
 * The legs a blade travelled between two stroke samples. A leg is a raw
 * progress interval within one stroke; a gap that spans the turnaround or
 * park yields one leg per stroke touched.
 */
export function strokeLegs(prev: StrokeSample, next: StrokeSample): StrokeLeg[] {
	const passes = next.passesDone - prev.passesDone;
	const legs: StrokeLeg[] = [];
	if (passes >= 2) {
		// A whole cycle or more went by: both strokes ran end to end.
		legs.push({ stroke: 'out', from: 0, to: 1 }, { stroke: 'back', from: 0, to: 1 });
	} else if (passes === 1) {
		const finished = prev.phase === 'dwell' ? 'out' : prev.phase;
		legs.push({ stroke: finished, from: prev.phase === 'dwell' ? 0 : prev.t, to: 1 });
	} else if (prev.phase !== 'dwell' && next.phase !== 'dwell' && next.strokeIndex === prev.strokeIndex) {
		return [{ stroke: prev.phase, from: Math.min(prev.t, next.t), to: Math.max(prev.t, next.t) }];
	}
	if (next.phase !== 'dwell' && (passes >= 1 || next.strokeIndex > prev.strokeIndex)) {
		legs.push({ stroke: next.phase, from: 0, to: next.t });
	}
	return legs;
}

/** The angle range, radians, an arm's edge swept during a leg, sorted. */
export function legAngles(arm: ArmSpec, leg: StrokeLeg): { lo: number; hi: number } {
	const a = phiAt(arm, leg.from, leg.stroke, strokeEase);
	const b = phiAt(arm, leg.to, leg.stroke, strokeEase);
	return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

export interface DropletFieldOptions {
	random?: () => number;
	cellPx?: number;
	preseed?: number;
}

/** Per-cell bead state; a bead exists where rFinal > 0. */
interface Cells {
	x: Float32Array;
	y: Float32Array;
	rFinal: Float32Array;
	birth: Float32Array;
	clearedAt: Float32Array;
}

export class DropletField {
	cols = 0;
	rows = 0;
	cellCss: number;
	/** (cols + 2) x (rows + 2) x 4: x, y, r (CSS px) and alpha, zero border. */
	data = new Float32Array(0);
	/** The field clock, seconds; advances only while the scene may change. */
	time = 0;

	#geometry: WiperGeometry;
	#cells: Cells = {
		x: new Float32Array(0),
		y: new Float32Array(0),
		rFinal: new Float32Array(0),
		birth: new Float32Array(0),
		clearedAt: new Float32Array(0),
	};
	#random: () => number;
	#preseed: number;
	#prev: StrokeSample | null = null;
	#strokeStart = -Infinity;
	#live = 0;

	constructor(geometry: WiperGeometry, options: DropletFieldOptions = {}) {
		this.#random = options.random ?? Math.random;
		this.cellCss = options.cellPx ?? DROP_CELL_PX;
		this.#preseed = options.preseed ?? DROP_PRESEED;
		this.#geometry = geometry;
		this.relayout(geometry);
	}

	get live(): number {
		return this.#live;
	}
	get cellCount(): number {
		return this.cols * this.rows;
	}
	occupancy(): number {
		return this.cellCount ? this.#live / this.cellCount : 0;
	}

	/** Rebuild the grid for a new glass box; the field restarts preseeded. */
	relayout(geometry: WiperGeometry): void {
		this.#geometry = geometry;
		this.cols = Math.max(1, Math.min(DROP_MAX_COLS, Math.ceil(geometry.box.width / this.cellCss)));
		this.rows = Math.max(1, Math.min(DROP_MAX_ROWS, Math.ceil(geometry.box.height / this.cellCss)));
		const n = this.cols * this.rows;
		this.#cells = {
			x: new Float32Array(n),
			y: new Float32Array(n),
			rFinal: new Float32Array(n),
			birth: new Float32Array(n),
			clearedAt: new Float32Array(n).fill(-Infinity),
		};
		this.data = new Float32Array((this.cols + 2) * (this.rows + 2) * 4);
		this.#live = 0;
		for (let index = 0; index < n; index += 1) {
			if (this.#random() < this.#preseed) this.#birth(index, this.time - DROP_GROW_S);
		}
		this.#write();
	}

	/**
	 * Advance the field by `dt` seconds to the stroke sample `next` with the
	 * arms as laid out. Returns true when the texture data changed.
	 */
	step(dt: number, next: StrokeSample, arms: readonly ArmSpec[] = this.#geometry.arms): boolean {
		const prev = this.#prev ?? next;
		this.#prev = next;
		if (next.strokeIndex !== prev.strokeIndex) this.#strokeStart = this.time;
		this.time += Math.max(dt, 0);
		let changed = false;

		const legs = strokeLegs(prev, next);
		if (legs.length > 0) changed = this.#sweep(legs, arms) || changed;

		if (dt > 0) {
			changed = this.#births(dt, next, arms) || changed;
			changed = this.#grow(dt) || changed;
		}
		if (changed) this.#write();
		return changed;
	}

	/** Kill every bead a leg crossed whole; stamp the cells a leg passed. */
	#sweep(legs: StrokeLeg[], arms: readonly ArmSpec[]): boolean {
		const cells = this.#cells;
		let changed = false;
		const ranges = arms.map((arm) => legs.map((leg) => ({ leg, ...legAngles(arm, leg) })));
		for (let index = 0; index < cells.rFinal.length; index += 1) {
			const cx = ((index % this.cols) + 0.5) * this.cellCss;
			const cy = (Math.floor(index / this.cols) + 0.5) * this.cellCss;
			arms.forEach((arm, armIndex) => {
				const centre = polar(arm, cx, cy);
				const inFanCentre = centre.phi >= -arm.park && centre.phi <= arm.halfSweep && centre.distance <= arm.length;
				for (const range of ranges[armIndex]) {
					if (inFanCentre && centre.phi >= range.lo && centre.phi <= range.hi) cells.clearedAt[index] = this.time;
				}
				const r = cells.rFinal[index];
				if (r <= 0) return;
				const bead = polar(arm, cells.x[index], cells.y[index]);
				if (bead.phi < -arm.park || bead.phi > arm.halfSweep || bead.distance > arm.length) return;
				const m = r / bead.distance;
				for (const range of ranges[armIndex]) {
					const edge = range.leg.stroke === 'out' ? bead.phi + m : bead.phi - m;
					if (edge >= range.lo && edge <= range.hi) {
						cells.rFinal[index] = 0;
						this.#live -= 1;
						changed = true;
						break;
					}
				}
			});
		}
		return changed;
	}

	#births(dt: number, next: StrokeSample, arms: readonly ArmSpec[]): boolean {
		const cells = this.#cells;
		const headroom = Math.max(0, 1 - this.#live / (this.cellCount * DROP_OCCUPANCY));
		if (headroom <= 0) return false;
		const moving = next.phase !== 'dwell';
		const edges = arms.map((arm) => (next.phase === 'dwell' ? 0 : phiAt(arm, next.t, next.phase, strokeEase)));
		let changed = false;
		for (let index = 0; index < cells.rFinal.length; index += 1) {
			if (cells.rFinal[index] > 0) continue;
			const cleared = cells.clearedAt[index];
			if (moving && cleared >= this.#strokeStart) continue;
			const ramp = Math.min(Math.max((this.time - cleared - DROP_RAMP_DELAY_S) / DROP_RAMP_S, 0), 1);
			if (ramp <= 0) continue;
			if (this.#random() >= DROP_BIRTH_RATE * dt * ramp * headroom) continue;
			const u = this.#random();
			const rFinal = DROP_RADIUS_MIN_PX + DROP_RADIUS_SPREAD_PX * u * u;
			const cx = ((index % this.cols) + 0.5) * this.cellCss;
			const cy = (Math.floor(index / this.cols) + 0.5) * this.cellCss;
			if (moving) {
				// Never ahead of a blade by less than the bead's own reach.
				let tooClose = false;
				arms.forEach((arm, armIndex) => {
					const centre = polar(arm, cx, cy);
					if (centre.phi < -arm.park || centre.phi > arm.halfSweep || centre.distance > arm.length) return;
					const m = rFinal / centre.distance + DROP_EDGE_CLEARANCE_RAD;
					const edge = edges[armIndex];
					if (next.phase === 'out' ? centre.phi < edge + m : centre.phi > edge - m) tooClose = true;
				});
				if (tooClose) continue;
			}
			this.#birth(index, this.time, rFinal);
			changed = true;
		}
		return changed;
	}

	#birth(index: number, birth: number, rFinal?: number): void {
		const cells = this.#cells;
		const u = this.#random();
		const r = rFinal ?? DROP_RADIUS_MIN_PX + DROP_RADIUS_SPREAD_PX * u * u;
		const left = (index % this.cols) * this.cellCss;
		const top = Math.floor(index / this.cols) * this.cellCss;
		const room = Math.max(this.cellCss - 2 * r, 0);
		cells.x[index] = left + r + this.#random() * room;
		cells.y[index] = top + r + this.#random() * room;
		cells.rFinal[index] = r;
		cells.birth[index] = birth;
		this.#live += 1;
	}

	#grow(dt: number): boolean {
		const cells = this.#cells;
		let changed = false;
		for (let index = 0; index < cells.rFinal.length; index += 1) {
			const r = cells.rFinal[index];
			if (r <= 0) continue;
			if (this.time - cells.birth[index] < DROP_GROW_S + dt) changed = true;
			if (r >= DROP_CREEP_MIN_R) {
				const bottom = (Math.floor(index / this.cols) + 1) * this.cellCss - r;
				const y = Math.min(cells.y[index] + DROP_CREEP_PX_S * dt, bottom);
				if (y !== cells.y[index]) {
					cells.y[index] = y;
					changed = true;
				}
			}
		}
		return changed;
	}

	#write(): void {
		const cells = this.#cells;
		const stride = this.cols + 2;
		this.data.fill(0);
		for (let index = 0; index < cells.rFinal.length; index += 1) {
			const r = cells.rFinal[index];
			if (r <= 0) continue;
			const i = (index % this.cols) + 1;
			const j = Math.floor(index / this.cols) + 1;
			const k = strokeEase(Math.min((this.time - cells.birth[index]) / DROP_GROW_S, 1));
			const offset = (j * stride + i) * 4;
			this.data[offset] = cells.x[index];
			this.data[offset + 1] = cells.y[index];
			this.data[offset + 2] = r * (0.35 + 0.65 * k);
			this.data[offset + 3] = k;
		}
	}
}
