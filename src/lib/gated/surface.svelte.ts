// The one shared load of the gated manifest. Every <GatedSlot> reads from here;
// the first slot to mount starts the single fetch. Browser only: nothing here
// runs during prerender, so the prerendered HTML carries no gated item.
import { resolveSurface, type SurfaceItem, type SurfaceSlot } from './manifest';

class GatedSurface {
	items = $state<SurfaceItem[]>([]);
	#started = false;

	forSlot(slot: SurfaceSlot): SurfaceItem[] {
		return this.items.filter((item) => item.slot === slot);
	}

	/** Starts the load once per page load. Never throws. */
	load(): void {
		if (this.#started || typeof window === 'undefined') return;
		this.#started = true;
		void resolveSurface({
			search: window.location.search,
			getStorage: () => window.localStorage,
			getSession: () => window.sessionStorage,
			pageOrigin: window.location.origin,
			// The build flag is inlined by Vite, so this import is dead code (and
			// the fixture module is dropped) in any build without it.
			loadFixture: __MEMBERSHIP_FIXTURE__ === true ? async () => (await import('./fixture')).FIXTURE_ITEMS : undefined,
		}).then(
			(items) => {
				this.items = items;
			},
			() => {
				this.items = [];
			},
		);
	}
}

export const gatedSurface = new GatedSurface();
