# Dynamic-spoke deployment — superseded receiver design

- Status: superseded 2026-08-03 under TIN-489/TIN-3066.
- Original date: 2026-06-29.
- Linear: TIN-2228.

The original design coupled adapter-node deployment and blue/green lifecycle to
a shared Blahaj receiver. That application authority was never a property of
the scaffold and is removed.

The retained decisions are narrow:

- Static spokes publish through their declared atomic host.
- `scripts/rebrand.sh --adapter=node` selects an application/stateful repo
  shape, not a deployment carrier.
- A dynamic product's dedicated owner overlay must define immutable image
  identity, protected state/apply, health, cutover, rollback, and real-edge
  served readback.
- This scaffold ships no dynamic receiver, controller, dispatch payload, or
  OpenTofu application module.

Git history preserves the former BLUE/GREEN proposal. A future owner-overlay
implementation must be reviewed in the owning product and must not revive the
removed shared receiver.
