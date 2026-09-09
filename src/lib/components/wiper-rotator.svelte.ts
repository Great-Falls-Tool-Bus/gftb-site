// The wiper rotator's cycle state (runes class; see WiperRotator.svelte for
// the DOM, the timers and the whole motion-honesty contract). No DOM here:
// the component owns the dwell timer and the animation events and calls the
// transitions below. Everything a template or test wants to know is a
// derived field, so the component never re-derives "is it running".
import {
	DEFAULT_WIPER_POSITION,
	wiperEntry,
	type ActiveWiperPosition,
	type WiperPosition,
	type WiperPositionEntry,
} from './wiper-rotator';

export type WiperPhase = 'dwell' | 'wiping';
export type WiperStroke = 'out' | 'back';

export class WiperCycle {
	// Declared (with inert defaults) before the derived fields below, which
	// read them lazily on first access; the constructor sets the real ones.
	#pageCount: () => number = () => 1;
	#motionOk: () => boolean = () => false;
	#lastActive: ActiveWiperPosition = DEFAULT_WIPER_POSITION;

	/** The stalk detent: the single source of truth for on/off and speed. */
	position = $state<WiperPosition>(DEFAULT_WIPER_POSITION);
	phase = $state<WiperPhase>('dwell');
	/** Which stroke of the current wipe is running: out over the old page, back over the new. */
	stroke = $state<WiperStroke>('out');
	/** Requested page; `currentPage` clamps it when the page size shrinks it away. */
	page = $state(0);
	hover = $state(false);
	focus = $state(false);
	hidden = $state(false);
	/**
	 * Sweep length captured when a wipe starts, so a speed change mid-sweep
	 * cannot re-time an animation that is already running.
	 */
	activeSweepMs: number = $state(0);
	/**
	 * Dwell time still owed when a pause interrupted the dwell timer, or null
	 * for a fresh full dwell. The CSS instruments (gauge, rain, LCD) freeze in
	 * place under a pause and resume from there; the JS timer must resume
	 * from the same remaining time or the two clocks drift apart.
	 */
	dwellRemainingMs: number | null = $state(null);

	constructor(pageCount: () => number, motionOk: () => boolean, initial: WiperPosition = DEFAULT_WIPER_POSITION) {
		this.#pageCount = pageCount;
		this.#motionOk = motionOk;
		this.position = initial;
		if (initial !== 'off') this.#lastActive = initial;
	}

	entry: WiperPositionEntry = $derived(wiperEntry(this.position));
	enabled: boolean = $derived(this.position !== 'off');
	dwellMs: number = $derived(this.entry.dwellMs);
	/** Courtesy pauses only; none of them changes the stalk. */
	paused: boolean = $derived(this.hover || this.focus || this.hidden);
	pageCount: number = $derived(Math.max(this.#pageCount(), 1));
	currentPage: number = $derived(Math.min(this.page, this.pageCount - 1));
	/** Rotation is offered at all: motion allowed and more than one page. */
	rotatable: boolean = $derived(this.#motionOk() && this.pageCount > 1);
	running: boolean = $derived(this.rotatable && this.enabled && !this.paused);

	setPosition(next: WiperPosition): void {
		const changed = next !== this.position;
		if (next !== 'off') this.#lastActive = next;
		// Off is immediate: the grid comes back at once, so any sweep in
		// flight is abandoned rather than finished over a list that no
		// longer pages.
		if (next === 'off') this.phase = 'dwell';
		this.position = next;
		this.dwellRemainingMs = null;
		// A speed change wipes at once (even under the pointer resting on the
		// stalk): immediate feedback, and every clock (timer, gauge, rain, LCD)
		// restarts together on the new dwell instead of carrying an old
		// fraction into it.
		if (changed && next !== 'off' && this.phase === 'dwell') this.startWipe(true);
	}

	/** The switch: Off <-> the last non-off detent. */
	toggle(): void {
		this.setPosition(this.enabled ? 'off' : this.#lastActive);
	}

	/** Focus-follow: show the page holding `index` at once, with no wipe. */
	reveal(index: number, pageSize: number): void {
		// Abandon the sweep before selecting the focused page. Calling finish()
		// would advance an outbound wipe; late sweep events must instead be inert.
		this.dwellRemainingMs = null;
		this.phase = 'dwell';
		this.activeSweepMs = 0;
		this.page = Math.floor(index / Math.max(pageSize, 1));
	}

	/** `force` lets a detent change wipe while the pane is paused; Off and reduce still refuse. */
	startWipe(force = false): void {
		if (this.phase !== 'dwell') return;
		if (force ? !(this.rotatable && this.enabled) : !this.running) return;
		this.dwellRemainingMs = null;
		this.activeSweepMs = this.entry.sweepMs;
		this.stroke = 'out';
		this.phase = 'wiping';
	}

	/** The blades' turnaround: the moment the next page appears beneath them. */
	apex(): void {
		if (this.phase !== 'wiping') return;
		this.page = (this.currentPage + 1) % this.pageCount;
		this.stroke = 'back';
	}

	/**
	 * End of the wipe. If the turnaround never reported (a throttled tab can
	 * deliver animationend late or drop animationiteration entirely), turn
	 * the page here: every wipe shows the next page, events or not.
	 */
	finish(): void {
		this.dwellRemainingMs = null;
		if (this.phase === 'wiping' && this.stroke === 'out') this.apex();
		this.phase = 'dwell';
	}
}
