# Agent Note: final response presentation boundary

Status: implemented

English | [中文](2026-09-02-final-response-presentation-boundary.zh.md)

## Problem

The canonical assistant message serves three jobs at once: durable Session truth, later model history, and user-facing output. An application that needs to vary expression after reasoning cannot rewrite that message without changing history, and observing `session/event` is too late to stop Web from showing raw chunks. System-prompt persona changes happen before reasoning, while transport-specific wrappers do not establish one invariant across Web and Headless.

## Decision

The host plane provides an optional `@deepseek-ai/dsh-final-response-presentation` service. It extracts one completed plain-text assistant candidate after terminal `turn/end`, detaches and freezes its narrow data, and calls an Agent-scoped transformer. The transformer returns text only. State is a `WeakMap<Agent, RuntimeState>` with an epoch, abort controller, JSON config, and transient annotations; switch, disable, and Agent disposal abort old work and clear annotations.

The Session log remains canonical and gains no event type. API Proxy's inactive path remains direct. Its active path buffers candidate assistant events until completion, then emits optional `presentation` annotations beside unchanged wire events. Web suppresses annotated source chunks and displays annotated final text. Headless flushes persistence before selecting presented stdout. Exceptions, timeout, malformed output, ineligibility, and stale epochs all fall back to canonical delivery.

## Guarantee boundary

The service mechanically owns stage ordering, canonical non-mutation, plain-text-only admission, absence of tool/control output authority, process-local isolation, and neutral fallback. The callback is trusted same-process code despite its narrow explicit input. DSH does not claim to prove semantic equivalence of arbitrary natural-language rewrites; an application owns its semantic envelope, eligibility policy, and eval.

## Alternatives considered

**Rewrite `assistant/message` before persistence.** Rejected because the rewritten expression would become model history and durable truth, collapsing canonical semantics with display.

**Add a durable presentation Session event.** Rejected because display state must disappear on restart and must not become model, persistence, transcript, or evidence input merely because a user saw it.

**Transform in Web and Headless independently.** Rejected because it duplicates policy, allows transport drift, and leaves Web raw-chunk leakage unresolved.

**Stream transformed tokens.** Deferred because no final semantic result exists while raw tokens arrive. V1 trades first-token display latency for a strict post-completion boundary only when an Agent opts in.

## Consequences

Disabled profiles retain current delivery and streaming. Active plain-text responses incur turn-sized buffering and one bounded transform, then display without changing Session bytes or later model requests. Tool-call, mixed, incomplete, and application-ineligible outputs bypass. Live history can carry the current annotation while its Agent exists, but restart/resume does not reconstruct presentation state. Applications can add expression safely within their own guard, but cannot cite this primitive alone as proof of natural language semantic invariance.
