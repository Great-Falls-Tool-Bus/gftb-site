<script lang="ts">
	import { publicLogs } from '$lib/public-logs';
	import ContactForm from '$lib/components/ContactForm.svelte';

	const latest = publicLogs[0];
	const prior = publicLogs.slice(1);

	const goals = [
		{
			title: 'Make the bus ready',
			body: 'Keep water out, clear and prepare the interior, and establish a simple interim lock and safe working setup.',
		},
		{
			title: 'Design membership together',
			body: 'Storyboard a welcoming sliding-scale membership path before collecting online payments or issuing accounts.',
		},
		{
			title: 'Start with useful tools',
			body: 'Build a small, legible inventory and checkout process that works well from a phone and still respects privacy.',
		},
	];

	const help = [
		'Hands for removing and preparing bus seats',
		'Sheet metal or sheet plastic for odd openings and inserts',
		'A 9/16-inch impact or large breaker bar for stubborn bolts',
		'Cleaning supplies, rags, a broom, and industrial cleaner',
		'Security Torx drivers and a broader set of imperial square bits',
	];

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
			<h1 id="page-title">Tools belong in motion.</h1>
			<p class="lede">
				The Great Falls Tool Bus is becoming a community-run mobile tool library: a place to share tools, practical
				knowledge, repair work, and the responsibility that keeps all three circulating.
			</p>
			<div class="button-row">
				<a class="button" href="#contact">Help build the bus</a>
				<a class="button button--secondary" href="#log">Read the latest log</a>
			</div>
		</div>

		<aside class="status-card" id="status" aria-labelledby="status-title">
			<h2 id="status-title">Building, not lending yet.</h2>
			<p>
				The bus and its public processes are being prepared. Tool checkout, digital membership payments, and member
				accounts are not live yet.
			</p>
			<p class="muted">Updates here describe completed work and the next concrete invitation.</p>
		</aside>
	</section>

	<section class="section" aria-labelledby="next-title">
		<div class="next-session">
			<div>
				<h2 id="next-title">Waterproofing + measurements</h2>
				<p class="date-chip">Schedule being confirmed</p>
			</div>
			<div>
				<p>
					Our current hands-on focus is sealing the body and openings, then measuring wonky shapes that may need
					fabricated inserts. The next open work time will be posted here once confirmed.
				</p>
				<p>
					Use the <a class="text-link" href="#contact">contact form before coming</a>; timing and exact location details
					are shared directly.
				</p>
			</div>
		</div>
	</section>

	<section class="section" aria-labelledby="goals-title">
		<div class="section-heading">
			<h2 id="goals-title">A useful thing, built in understandable steps.</h2>
			<p class="lede">
				The public page stays simple while the real member, tool, and stewardship flows are designed with the people who
				will use them.
			</p>
		</div>
		<div class="grid grid--3">
			{#each goals as goal (goal.title)}
				<article class="card">
					<h3>{goal.title}</h3>
					<p>{goal.body}</p>
				</article>
			{/each}
		</div>
	</section>

	<section class="section" aria-labelledby="help-title">
		<div class="grid grid--2">
			<div class="section-heading">
				<h2 id="help-title">A few specific ways to help.</h2>
				<p>
					Please contact us before dropping anything off. We can confirm what is still needed and arrange a safe
					handoff.
				</p>
			</div>
			<div class="card">
				<ul class="check-list">
					{#each help as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</div>
		</div>
	</section>

	<section class="section" id="log" aria-labelledby="log-title">
		<div class="section-heading">
			<h2 id="log-title">What changed, in plain language.</h2>
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
				<h2 id="history-title">A name shaped by this place.</h2>
				<p>
					The falls and working river connect Lewiston and Auburn. The bus borrows that local name for another kind of
					shared infrastructure: useful things moving between neighbors instead of sitting alone.
				</p>
			</div>
		</div>
	</section>

	<section class="section" id="contact" aria-labelledby="contact-title">
		<div class="contact-card contact-card--form">
			<div class="contact-copy">
				<h2 id="contact-title">Bring a question, a skill, or a tool story.</h2>
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
