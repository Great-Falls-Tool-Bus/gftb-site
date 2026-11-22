// The one shared load of the gated manifest. Every <GatedSlot> reads from here;
// the first slot to mount starts the single fetch. Browser only: nothing here
// runs during prerender, so the prerendered HTML carries no gated item.
import { TAILNET_PROBE_URL, checkTailnet, resolveSurface, type SurfaceItem, type SurfaceSlot } from './manifest';

/** Where the footer button's check stands. */
export type TailnetState = 'idle' | 'checking' | 'yes' | 'yes-empty' | 'no';

class GatedSurface {
	items = $state<SurfaceItem[]>([]);
	tailnet = $state<TailnetState>('idle');
	/** Show the button only when the build supplied a probe URL. */
	readonly canAskTailnet = TAILNET_PROBE_URL !== '';
	/** True once the browser has loaded the surface (never during prerender). */
	ready = $state(false);
	/** Whether the footer button's modal is open. */
	promptOpen = $state(false);
	#started = false;

	/** The footer button shows in the browser, with a stamped probe URL, while no member links are showing. */
	get showTailnetButton(): boolean {
		return this.ready && this.canAskTailnet && this.items.length === 0;
	}

	forSlot(slot: SurfaceSlot): SurfaceItem[] {
		return this.items.filter((item) => item.slot === slot);
	}

	/** Reuse the page’s first request and handle errors locally. */
	load(): void {
		if (this.#started || typeof window === 'undefined') return;
		this.#started = true;
		this.ready = true;
		// An interrupted navigation gives no probe result to cache.
		let leaving = false;
		const leave = () => {
			leaving = true;
		};
		window.addEventListener('beforeunload', leave);
		window.addEventListener('pagehide', leave);
		void resolveSurface({
			search: window.location.search,
			getStorage: () => window.localStorage,
			getSession: () => window.sessionStorage,
			canCache: () => !leaving,
			pageOrigin: window.location.origin,
			// Vite removes the fixture import when the build flag is off.
			loadFixture: __MEMBERSHIP_FIXTURE__ === true ? async () => (await import('./fixture')).FIXTURE_ITEMS : undefined,
		}).then(
			(items) => {
				// A tailnet yes that landed first is not overwritten by a slower load.
				if (this.tailnet !== 'yes') this.items = items;
			},
			() => {
				if (this.tailnet !== 'yes') this.items = [];
			},
		);
	}

	/**
	 * The footer button's check. Only ever called from the modal's own button,
	 * never on page load. `force` asks again instead of reusing this tab's answer.
	 */
	async askTailnet(force = false): Promise<void> {
		if (typeof window === 'undefined' || !this.canAskTailnet || this.tailnet === 'checking') return;
		this.tailnet = 'checking';
		try {
			const outcome = await checkTailnet({
				probeUrl: TAILNET_PROBE_URL,
				pageOrigin: window.location.origin,
				getSession: () => window.sessionStorage,
				force,
			});
			if (outcome.answer === 'yes') {
				this.tailnet = outcome.items.length > 0 ? 'yes' : 'yes-empty';
				if (outcome.items.length > 0) this.items = outcome.items;
			} else {
				this.tailnet = 'no';
			}
		} catch {
			this.tailnet = 'no';
		}
	}
}

export const gatedSurface = new GatedSurface();
