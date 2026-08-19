<script lang="ts">
	// The one body for both error surfaces: the prerendered /404 route, whose
	// output Caddy serves for any missing path, and +error.svelte, which the
	// client router renders for a navigation that fails after boot. Sharing it
	// is what stops the two from drifting into different copy.
	//
	// Only the status code is echoed. The framework's error text can carry an
	// internal path or handler detail, and this page is public, so it is never
	// printed here — the leak scan is a backstop for that rule, not the rule.
	interface Props {
		status?: number;
	}

	let { status = 404 }: Props = $props();

	const heading = $derived(status === 404 ? 'That page is not here.' : 'Something went wrong.');
	const detail = $derived(
		status === 404
			? 'The Great Falls Tool Bus site is a single public page, so most addresses below it never existed. The front page carries the current status, the public log, and the contact form.'
			: 'The page could not be shown. The front page carries the current status, the public log, and the contact form.',
	);
</script>

<div class="page-shell">
	<section class="section" aria-labelledby="error-title">
		<p class="eyebrow">Error {status}</p>
		<h1 id="error-title">{heading}</h1>
		<p class="lede">{detail}</p>
		<div class="button-row">
			<a class="button" href="/">Back to the front page</a>
		</div>
	</section>
</div>
