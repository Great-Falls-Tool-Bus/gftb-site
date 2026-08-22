<script lang="ts">
	import { publicLogs } from '$lib/public-logs';
	import SourceLink from '$lib/components/SourceLink.svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import { reveal } from '$lib/motion.svelte';

	// Scroll-reveal (D04): each below-hero section arms with a per-item
	// 70ms stagger. The hidden start state only exists under
	// html.motion-safe-ready (app.html sync script), with a 3s fail-open
	// failsafe, so no-JS / reduced-motion / dead-bundle visitors always see
	// content at rest — see src/lib/motion.svelte.ts.

	// The front page is the ratified spec §3 page order (:83-93), eight rows,
	// nothing else. Rows render from files/data (the log pipeline, the photo
	// record, the nav SSOT); every string an operator has not authored is a
	// TODO(jess) slot (addendum B1.3: the baked prose sections are killed,
	// their swept text preserved in the comment slots restoration PR-5
	// recorded).

	const latest = publicLogs[0];

	// TODO(jess): goals content. The three goal cards were swept as
	// unverified AI-authored copy (operator re-review 2026-08-19, salvaged
	// from restoration PR-5); nothing renders until you write the real
	// goals. The swept items, restore whatever is real:
	//   Make the bus ready — Keep water out, clear and prepare the interior,
	//     and establish a simple interim lock and safe working setup.
	//   Design membership together — Storyboard a welcoming sliding-scale
	//     membership path before collecting online payments or issuing
	//     accounts.
	//   Start with useful tools — Build a small inventory and checkout
	//     process that works well from a phone and still respects privacy.

	// TODO(jess): needs list. The five specific asks (bus-seat removal help,
	// sheet metal/plastic, a 9/16-inch impact or breaker bar, cleaning
	// supplies, Security Torx + imperial square bits) were swept as
	// unverified specifics (restoration PR-5); restore the ones that are
	// real. Until then the page points people at the contact page instead of
	// asserting needs.

	// The 3070x1851 master was served to every visitor at 2.35 MB. The published
	// renditions are downscales of it, recorded in NOTICE and
	// docs/attribution.md; a phone now pulls the 640 or 1280 candidate instead.
	const photoBase = '/photos/great-falls-lewiston-1930s';
	const photoWidths = [640, 1280, 1920];
	const historyPhoto = {
		webp: photoWidths.map((width) => `${photoBase}-${width}.webp ${width}w`).join(', '),
		jpeg: photoWidths.map((width) => `${photoBase}-${width}.jpg ${width}w`).join(', '),
		fallback: `${photoBase}-1280.jpg`,
		sizes: '(min-width: 76rem) 604px, (min-width: 48rem) 52vw, 100vw',
	};

	// ── HERO SOURCE SWAP POINT ────────────────────────────────────────────
	// The hero backdrop reuses the licensed Great Falls postcard renditions
	// the history figure already ships (credits recorded in NOTICE and
	// docs/attribution.md). The bus-photo corpus is pending its
	// colorspace/EXIF audit; when an audited photo lands, swap ONLY this
	// constant. The layer is decorative: empty alt, aria-hidden wrapper.
	//
	// `sizes` is its OWN value (apex-gaps diagnosis 2026-08-20 item 1),
	// NOT historyPhoto.sizes: this picture fills `.hero`, which breaks out
	// to the full 100vw band (app.css `.hero { width: 100vw; margin-left:
	// calc(50% - 50vw); }`), not the ~604px-capped column the History
	// thumbnail renders in. Reusing History's sizes told the browser this
	// was a small, column-capped image, so at a 1440px viewport it picked
	// the 640w candidate and stretched it ~2.3x via object-fit: cover —
	// compounding the crush the scrim/blur tuning above fixes.
	const heroPhoto = {
		webp: photoWidths.map((width) => `${photoBase}-${width}.webp ${width}w`).join(', '),
		jpeg: photoWidths.map((width) => `${photoBase}-${width}.jpg ${width}w`).join(', '),
		fallback: `${photoBase}-1280.jpg`,
		sizes: '100vw',
	};

	const formatDate = (value: string) =>
		new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
</script>

<!-- Row 1 (spec §3 :85): project name, one-sentence purpose, current status.
     Full-bleed band, demo #90 geometry; the drift is CSS-only scroll-driven
     animation (restoration PR-7, ratified Q&A-12 ruling: no JS, static under
     reduced motion and without support). The headline block sits on the
     demo's featured-glass panel, on the role layer. -->
<section class="hero" aria-labelledby="page-title">
	<div class="hero__media" aria-hidden="true">
		<picture class="hero__drift">
			<source type="image/webp" srcset={heroPhoto.webp} sizes={heroPhoto.sizes} />
			<img
				src={heroPhoto.fallback}
				srcset={heroPhoto.jpeg}
				sizes={heroPhoto.sizes}
				alt=""
				width="1280"
				height="771"
				loading="eager"
				fetchpriority="low"
				decoding="async"
			/>
		</picture>
		<div class="hero__scrim"></div>
	</div>
	<div class="hero__inner">
		<div class="hero-glass">
			<!-- TODO(jess): headline. "Tools belong in motion." was stripped — the
			     bus is permanently parked and never moves (operator fact,
			     2026-08-19; salvaged from restoration PR-5). The interim text is
			     the project name (spec §3 row 1); the real headline is yours. -->
			<h1 id="page-title">Great Falls Tool Bus</h1>
			<!-- TODO(jess): lede. Salvaged from restoration PR-5: "mobile" was
			     stripped (the bus is parked; this phrase changes atomically with
			     the meta description carriers, pinned by
			     e2e/acceptance-copy-deslop.spec.ts) and the triad tail was
			     removed as motion slop. -->
			<p class="lede">The Great Falls Tool Bus is becoming a community-run tool library.</p>
			<!-- Row 3 (spec §3 :87): the one primary interest/help CTA, pointing
			     at the contact page (B1.4: the form lives on its own page).
			     TODO(jess): CTA wording (interim label salvaged from PR-5). -->
			<div class="button-row">
				<a class="button" href="/contact">Help build the bus</a>
				<a class="button button--secondary" href="/log">Read the log</a>
			</div>
		</div>

		<aside class="status-card hero-glass" id="status" aria-labelledby="status-title">
			<!-- TODO(jess): status wording (salvaged from restoration PR-5): the
			     interim heading is the spec's own term (spec §3 row 1: "current
			     status") and the body keeps only the verifiable not-live-yet
			     statement. -->
			<h2 id="status-title">Current status</h2>
			<p>Tool checkout, digital membership payments, and member accounts are not live yet.</p>
			<p class="muted">Updates here describe completed work.</p>
		</aside>
	</div>
</section>

<div class="page-shell">
	<!-- Row 2 (spec §3 :86): next confirmed public work session, or the honest
	     not-scheduled state. This band is the restored yellow livery block
	     (gen_board.py:166-168; addendum B1.1). -->
	<section class="section reveal-armed" use:reveal={{ delay: 0 }} aria-labelledby="next-title">
		<div class="next-session">
			<div>
				<!-- TODO(jess): next-session block (salvaged from restoration
				     PR-5). The session name and hands-on description were swept
				     as unverified specifics; restore whatever is real:
				       heading: "Waterproofing + measurements"
				       chip: "Schedule being confirmed"
				       body: "Our current hands-on focus is sealing the body and
				       openings, then measuring wonky shapes that may need
				       fabricated inserts."
				     The interim copy is the spec's honest not-scheduled state
				     (spec §3 row 2). -->
				<h2 id="next-title">Next public work session</h2>
				<p class="date-chip">Not scheduled yet</p>
			</div>
			<div>
				<p>The next open work time will be posted here once confirmed.</p>
				<p>
					Use the <a href="/contact">contact page</a>; timing and exact location details are shared directly.
				</p>
			</div>
		</div>
	</section>

	<!-- Row 4 (spec §3 :88): near-term goals and specific ways to help.
	     Empty until the operator authors them (see the TODO slots in the
	     script block). -->
	<section class="section reveal-armed" use:reveal={{ delay: 70 }} aria-labelledby="goals-title">
		<div class="section-heading">
			<h2 id="goals-title">Near-term goals</h2>
			<p>Near-term goals and specific ways to help will be posted here.</p>
		</div>
	</section>

	<!-- Rows 5 and 6 (spec §3 :89-91): the latest log entry, then older
	     entries through the paginated /log archive (its pagination is plain
	     prerendered links — the no-JavaScript path). -->
	<section class="section reveal-armed" use:reveal={{ delay: 140 }} id="log" aria-labelledby="log-title">
		<div class="section-heading">
			<h2 id="log-title">Public log</h2>
		</div>

		{#if latest}
			{@const LatestLog = latest.component}
			<article class="log-entry">
				<header class="log-entry__header">
					<h3><a href={`/log/${latest.slug}`}>{latest.metadata.title}</a></h3>
					<p class="log-meta">{formatDate(latest.metadata.date)}</p>
					<p>{latest.metadata.summary}</p>
				</header>
				<div class="log-entry__body"><LatestLog /></div>
			</article>
		{:else}
			<!-- TODO(jess): the first entry is a published:false draft awaiting
			     your write-up (addendum B1.2: agent-drafted posts never
			     publish). This honest empty state renders until then. -->
			<p class="muted">No log entries have been published yet.</p>
		{/if}

		<p><a href="/log">Older log entries</a></p>
	</section>

	<!-- Row 7 (spec §3 :92): short history. -->
	<section class="section reveal-armed" use:reveal={{ delay: 210 }} id="history" aria-labelledby="history-title">
		<div class="history-card">
			<figure>
				<picture>
					<source type="image/webp" srcset={historyPhoto.webp} sizes={historyPhoto.sizes} />
					<img
						src={historyPhoto.fallback}
						srcset={historyPhoto.jpeg}
						sizes={historyPhoto.sizes}
						alt="Historic postcard view of Great Falls between Auburn and Lewiston"
						width="1280"
						height="771"
						loading="lazy"
						decoding="async"
					/>
				</picture>
				<figcaption>
					Tichnor Brothers, Inc., Boston Public Library collection no. 69902. Public domain; no known restrictions.
				</figcaption>
			</figure>
			<div class="history-card__copy">
				<!-- TODO(jess): history copy. "A name shaped by this place." and
				     its body were swept (the body's "useful things moving between
				     neighbors" is motion copy — the bus is parked; salvage of the
				     PR-5 sweep). The interim heading is the spec row's own term;
				     the short history is yours to write. -->
				<h2 id="history-title">History</h2>
				<p>The falls and working river connect Lewiston and Auburn; the bus borrows that local name.</p>
			</div>
		</div>
	</section>

	<!-- Row 8 (spec §3 :93): contact and discussion information — a LINK to
	     the contact page (B1.4: the form lives on its own page, never the
	     root). -->
	<section class="section reveal-armed" use:reveal={{ delay: 280 }} id="contact" aria-labelledby="contact-title">
		<div class="section-heading">
			<h2 id="contact-title">Contact and discussion</h2>
			<p>
				Reach a keyholder through the <a href="/contact">contact page</a>. For open project conversation, email
				<a href="mailto:discuss@latoolb.us">discuss@latoolb.us</a>
				or read the
				<ExternalLink href="https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/"
					>public discussion archive</ExternalLink
				>.
			</p>
		</div>
	</section>

	<SourceLink routeId="/" />
</div>
