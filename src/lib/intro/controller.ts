// The home intro's DOM adapter. Mounted on the veil element once the page has
// hydrated; everything it registers hangs off one AbortController. It never
// registers a scroll listener (it reads scrollY inside its own frames), never
// moves focus, never prevents or stops an event, and never writes a
// console line. Any input, a hidden tab, or a scroll that is not its own
// ends it and leaves the page where it is.
import { IntroMachine, wiperReady } from './machine';

export type IntroState = 'veil' | 'lift' | 'hold' | 'scroll' | 'done' | 'cancelled' | 'skipped';

export interface IntroHandle {
	cancel(reason: string): void;
	destroy(): void;
}

export interface IntroOptions {
	publish?: (state: IntroState) => void;
}

/** The class app.html sets before first paint; the stylesheet paints the veil only under it. */
export const INTRO_ARMED_CLASS = 'intro-armed';
/** Set once the controller owns the veil: the stylesheet holds it steady instead of timing it out. */
export const INTRO_LIVE_CLASS = 'intro-live';
/** Runs the lift keyframes on the veil and the mark's fade-out. */
export const INTRO_LIFTING_CLASS = 'intro-lifting';
/**
 * Test and LOOK hook: the intro never arms while `<html data-intro-off>` is
 * present or `window.__gftbIntroOff` is set (the latter reaches the pre-paint
 * script, which runs before the root element can carry an attribute). No URL
 * query, no storage.
 */
export const INTRO_OFF_ATTR = 'data-intro-off';
export const INTRO_OFF_GLOBAL = '__gftbIntroOff';

const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

const INERT: IntroHandle = { cancel() {}, destroy() {} };

export function mountHomeIntro(overlay: HTMLElement, options: IntroOptions = {}): IntroHandle {
	const root = document.documentElement;
	const publish = (state: IntroState) => options.publish?.(state);
	const disarm = () => root.classList.remove(INTRO_ARMED_CLASS, INTRO_LIVE_CLASS, INTRO_LIFTING_CLASS);
	const skip = (): IntroHandle => {
		disarm();
		publish('skipped');
		return INERT;
	};

	// Not armed before paint (motion, path, fragment, the hook), or disarmed
	// by input before the bundle mounted, or by the fail-open timer.
	if (!root.classList.contains(INTRO_ARMED_CLASS)) return skip();
	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const off =
		root.hasAttribute(INTRO_OFF_ATTR) || (window as unknown as Record<string, unknown>)[INTRO_OFF_GLOBAL] === true;
	if (reduce || location.hash !== '' || off) return skip();
	const goals = document.getElementById('goals');
	if (!goals) return skip();

	// The controller owns the veil from here: steady until it lifts. A reload
	// has its old scroll position restored beneath the veil by now; the page
	// goes back to the top once, and from here any scroll that is not the
	// intro's own ends it.
	root.classList.add(INTRO_LIVE_CLASS);
	window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
	const machine = new IntroMachine(performance.now());
	const controller = new AbortController();
	const { signal } = controller;
	let raf = 0;
	let published: IntroState = 'veil';
	publish('veil');

	const finish = (state: IntroState) => {
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		controller.abort();
		disarm();
		if (published !== state) {
			published = state;
			publish(state);
		}
	};
	const cancel = (reason: string) => {
		if (machine.terminal) return;
		machine.cancel(reason);
		finish('cancelled');
	};

	for (const type of CANCEL_EVENTS) {
		window.addEventListener(type, () => cancel('input'), { capture: true, passive: true, signal });
	}
	document.addEventListener(
		'visibilitychange',
		() => {
			if (document.hidden) cancel('hidden');
		},
		{ signal },
	);
	overlay.addEventListener(
		'animationend',
		(event) => {
			if (event.animationName === 'intro-lift') machine.liftEnded(performance.now());
		},
		{ signal },
	);

	const tiers = () =>
		[...goals.querySelectorAll<HTMLElement>('canvas[data-tier]')].map((canvas) => canvas.dataset.tier ?? '');
	// Where the goals land: the same place an anchor jump puts them, under the
	// sticky header by their scroll margin, never past the page's end. Read
	// through the offset chain, which ignores transforms: the section is still
	// carrying its reveal translate while the tween measures it.
	const documentTop = (element: HTMLElement) => {
		let top = 0;
		for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
			top += node.offsetTop;
		}
		return top;
	};
	const targetFor = () => {
		const margin = Number.parseFloat(getComputedStyle(goals).scrollMarginTop) || 0;
		const top = documentTop(goals) - margin;
		const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
		return Math.max(0, Math.min(top, max));
	};

	const frame = (now: number) => {
		raf = 0;
		if (machine.terminal) return;
		// The wiper stack: its canvases mount with the page and report a rung
		// once the renderer, the blob field and the first paint are in.
		if (!machine.ready && wiperReady(tiers())) machine.markReady();
		const command = machine.step(now, window.scrollY, targetFor());
		switch (command.kind) {
			case 'lift':
				root.classList.add(INTRO_LIFTING_CLASS);
				break;
			case 'write':
			case 'done':
				window.scrollTo({ top: command.y, left: 0, behavior: 'instant' });
				break;
			default:
				break;
		}
		if (command.kind === 'done') {
			finish('done');
			return;
		}
		if (command.kind === 'cancel') {
			finish('cancelled');
			return;
		}
		if (machine.phase !== published && !machine.terminal) {
			published = machine.phase;
			publish(machine.phase);
		}
		raf = requestAnimationFrame(frame);
	};
	raf = requestAnimationFrame(frame);

	return {
		cancel,
		destroy() {
			cancel('unmount');
		},
	};
}
