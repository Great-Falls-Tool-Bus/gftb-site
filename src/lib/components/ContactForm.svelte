<script lang="ts">
	import {
		buildMailtoHref,
		contactApiUrl,
		contactChallengeUrl,
		emptyContactValues,
		hasErrors,
		isHoneypotTripped,
		toContactPayload,
		validateContactForm,
		type ContactFieldErrors,
		type ContactFormValues,
	} from '$lib/contact-form';

	const formEndpoint = 'https://forms.latoolb.us';
	const keyholders = 'keyholders@latoolb.us';
	const requestTimeoutMs = 15_000;
	type Status = 'idle' | 'submitting' | 'success' | 'error';

	let status = $state<Status>('idle');
	let values = $state<ContactFormValues>(emptyContactValues());
	let fieldErrors = $state<ContactFieldErrors>({});
	let submitError = $state('');
	let altchaPayload = $state('');
	let widgetEl = $state<HTMLElement | undefined>();
	const mailtoHref = $derived(buildMailtoHref(keyholders, values));

	$effect(() => {
		if (typeof document === 'undefined' || document.querySelector('script[data-altcha]')) return;
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

	function focusFirstError() {
		for (const field of ['name', 'email', 'message'] as const) {
			if (fieldErrors[field]) {
				document.getElementById(`contact-${field}`)?.focus();
				return;
			}
		}
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		submitError = '';
		if (isHoneypotTripped(values)) {
			status = 'success';
			return;
		}

		fieldErrors = validateContactForm(values);
		if (hasErrors(fieldErrors)) {
			focusFirstError();
			return;
		}

		status = 'submitting';
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
		try {
			const response = await fetch(contactApiUrl(formEndpoint), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(toContactPayload(values, altchaPayload)),
				signal: controller.signal,
			});
			if (!response.ok) throw new Error(`The contact service answered ${response.status}.`);
			status = 'success';
		} catch (error) {
			status = 'error';
			submitError =
				error instanceof DOMException && error.name === 'AbortError'
					? 'The contact service took too long to answer.'
					: 'We could not reach the contact service.';
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

{#if status === 'success'}
	<div class="form-notice form-notice--success" role="status" aria-live="polite">
		<h3>Thanks — your note is on its way.</h3>
		<p>A keyholder will reply to the email address you provided.</p>
	</div>
{:else}
	<form class="contact-form" method="post" action={contactApiUrl(formEndpoint)} onsubmit={handleSubmit} novalidate>
		{#if status === 'error'}
			<div class="form-notice form-notice--error" role="alert">
				<p>{submitError} You can retry or <a href={mailtoHref}>send the same note by email</a>.</p>
				<button class="text-button" type="button" onclick={retry}>Try again</button>
			</div>
		{/if}

		<label for="contact-name">Name</label>
		<input
			id="contact-name"
			name="name"
			autocomplete="name"
			bind:value={values.name}
			aria-invalid={fieldErrors.name ? 'true' : undefined}
			aria-describedby={fieldErrors.name ? 'contact-name-error' : undefined}
			required
		/>
		{#if fieldErrors.name}<p id="contact-name-error" class="field-error">{fieldErrors.name}</p>{/if}

		<label for="contact-email">Email</label>
		<input
			id="contact-email"
			name="email"
			type="email"
			autocomplete="email"
			bind:value={values.email}
			aria-invalid={fieldErrors.email ? 'true' : undefined}
			aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined}
			required
		/>
		{#if fieldErrors.email}<p id="contact-email-error" class="field-error">{fieldErrors.email}</p>{/if}

		<label for="contact-message">What would you like to ask or help with?</label>
		<textarea
			id="contact-message"
			name="message"
			rows="5"
			bind:value={values.message}
			aria-invalid={fieldErrors.message ? 'true' : undefined}
			aria-describedby={fieldErrors.message ? 'contact-message-error' : undefined}
			required></textarea>
		{#if fieldErrors.message}<p id="contact-message-error" class="field-error">{fieldErrors.message}</p>{/if}

		<div class="honeypot" aria-hidden="true">
			<label for="contact-website">Website (leave blank)</label>
			<input id="contact-website" name="website" tabindex="-1" autocomplete="off" bind:value={values.website} />
		</div>

		<altcha-widget
			bind:this={widgetEl}
			challengeurl={contactChallengeUrl(formEndpoint)}
			name="altcha"
			auto="onload"
			label="Human verification"
		></altcha-widget>
		<p class="form-help">
			A private, puzzle-free proof-of-work check accompanies the request. If it is unavailable, you can still send.
		</p>

		<button class="button" type="submit" disabled={status === 'submitting'}>
			{status === 'submitting' ? 'Sending…' : 'Send to keyholders'}
		</button>
		<noscript>
			<p>Email <a href={`mailto:${keyholders}`}>{keyholders}</a> if JavaScript is unavailable.</p>
		</noscript>
	</form>
{/if}
