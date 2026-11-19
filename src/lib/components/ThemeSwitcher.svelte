<script lang="ts">
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import { theme } from '#lib/theme.svelte.js';

	// D01+D02 adapt the demo ThemeSwitcher to the v5 Switch anatomy. Reflect theme.isDark so
	// `system` follows the OS until the visitor picks an explicit mode. Keep the inline
	// glyphs decorative. The .mode-switch rules in src/app.css provide role colours and
	// enable the crossfade only under prefers-reduced-motion: no-preference.

	function onCheckedChange(details: { checked: boolean }) {
		theme.setMode(details.checked ? 'dark' : 'light');
	}
</script>

<Switch
	class="mode-switch"
	checked={theme.isDark}
	{onCheckedChange}
	title={theme.mode === 'system' ? 'Auto (matches your system)' : theme.isDark ? 'Dark mode' : 'Light mode'}
>
	<Switch.HiddenInput aria-label="Dark mode" />
	<Switch.Context>
		{#snippet children(switch_)}
			<Switch.Control class="mode-switch__control">
				<Switch.Thumb class="mode-switch__thumb">
					<svg
						class="mode-switch__glyph mode-switch__glyph--sun"
						class:mode-switch__glyph--active={!switch_().checked}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="4" />
						<path
							d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"
						/>
					</svg>
					<svg
						class="mode-switch__glyph mode-switch__glyph--moon"
						class:mode-switch__glyph--active={switch_().checked}
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path d="M21 13.2A8.6 8.6 0 0 1 10.8 3a8.6 8.6 0 1 0 10.2 10.2Z" />
					</svg>
				</Switch.Thumb>
			</Switch.Control>
		{/snippet}
	</Switch.Context>
</Switch>
