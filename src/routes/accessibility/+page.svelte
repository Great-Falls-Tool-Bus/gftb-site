<script lang="ts">
	import SourceLink from '#lib/components/SourceLink.svelte';

	// DRAFT skeleton: not for merge until lane O and lane K report. Each
	// TODO(TIN-5351) marks a fact that has no confirmed source yet.
</script>

<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li aria-current="page">Accessibility</li>
		</ol>
	</nav>

	<article class="log-entry">
		<header class="log-entry__header">
			<h1>Accessibility</h1>
			<p>How to use this site and the tool library if something in the way you work does not fit.</p>
		</header>

		<div class="log-entry__body">
			<h2>This site</h2>
			<p>
				[TODO(TIN-5351): the standard we test against, the date of the last check, and the known gaps. Do not claim a
				conformance level that no audit supports.]
			</p>

			<h2>Borrowing tools without a phone</h2>
			<p>
				Tool checkout uses a phone to scan a code. If you do not have a phone, or the scan does not work for you,
				[TODO(TIN-5351): the assisted-device alternative, worded as lane K confirms: what is offered, where, when, and
				whether a keyholder must be present].
			</p>

			<h2>Tell us about a barrier</h2>
			<p>
				Write to <a href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a> or use the
				<a href="/contact">contact form</a>. [TODO(TIN-5351): response time we can promise, if any.]
			</p>

			<p class="muted">Last reviewed: [TODO(TIN-5351): date of release].</p>
		</div>
	</article>

	<SourceLink routeId="/accessibility" />
</div>
