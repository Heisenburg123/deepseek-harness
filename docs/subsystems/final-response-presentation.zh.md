# 最终回复呈现

[English](final-response-presentation.md) | 中文

[`@deepseek-ai/dsh-final-response-presentation`](../../packages/core/final-response-presentation) 所拥有的可选进程内显示服务。只有在规范纯文本 assistant 回复与 completed 轮次都已存在后，它才接收分离的 candidate；它可以附加短暂显示 annotation，但不会改变 Session 日志、后续模型历史、工具或持久化。

源码：[`packages/core/final-response-presentation/src/index.ts`](../../packages/core/final-response-presentation/src/index.ts)

## 选择与 Transformer

服务配置约束 transform 的 deadline 与可接受输出大小。应用为某个精确的活跃 Agent 选择一个 transformer；只有分离的 candidate、无损 JSON 配置和协作式 abort signal 会进入应用代码。

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

切换与禁用都会推进 epoch、中止旧工作并清除显示 annotation。Agent 作用域 dispose 会移除选择与缓存。任何选择或 annotation 都不会跨进程重启保留。

## 决策与 Transport Annotation

服务只接纳 selected transformer 返回的非空、受大小限制文本。不适用、不完整或结构化 candidate、异常、deadline、畸形输出、取消与过期 epoch 都会产生 neutral 决策；transport 必须据此原样交付规范回复。

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

Annotation 使用已经附着的 Session 对象作为只读查询键；冷历史与 subagent 历史读取绝不会为了发现显示状态而获取或激活 Agent。服务不发出 Session event。应用 eligibility 负责 artifact 分类与语义保持策略；通用服务无法证明任意自然语言变换保持等义。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md) · [Session](session.zh.md) · [SessionEvent](session.zh.md)

Source: [`packages/core/final-response-presentation/src/index.ts`](../../packages/core/final-response-presentation/src/index.ts)
<!-- END GENERATED cordis-surface -->
