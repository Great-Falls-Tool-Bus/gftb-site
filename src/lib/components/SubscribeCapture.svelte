<script lang="ts">
	// Dwell-armed list-signup capture (rehearsal only, behind the build-time
	// PUBLIC_SUBSCRIBE_CAPTURE flag; +layout.svelte mounts this on browser
	// idle and only when the flag is on). The modal arms after the visitor has
	// spent CAPTURE_DWELL_MS on the site AND scrolled past the hero, on a
	// viewport at least CAPTURE_MIN_VIEWPORT_WIDTH wide, never while the home
	// first-load intro is armed, live or lifting (read from the <html> classes
	// src/lib/intro owns; nothing about the intro is restated here), never on
	// /contact, /legal or /privacy, never under reduced motion, forced colours
	// or paper, and never again for 30 days after a dismissal or ever after a
	// signup. The decision itself is src/lib/subscribe-form.ts's pure
	// armCapture; this file only gathers the signals and publishes the
	// outcome on <html data-subscribe-capture> for tests and LOOKs.
	//
	// It is a list signup and nothing else: an email, a confirmation email,
	// an unsubscribe link in every message. The request goes to the same
	// separately owned forms API the contact form uses, with the same
	// honeypot and the same ALTCHA proof-of-work (the vendored widget script
	// is loaded once, the way ContactForm.svelte loads it, and only once the
	// modal has actually armed so a visit that never arms fetches nothing).
	//
	// Test and LOOK hook, read from <html> (no URL query, no storage):
	// `data-subscribe-capture-dwell-ms="<n>"` credits the dwell already
	// served, so a rig can arm with n=0 after scrolling past the hero. It is
	// only ever read by this component, which only exists on a flag-on build.
	import { onMount, tick, untrack } from 'svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { page } from '$app/state';
	import { INTRO_ARMED_CLASS, INTRO_LIFTING_CLASS, INTRO_LIVE_CLASS } from '$lib/intro/controller';
	import { contactChallengeUrl, hasErrors, isHoneypotTripped } from '$lib/contact-form';
	import {
		CAPTURE_DWELL_MS,
		armCapture,
		emptySubscribeValues,
		parseStoredTime,
		subscribeApiUrl,
		toSubscribePayload,
		validateSubscribe,
		type CaptureReason,
		type SubscribeFieldErrors,
		type SubscribeFormValues,
	} from '$lib/subscribe-form';

	const formEndpoint = 'https://forms.latoolb.us';
	const requestTimeoutMs = 15_000;
	const DISMISSED_KEY = 'subscribe-capture-dismissed';
	const SUBSCRIBED_KEY = 'subscribe-capture-subscribed';
	const DWELL_HOOK_ATTR = 'data-subscribe-capture-dwell-ms';
	/** Re-check the clock at most this often while waiting on dwell. */
	const DWELL_TICK_CAP_MS = 5_000;

	type Status = 'idle' | 'submitting' | 'success' | 'error';
	type Published = CaptureReason | 'armed';

	let open = $state(false);
	let status = $state<Status>('idle');
	let values = $state<SubscribeFormValues>(emptySubscribeValues());
	let fieldErrors = $state<SubscribeFieldErrors>({});
	let submitError = $state('');
	let altchaPayload = $state('');
	let widgetEl = $state<HTMLElement | undefined>();
	let emailEl = $state<HTMLInputElement | undefined>();
	/** Once dismissed or signed up, nothing re-arms in this session. */
	let settled = false;
	/** The arm check, installed by onMount; client-side navigation re-runs it. */
	let evaluate: (() => void) | undefined;

	function publish(state: Published) {
		document.documentElement.dataset.subscribeCapture = state;
	}

	// localStorage can be absent or throw (privacy mode, cleared site data);
	// every read and write is guarded, and the modal still decides correctly
	// without it (no memory means no suppression, which is the honest answer).
	function readStored(key: string): number | null {
		try {
			return parseStoredTime(localStorage.getItem(key));
		} catch {
			return null;
		}
	}
	function writeStored(key: string, value: number) {
		try {
			localStorage.setItem(key, String(value));
		} catch {
			// Storage unavailable: the session-level `settled` flag still holds.
		}
	}

	onMount(() => {
		const root = document.documentElement;
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
		const forced = window.matchMedia('(forced-colors: active)');
		const print = window.matchMedia('print');
		const controller = new AbortController();
		const { signal } = controller;

		// Dwell counts visible time only: a background tab does not accrue.
		let banked = 0;
		let visibleSince: number | null = document.hidden ? null : performance.now();
		const dwellMs = () => banked + (visibleSince === null ? 0 : performance.now() - visibleSince);
		const hook = Number.parseInt(root.getAttribute(DWELL_HOOK_ATTR) ?? '', 10);
		const dwellCredit = Number.isFinite(hook) && hook >= 0 ? Math.max(0, CAPTURE_DWELL_MS - hook) : 0;

		const introLive = () =>
			root.classList.contains(INTRO_ARMED_CLASS) ||
			root.classList.contains(INTRO_LIVE_CLASS) ||
			root.classList.contains(INTRO_LIFTING_CLASS);
		const scrolledPast = () => {
			const hero = document.querySelector('.hero');
			if (hero) return hero.getBoundingClientRect().bottom <= 0;
			return window.scrollY >= window.innerHeight;
		};

		let timer: ReturnType<typeof setTimeout> | undefined;
		const check = () => {
			if (settled || open) return;
			const decision = armCapture({
				dwellMs: dwellCredit + dwellMs(),
				scrolledPast: scrolledPast(),
				reducedMotion: reduce.matches,
				viewportWidth: window.innerWidth,
				introLive: introLive(),
				scriptsOn: true,
				forcedColors: forced.matches,
				printing: print.matches,
				dismissedAt: readStored(DISMISSED_KEY),
				subscribedAt: readStored(SUBSCRIBED_KEY),
				pathname: location.pathname,
				now: Date.now(),
			});
			if (decision.arm) {
				controller.abort();
				open = true;
				publish('armed');
				return;
			}
			publish(decision.reason);
			if (decision.reason === 'dwell' && visibleSince !== null) {
				clearTimeout(timer);
				const remaining = CAPTURE_DWELL_MS - dwellCredit - dwellMs();
				timer = setTimeout(check, Math.min(DWELL_TICK_CAP_MS, Math.max(50, remaining)));
			}
		};
		evaluate = check;

		window.addEventListener('scroll', check, { passive: true, signal });
		window.addEventListener('resize', check, { passive: true, signal });
		document.addEventListener(
			'visibilitychange',
			() => {
				if (document.hidden) {
					if (visibleSince !== null) banked += performance.now() - visibleSince;
					visibleSince = null;
				} else if (visibleSince === null) {
					visibleSince = performance.now();
				}
				check();
			},
			{ signal },
		);
		for (const query of [reduce, forced, print]) query.addEventListener('change', check, { signal });
		const observer = new MutationObserver(check);
		observer.observe(root, { attributes: true, attributeFilter: ['class'] });
		signal.addEventListener('abort', () => {
			observer.disconnect();
			clearTimeout(timer);
			evaluate = undefined;
		});
		check();

		return () => controller.abort();
	});

	// Reduced motion, forced colours or paper flipping on while the box is
	// open: stand down at once, the way HomeIntro cancels on reduce. Nothing
	// is remembered for it; the visitor made no choice.
	$effect(() => {
		if (!open) return;
		const queries: Array<[MediaQueryList, CaptureReason]> = [
			[window.matchMedia('(prefers-reduced-motion: reduce)'), 'reduced-motion'],
			[window.matchMedia('(forced-colors: active)'), 'forced-colors'],
			[window.matchMedia('print'), 'printing'],
		];
		const controller = new AbortController();
		for (const [query, reason] of queries) {
			query.addEventListener(
				'change',
				() => {
					if (!query.matches || !open) return;
					settled = true;
					open = false;
					publish(reason);
				},
				{ signal: controller.signal },
			);
		}
		return () => controller.abort();
	});

	// Client-side navigation: the suppressed paths are re-read as the URL changes.
	$effect(() => {
		void page.url.pathname;
		untrack(() => evaluate?.());
	});

	// The vendored ALTCHA widget script, loaded once and only once the modal
	// has armed (same element and guard as ContactForm.svelte).
	$effect(() => {
		if (!open || typeof document === 'undefined' || document.querySelector('script[data-altcha]')) return;
		const script = document.createElement('script');
		script.src = '/vendor/altcha/altcha.js';
		script.defer = true;
		script.dataset.altcha = '';
		document.head.appendChild(script);
	});

	$effect(() => {
		const element = widgetEl;
		if (!element) return;
		const onVerified = (event: Event) => {
			const detail = (event as CustomEvent<{ payload?: string }>).detail;
			altchaPayload = typeof detail?.payload === 'string' ? detail.payload : '';
		};
		const onState = (event: Event) => {
			const detail = (event as CustomEvent<{ state?: string }>).detail;
			if (detail?.state !== 'verified') altchaPayload = '';
		};
		element.addEventListener('verified', onVerified);
		element.addEventListener('statechange', onState);
		return () => {
			element.removeEventListener('verified', onVerified);
			element.removeEventListener('statechange', onState);
		};
	});

	function dismiss() {
		if (!open) return;
		settled = true;
		open = false;
		if (status === 'success') {
			publish('subscribed');
			return;
		}
		writeStored(DISMISSED_KEY, Date.now());
		publish('dismissed');
	}

	function onOpenChange(details: { open: boolean }) {
		if (!details.open) dismiss();
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		submitError = '';
		if (isHoneypotTripped(values)) {
			// A filled honeypot is not a person: show the quiet outcome, send
			// nothing, remember nothing.
			status = 'success';
			return;
		}

		fieldErrors = validateSubscribe(values);
		if (hasErrors(fieldErrors)) {
			await tick();
			emailEl?.focus();
			return;
		}

		status = 'submitting';
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
		try {
			const response = await fetch(subscribeApiUrl(formEndpoint), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(toSubscribePayload(values, altchaPayload)),
				signal: controller.signal,
			});
			if (!response.ok) throw new Error(`The list service answered ${response.status}.`);
			status = 'success';
			writeStored(SUBSCRIBED_KEY, Date.now());
		} catch (error) {
			status = 'error';
			submitError =
				error instanceof DOMException && error.name === 'AbortError'
					? 'The list service took too long to answer.'
					: 'We could not reach the list service.';
		} finally {
			clearTimeout(timer);
		}
	}

	function retry() {
		status = 'idle';
		submitError = '';
		altchaPayload = '';
		const element = widgetEl as (HTMLElement & { reset?: () => void; solve?: () => void }) | undefined;
		element?.reset?.();
		element?.solve?.();
	}
</script>

<!-- ADOPTION RECORD (Skeleton audit §a, the third entry after the two
     NON-ADOPTION RECORDs at ContactForm.svelte and src/app.css .prior-logs):
     this surface ADOPTS the v5 Dialog anatomy (Backdrop / Positioner /
     Content / Title / Description / CloseTrigger over the Zag dialog
     machine) instead of a native <dialog> or the hand-rolled trap
     ContributeMenu.svelte carries. Reasons, in order: (1) the surface is
     modal by design (it hides the page below from assistive tech, returns
     focus on dismiss, and dismisses on Escape and backdrop), which is
     exactly the machine's contract and is the part a hand-rolled version
     gets subtly wrong (ContributeMenu's review round 2 finding C is the
     local precedent); (2) a native <dialog>.showModal() puts the box in the
     top layer, above --z-intro, so it could not be kept below the first-load
     veil by the semantic z ladder at all; (3) the anatomy renders plain
     elements with no styles of its own, so sharp edges, the role layer and
     the print/forced-colours absence are all this file's CSS in app.css,
     the same way the mode switch and the wiper stalk are dressed. It is
     configured escapable: Escape, the backdrop, the close control and
     "Not now" all close it, and focus is restored to wherever it was.
     Skeleton's Portal was NOT adopted: the layout mounts this after the
     footer already, and .app-shell has no transform, so fixed positioning
     holds in place. -->
{#if open}
	<Dialog
		open={true}
		{onOpenChange}
		closeOnEscape={true}
		closeOnInteractOutside={true}
		restoreFocus={true}
		preventScroll={false}
		initialFocusEl={() => emailEl ?? null}
	>
		<Dialog.Backdrop class="subscribe-capture__backdrop" />
		<Dialog.Positioner class="subscribe-capture__positioner">
			<Dialog.Content class="subscribe-capture" data-testid="subscribe-capture">
				<!-- TODO(jess): capture wording. Every rendered string below is
				     interim: a list signup only, no ask of any other kind. -->
				{#if status === 'success'}
					<div class="form-notice form-notice--success" role="status" aria-live="polite">
						<Dialog.Title>
							{#snippet element(attributes)}
								<h2 {...attributes} class="subscribe-capture__title">Thanks. Check your inbox.</h2>
							{/snippet}
						</Dialog.Title>
						<Dialog.Description>
							{#snippet element(attributes)}
								<p {...attributes}>
									We sent a confirmation email to <strong>{values.email.trim()}</strong>. The list only adds you once
									you confirm it, and every message carries an unsubscribe link.
								</p>
							{/snippet}
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger class="button subscribe-capture__close">Close</Dialog.CloseTrigger>
				{:else}
					<Dialog.Title>
						{#snippet element(attributes)}
							<h2 {...attributes} class="subscribe-capture__title">Hear from the Tool Bus</h2>
						{/snippet}
					</Dialog.Title>
					<Dialog.Description>
						{#snippet element(attributes)}
							<p {...attributes} class="subscribe-capture__lede">
								An occasional email about open hours, workdays and what the club is up to. A few a month at most, and
								every one carries an unsubscribe link.
							</p>
						{/snippet}
					</Dialog.Description>

					<form
						class="subscribe-capture__form"
						method="post"
						action={subscribeApiUrl(formEndpoint)}
						onsubmit={handleSubmit}
						novalidate
					>
						{#if status === 'error'}
							<div class="form-notice form-notice--error" role="alert">
								<p>{submitError} You can try again or close this.</p>
								<button class="text-button" type="button" onclick={retry}>Try again</button>
							</div>
						{/if}

						<label for="subscribe-email">Email</label>
						<input
							id="subscribe-email"
							name="email"
							type="email"
							autocomplete="email"
							bind:this={emailEl}
							bind:value={values.email}
							aria-invalid={fieldErrors.email ? 'true' : undefined}
							aria-describedby={fieldErrors.email ? 'subscribe-email-error' : undefined}
							required
						/>
						{#if fieldErrors.email}<p id="subscribe-email-error" class="field-error">{fieldErrors.email}</p>{/if}

						<div class="honeypot" aria-hidden="true">
							<label for="subscribe-website">Website (leave blank)</label>
							<input
								id="subscribe-website"
								name="website"
								tabindex="-1"
								autocomplete="off"
								bind:value={values.website}
							/>
						</div>

						<altcha-widget
							bind:this={widgetEl}
							challengeurl={contactChallengeUrl(formEndpoint)}
							name="altcha"
							auto="onload"
							label="Human verification"
						></altcha-widget>
						<p class="form-help">A private, puzzle-free proof-of-work check accompanies the request.</p>

						<div class="subscribe-capture__actions">
							<button class="button" type="submit" disabled={status === 'submitting'}>
								{status === 'submitting' ? 'Sending…' : 'Join the list'}
							</button>
							<Dialog.CloseTrigger class="button button--secondary subscribe-capture__close"
								>Not now</Dialog.CloseTrigger
							>
						</div>
					</form>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Dialog>
{/if}
