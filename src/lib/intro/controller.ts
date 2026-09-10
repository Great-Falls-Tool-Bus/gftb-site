// The home intro's DOM adapter. Mounted on the veil element once the page has
// hydrated; everything it registers hangs off one AbortController. It never
// registers a scroll listener (it reads scrollY inside its own frames), never
// moves focus, never prevents or stops an event, and never writes a
// console line. Any input, a hidden tab, or a scroll that is not its own ends it
// and leaves the page where it is.
import { INTRO_PLAYED_KEY, INTRO_TIMING, IntroMachine, wiperReady } from './machine';

export type IntroState = 'veil' | 'hold' | 'scroll' | 'done' | 'cancelled' | 'skipped';

export interface IntroHandle {
	cancel(reason: string): void;
	destroy(): void;
}

export interface IntroOptions {
	publish?: (state: IntroState) => void;
}

/** The class app.html sets before first paint; the stylesheet paints the veil only under it. */
export const INTRO_ARMED_CLASS = 'intro-armed';

const CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

const INERT: IntroHandle = { cancel() {}, destroy() {} };

export function mountHomeIntro(overlay: HTMLElement, options: IntroOptions = {}): IntroHandle {
	const root = document.documentElement;
	const publish = (state: IntroState) => options.publish?.(state);
	const disarm = () => root.classList.remove(INTRO_ARMED_CLASS);
	const skip = (): IntroHandle => {
		disarm();
		publish('skipped');
		return INERT;
	};

	// Not armed before paint (motion, path, fragment, storage), or disarmed by
	// input before the bundle mounted, or by the fail-open timer: nothing to do.
	if (!root.classList.contains(INTRO_ARMED_CLASS)) return skip();
	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (reduce || location.hash !== '' || Math.abs(window.scrollY) > INTRO_TIMING.deviationPx) return skip();
	const goals = document.getElementById('goals');
	if (!goals) return skip();
	try {
		// Recorded at the start so a reload mid-intro does not replay it.
		sessionStorage.setItem(INTRO_PLAYED_KEY, '1');
	} catch {
		return skip();
	}

	const machine = new IntroMachine(performance.now(), window.scrollY);
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
			if (event.animationName === 'intro-veil') machine.veilEnded(performance.now());
		},
		{ signal },
	);

	const tiers = () =>
		[...goals.querySelectorAll<HTMLElement>('canvas[data-tier]')].map((canvas) => canvas.dataset.tier ?? '');
	// Where the goals land: the same place an anchor jump puts them, under the
	// sticky header by their scroll margin, never past the page's end.
	const targetFor = () => {
		const margin = Number.parseFloat(getComputedStyle(goals).scrollMarginTop) || 0;
		const top = window.scrollY + goals.getBoundingClientRect().top - margin;
		const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
		return Math.max(0, Math.min(top, max));
	};

	const frame = (now: number) => {
		raf = 0;
		if (machine.terminal) return;
		// The wiper's canvases mount with the page; only the hold consults them.
		if (machine.phase === 'hold' && !machine.ready && wiperReady(tiers())) machine.markReady();
		const command = machine.step(now, window.scrollY, targetFor());
		if (command.kind === 'write' || command.kind === 'done') {
			window.scrollTo({ top: command.y, left: 0, behavior: 'instant' });
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
