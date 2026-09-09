// The runes adapter around WiperMachine: owns the pane element, the frame
// loop, the per-frame DOM write (one inherited custom property on the pane),
// the per-item mask geometry, and a reactive view for the template. Coarse
// state changes a few times per cycle and lives in $state; the 60 Hz channel
// never touches reactivity. Every listener hangs off one AbortSignal.
import {
	armsOver,
	bladePoseAt,
	deriveGeometry,
	maskVarsFor,
	sweepSpanDeg,
	type ArmSpec,
	type BladePose,
	type WiperGeometry,
} from './geometry';
import { WiperMachine, type StrokeSample, type WiperMachineOptions, type WiperView } from './machine';
import { strokeEase, strokeEaseInverse, type WiperDetent } from './schedule';

/** The machine's stroke sample resolved for a frame: held, paused, and the eased unit the mask carries. */
export interface StrokeClock extends StrokeSample {
	unit: number;
	held: boolean;
	paused: boolean;
}

export type RendererTier = 'webgpu' | 'webgl2' | 'none';

export interface SceneFrame {
	now: number;
	/** Raw progress inside the current stroke, 0..1. */
	strokeProgress: number;
	/** Eased out-stroke progress the mask uses, 0..1. */
	unit: number;
	view: WiperView;
	geometry: WiperGeometry | null;
}

export interface WiperEngineOptions extends WiperMachineOptions {
	/** Per-frame hook for a renderer (M2 onward). */
	onFrame?: (frame: SceneFrame) => void;
	now?: () => number;
}

/** Test and LOOK hook: `<html data-wiper-freeze="0.5">` holds the out-stroke at that unit. */
const FREEZE_ATTR = 'wiperFreeze';
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
	#onFrame: WiperEngineOptions['onFrame'];
	#now: () => number;

	constructor(options: WiperEngineOptions) {
		this.machine = new WiperMachine(options);
		this.#onFrame = options.onFrame;
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
		// The glass is the list, not the wrapper: the hub hangs below the notes,
		// never below the stalk or the collection link.
		const glass = pane.querySelector<HTMLElement>('.goal-list') ?? pane;
		const box = glass.getBoundingClientRect();
		if (box.width <= 0 || box.height <= 0) return;
		const geometry = deriveGeometry({ width: box.width, height: box.height });
		this.#geometry = geometry;
		pane.style.setProperty('--wipe-feather', `${geometry.featherDeg}deg`);
		for (const item of glass.querySelectorAll<HTMLElement>(':scope > li')) {
			const rect = item.getBoundingClientRect();
			const [owner, second] = armsOver(geometry, {
				left: rect.left - box.left,
				top: rect.top - box.top,
				width: rect.width,
				height: rect.height,
			});
			this.#writeArmVars(item, owner, rect, box, '');
			// The push (app.css --wipe-push) meets the blade at the note's mid-height.
			item.style.setProperty('--wipe-h', `${Math.round(rect.height * 100) / 100}px`);
			// A note both blades pass over is wiped by both, each where it
			// passes: a second set of variables and a composited second mask.
			if (second) {
				this.#writeArmVars(item, second, rect, box, '-2');
				item.dataset.wipeArms = 'both';
			} else {
				for (const name of ['--wipe-from-2', '--wipe-x-2', '--wipe-y-2', '--wipe-span-2'])
					item.style.removeProperty(name);
				delete item.dataset.wipeArms;
			}
		}
		this.refresh();
	}

	#writeArmVars(item: HTMLElement, arm: ArmSpec, rect: DOMRect, box: DOMRect, suffix: '' | '-2'): void {
		const vars = maskVarsFor(arm, rect, box);
		for (const [name, value] of Object.entries(vars)) item.style.setProperty(`${name}${suffix}`, value);
		item.style.setProperty(`--wipe-span${suffix}`, `${Math.round(sweepSpanDeg(arm) * 100) / 100}deg`);
	}

	/**
	 * The blades as they stand at `now` (the animation frame's own timestamp),
	 * for the scene to draw in the same frame the mask moves. Both read the
	 * machine's clock through the same easing, and a LOOK or test hold
	 * (data-wiper-freeze) pins both to the held unit, so the drawn blade and
	 * the mask edge cannot come apart.
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
		const held = frozen !== undefined && sample.phase === 'out';
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
		if (frozen !== undefined && this.machine.phase === 'out') {
			// Held for a test or a LOOK: the blade stays where the attribute says
			// and the stroke resumes from there once the hold lifts.
			const unit = Math.min(Math.max(Number.parseFloat(frozen) || 0, 0), 1);
			this.#writeUnit(this.machine.holdStrokeAt(unit, now));
			this.#raf = requestAnimationFrame(this.#frame);
			return;
		}
		const result = this.machine.tick(now);
		if (result.unit !== null) this.#writeUnit(result.unit);
		if (result.apex || result.finish) this.#writeUnit(0);
		if (result.view) this.#sync();
		this.#onFrame?.({
			now,
			strokeProgress: this.machine.strokeProgress(now),
			unit: this.machine.unit,
			view: this.view,
			geometry: this.#geometry,
		});
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
