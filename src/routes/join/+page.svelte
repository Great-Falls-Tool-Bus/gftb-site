<script lang="ts">
	import GatedSlot from '#lib/components/GatedSlot.svelte';
	import { INTEREST_PATH, JOIN_STEPS, MEMBER_INTAKE } from '#lib/membership.js';

	// MEMBER_INTAKE in src/lib/membership.ts selects the intake message. The member app owns
	// applications and supplies Apply and sign-in links through src/lib/gated/manifest.ts.
	// Keep contact available if the manifest fails or intake closes between builds. Membership
	// requires an application, tour and keyholder approval. A separate contribution is
	// optional and may be $0. The 2026-11-14 ruling includes this page in the sitemap.
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
					<p>
						If you see no Apply button, or the form says applications are closed, <a href={INTEREST_PATH}
							>send us a message</a
						> and a keyholder will reply.
					</p>
					<GatedSlot slot="join-sign-in" tag="div" class="join-actions" />
				{:else}
					<p>
						Applications are not open yet. Until they are, send a keyholder a message and we will let you know when they
						open.
					</p>
					<div class="join-actions">
						<a class="button" href={INTEREST_PATH}>Tell us you're interested</a>
						<GatedSlot slot="join-sign-in" />
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
