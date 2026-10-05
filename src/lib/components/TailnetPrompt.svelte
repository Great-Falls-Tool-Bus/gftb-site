<script lang="ts">
	// The footer button that asks whether you are on the tool bus network
	// (operator ruling 2026-10-05: "Set, gated by a footer button that opens a
	// modal to ask for permission using the skeleton v5 pattern"). The site never
	// probes the tailnet on page load: the probe runs only from the button inside
	// this modal, after the visitor reads that the browser will ask for permission
	// to connect to devices on the local network. A blocked request, a denied
	// permission, a timeout or a non-true answer is a quiet "no". A yes mounts the
	// membership surface through the gated store (src/lib/gated/manifest.ts).
	//
	// This file is the modal. The footer button that opens it is in
	// +layout.svelte; it is public and harmless, renders only in the browser, only
	// when the build stamped a probe URL, and only while no member links are
	// showing. The Dialog anatomy is the one RsvpDialog.svelte follows.
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { gatedSurface } from '$lib/gated/surface.svelte';

	const {
		Backdrop: DialogBackdrop,
		Positioner: DialogPositioner,
		Content: DialogContent,
		Title: DialogTitle,
		Description: DialogDescription,
		CloseTrigger: DialogCloseTrigger,
	} = Dialog;

	const state = $derived(gatedSurface.tailnet);
	let checkEl = $state<HTMLButtonElement>();

	function onOpenChange(details: { open: boolean }) {
		gatedSurface.promptOpen = details.open;
	}
</script>

{#if gatedSurface.promptOpen}
	<Dialog
		open={true}
		{onOpenChange}
		closeOnEscape={true}
		closeOnInteractOutside={true}
		restoreFocus={true}
		preventScroll={false}
	>
		<DialogBackdrop class="tailnet-dialog__backdrop" />
		<DialogPositioner class="tailnet-dialog__positioner">
			<DialogContent class="tailnet-dialog" data-testid="tailnet-dialog">
				<DialogTitle>
					{#snippet element(attributes)}
						<h2 {...attributes} class="tailnet-dialog__title">On the tool bus network?</h2>
					{/snippet}
				</DialogTitle>
				<DialogDescription>
					{#snippet element(attributes)}
						<p {...attributes}>
							If you are connected to the tool bus network, we can show the member links. When you press the button
							below, your browser will ask for permission to connect to devices on your local network. We ask one
							address, once, and send no cookies or account details.
						</p>
					{/snippet}
				</DialogDescription>

				{#if state === 'yes'}
					<p class="tailnet-dialog__result" role="status" data-testid="tailnet-result">
						You are on the tool bus network. The member links are now shown.
					</p>
				{:else if state === 'yes-empty'}
					<p class="tailnet-dialog__result" role="status" data-testid="tailnet-result">
						You are on the tool bus network, but there are no member links to show yet.
					</p>
				{:else if state === 'no'}
					<p class="tailnet-dialog__result" role="status" data-testid="tailnet-result">
						We could not confirm that you are on the tool bus network. Nothing has changed.
					</p>
				{/if}

				<div class="tailnet-dialog__actions">
					{#if state !== 'yes' && state !== 'yes-empty'}
						<button
							type="button"
							class="button"
							data-testid="tailnet-check"
							bind:this={checkEl}
							disabled={state === 'checking'}
							onclick={() => void gatedSurface.askTailnet(state === 'no')}
						>
							{state === 'checking' ? 'Checking…' : state === 'no' ? 'Check again' : 'Check the network'}
						</button>
					{/if}
					<DialogCloseTrigger class="button button--secondary">Close</DialogCloseTrigger>
				</div>
			</DialogContent>
		</DialogPositioner>
	</Dialog>
{/if}

<style>
	/* Every dialog rule is :global because the Dialog anatomy renders the
	   classed elements itself. Same dress as the RSVP dialog: the shared glass,
	   sharp edges, no transition. */
	:global(.tailnet-dialog__backdrop) {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal-backdrop);
		background: color-mix(in oklab, var(--fg) 35%, transparent);
	}

	:global(.tailnet-dialog__positioner) {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		display: grid;
		place-items: center;
		padding: 1rem;
		overflow: auto;
	}

	:global(.tailnet-dialog) {
		width: min(30rem, 100%);
		max-height: calc(100vh - 2rem);
		overflow: auto;
		border: 1px solid var(--rule);
		border-left: 0.4rem solid var(--highlight);
		border-radius: 0;
		padding: 1.35rem;
		box-shadow: 0 1px 30px color-mix(in oklab, var(--bg) 40%, transparent);
	}

	:global(.tailnet-dialog__title) {
		margin: 0 0 0.5rem;
		color: var(--heading);
		font-size: 1.35rem;
	}

	:global(.tailnet-dialog__result) {
		margin: 0.75rem 0 0;
		font-weight: 700;
	}

	:global(.tailnet-dialog__actions) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	:global(.tailnet-dialog .button) {
		border-radius: 0;
	}

	:global(.tailnet-dialog .button:disabled) {
		cursor: wait;
		opacity: 0.65;
	}

	@media print {
		:global(.tailnet-dialog__backdrop),
		:global(.tailnet-dialog__positioner) {
			display: none !important;
		}
	}
</style>
