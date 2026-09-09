// The wiper's state machine, pure and clock-driven, so vitest can run it with
// synthetic timestamps. The runes adapter (engine.svelte.ts) owns the DOM, the
// frame loop and the reactive view; nothing here touches a browser API.
import {
	DEFAULT_WIPER_DETENT,
	dwellFor,
	pageCountFor,
	pageOf,
	strokeEase,
	wiperDetent,
	type WiperDetent,
	strokeEaseInverse,
} from './schedule';

export type WiperPhase = 'dwell' | 'out' | 'back';
export type WiperState = 'off' | 'dwell' | 'paused' | 'wiping';

export interface WiperMachineOptions {
	/** Notes per page at the current width (3 wide, 1 narrow). */
	pageSize: () => number;
	itemCount: () => number;
	/** Motion is allowed at all (enhanced, not reduced). */
	motionOk: () => boolean;
	initial?: WiperDetent;
	random?: () => number;
}

/** The coarse state a template or a test reads; a new object per change. */
export interface WiperView {
	detent: WiperDetent;
	phase: WiperPhase;
	state: WiperState;
	page: number;
	currentPage: number;
	pageCount: number;
	pageSize: number;
	/** Pages leaving and arriving during the out-stroke; -1 otherwise. */
	outgoing: number;
	incoming: number;
	enabled: boolean;
	rotatable: boolean;
	paged: boolean;
	paused: boolean;
	running: boolean;
	wiping: boolean;
}

export interface TickResult {
	/** Coarse state changed; re-read view(). */
	view: boolean;
	/** Eased out-stroke progress to write to the mask, or null when unchanged. */
	unit: number | null;
	apex: boolean;
	finish: boolean;
}

/**
 * The most one animation frame may advance the dwell. Real time otherwise:
 * a slow rig (software GL, a busy phone) at a few frames a second still
 * counts its dwell at wall-clock pace instead of slow motion, while a
 * frame that arrives after a long gap (a tab shown again) cannot swallow
 * the whole gap at once. Hidden tabs are paused by the engine anyway.
 */
export const MAX_STEP_MS = 1000;

/**
 * The stroke clock as a renderer sees it between two frames: which stroke
 * is running, how far it is, and how many passes (an out-stroke reaching
 * the turnaround, a back-stroke reaching park) have completed in total.
 * Two samples are enough to reconstruct every angle a blade crossed
 * between them, whatever the frame gap.
 */
export interface StrokeSample {
	phase: WiperPhase;
	/** Raw progress within the current stroke, 0..1; 0 in dwell. */
	t: number;
	/** Bumped when a stroke begins (out at the dwell's end, back at the turnaround). */
	strokeIndex: number;
	/** Bumped at the turnaround and at park; never by Off or a page jump. */
	passesDone: number;
}

export class WiperMachine {
	detent: WiperDetent;
	phase: WiperPhase = 'dwell';
	strokeIndex = 0;
	passesDone = 0;
	page = 0;
	outgoing = -1;
	incoming = -1;
	hover = false;
	focus = false;
	hidden = false;
	offscreen = false;

	#opts: Required<Pick<WiperMachineOptions, 'pageSize' | 'itemCount' | 'motionOk' | 'random'>>;
	#dwellRemaining = 0;
	#strokeStart = 0;
	#strokeMs = 0;
	#lastTick: number | null = null;
	#unit = 0;
	/** Blade angle the last completed pass ended on, as a unit of the fan (0 park, 1 end). */
	lastWipeEnd = 0;

	constructor(options: WiperMachineOptions) {
		this.#opts = {
			pageSize: options.pageSize,
			itemCount: options.itemCount,
			motionOk: options.motionOk,
			random: options.random ?? Math.random,
		};
		this.detent = options.initial ?? DEFAULT_WIPER_DETENT;
		this.#dwellRemaining = dwellFor(this.detent, this.#opts.random);
	}

	get pageSize(): number {
		return Math.max(this.#opts.pageSize(), 1);
	}
	get pageCount(): number {
		return pageCountFor(this.#opts.itemCount(), this.pageSize);
	}
	get currentPage(): number {
		return Math.min(this.page, this.pageCount - 1);
	}
	get enabled(): boolean {
		return this.detent !== 'off';
	}
	get rotatable(): boolean {
		return this.#opts.motionOk() && this.pageCount > 1;
	}
	get paged(): boolean {
		return this.rotatable && this.enabled;
	}
	get paused(): boolean {
		// A resting pointer pauses only the intermittent wipers (operator
		// ruling at the M4 ratification): on Low and High the blades keep
		// time. Focus, a hidden tab and an off-screen pane pause every detent.
		return (this.hover && this.detent === 'intermittent') || this.focus || this.hidden || this.offscreen;
	}
	get running(): boolean {
		return this.paged && !this.paused;
	}
	get wiping(): boolean {
		return this.paged && this.phase !== 'dwell';
	}
	get state(): WiperState {
		if (!this.paged) return 'off';
		if (this.wiping) return 'wiping';
		return this.paused ? 'paused' : 'dwell';
	}
	/** Frames are worth scheduling: a stroke is in flight or the dwell is counting. */
	get needsFrames(): boolean {
		return this.wiping || this.running;
	}
	/** Eased out-stroke progress, 0 at park, 1 at the turnaround. */
	get unit(): number {
		return this.#unit;
	}
	/** Raw stroke progress for a renderer, 0..1 within the current stroke. */
	strokeProgress(now: number): number {
		if (this.phase === 'dwell' || this.#strokeMs <= 0) return 0;
		return Math.min(Math.max((now - this.#strokeStart) / this.#strokeMs, 0), 1);
	}
	get dwellRemainingMs(): number {
		return this.#dwellRemaining;
	}

	strokeSample(now: number): StrokeSample {
		return {
			phase: this.phase,
			t: this.strokeProgress(now),
			strokeIndex: this.strokeIndex,
			passesDone: this.passesDone,
		};
	}

	view(): WiperView {
		return {
			detent: this.detent,
			phase: this.phase,
			state: this.state,
			page: this.page,
			currentPage: this.currentPage,
			pageCount: this.pageCount,
			pageSize: this.pageSize,
			outgoing: this.outgoing,
			incoming: this.incoming,
			enabled: this.enabled,
			rotatable: this.rotatable,
			paged: this.paged,
			paused: this.paused,
			running: this.running,
			wiping: this.wiping,
		};
	}

	/** Called when frames resume after a gap so the first step is not the gap. */
	resume(now: number): void {
		this.#lastTick = now;
	}

	/**
	 * Hold an out-stroke at a chosen eased unit (a test or a LOOK frame): the
	 * stroke clock is rewound so that releasing the hold continues from the
	 * held angle rather than snapping to wherever the wall clock got to.
	 */
	holdStrokeAt(unit: number, now: number): number {
		if (this.phase !== 'out' || this.#strokeMs <= 0) return this.#unit;
		const clamped = Math.min(Math.max(unit, 0), 1);
		const t = strokeEaseInverse(clamped);
		this.#strokeStart = now - t * this.#strokeMs;
		this.#lastTick = now;
		return this.#setUnit(clamped);
	}

	setDetent(next: WiperDetent, now: number): void {
		if (next === this.detent) return;
		const entry = wiperDetent(next);
		this.detent = next;
		if (next === 'off') {
			// Off is immediate: the grid comes back at once; a stroke in flight is abandoned.
			this.#abandonStroke();
			return;
		}
		// A faster detent never waits out the slower dwell that was running.
		this.#dwellRemaining = Math.min(this.#dwellRemaining || entry.dwellMs, entry.dwellMs);
		if (this.#dwellRemaining <= 0) this.#dwellRemaining = dwellFor(next, this.#opts.random);
		this.#lastTick = now;
	}

	/** Focus-follow: show the page holding `index` at once, with no wipe. */
	reveal(index: number, now: number): void {
		this.#abandonStroke();
		this.page = pageOf(index, this.pageSize);
		this.#dwellRemaining = dwellFor(this.detent, this.#opts.random);
		this.#lastTick = now;
	}

	tick(now: number): TickResult {
		const result: TickResult = { view: false, unit: null, apex: false, finish: false };
		if (this.#lastTick === null) this.#lastTick = now;
		const step = Math.min(Math.max(now - this.#lastTick, 0), MAX_STEP_MS);
		this.#lastTick = now;

		if (this.phase === 'dwell') {
			if (!this.running) return result; // banked: the remainder waits for the pause to lift
			this.#dwellRemaining -= step;
			if (this.#dwellRemaining > 0) return result;
			this.#beginStroke('out', now);
			result.view = true;
			result.unit = this.#setUnit(0);
			return result;
		}

		const t = this.strokeProgress(now);
		if (this.phase === 'out') {
			const eased = strokeEase(t);
			if (eased !== this.#unit) result.unit = this.#setUnit(eased);
			if (t >= 1) {
				this.#apex(now);
				result.view = true;
				result.apex = true;
			}
			return result;
		}

		if (t >= 1) {
			this.#finish();
			result.view = true;
			result.finish = true;
		}
		return result;
	}

	#beginStroke(phase: 'out' | 'back', now: number): void {
		const entry = wiperDetent(this.detent);
		this.#strokeMs = Math.max(entry.sweepMs / 2, 1);
		this.#strokeStart = now;
		this.phase = phase;
		this.strokeIndex += 1;
		if (phase === 'out') {
			this.outgoing = this.currentPage;
			this.incoming = (this.currentPage + 1) % this.pageCount;
		}
	}

	#apex(now: number): void {
		if (this.incoming >= 0) this.page = this.incoming;
		this.outgoing = -1;
		this.incoming = -1;
		this.lastWipeEnd = 1;
		this.#unit = 0;
		this.passesDone += 1;
		this.#beginStroke('back', now);
	}

	#finish(): void {
		this.phase = 'dwell';
		this.passesDone += 1;
		this.lastWipeEnd = 0;
		this.#dwellRemaining = dwellFor(this.detent, this.#opts.random);
	}

	#abandonStroke(): void {
		this.phase = 'dwell';
		this.outgoing = -1;
		this.incoming = -1;
		this.#unit = 0;
		this.#strokeMs = 0;
	}

	#setUnit(value: number): number {
		this.#unit = value;
		return value;
	}
}
