<script lang="ts">
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import { INTEREST_PATH, JOIN_STEPS, MEMBER_INTAKE, applyLink, signInLink } from '$lib/membership';

	// How membership works, and the one place every Apply call to action
	// lands while applications are closed (src/lib/membership.ts). The member
	// app owns the application itself; this page only explains it and links
	// out. The steps and the contribution answer follow the ratified
	// membership rules: application, tour, keyholder approval, and a
	// contribution that is optional, separate, and may be $0.
	//
	// While the membership surface is behind its flag (operator rulings
	// 2026-10-03, src/lib/flags/membership-surface.ts) this page stays
	// prerendered and directly reachable but unlisted: the layout marks it
	// noindex, and it is left out of the sitemap and the source map (so it
	// carries no "Edit this page" link). Its own Apply and Sign in follow
	// the flag; the contact call to action stays public.
	const apply = applyLink();
	const signIn = signInLink();
</script>

<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li aria-current="page">Join</li>
		</ol>
	</nav>

	<article class="log-entry" aria-labelledby="join-title">
		<header class="log-entry__header">
			<h1 id="join-title">Join the Tool Bus</h1>
			<p>Members are adults 18 and older who apply, visit the bus, and are approved by a keyholder.</p>
		</header>

		<div class="log-entry__body">
			<section id="applications" aria-labelledby="applications-title">
				<h2 id="applications-title">Applications</h2>
				{#if MEMBER_INTAKE === 'open'}
					<p>Applications are open. The application form is on the member app.</p>
					<div class="join-actions membership-surface">
						<ExternalLink href={apply.href} class="button">{apply.label}</ExternalLink>
						<ExternalLink href={signIn.href} class="join-actions__sign-in">{signIn.label}</ExternalLink>
					</div>
				{:else}
					<p>
						Applications are not open yet. Until they are, send a keyholder a message and we will let you know when they
						open.
					</p>
					<div class="join-actions">
						<a class="button" href={INTEREST_PATH}>Tell us you're interested</a>
						<ExternalLink href={signIn.href} class="join-actions__sign-in membership-surface"
							>{signIn.label}</ExternalLink
						>
					</div>
				{/if}
			</section>

			<section id="steps" aria-labelledby="steps-title">
				<h2 id="steps-title">How membership works</h2>
				<ol class="join-steps">
					{#each JOIN_STEPS as step (step)}
						<li>{step}</li>
					{/each}
				</ol>
				<p>The Member Agreement and the Code of Conduct are on the <a href="/legal">legal page</a>.</p>
			</section>

			<section id="contributions" aria-labelledby="contributions-title">
				<h2 id="contributions-title">Contributions are optional</h2>
				<p>
					Membership never depends on money, gear, or tools. Contributions are separate from membership, and $0 is
					always an option. Once you are a member you can choose whether to contribute and how much, including by cash
					or check. Gear and tools in good working condition help too; if you're not sure if we'd want something,
					<a href="/contact">send us a message</a>.
				</p>
			</section>
		</div>
	</article>
</div>
