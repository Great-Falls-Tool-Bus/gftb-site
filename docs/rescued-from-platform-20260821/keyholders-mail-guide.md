# Keyholder mail guide (rescued from platform `/keyholders`)

Source: `greatfallstoolbus.org` `src/routes/keyholders/+page.svelte`, driven
by `src/lib/data/mail-clients.ts`. Redactions: none — the page is a
step-by-step onboarding guide for approved keyholders joining the private
`keyholders@latoolb.us` role list (Apple Mail, Gmail, Thunderbird, Outlook,
KMail, Geary, and server-side Sieve), with no PII.

**Operator call needed, not made here:** this is a private-list onboarding
runbook, not "public information about the project" in the sense the other
rescued families are. It may belong on this public microsite (so a new
keyholder can find it without repo access), or it may belong in private
operating docs instead. The platform repo's `mail-clients.ts` and its
`gftb-mail-laceup-*` skills remain the canonical source either way — this
rescue file is a pointer, not the data itself, so nothing here can drift out
of sync with that source.

## What the source page did

For each supported mail client, it walked through: subscribing to
`keyholders@latoolb.us`, filing incoming list mail, and replying correctly
(so replies thread and don't leak individual addresses beyond the list). It
closed with a pointer to the platform repo's `/agent` route, which publishes
one lace-up skill per client "ready for your own coding or desktop agent" —
that pointer does not carry over here, since (per the disposition table in
this directory's README) `/agent` itself is not being rescued: it indexes
the platform repo's own developer contract, not this one.
