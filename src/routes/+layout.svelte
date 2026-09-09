<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { TinyVectors } from '@tummycrypt/tinyvectors';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import ExternalLink from '$lib/components/ExternalLink.svelte';
	import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';
	import ContributeMenu from '$lib/components/ContributeMenu.svelte';
	import { buildShaShort } from '$lib/build-info';
	import { footerNavGroups, isActivePath, primaryNavItems } from '$lib/nav-items';
	import { theme } from '$lib/theme.svelte';
	import { createDeviceMotionHandshake, type DeviceMotionTarget } from '$lib/device-motion-permission';
	import sourceMap from '$lib/generated/source-map.json';
	import '../app.css';

	let { children } = $props();

	// TinyVectors mounts on browser idle, not during hydration. Mounting the
	// blob layer inside the first hydration pass measurably delayed the
	// page's progressive enhancements (the goals rotator's `enhanced` flip,
	// the contact widget's onload challenge fetch) enough that the acceptance
	// suite's post-domcontentloaded samples caught the page mid-enhancement.
	// The blobs are pure decoration with no focusables and no network
	// traffic, so deferring them to idle restores the pre-blob enhancement
	// timeline while changing nothing the visitor can interact with.
	let brandVectorsReady = $state(false);
	let tinyVectorsRef = $state<DeviceMotionTarget>();
	let motionHandshake = $state<ReturnType<typeof createDeviceMotionHandshake>>();

	// The component binds after the idle callback, potentially long after
	// onMount. Track that binding rather than sampling an absent ref once.
	$effect(() => {
		const handshake = motionHandshake;
		const target = tinyVectorsRef;
		untrack(() => handshake?.setTarget(target));
	});

	onMount(() => {
		// First-gesture phone-motion handshake (operator ruling 2026-09-09): no control is rendered. Browsers that gate the sensor
		// behind a gesture (iOS Safari) borrow the visitor's first neutral tap
		// inside main; taps on links, buttons and fields are never borrowed,
		// the contact page never prompts, reduced motion never arms, and
		// desktop/Android never need it (the package self-starts there). The
		// state is published on <html data-motion-handshake> for the e2e.
		const main = document.getElementById('main-content');
		const handshake = createDeviceMotionHandshake(
			window.matchMedia('(prefers-reduced-motion: reduce)'),
			main ?? document,
			{
				root: main,
				eligible: () => !window.location.pathname.startsWith('/contact'),
				publish: (state) => {
					if (state === 'idle') delete document.documentElement.dataset.motionHandshake;
					else document.documentElement.dataset.motionHandshake = state;
				},
			},
		);
		motionHandshake = handshake;
		return () => handshake.destroy();
	});

	onMount(() => {
		// Hydrate the theme store from localStorage so the mode switch
		// reflects the persisted choice on reload (the app.html FOUC script
		// sets the DOM attributes pre-paint, but the reactive store still
		// needs to catch up, otherwise the switch reads its default state
		// after a refresh).
		theme.init();

		// Cancel the reveal fail-open timer (see src/app.html): hydration
		// succeeded, so `use:reveal` will run and no forced un-hide is needed.
		const w = window as unknown as { __gftbRevealFailsafe?: ReturnType<typeof setTimeout> };
		if (w.__gftbRevealFailsafe) clearTimeout(w.__gftbRevealFailsafe);

		// Idle deferral for the brand-vectors layer (see the state's comment).
		// Safari still ships no requestIdleCallback, so fall back to a macrotask.
		if (typeof window.requestIdleCallback === 'function') {
			const idleHandle = window.requestIdleCallback(() => {
				brandVectorsReady = true;
			});
			return () => window.cancelIdleCallback(idleHandle);
		}
		const timeoutHandle = setTimeout(() => {
			brandVectorsReady = true;
		}, 0);
		return () => clearTimeout(timeoutHandle);
	});

	// Header + footer structure is the demo site's +layout.svelte shape
	// (greatfallstoolbus.org@origin/main): nav renders from the
	// $lib/nav-items SSOT, and the footer is the intro-weighted four-group
	// grid (intro / About / Get involved / Meta). The old apex #103
	// cell-nesting lesson holds: every line of the intro column — location,
	// provenance, licensing — lives INSIDE the one intro cell, never as a
	// direct child of the footer grid. e2e/footer.spec.ts asserts the
	// computed track count.
	//
	// TODO(jess): footer wording — the rendered strings below are yours to
	// final-word: the intro/location line (the exact line the site already
	// shipped) and the provenance string. Nothing new was worded here.

	const siteUrl = 'https://greatfallstoolbus.org';
	// TODO(jess): document title. The tagline "— tools, skills, and shared
	// work" was stripped (salvaged from restoration PR-5: em-dash AI-tell +
	// triad); the interim title is the bare project name.
	const title = 'Great Falls Tool Bus';
	// TODO(jess): site description. "mobile" was stripped (the bus is
	// permanently parked; salvaged from restoration PR-5). Must stay
	// byte-identical with the <meta name="description"> in src/app.html (the
	// JSON-LD below reuses this constant); e2e/acceptance-copy-deslop.spec.ts
	// pins the parity.
	const description = 'A community-run tool library taking shape in Lewiston–Auburn, Maine.';
	const repoUrl = sourceMap.repoUrl;
	const jsonLd = {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		name: 'Great Falls Tool Bus',
		url: siteUrl,
		description,
		areaServed: 'Lewiston–Auburn, Maine',
	};

	// Both error surfaces pass through this layout: the prerendered /404 route,
	// whose bytes Caddy serves for any missing path, and +error.svelte for a
	// client-router failure. SEOHead is rendered here for every route, so this is
	// the only place the head can be decided once — setting <title> or robots in
	// the error components as well produced two conflicting elements per
	// document, and the layout's copy, not the error page's, is the one that won.
	//
	// The prerendered route renders with status 200 (it is a successful
	// prerender of /404), so the path is what identifies it, not the status.
	const isErrorSurface = $derived(page.url.pathname === '/404' || page.status >= 400);
	// The "·" separator replaces an em-dash (salvaged from restoration PR-5;
	// "·" is the separator the site already uses in the footer).
	const headTitle = $derived(isErrorSurface ? 'Page not found · Great Falls Tool Bus' : title);
	const headDescription = $derived(
		isErrorSurface ? 'This address is not part of the Great Falls Tool Bus site.' : description,
	);

	const currentPath = $derived(page.url.pathname || '/');
</script>

<SEOHead
	title={headTitle}
	description={headDescription}
	siteName="Great Falls Tool Bus"
	origin={siteUrl}
	noindex={isErrorSurface}
	canonical={isErrorSurface ? null : undefined}
	jsonLd={isErrorSurface ? null : jsonLd}
/>

<!-- App shell (operator diagnosis 2026-08-20: /log footer cascade fix). The
     v5 Skeleton layout pattern demo fa5552c +layout.svelte:77/:206 ships —
     min-h-screen flex column, main takes the remaining space — so the
     footer sits at the viewport base on any page shorter than the
     viewport. One shell for every route through this layout (incl. /log,
     /contact, and the prerendered /404), so there is no per-page footer
     hack. -->
<div class="app-shell">
	<!-- TinyVectors warm Tinyland background — the same brand-blob layer the
	     members site ships in its own +layout.svelte, restored to the apex at
	     the tinyvectors 0.3.7 idle-drift floor. Gated on brandVectorsReady
	     (browser idle, see the script comment) rather than `browser`: the
	     component drives window/navigator APIs and Svelte effects that crash
	     under SSR anyway, and every apex route prerenders. Fixed
	     full-viewport, below content (.brand-vectors-bg in app.css), low
	     opacity, behind the hero's own isolated backdrop stack. v0.3.7 makes
	     idle drift/bounce the desktop default and honors
	     prefers-reduced-motion internally, so this call site adds NO motion
	     logic — config only. Pointer physics is OFF: in the package the
	     pointer field is a cursor attractor that also steers the scroll
	     physics toward the cursor, which pooled the blobs under a resting
	     mouse; with it off the scroll effect pulls toward the field centre
	     instead, the way the operator's blog runs (a centre attraction, not
	     a sweep). Browsers that gate the sensor behind a gesture get the
	     silent first-tap handshake wired in onMount above. -->
	{#if brandVectorsReady}
		<div class="brand-vectors-bg" aria-hidden="true" data-testid="brand-vectors-bg">
			<TinyVectors
				bind:this={tinyVectorsRef}
				theme="custom"
				colors={['#cb6738', '#d99d6a', '#a14a52', '#6b4f3a', '#3d6b8c']}
				opacity={0.15}
				blobCount={5}
				enableScrollPhysics={true}
				enableDeviceMotion={true}
				enablePointerPhysics={false}
			/>
		</div>
	{/if}
	<a class="skip-link" href="#main-content">Skip to content</a>

	<header class="site-header">
		<div class="site-header__inner">
			<a class="brand" href="/" aria-label="Great Falls Tool Bus home">
				<img src="/logo/bus-silhouette.svg" alt="" width="80" height="38" />
				<!-- D12 residual: the wordmark carries the uppercase tracked
				     Fraunces .font-display lockup (apex +layout.svelte:107-114,
				     Wordmark.svelte). -->
				<span class="font-display">Great Falls Tool Bus</span>
			</a>
			<nav class="site-nav" aria-label="Main navigation">
				{#each primaryNavItems as item (item.href)}
					{#if item.external}
						<ExternalLink href={item.href}>{item.label}</ExternalLink>
					{:else}
						<a href={item.href} aria-current={isActivePath(currentPath, item.match) ? 'page' : undefined}
							>{item.label}</a
						>
					{/if}
				{/each}
				<!-- D01 placement: the mode switch rides the third header column
				     beside the anchors — the demo's AppBar.Trail position. -->
				<ThemeSwitcher />
			</nav>
		</div>
	</header>

	<main id="main-content" class="site-main" tabindex="-1">
		{@render children?.()}
	</main>

	<footer class="site-footer">
		<div class="site-footer__inner">
			<div class="site-footer__intro">
				<p>Great Falls Tool Bus · Lewiston–Auburn, Maine</p>
				<!-- Build provenance (D10, demo #140 fe32de1): the short sha only.
				     Degrade-to-nothing on
				     local/unstamped builds is already the build-info contract.
				     DELIBERATELY NO ANCHOR (review B1): the demo could link its
				     /commit page because that repo is public; this carrier is
				     private and the leak-scan internal-tracker-reference rule bans
				     the repo's pull/issues/commit path segments in the artifact by
				     name (AGENTS.md sanctions exactly one repository pointer, the
				     SourceLink affordance) — no sha length escapes a path-segment
				     ban, and a stamped `just build` fails on the href. The
				     leak-scan-stamped gate and src/lib/leak-scan.test.ts pin this;
				     the link half of D10 is a recorded residual behind an operator
				     ruling that would widen the sanctioned exception. -->
				{#if buildShaShort}
					<p class="site-footer__provenance">
						built from <code>{buildShaShort}</code>
					</p>
				{/if}
				<p class="site-footer__licensing">
					Content <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>
				</p>
			</div>
			{#each footerNavGroups as group (group.heading)}
				<nav class="site-footer__group" aria-label={group.heading}>
					<h2>{group.heading}</h2>
					<ul>
						{#each group.items as item (item.label)}
							<li>
								{#if item.external}
									<ExternalLink href={item.href}>{item.label}</ExternalLink>
								{:else}
									<a href={item.href}>{item.label}</a>
								{/if}
							</li>
						{/each}
					</ul>
				</nav>
			{/each}
			<nav class="site-footer__group" aria-label="Meta">
				<h2>Meta</h2>
				<ul>
					<!-- D11's AX/agent row was retired by operator ruling 2026-08-31.
					     Source and Security still point at the private site repo (a
					     404 for visitors, review E4); whether they should point at the
					     organization root instead is a separate operator call. D06:
					     outbound meta links ride ExternalLink. -->
					<li><ExternalLink href={repoUrl}>Source</ExternalLink></li>
					<li><ExternalLink href={`${repoUrl}/security/advisories/new`}>Security</ExternalLink></li>
				</ul>
			</nav>
		</div>
	</footer>

	<!-- Mounted ONCE so it rides every route (ContributeMenu.svelte, review
	     finding C). Its absolute position is anchored to .app-shell's reserved
	     footer rail, after the footer in both DOM and visual custody. -->
	<ContributeMenu />
</div>
