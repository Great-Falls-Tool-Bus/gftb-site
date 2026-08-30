<script lang="ts">
	import SourceLink from '$lib/components/SourceLink.svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';

	// RATIFIED INTERIM (operator Option A, 2026-08-29; TIN-4210): privacy +
	// retention copy for spec §12 may land while exact retention periods remain
	// unset. The route stays unlinked: no nav-items.ts entry and no cross-link
	// from /contact, /apply, or the root page. ADR 0016 still routes numerical
	// periods to sitting #3; this ruling does not invent or default a number.
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
			<h1>Privacy and data retention</h1>
			<!-- Operator-ratified interim summary (Option A, 2026-08-29). -->
			<p>
				What we collect, why, who can see it, and how long we keep it — for the contact form, membership application,
				contribution records, and (once it exists) the tool-lending pilot.
			</p>
		</header>

		<div class="log-entry__body">
			<h2>What this site is, technically</h2>
			<p>
				The public pages you are reading now are a static build with no server, database, or tracking script of their
				own. The one thing the browser remembers on its own is your light/dark theme choice, stored only in your
				browser's local storage — it is never sent anywhere. We do not run third-party analytics or advertising trackers
				on this site.
			</p>
			<p>
				Two things on this site do talk to something else: the
				<a href="/contact">contact form</a>, and, for members, the membership application and contribution tools
				described below.
			</p>

			<h2>Contact form</h2>
			<p>
				The contact form sends what you type to <code>keyholders@latoolb.us</code>, a private role address read by
				keyholders; its archive is not public. If you email <code>discuss@latoolb.us</code> or post there instead, that
				list keeps a
				<ExternalLink href="https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/">public archive</ExternalLink>
				— anything you send there, including your address, is visible to anyone who reads the archive. Use the contact form
				or the private address if you want your message to stay off the public record.
			</p>

			<h2>Membership application</h2>
			<p>
				Applying for membership means giving us an email address and the answers you provide in the application itself.
				We use that information to verify your email, schedule and record the outcome of an in-person tour, and decide
				on and track your membership status. The keyholder who reviews your application records only the decision and
				the operational notes needed to make it — not your contribution information, which is handled separately (below)
				and is visible only to the finance role.
			</p>
			<p>
				<strong>Declined or withdrawn applications.</strong>
				<!-- Option A ratifies the truthful unset-period wording; sitting #3 still owns the exact period. -->
				How long we keep a declined or withdrawn application is not yet decided. This page will state the exact period once
				it is set.
			</p>

			<h2>Contribution records</h2>
			<p>
				If you make a recurring or one-time contribution by card, that goes through Stripe's own hosted checkout and
				customer portal — this site and its operators never see or store your card number. If you contribute by cash or
				check, a keyholder records the amount, date, and cadence by hand.
			</p>
			<p>
				Only the finance role can see contribution amount, payment rail, processor/customer identifiers, cash notes, or
				payment-failure detail. General keyholders can see only whether a contribution step was offered and whether you
				asked for help with it.
			</p>
			<p>
				<strong>Finance and audit records.</strong>
				<!-- Option A ratifies the truthful unset-period wording; sitting #3 still owns the exact period. -->
				How long finance and audit records are kept — including after a membership ends — is not yet decided. This page will
				state the exact period once it is set.
			</p>

			<h2>Tool-lending pilot (photos and location observations)</h2>
			<p>
				Once the tool-lending pilot is live, checking a tool out or back in may involve a condition photo of the item
				and a note of where a return happened. Those exist to protect the tool library's shared equipment, not to track
				members.
			</p>
			<p>
				<strong>Photos and location observations.</strong>
				<!-- Option A ratifies the truthful unset-period wording; sitting #3 still owns the exact period. -->
				How long photos and location observations are kept is not yet decided. This page will state the exact period, and
				this section will be updated before the pilot's data collection goes live, once it is set.
			</p>

			<h2>Who your information is shared with</h2>
			<p>
				We do not sell member or applicant information. Card payment processing is handled by Stripe under its own
				privacy terms. Records may be disclosed if required by law. Beyond that, information stays within the keyholder
				and finance roles described above.
			</p>

			<h2>Your choices</h2>
			<p>
				To ask what information we hold about you, correct it, or request its deletion — subject to the finance/audit
				records we are required to keep for the period above once it is set — email
				<a href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a>.
			</p>

			<h2>Changes to this page</h2>
			<p>
				This page describes the system as built. When retention periods are ratified, or the system changes in a way
				that affects what is collected or who can see it, this page is updated and the update date below changes.
			</p>
			<!-- Operator review and interim-policy ratification recorded in TIN-4210. -->
			<p><em>Last reviewed: 29 August 2026.</em></p>
		</div>
	</article>

	<SourceLink routeId="/privacy" />
</div>
