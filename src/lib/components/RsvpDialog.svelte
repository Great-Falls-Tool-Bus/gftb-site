<script lang="ts">
	// RSVP for a work session (operator interview 2026-10-02, Option A). One
	// instance on the home page takes the band's RSVP_OPEN_EVENT (and cancels
	// it, so the band does not fall back to the contact section) and opens a
	// modal for that session. The RSVP rides the public contact relay as a
	// contact message: the name starts with "RSVP ", the message carries
	// "Slot: <id>", and no acknowledgement is sent; a keyholder replies by
	// hand. Fields: email (required), name or handle (optional), "Anything we
	// should know?" (optional), the honeypot and the shared ALTCHA widget.
	//
	// States: an invalid email is caught here and sends nothing; a 400 about
	// the address says to check it; 429 and 500 have their own copy; when the
	// relay cannot be reached at all (offline, CORS, down) the dialog offers
	// the same RSVP by email. A filled honeypot shows the quiet success and
	// sends nothing. A sent slot is remembered in memory only, for this page
	// view: reopening it says "Already sent". The trigger stays enabled, and
	// focus goes back to it whenever the dialog closes. A send keeps running
	// when the dialog closes: its answer marks its own slot as sent and shows
	// only while that slot's dialog is open, and reopening that slot while it
	// is in flight shows the disabled "Sending…" button again.
	//
	// The Dialog anatomy is the one SubscribeCapture.svelte adopted (see the
	// ADOPTION RECORD there); the dress is this file's own :global block.
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { contactApiUrl, contactChallengeUrl, hasErrors, isHoneypotTripped } from '$lib/contact-form';
	import { loadAltchaWidget, resolveAltcha, watchAltcha } from '$lib/altcha-loader';
	import {
		buildRsvpMailtoHref,
		emptyRsvpValues,
		RSVP_FAILURE_COPY,
		RSVP_CHECK_EMAIL,
		RSVP_HANDLE_MAX,
		RSVP_NOTE_MAX,
		RSVP_OPEN_ATTR,
		RSVP_OPEN_EVENT,
		rsvpFailureFor,
		toRsvpPayload,
		validateRsvp,
		type RsvpFailure,
		type RsvpFieldErrors,
		type RsvpFormValues,
		type RsvpOpenDetail,
		type RsvpSlot,
	} from '$lib/rsvp-form';
	// The parts are bound to flat local names once, so the minified bundle
	// carries no `X.Title`-style member access for the leak scan to read
	// as a personal name (operator ruling 2026-10-02).
	const {
		Backdrop: DialogBackdrop,
		Positioner: DialogPositioner,
		Content: DialogContent,
		Title: DialogTitle,
		Description: DialogDescription,
		CloseTrigger: DialogCloseTrigger,
	} = Dialog;

	const formEndpoint = 'https://forms.latoolb.us';
	const keyholders = 'keyholders@latoolb.us';
	const requestTimeoutMs = 15_000;

	type Status = 'idle' | 'submitting' | 'success' | 'error' | 'already';

	let open = $state(false);
	let slot = $state<RsvpSlot>({ slotId: '', label: '' });
	let status = $state<Status>('idle');
	let failure = $state<RsvpFailure>('unreachable');
	let values = $state<RsvpFormValues>(emptyRsvpValues());
	let fieldErrors = $state<RsvpFieldErrors>({});
	let altchaPayload = $state('');
	let widgetEl = $state<HTMLElement | undefined>();
	let emailEl = $state<HTMLInputElement | undefined>();
	let sentEmail = $state('');
	/** Slots sent from this page view; memory only, never stored. */
	const sent = new SvelteSet<string>();
	let trigger: HTMLElement | null = null;
	/** Counts submits, so only the latest one's answer reaches the dialog. */
	let submitSeq = 0;
	/** The slot whose send is in flight, or '' when none is. */
	let inFlightSlotId = '';

	const mailtoHref = $derived(buildRsvpMailtoHref(keyholders, slot, { handle: values.handle, note: values.note }));

	onMount(() => {
		const onOpen = (event: Event) => {
			const detail = (event as CustomEvent<RsvpOpenDetail>).detail;
			if (!detail || typeof detail.slotId !== 'string' || typeof detail.label !== 'string') return;
			event.preventDefault();
			trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			if (detail.slotId !== slot.slotId) {
				values = { ...emptyRsvpValues(), email: values.email, handle: values.handle };
			}
			slot = { slotId: detail.slotId, label: detail.label };
			fieldErrors = {};
			altchaPayload = '';
			if (inFlightSlotId === detail.slotId) status = 'submitting';
			else status = sent.has(detail.slotId) ? 'already' : 'idle';
			open = true;
		};
		window.addEventListener(RSVP_OPEN_EVENT, onOpen);
		return () => {
			window.removeEventListener(RSVP_OPEN_EVENT, onOpen);
			document.documentElement.removeAttribute(RSVP_OPEN_ATTR);
		};
	});

	$effect(() => {
		if (!open) return;
		loadAltchaWidget();
		document.documentElement.setAttribute(RSVP_OPEN_ATTR, '');
		return () => document.documentElement.removeAttribute(RSVP_OPEN_ATTR);
	});

	// The widget is rebuilt each time the form shows, so every opening solves
	// a fresh proof (proofs are single use and expire after 30 minutes).
	$effect(() => {
		const element = widgetEl;
		if (!element) return;
		return watchAltcha(element, (payload) => {
			altchaPayload = payload;
		});
	});

	async function close() {
		if (!open) return;
		open = false;
		await tick();
		requestAnimationFrame(() => {
			if (trigger?.isConnected) trigger.focus();
		});
	}

	function onOpenChange(details: { open: boolean }) {
		if (!details.open) void close();
	}

	async function fail(reason: RsvpFailure) {
		failure = reason;
		status = 'error';
		altchaPayload = '';
		resolveAltcha(widgetEl);
		if (reason === 'invalid-email') {
			fieldErrors = { ...fieldErrors, email: RSVP_CHECK_EMAIL };
			await tick();
			emailEl?.focus();
		}
	}

	// The form, and the Send button that had focus, give way to the
	// confirmation: focus moves to its heading so the confirmation is read
	// out and keyboard focus stays in the dialog.
	async function focusConfirmation() {
		await tick();
		document.querySelector<HTMLElement>('[data-testid="rsvp-dialog"] .rsvp-dialog__title')?.focus();
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (status === 'submitting') return;
		if (isHoneypotTripped(values)) {
			// A filled honeypot is not a person: the quiet outcome, nothing sent.
			sentEmail = values.email.trim();
			status = 'success';
			await focusConfirmation();
			return;
		}

		fieldErrors = validateRsvp(values);
		if (hasErrors(fieldErrors)) {
			await tick();
			if (fieldErrors.email) emailEl?.focus();
			else document.getElementById(fieldErrors.handle ? 'rsvp-handle' : 'rsvp-note')?.focus();
			return;
		}

		status = 'submitting';
		const sentSlot = slot;
		const run = ++submitSeq;
		inFlightSlotId = sentSlot.slotId;
		// The answer belongs to the dialog only while it still shows this send.
		const current = () => open && run === submitSeq && slot.slotId === sentSlot.slotId;
		const payload = toRsvpPayload(sentSlot, values, altchaPayload);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
		try {
			const response = await fetch(contactApiUrl(formEndpoint), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
				signal: controller.signal,
			});
			if (!response.ok) {
				const body: unknown = await response.json().catch(() => null);
				if (run === submitSeq) inFlightSlotId = '';
				if (current()) await fail(rsvpFailureFor(response.status, body));
				return;
			}
			sent.add(sentSlot.slotId);
			if (run === submitSeq) inFlightSlotId = '';
			if (current()) {
				sentEmail = payload.email;
				status = 'success';
				await focusConfirmation();
			}
		} catch (error) {
			if (run === submitSeq) inFlightSlotId = '';
			if (current()) {
				await fail(error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'unreachable');
			}
		} finally {
			clearTimeout(timer);
		}
	}

	function retry() {
		status = 'idle';
		altchaPayload = '';
		resolveAltcha(widgetEl);
	}
</script>

{#if open}
	<Dialog
		open={true}
		{onOpenChange}
		closeOnEscape={true}
		closeOnInteractOutside={true}
		restoreFocus={false}
		preventScroll={false}
		initialFocusEl={() => emailEl ?? null}
	>
		<DialogBackdrop class="rsvp-dialog__backdrop" />
		<DialogPositioner class="rsvp-dialog__positioner">
			<DialogContent class="rsvp-dialog" data-testid="rsvp-dialog">
				<!-- TODO(jess): RSVP wording. Every rendered string below is interim. -->
				{#if status === 'success'}
					<div class="form-notice form-notice--success" role="status" aria-live="polite">
						<DialogTitle>
							{#snippet element(attributes)}
								<h2 {...attributes} class="rsvp-dialog__title" tabindex="-1">Thanks. Your RSVP has been sent.</h2>
							{/snippet}
						</DialogTitle>
						<DialogDescription>
							{#snippet element(attributes)}
								<p {...attributes}>
									A keyholder will reply to <strong>{sentEmail}</strong> about {slot.label}.
								</p>
							{/snippet}
						</DialogDescription>
						<p>Replies usually come within three business days.</p>
					</div>
					<DialogCloseTrigger class="button rsvp-dialog__close">Close</DialogCloseTrigger>
				{:else if status === 'already'}
					<div class="form-notice form-notice--success" role="status">
						<DialogTitle>
							{#snippet element(attributes)}
								<h2 {...attributes} class="rsvp-dialog__title">Already sent</h2>
							{/snippet}
						</DialogTitle>
						<DialogDescription>
							{#snippet element(attributes)}
								<p {...attributes}>
									You sent an RSVP for {slot.label} from this page. A keyholder will reply by email.
								</p>
							{/snippet}
						</DialogDescription>
						<p>Replies usually come within three business days.</p>
					</div>
					<DialogCloseTrigger class="button rsvp-dialog__close">Close</DialogCloseTrigger>
				{:else}
					<DialogTitle>
						{#snippet element(attributes)}
							<h2 {...attributes} class="rsvp-dialog__title">RSVP for a work session</h2>
						{/snippet}
					</DialogTitle>
					<DialogDescription>
						{#snippet element(attributes)}
							<p {...attributes} class="rsvp-dialog__session">{slot.label}, on the bus.</p>
						{/snippet}
					</DialogDescription>

					<form
						class="rsvp-dialog__form"
						method="post"
						action={contactApiUrl(formEndpoint)}
						onsubmit={handleSubmit}
						novalidate
					>
						{#if status === 'error'}
							<div class="form-notice form-notice--error" role="alert">
								<p>
									{RSVP_FAILURE_COPY[failure]} You can try again or
									<a href={mailtoHref}>send your RSVP by email</a>.
								</p>
								<button class="text-button" type="button" onclick={retry}>Try again</button>
							</div>
						{/if}

						<label for="rsvp-email">Email</label>
						<input
							id="rsvp-email"
							name="email"
							type="email"
							autocomplete="email"
							maxlength="254"
							bind:this={emailEl}
							bind:value={values.email}
							aria-invalid={fieldErrors.email ? 'true' : undefined}
							aria-describedby={fieldErrors.email ? 'rsvp-email-error' : undefined}
							required
						/>
						{#if fieldErrors.email}<p id="rsvp-email-error" class="field-error">{fieldErrors.email}</p>{/if}

						<label for="rsvp-handle">Name or handle (optional)</label>
						<input
							id="rsvp-handle"
							name="handle"
							autocomplete="nickname"
							maxlength={RSVP_HANDLE_MAX}
							bind:value={values.handle}
							aria-invalid={fieldErrors.handle ? 'true' : undefined}
							aria-describedby={fieldErrors.handle ? 'rsvp-handle-error' : undefined}
						/>
						{#if fieldErrors.handle}<p id="rsvp-handle-error" class="field-error">{fieldErrors.handle}</p>{/if}

						<label for="rsvp-note">Anything we should know? (optional)</label>
						<textarea
							id="rsvp-note"
							name="note"
							rows="3"
							maxlength={RSVP_NOTE_MAX}
							bind:value={values.note}
							aria-invalid={fieldErrors.note ? 'true' : undefined}
							aria-describedby={fieldErrors.note ? 'rsvp-note-error' : undefined}></textarea>
						{#if fieldErrors.note}<p id="rsvp-note-error" class="field-error">{fieldErrors.note}</p>{/if}

						<div class="honeypot" aria-hidden="true">
							<label for="rsvp-website">Website (leave blank)</label>
							<input id="rsvp-website" name="website" tabindex="-1" autocomplete="off" bind:value={values.website} />
						</div>

						<altcha-widget
							bind:this={widgetEl}
							challengeurl={contactChallengeUrl(formEndpoint)}
							name="altcha"
							auto="onload"
							label="Human verification"
						></altcha-widget>
						<p class="form-help">
							A private, puzzle-free proof-of-work check accompanies the request. If it is unavailable, you can still
							send.
						</p>

						<p class="rsvp-dialog__privacy">
							We send your email address, and the name and note if you give them, through our form relay to
							keyholders@latoolb.us, a private list read by keyholders. The relay adds your connection's IP address. The
							list keeps a private archive; ask us to delete your message at any time by writing to the same address.
							Nothing from this form is stored on this site or in your browser.
						</p>

						<div class="rsvp-dialog__actions">
							<button class="button" type="submit" disabled={status === 'submitting'}>
								{status === 'submitting' ? 'Sending…' : 'Send RSVP'}
							</button>
							<DialogCloseTrigger class="button button--secondary rsvp-dialog__close">Cancel</DialogCloseTrigger>
						</div>
					</form>
				{/if}
			</DialogContent>
		</DialogPositioner>
	</Dialog>
{/if}

<style>
	/* Every rule is :global because the Dialog anatomy renders the classed
	   elements itself. Existing roles only (no new colour); backdrop and box
	   ride the semantic ladder below --z-intro. Sharp edges throughout; no
	   transition or animation; absent on paper. */
	:global(.rsvp-dialog__backdrop) {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal-backdrop);
		background: color-mix(in oklab, var(--fg) 35%, transparent);
	}

	:global(.rsvp-dialog__positioner) {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		display: grid;
		place-items: center;
		padding: 1rem;
		overflow: auto;
	}

	:global(.rsvp-dialog) {
		width: min(30rem, 100%);
		max-height: calc(100vh - 2rem);
		overflow: auto;
		border: 1px solid var(--rule);
		border-left: 0.4rem solid var(--highlight-edge);
		border-radius: 0;
		background: var(--panel);
		color: var(--fg);
		padding: 1.35rem;
		box-shadow: 0 1px 30px color-mix(in oklab, var(--bg) 40%, transparent);
	}

	:global(.rsvp-dialog__title) {
		margin: 0 0 0.5rem;
		color: var(--heading);
		font-size: 1.35rem;
	}

	/* The confirmation heading takes focus only to be read out; it is not a
	   control, so it draws no ring. */
	:global(.rsvp-dialog__title[tabindex='-1']:focus) {
		outline: none;
	}

	:global(.rsvp-dialog__session) {
		margin: 0;
		font-weight: 700;
	}

	:global(.rsvp-dialog__form) {
		display: grid;
		gap: 0.55rem;
		margin-top: 1rem;
	}

	:global(.rsvp-dialog__form label) {
		font-weight: 700;
	}

	:global(.rsvp-dialog__form input),
	:global(.rsvp-dialog__form textarea),
	:global(.rsvp-dialog__form altcha-widget) {
		width: 100%;
		border: 1px solid var(--accent);
		border-radius: 0;
		background: var(--panel);
		color: var(--fg);
		font: inherit;
	}

	:global(.rsvp-dialog__form input),
	:global(.rsvp-dialog__form textarea) {
		padding: 0.75rem;
	}

	:global(.rsvp-dialog__form altcha-widget) {
		display: flex;
		margin-top: 0.5rem;
		padding: 0.75rem;
	}

	:global(.rsvp-dialog__form input:focus-visible),
	:global(.rsvp-dialog__form textarea:focus-visible) {
		outline: 2px solid var(--highlight-edge);
		outline-offset: 2px;
	}

	:global(.rsvp-dialog__form [aria-invalid='true']) {
		border-color: var(--danger);
	}

	:global(.rsvp-dialog__privacy) {
		margin: 0.5rem 0 0;
		color: var(--fg-muted);
		font-size: 0.9rem;
	}

	:global(.rsvp-dialog__actions) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	:global(.rsvp-dialog .button) {
		border-radius: 0;
	}

	:global(.rsvp-dialog .button:disabled) {
		cursor: wait;
		opacity: 0.65;
	}

	:global(.rsvp-dialog .form-notice + .rsvp-dialog__close) {
		margin-top: 1rem;
	}

	@media print {
		:global(.rsvp-dialog__backdrop),
		:global(.rsvp-dialog__positioner) {
			display: none !important;
		}
	}
</style>
