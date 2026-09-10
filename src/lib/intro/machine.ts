// The home intro as a pure machine: veil, hold, scroll, done, cancelled. The
// DOM adapter (controller.ts) feeds it a clock, the page's scroll position
// and the target for the scroll; it answers with one command per frame. It
// knows nothing about elements, timers or storage, so it is tested in node.
// (Operator ruling 2026-09-10: once per browser session, home route only,
// any input cancels, focus is never moved.)

export const INTRO_PLAYED_KEY = 'intro-played';

export const INTRO_TIMING = {
	/** The veil's own keyframes end here; the grace covers a missing animationend. */
	veilMs: 1000,
	veilGraceMs: 200,
	/** Header and hero alone, at least this long. */
	holdMs: 500,
	/** How long the hold waits for the wiper's canvases past holdMs. */
	readyCapMs: 2500,
	scrollMs: 1600,
	/** A scroll position further than this from the last one written is someone else's. */
	deviationPx: 4,
} as const;

export type IntroTiming = typeof INTRO_TIMING;

export type IntroPhase = 'veil' | 'hold' | 'scroll' | 'done' | 'cancelled';

export type IntroCommand =
	| { readonly kind: 'idle' }
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
	played: boolean;
}

/** Mirrors the pre-paint check in app.html: motion allowed, home path, no fragment, not yet played. */
export function shouldArm(input: ArmInput): boolean {
	return !input.reduce && input.pathname === '/' && input.hash === '' && !input.played;
}

/** No canvas at all (the plain grid) counts as ready; a pending rung does not. */
export function wiperReady(tiers: readonly string[]): boolean {
	return tiers.every((tier) => tier !== 'pending');
}

export class IntroMachine {
	#phase: IntroPhase = 'veil';
	#reason = '';
	#ready = false;
	#holdStart = 0;
	#from = 0;
	#scrollStart = 0;
	#lastWritten: number;
	readonly #start: number;
	readonly #timing: IntroTiming;

	constructor(now: number, scrollY = 0, timing: IntroTiming = INTRO_TIMING) {
		this.#start = now;
		this.#lastWritten = scrollY;
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

	/** The veil's animation has ended (or the grace timer stands in for it). */
	veilEnded(now: number): void {
		if (this.#phase !== 'veil') return;
		this.#phase = 'hold';
		this.#holdStart = now;
	}

	markReady(): void {
		this.#ready = true;
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
		if (this.#phase === 'veil') {
			if (now - this.#start >= this.#timing.veilMs + this.#timing.veilGraceMs) this.veilEnded(now);
			return { kind: 'idle' };
		}
		if (this.#phase === 'hold') {
			const held = now - this.#holdStart;
			if (held >= this.#timing.holdMs && (this.#ready || held >= this.#timing.readyCapMs)) {
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
