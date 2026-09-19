<script lang="ts">
	// The colour brand mark (operator ruling 2026-09-19): the full three-quarter
	// toolbox-bus for the home intro and the OG image, or the side-profile
	// glyph for the header. Same paths as static/brand/*.svg; the colours are
	// the --tb-* variables and the .tb-mark fill rules in app.css (keyed on
	// [data-mode]), so the inline mark follows the site's mode switch where a
	// file's media query could not. Fills live in CSS, never in attributes.
	// Decorative and unfocusable; the parent carries any accessible name.
	let { variant = 'glyph', class: className = '' }: { variant?: 'full' | 'glyph'; class?: string } = $props();
</script>

{#if variant === 'full'}
	<svg class="tb-mark {className}" viewBox="0 0 240 136" aria-hidden="true" focusable="false">
		<path class="lid" d="M14,58.0 C14,40.0 20,32.0 34,31.0 L146,23.0 L146,43.0 L22,56.0 Z" />
		<path class="handle" d="M60,32 C60,2 124,2 124,32 L114,32 C114,12 70,12 70,32 Z" />
		<path class="dome" d="M138,43.0 C138,8.0 208,13.0 208,48.0 Z" />
		<path class="body" d="M22.0,54.0 L138.0,42.0 L138.0,124.0 L22.0,110.0Z" />
		<path
			class="windows"
			d="M27.0,59.5 L66.0,55.4 L66.0,87.4 L27.0,91.5Z M72.0,54.8 L102.0,51.7 L102.0,83.7 L72.0,86.8Z M108.0,51.1 L118.0,50.1 L118.0,82.1 L108.0,83.1Z M123.0,49.6 L134.0,48.4 L134.0,80.4 L123.0,81.6Z"
		/>
		<path class="front" d="M138.0,42.0 L208.0,47.0 L208.0,119.0 L138.0,124.0Z" />
		<path class="glass" d="M142.0,48.3 L206.0,52.9 L206.0,96.9 L142.0,92.3Z" />
		<path class="band" d="M138.0,99.0 L208.0,104.0 L208.0,118.0 L138.0,113.0Z" />
		<path
			class="lamps"
			d="M142.0,103.3 L151.0,103.9 L151.0,110.9 L142.0,110.3Z M195.0,107.1 L205.0,107.8 L205.0,114.8 L195.0,114.1Z"
		/>
		<ellipse class="wheel" cx="50" cy="111.4" rx="11" ry="13" />
		<ellipse class="wheel" cx="100" cy="117.4" rx="11" ry="13" />
	</svg>
{:else}
	<svg class="tb-mark {className}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
		<path
			class="body"
			fill-rule="evenodd"
			d="M8 28h48v20h-3a7 7 0 0 1-14 0H25a7 7 0 0 1-14 0H8zM12 32h9v8h-9zM24 32h9v8h-9zM36 32h9v8h-9zM48 32h5v8h-5z"
		/>
		<path class="band" d="M8 43h48v2H8z" />
		<path class="lid" d="M8 24q0-6 6-6h36q6 0 6 6v4H8z" />
		<path class="handle" d="M20 18a12 12 0 0 1 24 0h-4a8 8 0 0 0-16 0z" />
		<path class="wheels" d="M18 43a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM46 43a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
	</svg>
{/if}
