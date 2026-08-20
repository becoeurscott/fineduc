# Services

The application services that **both** `apps/api` and `apps/worker` execute.

It exists because apps may never import each other (enforced by
`eslint-plugin-boundaries`), and the worker runs the same money paths the API
does — `webhook-processor` settles a payment exactly as the HTTP path settles
cash. Duplicating that across the boundary would drift, and the first symptom
of drift on a money path is a balance nobody can explain.

## The entry rule

**Something belongs here only when BOTH processes genuinely run it.**

Anything used by one app stays in that app. Without that rule this becomes a
junk drawer, and a junk drawer shared between two processes is how a modular
monolith quietly turns into a distributed one.

## No frameworks

Nothing here imports Nest, Express or BullMQ. These are plain classes:

- `apps/api` wires them with **explicit factory providers**, so the dependency
  graph is readable without knowing how Nest resolves constructor metadata.
- `apps/worker` just constructs them.

The logger is the same idea — a three-method interface, defaulting to the
console, so the API can pass Nest's `Logger` and the worker needs no container
just to write a line.

## Contents

| Service | Used by |
| --- | --- |
| `SettlementService` | api (cash), worker (webhook-processor, reconciler) |
| `WebhookIngestService` | api (the public endpoint) |
| `WebhookProcessorService` | worker (webhook-processor), api (tests) |
