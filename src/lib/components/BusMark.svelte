<script lang="ts">
	// The bus glyph from static/favicon.svg on currentColor: the same mark as
	// the browser tab, drawn in whatever role the parent sets. Decorative and
	// unfocusable; a unit pin keeps the path equal to the favicon's.
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg class={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="currentColor">
	<path
		d="M11 19h39l5 9v17h-5a7 7 0 0 1-14 0H27a7 7 0 0 1-14 0h-2V19Zm7 5v11h29l-3-11H18Zm2 17a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm23 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
	/>
</svg>
