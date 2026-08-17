# On-cluster adapter-node hosting boundary

- Status: owner-defined opt-in; receiver-specific design removed 2026-08-03.
- Original date: 2026-07-05.
- Linear: TIN-2544.

A dynamic spoke may publish a non-root adapter-node image. The public
application repository may own its `ContainerFile`, immutable artifact, health
endpoint, and non-secret environment shape.

Its dedicated product owner overlay owns:

- Kubernetes workloads and service objects;
- namespace, resource, and rollout policy;
- exact image digest and protected saved-plan application;
- tenant Secrets and state;
- ingress/tunnel intent and runtime receipts;
- rollback and real-edge `SERVED` proof.

The application repository holds no cluster manifests, tenant credentials, or
apply state. A generic cluster/tunnel substrate may implement bounded primitives
without acquiring product promotion authority.

This scaffold ships no application receiver, dispatch schema, controller,
manifest, or deployment workflow. Git history preserves the former
Blahaj-specific proposal as incident evidence.
