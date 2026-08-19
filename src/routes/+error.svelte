<script lang="ts">
	import { page } from '$app/state';

	// Only the status code is echoed. The framework's error text can carry an
	// internal path or handler detail, and this page is public, so it is never
	// printed here — the leak scan is a backstop for that rule, not the rule.
	const status = $derived(page.status);
	const heading = $derived(status === 404 ? 'That page is not here.' : 'Something went wrong.');
	const detail = $derived(
		status === 404
			? 'The Great Falls Tool Bus site is a single public page, so most addresses below it never existed. The front page carries the current status, the public log, and the contact form.'
			: 'The page could not be shown. The front page carries the current status, the public log, and the contact form.',
	);
</script>

<svelte:head>
	<title>{status} · Great Falls Tool Bus</title>
	<meta name="robots" content="noindex" />
</svelte:head>

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
