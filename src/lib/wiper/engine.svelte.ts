// WiperMachine exposes coarse state through $state. Each frame writes one inherited CSS
// property on the pane to avoid reactive updates at 60 Hz. One AbortSignal owns the listeners.
import {
	armsOver,
	bladePoseAt,
	deriveGeometry,
	leftToRight,
	maskVarsFor,
	sweepSpanDeg,
	trainFor,
	type ArmSpec,
	type BladePose,
	type WiperGeometry,
} from './geometry';
import { WiperMachine, type StrokeSample, type WiperMachineOptions, type WiperView } from './machine';
import type { RendererTier } from './renderer/types';
import { pageOf, strokeEase, strokeEaseInverse, type WiperDetent } from './schedule';

/** The machine's stroke sample resolved for a frame: held, paused, and the eased unit the mask carries. */
export interface StrokeClock extends StrokeSample {
	unit: number;
	held: boolean;
	paused: boolean;
}

export interface WiperEngineOptions extends WiperMachineOptions {
	now?: () => number;
}

/**
 * <html data-wiper-freeze="0.5"> holds an out-stroke at that unit. The value rest pauses the
 * dwell while beads and frost accumulate.
 */
const FREEZE_ATTR = 'wiperFreeze';
const REST_HOLD = 'rest';
/** Smallest unit change worth a style write. */
const UNIT_EPSILON = 0.002;

export class WiperEngine {
	readonly machine: WiperMachine;
	view = $state<WiperView>() as WiperView;
	tier = $state<RendererTier>('none');

	#pane: HTMLElement | null = null;
	#raf = 0;
	#lastUnit = -1;
	#geometry: WiperGeometry | null = null;
	#resize: ResizeObserver | null = null;
	#intersection: IntersectionObserver | null = null;
	#controller = new AbortController();
	#now: () => number;

	constructor(options: WiperEngineOptions) {
		this.machine = new WiperMachine(options);
		this.#now = options.now ?? (() => performance.now());
		this.view = this.machine.view();
	}

	get signal(): AbortSignal {
		return this.#controller.signal;
	}
	get geometry(): WiperGeometry | null {
		return this.#geometry;
	}

	/** Bind the pane once it exists; safe to call again with the same element. */
	attach(pane: HTMLElement): void {
		if (this.#pane === pane || this.#controller.signal.aborted) return;
		this.#pane = pane;
		if (typeof ResizeObserver !== 'undefined') {
			this.#resize = new ResizeObserver(() => this.relayout());
			this.#resize.observe(pane);
		}
		if (typeof IntersectionObserver !== 'undefined') {
			this.#intersection = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) this.setOffscreen(!entry.isIntersecting);
				},
				{ rootMargin: '10%' },
			);
			this.#intersection.observe(pane);
		}
		document.addEventListener('visibilitychange', () => this.setHidden(document.hidden), { signal: this.signal });
		this.setHidden(document.hidden);
		this.relayout();
		this.#arm();
	}

	/** Re-derive the geometry and every item's static mask variables. */
	relayout(): void {
		const pane = this.#pane;
		if (!pane) return;
		// Measure the list so the hub hangs below the notes.
		const glass = pane.querySelector<HTMLElement>('.goal-list') ?? pane;
		// Layout reads first, all of them, then the writes. offsetLeft and
		// offsetTop ignore transforms (a resize landing mid-stroke must not bake
		// that frame's shove into the mask pivot) and are glass-local already:
		// the list is the positioned ancestor.
		const box = { width: glass.clientWidth, height: glass.clientHeight };
		if (box.width <= 0 || box.height <= 0) return;
		const items = [...glass.querySelectorAll<HTMLElement>(':scope > li')].map((item) => ({
			item,
			left: item.offsetLeft,
			top: item.offsetTop,
			width: item.offsetWidth,
			height: item.offsetHeight,
		}));
		const geometry = deriveGeometry(box);
		this.#geometry = geometry;
		pane.style.setProperty('--wipe-feather', `${geometry.featherDeg}deg`);
		for (const entry of items) {
			const { item } = entry;
			const [owner, second] = armsOver(geometry, entry);
			if (second) {
				// Each blade wipes the notes it crosses. Clip the right mask to its own disc so
				// its wedge cannot reveal the left column early.
				const [left, right] = leftToRight([owner, second]);
				this.#writeArmVars(item, left, entry, '');
				this.#writeArmVars(item, right, entry, '-2');
				item.style.setProperty('--wipe-len-2', `${Math.round(right.length * 100) / 100}px`);
				item.dataset.wipeArms = 'both';
			} else {
				this.#writeArmVars(item, owner, entry, '');
				for (const name of ['--wipe-from-2', '--wipe-x-2', '--wipe-y-2', '--wipe-span-2', '--wipe-len-2'])
					item.style.removeProperty(name);
				delete item.dataset.wipeArms;
			}
		}
		// Use the first blade contact for the whole row so notes move together.
		const pageSize = this.machine.pageSize;
		const pages: (typeof items)[] = [];
		items.forEach((entry, index) => {
			(pages[pageOf(index, pageSize)] ??= []).push(entry);
		});
		for (const entries of pages) {
			if (!entries) continue;
			const train = trainFor(geometry, entries);
			for (const { item } of entries)
				for (const [name, value] of Object.entries(train)) item.style.setProperty(name, value);
		}
		this.refresh();
	}

	#writeArmVars(item: HTMLElement, arm: ArmSpec, at: { left: number; top: number }, suffix: '' | '-2'): void {
		const vars = maskVarsFor(arm, at, { left: 0, top: 0 });
		for (const [name, value] of Object.entries(vars)) item.style.setProperty(`${name}${suffix}`, value);
		item.style.setProperty(`--wipe-span${suffix}`, `${Math.round(sweepSpanDeg(arm) * 100) / 100}deg`);
	}

	/**
	 * Sample the blades and mask on the same frame timestamp. Both use the same easing and
	 * honor data-wiper-freeze.
	 */
	blades(now: number): BladePose[] {
		const geometry = this.#geometry;
		if (!geometry) return [];
		const clock = this.strokeClock(now);
		return geometry.arms.map((arm) => bladePoseAt(arm, geometry.box, clock.phase, clock.unit, clock.t));
	}

	/**
	 * The stroke as this frame sees it. A hold (data-wiper-freeze) pins the
	 * out-stroke at the attribute's unit; otherwise the raw progress comes
	 * from the machine clock and the unit through the mask's own easing.
	 */
	strokeClock(now: number): StrokeClock {
		const sample = this.machine.strokeSample(now);
		const frozen = document.documentElement.dataset[FREEZE_ATTR];
		const held = frozen !== undefined && frozen !== REST_HOLD && sample.phase === 'out';
		const heldUnit = held ? Math.min(Math.max(Number.parseFloat(frozen) || 0, 0), 1) : 0;
		const t = held ? strokeEaseInverse(heldUnit) : sample.t;
		const unit = sample.phase === 'dwell' ? 0 : held ? heldUnit : strokeEase(t);
		return { ...sample, t, unit, held, paused: this.machine.paused };
	}

	/** Re-read the machine after an external input changed (page size, motion preference). */
	refresh(): void {
		this.#sync();
		this.#arm();
	}

	setDetent(next: WiperDetent): void {
		this.machine.setDetent(next, this.#now());
		this.#writeUnit(0);
		this.refresh();
	}

	reveal(index: number): void {
		this.machine.reveal(index, this.#now());
		this.#writeUnit(0);
		this.refresh();
	}

	setHover(value: boolean): void {
		if (this.machine.hover === value) return;
		this.machine.hover = value;
		this.refresh();
	}
	setFocus(value: boolean): void {
		if (this.machine.focus === value) return;
		this.machine.focus = value;
		this.refresh();
	}
	setHidden(value: boolean): void {
		if (this.machine.hidden === value) return;
		this.machine.hidden = value;
		this.refresh();
	}
	setOffscreen(value: boolean): void {
		if (this.machine.offscreen === value) return;
		this.machine.offscreen = value;
		this.refresh();
	}

	destroy(): void {
		if (this.#raf) cancelAnimationFrame(this.#raf);
		this.#raf = 0;
		this.#resize?.disconnect();
		this.#intersection?.disconnect();
		this.#controller.abort();
		this.#pane = null;
	}

	#arm(): void {
		if (this.#raf || !this.#pane || this.#controller.signal.aborted) return;
		if (!this.machine.needsFrames) return;
		this.machine.resume(this.#now());
		this.#raf = requestAnimationFrame(this.#frame);
	}

	#frame = (now: number): void => {
		this.#raf = 0;
		if (this.#controller.signal.aborted) return;
		const frozen = document.documentElement.dataset[FREEZE_ATTR];
		if (frozen === REST_HOLD && this.machine.phase === 'dwell') {
			// A rest held open: the dwell does not count down, frames keep coming.
			this.machine.resume(now);
			this.#raf = requestAnimationFrame(this.#frame);
			return;
		}
		if (frozen !== undefined && frozen !== REST_HOLD && this.machine.phase === 'out') {
			// Resume the stroke at the held angle when the attribute clears.
			const unit = Math.min(Math.max(Number.parseFloat(frozen) || 0, 0), 1);
			this.#writeUnit(this.machine.holdStrokeAt(unit, now));
			this.#raf = requestAnimationFrame(this.#frame);
			return;
		}
		const result = this.machine.tick(now);
		if (result.unit !== null) this.#writeUnit(result.unit);
		if (result.apex || result.finish) this.#writeUnit(0);
		if (result.view) this.#sync();
		if (this.machine.needsFrames) this.#raf = requestAnimationFrame(this.#frame);
	};

	#writeUnit(unit: number): void {
		if (unit === this.#lastUnit) return;
		if (unit !== 0 && unit !== 1 && Math.abs(unit - this.#lastUnit) < UNIT_EPSILON) return;
		this.#lastUnit = unit;
		this.#pane?.style.setProperty('--wipe-u', unit.toFixed(4));
	}

	#sync(): void {
		this.view = this.machine.view();
	}
}
