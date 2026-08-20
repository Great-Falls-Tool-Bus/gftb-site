<script lang="ts">
	import ContactForm from '$lib/components/ContactForm.svelte';
	import SourceLink from '$lib/components/SourceLink.svelte';

	// The contact form on its OWN page — the demo site's architecture
	// (greatfallstoolbus.org@origin/main src/routes/contact/+page.svelte),
	// restored by addendum B1.4: ALTCHA proof-of-work + honeypot + bounds +
	// exact-origin CORS against the forms.latoolb.us relay, with the mailto
	// compose as the deliberate manual fallback (spec §3 contact relay
	// :118-127 and §10). The root page's row 8 links here.
	//
	// The panel is the restored purple inversion (gen_board.py:170-179).
</script>

<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li aria-current="page">Contact</li>
		</ol>
	</nav>

	<section class="contact-card contact-card--form" aria-labelledby="contact-title">
		<div class="contact-copy">
			<!-- TODO(jess): contact heading. "Bring a question, a skill, or a
			     tool story." was swept as AI-authored copy (operator re-review
			     2026-08-19, salvaged from restoration PR-5); the interim heading
			     is the spec row's own term. -->
			<h1 id="contact-title">Contact</h1>
			<p>
				The form reaches <a href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a>, the private role list for
				access requests. Its archive is not public.
			</p>
			<p>
				For open project conversation, email <a href="mailto:discuss@latoolb.us">discuss@latoolb.us</a>
				or read the
				<a href="https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/">public discussion archive</a>.
			</p>
			<ContactForm />
		</div>
		<div class="qr-card">
			<!-- NON-ADOPTION RECORD (FR-9, Skeleton audit §a) — do not "fix":
			     this static, committed QR <img> STAYS; the runtime Zag/v5 QR
			     Code component was considered and rejected. The printed-artifact
			     decode and always-encode-the-apex acceptance (spec §3:129-142;
			     0014:88-89) are satisfied with zero runtime JS, and the
			     committed SVG is byte-identity-gated against a fresh qrencode
			     run (`just qr-verify`) plus a decode unit test — a runtime
			     component would trade a proven artifact for a client
			     dependency. -->
			<img
				class="qr"
				src="/qr/greatfallstoolbus-apex.svg"
				alt="QR code for greatfallstoolbus.org"
				width="196"
				height="196"
			/>
			<p>Permanent public address: <strong>greatfallstoolbus.org</strong></p>
		</div>
	</section>

	<SourceLink routeId="/contact" />
</div>
