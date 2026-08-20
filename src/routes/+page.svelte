<script lang="ts">
	import { publicLogs } from '$lib/public-logs';
	import ContactForm from '$lib/components/ContactForm.svelte';

	const latest = publicLogs[0];
	const prior = publicLogs.slice(1);

	// TODO(jess): goals content (Q4 format ruling also pending: plain list vs
	// run-in prose). The three goal cards were swept as unverified AI-authored
	// copy (operator re-review 2026-08-19); nothing renders until you write
	// the real goals. The swept items, restore whatever is real:
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
	// unverified specifics; restore the ones that are real. Until then the
	// page points people at the contact form instead of asserting needs.

	// The 3070x1851 master was served to every visitor at 2.35 MB. The published
	// renditions are downscales of it, recorded in NOTICE and
	// docs/attribution.md; a phone now pulls the 640 or 1280 candidate instead.
	//
	// `sizes` describes the figure column, not the viewport. Below 48rem the card
	// is one column of `.page-shell`; above it the card splits 1.1fr / 1fr, so the
	// photo takes 1.1/2.1 of a shell that is `min(100vw - 4rem, 72rem)` wide —
	// 52vw until the shell caps at 72rem, and a flat 604px after that.
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
	// the history figure already ships (the 640/1280/1920 jpeg+webp ladder
	// above; credits recorded in NOTICE and docs/attribution.md — the visible
	// credit stays with the history figure below, where the photo is content
	// rather than a blurred backdrop). The bus-photo corpus is pending its
	// colorspace/EXIF audit; when an audited photo lands, swap ONLY this
	// constant. The layer is decorative: empty alt, aria-hidden wrapper.
	//
	// `sizes` deliberately mirrors the history figure's so every viewport
	// resolves the SAME rendition the page already fetches for that figure —
	// the backdrop then adds zero image transfer at any width or DPR. The
	// band is wider than the slot `sizes` declares, and that is the point:
	// the layer is 16px-blurred behind a 92% scrim, so the smaller candidate
	// is perceptually identical to a dedicated full-width rendition.
	const heroPhoto = {
		webp: photoWidths.map((width) => `${photoBase}-${width}.webp ${width}w`).join(', '),
		jpeg: photoWidths.map((width) => `${photoBase}-${width}.jpg ${width}w`).join(', '),
		fallback: `${photoBase}-1280.jpg`,
		sizes: historyPhoto.sizes,
	};

	const formatDate = (value: string) =>
		new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
</script>

<div class="page-shell">
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
		<div>
			<!-- TODO(jess): any kicker survivors? The nine uppercase eyebrow kickers
			     were stripped as decoration (de-slop ruling 2026-08-19); if any of
			     their words were load-bearing, they are yours to re-author. -->
			<!-- TODO(jess): headline. "Tools belong in motion." was stripped — the
			     bus is permanently parked and never moves (operator fact,
			     2026-08-19). The interim text below is the project name, the
			     first element of the ratified page order (spec §3 item 1:
			     "project name, one-sentence purpose, and current status");
			     the real headline is yours to author. -->
			<h1 id="page-title">Great Falls Tool Bus</h1>
			<!-- TODO(jess): lede. Two strips landed here: (1) "mobile tool
			     library" needs your wording (the bus is parked — this phrase
			     changes atomically with the meta description in
			     +layout.svelte and app.html, kept identical by
			     e2e/acceptance-copy-deslop.spec.ts); the interim is the same
			     phrase minus "mobile". (2) The triad tail ("a place to share
			     tools, practical knowledge, repair work, and the
			     responsibility that keeps all three circulating") was removed
			     as motion/triad slop; nothing replaces it until you write it. -->
			<p class="lede">The Great Falls Tool Bus is becoming a community-run tool library.</p>
			<!-- TODO(jess): link wording. The button pair was demoted to plain
			     links (CTA-demotion ruling); the link text carried over as
			     interim wording. -->
			<p>
				<a class="text-link" href="#contact">Help build the bus</a> ·
				<a class="text-link" href="#log">Read the latest log</a>
			</p>
		</div>

		<aside class="status-card" id="status" aria-labelledby="status-title">
			<!-- TODO(jess): status heading + first sentence. "Building, not
			     lending yet." and "The bus and its public processes are being
			     prepared." were swept as AI-authored copy (operator re-review
			     2026-08-19); the interim heading is the spec's own term
			     (spec §3 item 1: "current status") and the body keeps only the
			     verifiable not-live-yet statement. -->
			<h2 id="status-title">Current status</h2>
			<p>Tool checkout, digital membership payments, and member accounts are not live yet.</p>
			<!-- TODO(jess): "and the next concrete invitation" was trimmed as an
			     AI-tell; if the status card should also name what future
			     updates announce, that clause is yours to write. -->
			<p class="muted">Updates here describe completed work.</p>
		</aside>
	</section>

	<section class="section" aria-labelledby="next-title">
		<div class="next-session">
			<div>
				<!-- TODO(jess): next-session block. The session name and the
				     hands-on description were swept as unverified specifics
				     (operator re-review 2026-08-19); restore whatever is real:
				       heading: "Waterproofing + measurements"
				       chip: "Schedule being confirmed"
				       body: "Our current hands-on focus is sealing the body and
				       openings, then measuring wonky shapes that may need
				       fabricated inserts."
				     The interim copy below is the spec's honest not-scheduled
				     state (spec §3 item 2). -->
				<h2 id="next-title">Next public work session</h2>
				<p class="date-chip">Not scheduled yet</p>
			</div>
			<div>
				<p>The next open work time will be posted here once confirmed.</p>
				<p>
					Use the <a class="text-link" href="#contact">contact form</a>; timing and exact location details are shared
					directly.
				</p>
			</div>
		</div>
	</section>

	<section class="section" aria-labelledby="goals-title">
		<div class="section-heading">
			<!-- TODO(jess): section heading. "A useful thing, built in
			     understandable steps." was stripped as slop; the interim is
			     the ratified page-order wording (spec §3 item 4: "near-term
			     goals and specific ways to help"). -->
			<h2 id="goals-title">Near-term goals</h2>
			<!-- TODO(jess): the section lede ("The public page stays simple
			     while the real member, tool, and stewardship flows are
			     designed with the people who will use them.") was swept as
			     AI-authored prose; the goal cards moved to the comment slot in
			     the script block above. Both are yours to re-author. -->
			<p>Near-term goals will be posted here.</p>
		</div>
	</section>

	<section class="section" aria-labelledby="help-title">
		<div class="grid grid--2">
			<div class="section-heading">
				<!-- TODO(jess): section heading. "A few specific ways to help."
				     was swept; the interim is the ratified page-order wording
				     (spec §3 item 4: "specific ways to help"). -->
				<h2 id="help-title">Ways to help</h2>
				<p>
					Please contact us before dropping anything off. We can confirm what is still needed and arrange a safe
					handoff.
				</p>
			</div>
			<div class="card">
				<!-- TODO(jess): the specific needs list was swept as unverified
				     (see the comment slot in the script block above); restore
				     the real items. -->
				<p>Current needs are confirmed through the contact form.</p>
			</div>
		</div>
	</section>

	<section class="section" id="log" aria-labelledby="log-title">
		<div class="section-heading">
			<!-- TODO(jess): section heading. "What changed, in plain language."
			     was stripped as slop; the interim is the spec's own name for
			     this surface (spec §3: "Public log"). -->
			<h2 id="log-title">Public log</h2>
			<p>
				These short entries are reviewed before publication. They report public project progress without exposing
				internal development or member information.
			</p>
		</div>

		{#if latest}
			{@const LatestLog = latest.component}
			<article class="log-entry">
				<header class="log-entry__header">
					<h3>{latest.metadata.title}</h3>
					<p>{latest.metadata.summary}</p>
				</header>
				<div class="log-entry__body"><LatestLog /></div>
			</article>
		{/if}

		<div class="prior-logs" aria-labelledby="prior-title">
			<h3 id="prior-title">Prior logs</h3>
			{#if prior.length === 0}
				<p class="muted">This is the first public entry. Earlier internal notes were not backfilled.</p>
			{:else}
				{#each prior as log (log.slug)}
					{@const PriorLog = log.component}
					<details>
						<summary>{formatDate(log.metadata.date)} · {log.metadata.title}</summary>
						<p>{log.metadata.summary}</p>
						<PriorLog />
					</details>
				{/each}
			{/if}
		</div>
	</section>

	<section class="section" aria-labelledby="history-title">
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
				<!-- TODO(jess): section heading. "A name shaped by this place."
				     was swept; the interim is the ratified page-order wording
				     (spec §3 item 7: "short history"). -->
				<h2 id="history-title">History</h2>
				<!-- TODO(jess): "useful things moving between neighbors instead of
				     sitting alone" was stripped as motion language (the bus is
				     parked); the factual first sentence and the name-borrowing
				     statement stay. The closing thought is yours to write. -->
				<p>
					The falls and working river connect Lewiston and Auburn. The bus borrows that local name for another kind of
					shared infrastructure.
				</p>
			</div>
		</div>
	</section>

	<section class="section" id="contact" aria-labelledby="contact-title">
		<div class="contact-card contact-card--form">
			<div class="contact-copy">
				<!-- TODO(jess): section heading. "Bring a question, a skill, or a
			     tool story." was stripped as a triad; the interim is the
			     ratified page-order wording (spec §3 item 8: "contact and
			     discussion information"). -->
				<h2 id="contact-title">Contact and discussion</h2>
				<p>
					The form reaches <a class="text-link" href="mailto:keyholders@latoolb.us">keyholders@latoolb.us</a>, the
					private role list for access requests. Its archive is not public.
				</p>
				<p>
					For open project conversation, email <a class="text-link" href="mailto:discuss@latoolb.us"
						>discuss@latoolb.us</a
					>
					or read the
					<a class="text-link" href="https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/"
						>public discussion archive</a
					>.
				</p>
				<ContactForm />
			</div>
			<div class="qr-card">
				<img
					class="qr"
					src="/qr/greatfallstoolbus-apex.svg"
					alt="QR code for greatfallstoolbus.org"
					width="196"
					height="196"
				/>
				<p>Permanent public address: <strong>greatfallstoolbus.org</strong></p>
			</div>
		</div>
	</section>
</div>
