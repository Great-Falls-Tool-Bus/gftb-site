<script lang="ts">
	import SourceLink from '$lib/components/SourceLink.svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';

	// Operator-ratified lifecycle values through 31 August 2026 (decision 0024
	// and its Amendment 1). Member, applicant, and archive-account periods
	// below are set; finance/audit and location-observation periods remain
	// separately governed. The route stays unlinked.
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
				<strong>Withdrawn, declined, or inactive applications.</strong>
				We keep profile and verification data for 30 days after withdrawal or decline so you can ask for correction or export,
				then delete it. An application that never reaches a tour closes after 60 days without applicant activity, after warning
				attempts, and then follows the same 30-day deletion window. We keep only a minimal non-personal decision or audit
				receipt when required.
			</p>

			<h2>When membership ends</h2>
			<p>
				Membership, login, and borrowing access end immediately. For 30 days after exit or removal, you may ask a
				keyholder to verify your identity and restore your account, mailbox contents, and member-list state intact.
				After that window the retained data is inaccessible and returning requires a new application. At 90 days after
				exit or removal, personal account data, mailbox contents, and list-subscription records are purged. Finance and
				audit records, unresolved obligation evidence, and records under a legal hold remain for their separate required
				periods.
			</p>
			<p>
				An account you made yourself on the public list archive is on that same clock: restorable for 30 days after exit
				or removal, and purged at 90 days.
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
				These records are kept for their separately governed or legally required periods. The member-account periods above
				do not shorten them; this page will state a numerical finance and audit period when that separate policy is set.
			</p>

			<h2>Tool-lending pilot (photos and location observations)</h2>
			<p>
				Once the tool-lending pilot is live, checking a tool out or back in may involve a condition photo of the item
				and a note of where a return happened. Those exist to protect the tool library's shared equipment, not to track
				members.
			</p>
			<p>
				<strong>Photos.</strong>
				Ordinary condition photos are kept until the checkout or return is closed, plus 90 days. Photos connected to damage
				or repair are kept until the matter is resolved, plus one year. Catalog photos remain for the lifetime of the tool.
				A legal hold may require longer retention.
			</p>
			<p>
				<strong>Location observations.</strong>
				Their separate retention period is not yet set. This section will be updated before the pilot collects them.
			</p>

			<h2>Who your information is shared with</h2>
			<p>
				We do not sell member or applicant information. Card payment processing is handled by Stripe under its own
				privacy terms. Records may be disclosed if required by law. Beyond that, information stays within the keyholder
				and finance roles described above.
			</p>

			<h2>Your choices</h2>
			<p>
				To ask what information we hold about you, correct it, request an export, or request deletion subject to the
				retention requirements above, email
				<a href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a>.
			</p>

			<h2>Changes to this page</h2>
			<p>
				When a remaining retention period is ratified, or the system changes in a way that affects what is collected or
				who can see it, this page is updated and the update date below changes.
			</p>
			<p><em>Last reviewed: 30 August 2026.</em></p>
		</div>
	</article>

	<SourceLink routeId="/privacy" />
</div>
