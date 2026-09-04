/**
 * Optional final-response presentation boundary.
 *
 * The service receives a detached, frozen text candidate only after its
 * canonical assistant message and terminal turn boundary exist. A transformer
 * can return display text, but it receives no Agent, Session, tool, or
 * persistence handle. The canonical log remains the sole model-visible source.
 *
 * @module @deepseek-ai/dsh-final-response-presentation
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { deepFreeze } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Process-local boundary for optional display-only final-response projection. */
    finalResponsePresentation: FinalResponsePresentation
  }
}

/** Configuration of the neutral service row. */
export interface Config {
  /** Default deadline for one display transform. */
  timeoutMs?: number
  /** Maximum UTF-8 bytes accepted from a transformer. */
  maxOutputBytes?: number
}

/** Immutable semantic response supplied to an application transformer. */
export interface FinalResponseCandidate {
  readonly sessionId: string
  readonly turn: number
  readonly messageId: string
  readonly text: string
  readonly reason: TurnEndReason
  readonly epoch: number
}

/** Narrow, authority-free application callback. */
export interface FinalResponseTransformer {
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

/** Options for one scoped activation or switch. */
export interface PresentationSelection {
  readonly transformer: FinalResponseTransformer
  readonly config?: JsonValue
  readonly timeoutMs?: number
}

/** Read-only state exposed for product controls and diagnostics. */
export type PresentationState =
  | { readonly mode: 'off'; readonly epoch: number }
  | { readonly mode: 'active'; readonly epoch: number; readonly transformerId: string }

/** Display-only result linked to one canonical message. */
export interface PresentedFinalResponse {
  readonly kind: 'presented'
  readonly text: string
  readonly epoch: number
  readonly messageSeq: number
  readonly sourceMessageId: string
  readonly sourceEventSeqs: readonly number[]
}

/** Neutral result means transports deliver the canonical response unchanged. */
export interface NeutralFinalResponse {
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

/** One completed boundary decision. */
export type FinalResponseDecision = PresentedFinalResponse | NeutralFinalResponse

/** Controller owned by the activating Agent scope. */
export interface PresentationController {
  /** Atomically select another transformer/config and advance the epoch. */
  switch(selection: PresentationSelection): PresentationState
  /** Turn presentation off, advance the epoch, and discard cached projections. */
  disable(): PresentationState
  /** Read the current process-local state. */
  state(): PresentationState
}

interface ActiveSelection {
  readonly transformer: FinalResponseTransformer
  readonly config: JsonValue | undefined
  readonly timeoutMs: number
}

interface RuntimeState {
  epoch: number
  active: ActiveSelection | undefined
  abort: AbortController
  annotations: Map<number, ResponsePresentationAnnotation>
}

interface ExtractedCandidate {
  readonly turn: number
  readonly messageSeq: number
  readonly messageId: string
  readonly text: string
  readonly reason: TurnEndReason
  readonly sourceEventSeqs: readonly number[]
}

/** Transient annotation consumed by a user-facing transport. */
export type ResponsePresentationAnnotation =
  | { readonly kind: 'suppress'; readonly epoch: number; readonly sourceMessageId: string }
  | { readonly kind: 'text'; readonly epoch: number; readonly sourceMessageId: string; readonly text: string }

const DEFAULT_TIMEOUT_MS = 1_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024

function validPositiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`)
  return value
}

function normalizedSelection(selection: PresentationSelection, defaultTimeoutMs: number): ActiveSelection {
  if (selection.transformer.id.trim() === '') throw new TypeError('presentation transformer id must be non-empty')
  const config = selection.config === undefined ? undefined : snapshotJsonValue(selection.config)
  if (selection.config !== undefined && config === undefined) {
    throw new TypeError('presentation config must be lossless JSON')
  }
  return {
    transformer: selection.transformer,
    config: config === undefined ? undefined : deepFreeze(config),
    timeoutMs: validPositiveInteger(selection.timeoutMs, defaultTimeoutMs, 'presentation timeoutMs'),
  }
}

/**
 * Extract one transformable terminal text response without exposing mutable runtime objects.
 * @param events - Canonical event slice ending at a completed turn.
 * @returns The detached candidate coordinates and text, or undefined when the slice is ineligible.
 */
export function finalResponseCandidate(events: readonly SessionEvent[]): ExtractedCandidate | undefined {
  const terminal = events.findLast(event => event.type === 'turn/end')
  if (terminal?.type !== 'turn/end' || terminal.data.reason.kind !== 'completed') return undefined
  const turn = terminal.data.turn
  const message = events.findLast(event =>
    event.type === 'assistant/message'
    && event.data.turn === turn
    && event.data.interrupted !== true)
  if (message?.type !== 'assistant/message') return undefined
  if (message.data.message.content.length === 0
    || message.data.message.content.some(block => block.type !== 'text')) return undefined
  const text = message.data.message.content.map(block => block.type === 'text' ? block.text : '').join('')
  if (text.trim() === '') return undefined
  const sourceEventSeqs = (message as SessionEvent & { sourceEventSeqs?: number[] }).sourceEventSeqs ?? []
  return {
    turn,
    messageSeq: message.seq,
    messageId: String(message.data.message.id),
    text,
    reason: terminal.data.reason,
    sourceEventSeqs: [...sourceEventSeqs],
  }
}

/**
 * Owns optional Agent-scoped presentation state and display projections.
 * Nothing in this service is serializable or emitted as a Session event.
 */
export class FinalResponsePresentation extends Service {
  static Config: z<Config> = z.object({
    timeoutMs: z.number().min(1).step(1).default(DEFAULT_TIMEOUT_MS),
    maxOutputBytes: z.number().min(1).step(1).default(DEFAULT_MAX_OUTPUT_BYTES),
  })

  private readonly states = new WeakMap<Agent, RuntimeState>()
  private readonly sessionStates = new WeakMap<Session, RuntimeState>()
  private readonly defaultTimeoutMs: number
  private readonly maxOutputBytes: number

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'finalResponsePresentation')
    this.defaultTimeoutMs = validPositiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 'presentation timeoutMs')
    this.maxOutputBytes = validPositiveInteger(config.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 'presentation maxOutputBytes')
  }

  /**
   * Whether this exact Agent currently opts into presentation buffering.
   * @param agent - Agent whose process-local presentation state is inspected.
   * @returns Whether presentation is active for that Agent.
   */
  active(agent: Agent): boolean {
    return this.states.get(agent)?.active !== undefined
  }

  /**
   * Read one exact Agent's state; an unregistered Agent is neutral epoch zero.
   * @param agent - Agent whose process-local presentation state is inspected.
   * @returns The current selection mode and epoch.
   */
  state(agent: Agent): PresentationState {
    const state = this.states.get(agent)
    if (state?.active === undefined) return { mode: 'off', epoch: state?.epoch ?? 0 }
    return { mode: 'active', epoch: state.epoch, transformerId: state.active.transformer.id }
  }

  /**
   * Activate presentation for one exact Agent. The returned controller and
   * all state unwind with that Agent's own context scope.
   * @param agent - Agent that owns the process-local selection and lifecycle.
   * @param selection - Initial transformer, detached JSON config, and deadline.
   * @returns A controller for atomic switch, disable, and state inspection.
   */
  activate(agent: Agent, selection: PresentationSelection): PresentationController {
    if (this.states.has(agent)) throw new Error(`final response presentation already registered for agent "${agent.id}"`)
    const state: RuntimeState = {
      epoch: 1,
      active: normalizedSelection(selection, this.defaultTimeoutMs),
      abort: new AbortController(),
      annotations: new Map(),
    }
    this.states.set(agent, state)
    this.sessionStates.set(agent.session, state)
    agent.ctx.effect(() => () => {
      state.abort.abort('disposed')
      state.annotations.clear()
      this.states.delete(agent)
      if (this.sessionStates.get(agent.session) === state) this.sessionStates.delete(agent.session)
    }, 'finalResponsePresentation.activate()')

    const replace = (next: ActiveSelection | undefined): PresentationState => {
      if (this.states.get(agent) !== state) return { mode: 'off', epoch: state.epoch }
      state.abort.abort('state-changed')
      state.abort = new AbortController()
      state.annotations.clear()
      state.epoch += 1
      state.active = next
      return this.state(agent)
    }
    return {
      switch: next => replace(normalizedSelection(next, this.defaultTimeoutMs)),
      disable: () => replace(undefined),
      state: () => this.state(agent),
    }
  }

  /**
   * Read a cached display annotation without changing canonical history.
   * @param session - Already-attached Session used as the read-only cache key.
   * @param eventSeq - Exact canonical event sequence to annotate for display.
   * @returns The transient annotation, or undefined when none is available.
   */
  annotation(session: Session, eventSeq: number): ResponsePresentationAnnotation | undefined {
    return this.sessionStates.get(session)?.annotations.get(eventSeq)
  }

  /**
   * Project one completed turn. Every failure and ambiguity returns neutral;
   * the canonical event objects are never passed to application code.
   * @param agent - Agent whose active transformer may project the response.
   * @param events - Completed canonical turn events to inspect without mutation.
   * @returns A display-only projection or a neutral fail-closed decision.
   */
  async present(agent: Agent, events: readonly SessionEvent[]): Promise<FinalResponseDecision> {
    const state = this.states.get(agent)
    const selection = state?.active
    if (state === undefined || selection === undefined) return { kind: 'neutral', reason: 'off' }
    const extracted = finalResponseCandidate(events)
    if (extracted === undefined) return { kind: 'neutral', reason: 'invalid-candidate' }
    const epoch = state.epoch
    const candidate = deepFreeze({
      sessionId: String(agent.id),
      turn: extracted.turn,
      messageId: extracted.messageId,
      text: extracted.text,
      reason: structuredClone(extracted.reason),
      epoch,
    } satisfies FinalResponseCandidate)
    try {
      if (selection.transformer.eligible?.(candidate, selection.config) === false) {
        return { kind: 'neutral', reason: 'ineligible' }
      }
    } catch {
      return { kind: 'neutral', reason: 'ineligible' }
    }

    const timeout = Promise.withResolvers<{ kind: 'timeout' }>()
    const stale = Promise.withResolvers<{ kind: 'stale' }>()
    const timer = setTimeout(() => { timeout.resolve({ kind: 'timeout' }) }, selection.timeoutMs)
    const onAbort = () => { stale.resolve({ kind: 'stale' }) }
    state.abort.signal.addEventListener('abort', onAbort, { once: true })
    let settled:
      | { kind: 'value'; value: unknown }
      | { kind: 'error' }
      | { kind: 'timeout' }
      | { kind: 'stale' }
    try {
      settled = await Promise.race([
        Promise.resolve()
          .then(() => selection.transformer.transform(candidate, selection.config, state.abort.signal))
          .then(value => ({ kind: 'value' as const, value }), () => ({ kind: 'error' as const })),
        timeout.promise,
        stale.promise,
      ])
    } finally {
      clearTimeout(timer)
      state.abort.signal.removeEventListener('abort', onAbort)
    }
    if (settled.kind === 'timeout') return { kind: 'neutral', reason: 'timeout' }
    if (settled.kind === 'stale'
      || this.states.get(agent) !== state
      || state.epoch !== epoch
      || state.active !== selection) return { kind: 'neutral', reason: 'stale-epoch' }
    if (settled.kind === 'error') return { kind: 'neutral', reason: 'exception' }
    if (typeof settled.value !== 'string'
      || settled.value.trim() === ''
      || Buffer.byteLength(settled.value, 'utf8') > this.maxOutputBytes) {
      return { kind: 'neutral', reason: 'invalid-output' }
    }
    const result: PresentedFinalResponse = {
      kind: 'presented',
      text: settled.value,
      epoch,
      messageSeq: extracted.messageSeq,
      sourceMessageId: extracted.messageId,
      sourceEventSeqs: extracted.sourceEventSeqs,
    }
    for (const seq of result.sourceEventSeqs) {
      state.annotations.set(seq, { kind: 'suppress', epoch, sourceMessageId: result.sourceMessageId })
    }
    state.annotations.set(result.messageSeq, {
      kind: 'text', epoch, sourceMessageId: result.sourceMessageId, text: result.text,
    })
    return result
  }
}

export default FinalResponsePresentation
