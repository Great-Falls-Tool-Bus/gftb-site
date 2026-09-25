<script lang="ts">
	// The toolbox-bus glyph from static/favicon.svg on currentColor: the same
	// mark as the browser tab, drawn in whatever role the parent sets (the
	// footer, forced colours, anything too small for the colour mark).
	// Decorative and unfocusable; a unit pin keeps the body path equal to the
	// favicon's, and the body path comes first for that pin.
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg class={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="currentColor">
	<path
		fill-rule="evenodd"
		d="M8 28h48v20h-3a7 7 0 0 1-14 0H25a7 7 0 0 1-14 0H8zM12 32h9v8h-9zM24 32h9v8h-9zM36 32h9v8h-9zM48 32h5v8h-5z"
	/>
	<path
		d="M8 24q0-6 6-6h36q6 0 6 6v4H8z M20 18a12 12 0 0 1 24 0h-4a8 8 0 0 0-16 0z M18 43a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM46 43a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"
	/>
</svg>
