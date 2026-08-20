<script lang="ts">
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import { theme } from '$lib/theme.svelte';

	// Light/dark switcher (D01+D02) — the demo ThemeSwitcher's behaviour on
	// the v5 Switch anatomy (Control/Thumb/HiddenInput, with a
	// Switch.Context snippet driving the sun/moon crossfade). The switch
	// reflects the RESOLVED mode (theme.isDark), so it reads correctly
	// whether the visitor picked an explicit mode or is on `system`.
	// Flipping it always persists an explicit light/dark.
	//
	// New visitors default to `system` (store default), so the switch
	// follows the OS color scheme until the visitor flips it. This is a
	// single two-state toggle, not a menu.
	//
	// House constraints carried here rather than in the markup:
	// - no icon dependency (house-stack contract) — the glyphs are inline
	//   hand-authored <svg>, aria-hidden, decorative;
	// - every colour is a role (src/app.css .mode-switch rules), never a raw
	//   palette token;
	// - slide/crossfade transitions are declared only under
	//   prefers-reduced-motion: no-preference (src/app.css), so reduced
	//   motion collapses to an instant state change.

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
