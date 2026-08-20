import { browser } from '$app/environment';

/**
 * Theme store — the demo store shape, ported verbatim (D01/D02; demo #81
 * `d381333` / #109 `1a85567`, `theme.svelte.ts:12-84`).
 *
 * Single CityLink theme (`gftb`) on this carrier; multi-theme later. Color
 * mode (`light` | `dark` | `system`) is the user-tunable axis and is
 * persisted to localStorage under `color-mode`. Theme id is persisted under
 * `skeleton-theme` for forward compatibility with the canonical Skeleton
 * pattern (and matches the inline FOUC script in `src/app.html`).
 *
 * NOT the v5 cookbook's binary model: new visitors default to `system` (no
 * `|| 'dark'` fallback), `setMode('system')` REMOVES the storage key, and a
 * `matchMedia` change listener re-resolves while the visitor stays on
 * `system` — all three are the demo's shipped decisions.
 */
export type ColorMode = 'light' | 'dark' | 'system';

class ThemeStore {
	mode = $state<ColorMode>('system');
	currentTheme = $state<string>('gftb');
	isDark = $derived(
		this.mode === 'dark' ||
			(this.mode === 'system' && browser && window.matchMedia('(prefers-color-scheme: dark)').matches),
	);

	init() {
		if (!browser) return;

		const storedMode = localStorage.getItem('color-mode') as ColorMode | null;
		const storedTheme = localStorage.getItem('skeleton-theme');

		if (storedMode === 'light' || storedMode === 'dark') {
			this.mode = storedMode;
		} else {
			this.mode = 'system';
		}

		if (storedTheme) {
			this.currentTheme = storedTheme;
		}

		this.applyMode();
		this.applyTheme();

		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (this.mode === 'system') this.applyMode();
		});
	}

	setMode(mode: ColorMode) {
		this.mode = mode;
		if (browser) {
			if (mode === 'system') {
				localStorage.removeItem('color-mode');
			} else {
				localStorage.setItem('color-mode', mode);
			}
			this.applyMode();
		}
	}

	setTheme(themeId: string) {
		this.currentTheme = themeId;
		if (browser) {
			localStorage.setItem('skeleton-theme', themeId);
			this.applyTheme();
		}
	}

	private applyMode() {
		if (!browser) return;
		const resolved =
			this.mode === 'system'
				? window.matchMedia('(prefers-color-scheme: dark)').matches
					? 'dark'
					: 'light'
				: this.mode;
		document.documentElement.setAttribute('data-mode', resolved);
		document.documentElement.style.colorScheme = resolved;
	}

	private applyTheme() {
		if (!browser) return;
		document.documentElement.setAttribute('data-theme', this.currentTheme);
	}
}

export const theme = new ThemeStore();
