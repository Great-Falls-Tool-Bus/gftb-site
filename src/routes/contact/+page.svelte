<script lang="ts">
	import ContactForm from '#lib/components/ContactForm.svelte';
	import SourceLink from '#lib/components/SourceLink.svelte';
	import ExternalLink from '#lib/components/ExternalLink.svelte';

	// Addendum B1.4 follows the demo route at greatfallstoolbus.org@origin/main
	// src/routes/contact/+page.svelte. The forms.latoolb.us relay uses ALTCHA, a honeypot,
	// bounds and exact-origin CORS. Keep the mailto fallback from spec §3 :118-127 and §10.
	// The 2026-08-31 ruling uses the plain page ground for .contact-card in src/app.css.
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
			<!-- TODO(jess): The contact heading uses the interim spec term pending
			     review. -->
			<h1 id="contact-title">Contact</h1>
			<p>
				The form reaches <a href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a>, the private role list for
				access requests. Its archive is not public.
			</p>
			<p>
				For open project conversation, email <a href="mailto:discuss@latoolb.us">discuss@latoolb.us</a>
				or read the
				<ExternalLink href="https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/"
					>public discussion archive</ExternalLink
				>.
			</p>
			<ContactForm />
		</div>
		<div class="qr-card">
			<!-- NON-ADOPTION RECORD for FR-9 and Skeleton audit §a. The committed QR SVG
			     works on paper without JavaScript. `just qr-verify` compares fresh
			     qrencode bytes and checks the payload against the package.json homepage.
			     Verify the printed code with a manual scan as specified in §3:129-142 and
			     0014:88-89. -->
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
