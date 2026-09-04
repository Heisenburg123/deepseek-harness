# Final-response Presentation

English | [中文](final-response-presentation.zh.md)

The optional process-local display service owned by [`@deepseek-ai/dsh-final-response-presentation`](../../packages/core/final-response-presentation). It receives a detached candidate only after a canonical plain-text assistant response and completed turn exist, and it can attach transient display annotations without changing the Session log, later model history, tools, or persistence.

Source: [`packages/core/final-response-presentation/src/index.ts`](../../packages/core/final-response-presentation/src/index.ts)

## Selection and transformer

Service configuration bounds the transform deadline and accepted output size. An application selects one transformer for an exact live Agent; only the detached candidate, lossless JSON configuration, and cooperative abort signal cross into application code.

```ts type-equiv
/** Configuration of the neutral service row. */
interface Config {
  /** Default deadline for one display transform. */
  timeoutMs?: number
  /** Maximum UTF-8 bytes accepted from a transformer. */
  maxOutputBytes?: number
}
```

```ts type-equiv
/** Immutable semantic response supplied to an application transformer. */
interface FinalResponseCandidate {
  readonly sessionId: string
  readonly turn: number
  readonly messageId: string
  readonly text: string
  readonly reason: TurnEndReason
  readonly epoch: number
}
```

```ts type-equiv
/** Narrow, authority-free application callback. */
interface FinalResponseTransformer {
  /** Stable diagnostic identity; it is never persisted. */
  readonly id: string
  /** Optional application classifier. False, throws, or ambiguity bypasses. */
  eligible?(candidate: FinalResponseCandidate, config: JsonValue | undefined): boolean
  /** Return display text only. The signal asks cooperative work to stop. */
  transform(
    candidate: FinalResponseCandidate,
    config: JsonValue | undefined,
    signal: AbortSignal,
  ): unknown
}
```

```ts type-equiv
/** Options for one scoped activation or switch. */
interface PresentationSelection {
  readonly transformer: FinalResponseTransformer
  readonly config?: JsonValue
  readonly timeoutMs?: number
}
```

```ts type-equiv
/** Read-only state exposed for product controls and diagnostics. */
type PresentationState =
  | { readonly mode: 'off'; readonly epoch: number }
  | { readonly mode: 'active'; readonly epoch: number; readonly transformerId: string }
```

```ts type-equiv
/** Controller owned by the activating Agent scope. */
interface PresentationController {
  /** Atomically select another transformer/config and advance the epoch. */
  switch(selection: PresentationSelection): PresentationState
  /** Turn presentation off, advance the epoch, and discard cached projections. */
  disable(): PresentationState
  /** Read the current process-local state. */
  state(): PresentationState
}
```

Switch and disable advance the epoch, abort older work, and clear display annotations. Agent-scope disposal removes the selection and cache. No selection or annotation survives process restart.

## Decisions and transport annotations

The service accepts only non-empty, size-bounded text from the selected transformer. Ineligibility, incomplete or structured candidates, exceptions, deadlines, malformed output, cancellation, and stale epochs produce a neutral decision, which requires the transport to deliver the canonical response unchanged.

```ts type-equiv
/** Display-only result linked to one canonical message. */
interface PresentedFinalResponse {
  readonly kind: 'presented'
  readonly text: string
  readonly epoch: number
  readonly messageSeq: number
  readonly sourceMessageId: string
  readonly sourceEventSeqs: readonly number[]
}
```

```ts type-equiv
/** Neutral result means transports deliver the canonical response unchanged. */
interface NeutralFinalResponse {
  readonly kind: 'neutral'
  readonly reason:
    | 'off'
    | 'ineligible'
    | 'invalid-candidate'
    | 'invalid-output'
    | 'exception'
    | 'timeout'
    | 'stale-epoch'
}
```

```ts type-equiv
/** One completed boundary decision. */
type FinalResponseDecision = PresentedFinalResponse | NeutralFinalResponse
```

```ts type-equiv
/** Transient annotation consumed by a user-facing transport. */
type ResponsePresentationAnnotation =
  | { readonly kind: 'suppress'; readonly epoch: number; readonly sourceMessageId: string }
  | { readonly kind: 'text'; readonly epoch: number; readonly sourceMessageId: string; readonly text: string }
```

Annotations use an already-attached Session object as a read-only lookup key; cold and subagent history reads never acquire or activate an Agent to discover display state. The service does not emit Session events. Application eligibility owns artifact classification and semantic-preservation policy; the generic service cannot prove that arbitrary natural-language transformations preserve meaning.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxfinalresponsepresentation--finalresponsepresentation"></a>

### `ctx.finalResponsePresentation` — `FinalResponsePresentation`

Owns optional Agent-scoped presentation state and display projections. Nothing in this service is serializable or emitted as a Session event.

```ts cordis-catalog
/**
 * Whether this exact Agent currently opts into presentation buffering.
 * @param agent - Agent whose process-local presentation state is inspected.
 * @returns Whether presentation is active for that Agent.
 */
active(agent: Agent): boolean

/**
 * Read one exact Agent's state; an unregistered Agent is neutral epoch zero.
 * @param agent - Agent whose process-local presentation state is inspected.
 * @returns The current selection mode and epoch.
 */
state(agent: Agent): PresentationState

/**
 * Activate presentation for one exact Agent. The returned controller and
 * all state unwind with that Agent's own context scope.
 * @param agent - Agent that owns the process-local selection and lifecycle.
 * @param selection - Initial transformer, detached JSON config, and deadline.
 * @returns A controller for atomic switch, disable, and state inspection.
 */
activate(agent: Agent, selection: PresentationSelection): PresentationController

/**
 * Read a cached display annotation without changing canonical history.
 * @param session - Already-attached Session used as the read-only cache key.
 * @param eventSeq - Exact canonical event sequence to annotate for display.
 * @returns The transient annotation, or undefined when none is available.
 */
annotation(session: Session, eventSeq: number): ResponsePresentationAnnotation | undefined

/**
 * Project one completed turn. Every failure and ambiguity returns neutral;
 * the canonical event objects are never passed to application code.
 * @param agent - Agent whose active transformer may project the response.
 * @param events - Completed canonical turn events to inspect without mutation.
 * @returns A display-only projection or a neutral fail-closed decision.
 */
async present(agent: Agent, events: readonly SessionEvent[]): Promise<FinalResponseDecision>
```

Types: [Agent](core.md) · [Session](session.md) · [SessionEvent](session.md)

Source: [`packages/core/final-response-presentation/src/index.ts`](../../packages/core/final-response-presentation/src/index.ts)
<!-- END GENERATED cordis-surface -->
