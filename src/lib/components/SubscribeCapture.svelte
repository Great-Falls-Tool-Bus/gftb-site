<script lang="ts">
	// +layout.svelte mounts this rehearsal dialog on browser idle when
	// PUBLIC_SUBSCRIBE_CAPTURE is enabled. Gather the inputs for armCapture in
	// src/lib/subscribe-form.ts. Read the home intro state from <html> and publish the
	// decision on data-subscribe-capture. Suppress signup while data-rsvp-open is set. The
	// shared ALTCHA loader runs only once the dialog arms. Tests can credit elapsed dwell with
	// data-subscribe-capture-dwell-ms="<n>".
	import { onMount, tick, untrack } from 'svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { page } from '$app/state';
	import { INTRO_ARMED_CLASS, INTRO_LIFTING_CLASS, INTRO_LIVE_CLASS } from '#lib/intro/controller.js';
	import { contactChallengeUrl, hasErrors, isHoneypotTripped } from '#lib/contact-form.js';
	import { loadAltchaWidget, resolveAltcha, watchAltcha } from '#lib/altcha-loader.js';
	import { RSVP_OPEN_ATTR } from '#lib/rsvp-form.js';
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
	} from '#lib/subscribe-form.js';
	// Bind the Dialog parts to flat names. Minified `X.Title` member access can look like a
	// personal name to the leak scan.
	const {
		Backdrop: DialogBackdrop,
		Positioner: DialogPositioner,
		Content: DialogContent,
		Title: DialogTitle,
		Description: DialogDescription,
		CloseTrigger: DialogCloseTrigger,
	} = Dialog;

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

	// Read and write localStorage defensively. When storage is unavailable the modal cannot
	// remember a dismissal.
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
			if (settled || open || root.hasAttribute(RSVP_OPEN_ATTR)) return;
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
	// has armed (the shared loader in src/lib/altcha-loader.ts).
	$effect(() => {
		if (open) loadAltchaWidget();
	});

	$effect(() => {
		const element = widgetEl;
		if (!element) return;
		return watchAltcha(element, (payload) => {
			altchaPayload = payload;
		});
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
		resolveAltcha(widgetEl);
	}
</script>

<!-- ADOPTION RECORD for Skeleton audit §a. The v5 Dialog anatomy handles Escape, backdrop
     dismissal and focus restoration. A native <dialog>.showModal() would enter the top
     layer above --z-intro. The layout mounts this after the footer and .app-shell has no
     transform, so fixed positioning works without a Portal. Component-local :global rules
     style the plain anatomy elements. -->
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
		<DialogBackdrop class="subscribe-capture__backdrop" />
		<DialogPositioner class="subscribe-capture__positioner">
			<DialogContent class="subscribe-capture" data-testid="subscribe-capture">
				<!-- TODO(jess): capture wording. Every rendered string below is
				     interim: a list signup only, no ask of any other kind. -->
				{#if status === 'success'}
					<div class="form-notice form-notice--success" role="status" aria-live="polite">
						<DialogTitle>
							{#snippet element(attributes)}
								<h2 {...attributes} class="subscribe-capture__title">Thanks. Check your inbox.</h2>
							{/snippet}
						</DialogTitle>
						<DialogDescription>
							{#snippet element(attributes)}
								<p {...attributes}>
									We sent a confirmation email to <strong>{values.email.trim()}</strong>. The list only adds you once
									you confirm it, and every message carries an unsubscribe link.
								</p>
							{/snippet}
						</DialogDescription>
					</div>
					<DialogCloseTrigger class="button subscribe-capture__close">Close</DialogCloseTrigger>
				{:else}
					<DialogTitle>
						{#snippet element(attributes)}
							<h2 {...attributes} class="subscribe-capture__title">Hear from the Tool Bus</h2>
						{/snippet}
					</DialogTitle>
					<DialogDescription>
						{#snippet element(attributes)}
							<p {...attributes} class="subscribe-capture__lede">
								An occasional email about open hours, workdays and what the club is up to. A few a month at most, and
								every one carries an unsubscribe link.
							</p>
						{/snippet}
					</DialogDescription>

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
							<DialogCloseTrigger class="button button--secondary subscribe-capture__close">Not now</DialogCloseTrigger>
						</div>
					</form>
				{/if}
			</DialogContent>
		</DialogPositioner>
	</Dialog>
{/if}

<style>
	/* Keep Dialog styles in this component so a flag-off build omits them. Use :global
	 * because the anatomy creates the elements. The backdrop and dialog sit below
	 * --z-intro. Hide them in print and stand down when forced colours turn on. */
	:global(.subscribe-capture__backdrop) {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal-backdrop);
		background: color-mix(in oklab, var(--fg) 35%, transparent);
	}

	:global(.subscribe-capture__positioner) {
		position: fixed;
		inset-inline-end: 1rem;
		inset-block-end: 1rem;
		z-index: var(--z-modal);
		width: min(24rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		overflow: auto;
	}

	:global(.subscribe-capture) {
		border: 1px solid var(--rule);
		border-left: 0.4rem solid var(--highlight-edge);
		border-radius: 0;
		background: var(--panel);
		color: var(--fg);
		padding: 1.35rem;
		box-shadow: 0 1px 30px color-mix(in oklab, var(--bg) 40%, transparent);
	}

	:global(.subscribe-capture__title) {
		margin: 0 0 0.5rem;
		color: var(--heading);
		font-size: 1.35rem;
	}

	:global(.subscribe-capture__lede) {
		margin: 0;
		color: var(--fg-muted);
	}

	:global(.subscribe-capture__form) {
		display: grid;
		gap: 0.55rem;
		margin-top: 1rem;
	}

	:global(.subscribe-capture__form label) {
		font-weight: 700;
	}

	:global(.subscribe-capture__form input),
	:global(.subscribe-capture__form altcha-widget) {
		width: 100%;
		border: 1px solid var(--accent);
		border-radius: 0;
		background: var(--panel);
		color: var(--fg);
		font: inherit;
	}

	:global(.subscribe-capture__form input) {
		padding: 0.75rem;
	}

	:global(.subscribe-capture__form altcha-widget) {
		display: flex;
		margin-top: 0.5rem;
		padding: 0.75rem;
	}

	:global(.subscribe-capture__form input:focus-visible) {
		outline: 2px solid var(--highlight-edge);
		outline-offset: 2px;
	}

	:global(.subscribe-capture__form input[aria-invalid='true']) {
		border-color: var(--danger);
	}

	:global(.subscribe-capture__actions) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	:global(.subscribe-capture .button) {
		border-radius: 0;
	}

	:global(.subscribe-capture .button:disabled) {
		cursor: wait;
		opacity: 0.65;
	}

	:global(.subscribe-capture .form-notice + .subscribe-capture__close) {
		margin-top: 1rem;
	}

	@media print {
		:global(.subscribe-capture__backdrop),
		:global(.subscribe-capture__positioner) {
			display: none !important;
		}
	}
</style>
