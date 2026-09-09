<script lang="ts">
	import { publicLogs, formatLogDate, summaryDiffersFromTitle, HOME_LOG_COUNT } from '$lib/public-logs';
	import { publicGoals, publicHelpAsks, memberBenefits } from '$lib/public-goals';
	import FeaturedImage from '$lib/components/FeaturedImage.svelte';
	import NotesAndGoals from '$lib/components/NotesAndGoals.svelte';
	import SourceLink from '$lib/components/SourceLink.svelte';
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

	// Operator ruling 2026-09-01: latest five minified logs on home —
	// supersedes the 2026-08-30 single-row scope (the citation form and
	// never-inline-body clauses stand). Fewer than five published entries
	// render however many exist.
	const latestLogs = publicLogs.slice(0, HOME_LOG_COUNT);

	// Notes & Goals, help asks, and member benefits render from
	// src/content/goals/*.md through the drift-checked manifest
	// (src/lib/public-goals.ts), the log pattern. Operator-authored
	// 2026-08-31 (timelines penciled in by the operator; the earlier
	// no-calendar-promises posture is superseded for these rows). The
	// three swept goal cards (2026-08-19) stay retired.

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
			<!-- Current operator placement: the recurring hours belong in the
			     hero, once. Naming consent covers the schedule, not a live location. -->
			<section class="hero-session" aria-labelledby="next-title">
				<h3 id="next-title">Public work sessions</h3>
				<p>
					Jess is usually working on the bus Fridays, about 3 to 5 PM ET. Please use the
					<a href="/contact">contact form</a> to confirm before traveling.
				</p>
				<p class="muted">
					Exact location details are shared directly. A confirmed one-off session will be posted here.
				</p>
			</section>
		</aside>
	</div>
</section>

<div class="page-shell">
	<!-- Row 4 (spec §3 :88): notes, goals and specific ways to help. -->
	<section class="section reveal-armed" use:reveal={{ delay: 70 }} id="goals" aria-labelledby="goals-title">
		<div class="section-heading">
			<h2 id="goals-title">Notes &amp; Goals</h2>
		</div>

		{#if publicGoals.length > 0}
			<!-- Notes & Goals: the borderless rows (never-cards stands: title,
			     plain window, one sentence, at most one CTA per row) as a plain grid
			     in every state. Operator ruling 2026-09-09: the wiper rotator is off
			     the public surface until the ratified replacement lands; the served
			     HTML, reduced motion and paper all show this same grid. See
			     NotesAndGoals.svelte for the goal rows and their Edit links.

			     The designed `media` snippet below consumes ONLY the schema's
			     frontmatter group (src/lib/featured-image-schema.ts) and is graceful
			     in absence (an imageless goal renders no figure and no reserved box).
			     The .goal-media crop box (app.css) fixes the media height from CSS
			     before any bytes arrive, so lazy-loading cannot shift layout; a goal's
			     own image_aspect overrides the default crop inline. -->
			<NotesAndGoals goals={publicGoals} labelledby="goals-title">
				{#snippet media(goal)}
					{#if goal.metadata.image}
						<figure class="goal-media">
							<img
								src={goal.metadata.image}
								alt={goal.metadata.image_alt ?? ''}
								loading="lazy"
								decoding="async"
								style:aspect-ratio={goal.metadata.image_aspect}
							/>
						</figure>
					{/if}
				{/snippet}
			</NotesAndGoals>
		{:else}
			<p>Notes, goals and specific ways to help will be posted here.</p>
		{/if}

		{#if memberBenefits.length > 0 || publicHelpAsks.length > 0}
			<div class="goal-asides">
				{#if memberBenefits.length > 0}
					<div class="goal-aside" id="benefits">
						<h3>What members get</h3>
						<p class="muted">Member accounts are not live yet. Membership is being built to include:</p>
						<ul class="plain-list">
							{#each memberBenefits as benefit (benefit.slug)}
								<li>{benefit.text ? `${benefit.metadata.title} ${benefit.text}` : benefit.metadata.title}</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if publicHelpAsks.length > 0}
					<div class="goal-aside" id="help">
						<h3>Ways to help</h3>
						<ul class="plain-list">
							{#each publicHelpAsks as ask (ask.slug)}
								<li>
									{ask.metadata.title}
									{#if ask.metadata.cta_label && ask.metadata.cta_href}
										<a href={ask.metadata.cta_href}>{ask.metadata.cta_label}</a>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Rows 5 and 6 (spec §3 :89-91): the latest five log entries, then
	     older entries through the paginated /log archive (its pagination is
	     plain prerendered links — the no-JavaScript path). Operator ruling
	     2026-09-01: latest five minified logs on home supersedes the
	     one-entry row this comment used to describe. -->
	<section class="section reveal-armed" use:reveal={{ delay: 140 }} id="log" aria-labelledby="log-title">
		<div class="section-heading">
			<h2 id="log-title">Public log</h2>
		</div>

		{#if latestLogs.length > 0}
			<!-- Operator ruling 2026-08-30: the home row is a concise citation
			     (title, date, summary, one read-more link), never the inline
			     body. The full entry lives on its permalink. Superseded in
			     scope by operator ruling 2026-09-01: latest five minified logs
			     on home — up to five citation rows render instead of one; the
			     citation form and never-inline-body clauses stand. -->
			{#each latestLogs as entry (entry.slug)}
				<article class="log-entry">
					<!-- Featured-image home integration (deferred item of the
					     2026-09-01 batch): an entry that ships the frontmatter
					     image group gets the same small archive-row thumb the
					     /log rows render — the card-free affordance above
					     title+meta, never the inline body (the citation form and
					     never-inline-body clauses stand; a thumbnail is entry
					     metadata, not body). The 2026-08-11 row currently renders
					     its manifest image; imageless entries render NOTHING — no
					     markup and no reserved box. The thumb's fixed CSS crop box
					     means a lazy-loading image cannot shift the rows below it. -->
					<FeaturedImage
						variant="thumb"
						src={entry.metadata.image}
						alt={entry.metadata.image_alt}
						aspect={entry.metadata.image_aspect}
					/>
					<header class="log-entry__header">
						<h3><a href={`/log/${entry.slug}`}>{entry.metadata.title}</a></h3>
						<p class="log-meta">{formatLogDate(entry.metadata.date)}</p>
						{#if summaryDiffersFromTitle(entry.metadata)}
							<p>{entry.metadata.summary}</p>
						{/if}
						<p class="log-entry__more"><a href={`/log/${entry.slug}`}>Read the full entry</a></p>
					</header>
				</article>
			{/each}
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
			<p>Reach a keyholder through the <a href="/contact">contact page</a>.</p>
		</div>
	</section>

	<SourceLink routeId="/" />
</div>
