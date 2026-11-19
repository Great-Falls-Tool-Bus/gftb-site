import { browser } from '$app/env';

/**
 * The store follows the apex theme.svelte.ts at d381333 and 1a85567.
 * The inline script in src/app.html reads the same color-mode and skeleton-theme keys.
 * System mode removes the color-mode override and follows changes to the OS setting.
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
