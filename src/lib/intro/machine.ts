// The home intro as a pure machine: veil, lift, hold, scroll, done,
// cancelled. The DOM adapter (controller.ts) feeds it a clock, the page's
// scroll position, the target for the scroll and whether the wiper stack has
// hydrated; it answers with one command per frame. It knows nothing about
// elements, timers or storage, so it is tested in node. (Operator rulings
// 2026-09-10: every full load of the home route, no storage, the veil holds
// until the wiper stack is ready, any input cancels, focus is never moved.)

export const INTRO_TIMING = {
	/** The mark dwells at least this long before the veil may lift. */
	minVeilMs: 1800,
	/** The veil lifts at this point even if the wiper stack has not reported ready. */
	veilCapMs: 4500,
	/** The lift's own keyframes end here; the grace covers a missing animationend. */
	liftMs: 500,
	liftGraceMs: 200,
	/** Header and hero alone, this long after the lift. */
	holdMs: 600,
	scrollMs: 1600,
	/** A scroll position further than this from the last one written is someone else's. */
	deviationPx: 4,
} as const;

export type IntroTiming = typeof INTRO_TIMING;

export type IntroPhase = 'veil' | 'lift' | 'hold' | 'scroll' | 'done' | 'cancelled';

export type IntroCommand =
	| { readonly kind: 'idle' }
	/** Start the lift: the adapter adds the class that runs the lift keyframes. */
	| { readonly kind: 'lift' }
	| { readonly kind: 'write'; readonly y: number }
	| { readonly kind: 'done'; readonly y: number }
	| { readonly kind: 'cancel'; readonly reason: string };

export function easeInOutCubic(t: number): number {
	const x = Math.min(1, Math.max(0, t));
	return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export interface ArmInput {
	reduce: boolean;
	pathname: string;
	hash: string;
	off: boolean;
}

/** Mirrors the pre-paint check in app.html: motion allowed, home path, no fragment, no test hook. */
export function shouldArm(input: ArmInput): boolean {
	return !input.reduce && input.pathname === '/' && input.hash === '' && !input.off;
}

/** No canvas at all (the plain grid) counts as ready; a pending rung does not. */
export function wiperReady(tiers: readonly string[]): boolean {
	return tiers.every((tier) => tier !== 'pending');
}

export class IntroMachine {
	#phase: IntroPhase = 'veil';
	#reason = '';
	#ready = false;
	#liftStart = 0;
	#holdStart = 0;
	#from = 0;
	#scrollStart = 0;
	#lastWritten = 0;
	readonly #start: number;
	readonly #timing: IntroTiming;

	constructor(now: number, timing: IntroTiming = INTRO_TIMING) {
		this.#start = now;
		this.#timing = timing;
	}

	get phase(): IntroPhase {
		return this.#phase;
	}

	get reason(): string {
		return this.#reason;
	}

	get ready(): boolean {
		return this.#ready;
	}

	get terminal(): boolean {
		return this.#phase === 'done' || this.#phase === 'cancelled';
	}

	markReady(): void {
		this.#ready = true;
	}

	/** The lift's animation has ended (or the grace timer stands in for it). */
	liftEnded(now: number): void {
		if (this.#phase !== 'lift') return;
		this.#phase = 'hold';
		this.#holdStart = now;
	}

	cancel(reason: string): void {
		if (this.terminal) return;
		this.#phase = 'cancelled';
		this.#reason = reason;
	}

	/** One call per animation frame. `targetY` is the scroll that lands the goals under the header. */
	step(now: number, scrollY: number, targetY: number): IntroCommand {
		if (this.terminal) return { kind: 'idle' };
		if (Math.abs(scrollY - this.#lastWritten) > this.#timing.deviationPx) {
			this.cancel('scrolled');
			return { kind: 'cancel', reason: 'scrolled' };
		}
		const elapsed = now - this.#start;
		if (this.#phase === 'veil') {
			if (elapsed >= this.#timing.minVeilMs && (this.#ready || elapsed >= this.#timing.veilCapMs)) {
				this.#phase = 'lift';
				this.#liftStart = now;
				return { kind: 'lift' };
			}
			return { kind: 'idle' };
		}
		if (this.#phase === 'lift') {
			if (now - this.#liftStart >= this.#timing.liftMs + this.#timing.liftGraceMs) this.liftEnded(now);
			return { kind: 'idle' };
		}
		if (this.#phase === 'hold') {
			if (now - this.#holdStart >= this.#timing.holdMs) {
				this.#phase = 'scroll';
				this.#from = scrollY;
				this.#scrollStart = now;
			}
			return { kind: 'idle' };
		}
		const t = Math.min(1, (now - this.#scrollStart) / this.#timing.scrollMs);
		if (t >= 1) {
			this.#phase = 'done';
			this.#lastWritten = targetY;
			return { kind: 'done', y: targetY };
		}
		const y = this.#from + (targetY - this.#from) * easeInOutCubic(t);
		this.#lastWritten = y;
		return { kind: 'write', y };
	}
}
