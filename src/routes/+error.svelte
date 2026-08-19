<script lang="ts">
	import { page } from '$app/state';
	import NotFound from '$lib/components/NotFound.svelte';

	// Client-router errors only. A missing path requested from the server is
	// answered with the prerendered /404 body instead (src/routes/404), so this
	// covers a navigation that fails after the app has booted.
	//
	// The <title>, robots and canonical decisions are made once in +layout.svelte
	// for both surfaces; setting them here as well produced two conflicting
	// <title> and <meta name="robots"> elements in the same document.
</script>

<NotFound status={page.status} />
