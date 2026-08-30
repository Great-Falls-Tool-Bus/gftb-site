<script lang="ts">
	import SourceLink from '$lib/components/SourceLink.svelte';

	// RATIFIED INTERIM (operator Option A, 2026-08-29): refund/cancellation copy for spec §12
	// P1 (2026-08-30 deliverable list includes "privacy and retention
	// copy"; refund/cancellation is the companion money-copy surface for the
	// same contribution subsystem, spec §5). The route stays unlinked: no
	// nav-items.ts entry and no cross-link. Operator Option A authorizes this
	// truthful interim copy without setting a refund-request deadline.
	//
	// Money-copy rule (binding, ADR 0014 §0.6 + ratification sitting #1 Card
	// B, meta drafts/2026-08-18-ratification-sitting-1.md): public money
	// copy is RECIPIENT-NEUTRAL, promises no tax deductibility, and implies
	// no entity, sponsor, insurance, license, or processor approval that has
	// not been observed. "Contribution" is used throughout, never
	// "donation" (the latter carries a tax implication the project cannot
	// support pending the Maine solicitation determination — spec §14 item
	// 2, an operator-only track this build does not touch). No entity name
	// is printed here because none is ratified yet.
	//
	// No binding source sets a refund-request window. Option A ratifies the
	// truthful not-yet-set wording below; it does not invent a deadline.
</script>

<div class="page-shell">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<ol>
			<li><a href="/">Home</a></li>
			<li aria-current="page">Refunds &amp; cancellation</li>
		</ol>
	</nav>

	<article class="log-entry">
		<header class="log-entry__header">
			<h1>Contribution refunds and cancellation</h1>
			<!-- Operator-ratified interim summary (Option A, 2026-08-29). -->
			<p>How to stop a recurring contribution, and how to ask about a refund.</p>
		</header>

		<div class="log-entry__body">
			<h2>What a contribution is</h2>
			<p>
				A contribution to the Great Falls Tool Bus is not a purchase — you are not buying membership or borrowing
				rights, and stopping a contribution does not end your membership. No tax-deductibility determination has been
				made for any contribution, and none should be assumed from this page or any other public copy.
			</p>

			<h2>Cancelling a recurring card contribution</h2>
			<p>
				Recurring card contributions run through Stripe's hosted checkout and customer portal. You can cancel at any
				time through that portal, or by asking a keyholder to cancel it for you at
				<a href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a>. Cancelling stops future charges. It does not,
				by itself, refund amounts already processed.
			</p>

			<h2>Cash or check contributions</h2>
			<p>
				Cash and check contributions are recorded by a keyholder as a one-time or intended-cadence receipt, not an
				automatic recurring charge, so there is nothing to "cancel" — a future cash or check contribution simply doesn't
				happen if you don't make it. To correct or reverse an already-recorded cash or check receipt, contact
				<a href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a>.
			</p>

			<h2>Requesting a refund</h2>
			<p>
				To ask about a refund of a card, cash, or check contribution, email
				<a href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a> with the date and amount. Refund requests are reviewed
				by a keyholder on a case-by-case basis.
			</p>
			<p>
				<!-- Option A ratifies the truthful no-fixed-window wording; no deadline is implied. -->
				A specific time window for refund requests is not yet set. Until it is, this page makes no promise about how long
				after a contribution a refund can be requested — ask, and a keyholder will tell you what's possible for your situation.
			</p>
			<p>
				Approving a refund does not imply an admission that a contribution was processed in error, and declining one
				does not waive any right you otherwise have under law or under Stripe's own terms for card payments.
			</p>

			<h2>What this page does not promise</h2>
			<ul>
				<li>No tax deductibility of any contribution.</li>
				<li>No specific legal entity, sponsor, or fiscal sponsor is named here.</li>
				<li>
					No insurance, license, or payment-processor approval beyond what Stripe itself provides for card payments.
				</li>
				<li>No guaranteed refund turnaround time — this section will be updated with one once it is set.</li>
			</ul>

			<h2>Questions</h2>
			<p>
				For anything not covered here, email
				<a href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a> or use the <a href="/contact">contact form</a>.
			</p>

			<p><em>Last reviewed: 29 August 2026.</em></p>
		</div>
	</article>

	<SourceLink routeId="/refund-policy" />
</div>
