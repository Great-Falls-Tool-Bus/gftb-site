// RSVP for a work session on the bus (operator interview 2026-10-02). An RSVP
// rides the public contact relay as a contact message whose name starts with
// "RSVP " and whose message carries "Slot: <id>"; no acknowledgement is sent.
// Before hydration, and wherever the relay cannot be reached, the band's RSVP
// control is a mailto link built here. Unlike the contact builder it writes
// no Email line: the visitor's own address is the sender.

/**
 * Dispatched on `window` by the band's RSVP button once hydrated, cancelable.
 * The RSVP dialog consumes it (and cancels it); while nothing does, the band
 * takes the visitor to the contact section instead.
 */
export const RSVP_OPEN_EVENT = 'gftb:rsvp-open';

export interface RsvpSlot {
	/** `<slot id>@<YYYY-MM-DD>` for a dated session, or the slot id alone. */
	slotId: string;
	/** `Thursday 8 October, 3 to 4 PM ET`, or the slot's rule text. */
	label: string;
}

export type RsvpOpenDetail = RsvpSlot;

export function rsvpSubject(slot: RsvpSlot): string {
	return `RSVP ${slot.label}`;
}

export function buildRsvpMailtoHref(to: string, slot: RsvpSlot): string {
	const body = [
		`Slot: ${slot.slotId}`,
		`Session: ${slot.label}`,
		'',
		'Name or handle (optional):',
		'',
		'Anything we should know? (optional):',
		'',
	].join('\n');
	return `mailto:${to}?subject=${encodeURIComponent(rsvpSubject(slot))}&body=${encodeURIComponent(body)}`;
}
