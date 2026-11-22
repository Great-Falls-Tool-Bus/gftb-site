<script lang="ts">
	// Caddy serves the prerendered /404 for missing paths. +error.svelte shares its body for
	// client navigation. Render only the status code because framework error text can expose
	// an internal path or handler detail.
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
		<p>Error {status}</p>
		<h1 id="error-title">{heading}</h1>
		<p class="lede">{detail}</p>
		<div class="button-row">
			<a class="button" href="/">Back to the front page</a>
		</div>
	</section>
</div>
