<script lang="ts">
	import SourceLink from '$lib/components/SourceLink.svelte';

	// The club's agreements as the compiled documents themselves (operator
	// ruling 2026-09-19): each PDF is built from its LaTeX source in the
	// private meta repository by the tectonic pipeline, published as a public
	// release, and fetched into this build by pinned URL and sha256
	// (MODULE.bazel) under /agreements/, away from this route's own output
	// directory. No status line: the document carries its own date.
	const documents = [
		{
			id: 'member-agreement',
			title: 'Member Agreement, Version 1',
			file: '/agreements/member-agreement-v1.pdf',
			label: 'Member Agreement v1',
		},
		{
			id: 'code-of-conduct',
			title: 'Code of Conduct',
			file: '/agreements/code-of-conduct.pdf',
			label: 'Code of Conduct',
		},
	] as const;
</script>

<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li aria-current="page">Legal</li>
		</ol>
	</nav>

	<article class="log-entry">
		<header class="log-entry__header">
			<h1>Legal</h1>
			<p>The club's agreements, as the documents themselves. Each one opens inline and downloads as a PDF.</p>
		</header>

		<div class="log-entry__body">
			{#each documents as doc (doc.id)}
				<section id={doc.id} aria-labelledby={`${doc.id}-title`}>
					<h2 id={`${doc.id}-title`}>{doc.title}</h2>
					<object data={doc.file} type="application/pdf" class="pdf-embed" aria-label={doc.title}>
						<p>Your browser does not show PDFs inline. <a href={doc.file}>Open the {doc.label} (PDF)</a>.</p>
					</object>
					<p class="pdf-print-link"><a href={doc.file}>{doc.label} (PDF)</a></p>
					<p><a href={doc.file} download>Download the {doc.label}</a></p>
				</section>
			{/each}
			<p>
				Questions about either document go through the <a href="/contact">contact page</a>. Privacy has its own
				<a href="/privacy">page</a>.
			</p>
		</div>
	</article>

	<SourceLink routeId="/legal" />
</div>
