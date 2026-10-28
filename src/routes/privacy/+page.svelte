<script lang="ts">
	import SourceLink from '#lib/components/SourceLink.svelte';
	import ExternalLink from '#lib/components/ExternalLink.svelte';

	// Minimal and accurate by operator ruling (2026-09-19): this page states
	// only what the served site and its forms actually do today. Operator
	// interview 2026-10-02: the work session RSVP rides the contact relay, so
	// both forms carry the relay's IP line and the list's private archive. Member
	// accounts, applications and payments are not live; their data terms will
	// be added here when they are, alongside the club's agreements.
	// TODO(jess): final wording review; the facts below are read from the code.
</script>

<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li aria-current="page">Privacy</li>
		</ol>
	</nav>

	<article class="log-entry">
		<header class="log-entry__header">
			<h1>Privacy</h1>
			<p>What this site collects, which is very little, and where it goes.</p>
		</header>

		<div class="log-entry__body">
			<h2>This site</h2>
			<p>
				These pages are a static site: no accounts, no database, no cookies set by us. The one thing your browser
				remembers is your light or dark choice, and, if you close the mailing-list invitation that appears after a while
				on the site, that you closed it, for thirty days; both are kept in your browser's local storage and never sent
				anywhere. Our host counts page views at the network edge without cookies or personal identifiers; we do not run
				advertising or other third-party trackers.
			</p>

			<h2>Contact form and work session RSVPs</h2>
			<p>
				The <a href="/contact">contact form</a> sends your name, email address and message through our form relay to
				<code>keyholders@latoolb.us</code>, a private address read by keyholders. A short proof-of-work check runs in
				your browser before sending, in place of a tracking-based captcha. We keep your message for as long as it takes
				to answer it and keep the conversation going; ask us to delete it at any time by writing to the same address.
			</p>
			<p>
				An RSVP for a work session on the bus, sent from the home page, goes the same way: your email address, and the
				name and note if you give them, with the session you picked. Nothing from either form is stored on this site or
				in your browser.
			</p>
			<p>
				For both forms, the relay adds your connection's IP address to the message, and the keyholders list keeps a
				private archive of what it receives, read only by keyholders. Ask us to delete a message at any time by writing
				to <code>keyholders@latoolb.us</code>.
			</p>
			<p>
				The public discussion list, <code>discuss@latoolb.us</code>, keeps a
				<ExternalLink href="https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/">public archive</ExternalLink>.
				Anything sent there, including your address, is visible to anyone who reads it. Use the contact form when you
				want a message to stay private.
			</p>

			<!-- DRAFT: ships in the same release that opens applications, never earlier.
			     TODO(TIN-5351): replace every bracketed item below with the facts lane O reports
			     for the shipped join path: fields collected, where they are stored, who reads
			     them, retention, the sign-in provider, and how to ask for deletion. -->
			<h2>Applications and member accounts</h2>
			<p>
				Applications are by invitation. When you apply, we collect [TODO(TIN-5351): fields]. They are stored in
				[TODO(TIN-5351): system] and read by [TODO(TIN-5351): roles]. We keep them for [TODO(TIN-5351): retention]. Ask
				us to delete them at any time by writing to <code>keyholders@latoolb.us</code>.
			</p>
			<p>
				Signing in uses [TODO(TIN-5351): provider and what it receives]. Payments and tool checkout are not running.
				Contributions today are cash or check, recorded by a keyholder. See the
				<a href="/refund-policy">refund policy</a>.
			</p>

			<p class="muted">Last reviewed: [TODO(TIN-5351): date of release].</p>
		</div>
	</article>

	<SourceLink routeId="/privacy" />
</div>
