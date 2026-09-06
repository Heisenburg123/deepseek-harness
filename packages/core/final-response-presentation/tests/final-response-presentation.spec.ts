/**
 * D-01 through D-23: optional post-semantic presentation, neutral failure,
 * epoch isolation, structural bypass, and canonical-log non-contamination.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, createToolResultMessage, CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import FinalResponsePresentation from '@deepseek-ai/dsh-final-response-presentation'
import type {
  FinalResponseCandidate, FinalResponseTransformer, PresentationController,
} from '@deepseek-ai/dsh-final-response-presentation'

interface Harness {
  ctx: Context
  agent: Agent
  session: Session
  scope: ReturnType<typeof createScope>
  activate(transformer: FinalResponseTransformer, timeoutMs?: number): PresentationController
}

async function harness(id = 'presentation-test'): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(FinalResponsePresentation, { timeoutMs: 50, maxOutputBytes: 1024 })
  const session = Session.create(SessionId(id))
  const agent = {
    id: session.id,
    session,
    options: {},
    inbox: {},
    status: 'idle',
    cancel: () => {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: <T>(job: (signal: AbortSignal) => Promise<T>) => job(new AbortController().signal),
    followup: () => {},
    steer: () => {},
    inject: () => {},
  } as unknown as Agent
  const scope = createScope(ctx, agent)
  Object.defineProperty(agent, 'ctx', { value: scope.ctx.extend({ agent }) })
  return {
    ctx,
    agent,
    session,
    scope,
    activate: (transformer, timeoutMs) =>
      ctx.finalResponsePresentation.activate(agent, { transformer, ...timeoutMs === undefined ? {} : { timeoutMs } }),
  }
}

function transformer(id: string, body: FinalResponseTransformer['transform']): FinalResponseTransformer {
  return { id, transform: body }
}

function appendTextTurn(session: Session, text = 'Canonical answer'): void {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const chunk = session.append('assistant/chunk', {
    turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text },
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [chunk.seq] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

describe('final response presentation boundary', () => {
  it('D-01: no transformer preserves existing behavior', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toEqual({ kind: 'neutral', reason: 'off' })
  })

  it('D-02: runs only after a terminal canonical result exists', async () => {
    const h = await harness()
    let calls = 0
    h.activate(transformer('after', () => { calls += 1; return 'Presented' }))
    h.session.append('turn/start', { turn: 1 })
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toEqual({ kind: 'neutral', reason: 'invalid-candidate' })
    expect(calls).toBe(0)
    h.session.append('step/start', { turn: 1, step: 1 })
    h.session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'Canonical' }], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
    }, { surfaceOp: 'append' })
    h.session.append('step/end', { turn: 1, step: 1 })
    h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect((await h.ctx.finalResponsePresentation.present(h.agent, h.session.events)).kind).toBe('presented')
    expect(calls).toBe(1)
  })

  it('D-03: gives the transformer a frozen copy and leaves canonical bytes unchanged', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    const before = JSON.stringify(h.session.events)
    h.activate(transformer('immutable', (candidate) => {
      expect(Object.isFrozen(candidate)).toBe(true)
      expect(Object.isFrozen(candidate.reason)).toBe(true)
      expect(() => { (candidate as { text: string }).text = 'mutated' }).toThrow()
      return 'Presented'
    }))
    expect((await h.ctx.finalResponsePresentation.present(h.agent, h.session.events)).kind).toBe('presented')
    expect(JSON.stringify(h.session.events)).toBe(before)
  })

  it('D-04: cannot present an assistant tool call', async () => {
    const h = await harness()
    h.activate(transformer('tool-denied', () => 'Changed'))
    h.session.append('turn/start', { turn: 1 })
    h.session.append('step/start', { turn: 1, step: 1 })
    h.session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: CallId('call-1'), name: 'echo', arguments: '{"value":"fixed"}' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    h.session.append('step/end', { turn: 1, step: 1 })
    h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toEqual({ kind: 'neutral', reason: 'invalid-candidate' })
  })

  it('D-05: transformer exceptions fall back to neutral', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    h.activate(transformer('throws', () => { throw new Error('broken') }))
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toEqual({ kind: 'neutral', reason: 'exception' })
  })

  it('D-06: transformer timeout falls back to neutral', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    h.activate(transformer('hangs', () => new Promise(() => {})), 5)
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toEqual({ kind: 'neutral', reason: 'timeout' })
  })

  it('D-07: malformed and oversized output fall back to neutral', async () => {
    const malformed = await harness('malformed')
    appendTextTurn(malformed.session)
    malformed.activate(transformer('malformed', () => ({ text: 'not a string' })))
    expect(await malformed.ctx.finalResponsePresentation.present(malformed.agent, malformed.session.events))
      .toEqual({ kind: 'neutral', reason: 'invalid-output' })
    const oversized = await harness('oversized')
    appendTextTurn(oversized.session)
    oversized.activate(transformer('oversized', () => 'x'.repeat(1025)))
    expect(await oversized.ctx.finalResponsePresentation.present(oversized.agent, oversized.session.events))
      .toEqual({ kind: 'neutral', reason: 'invalid-output' })
  })

  it('D-08: OFF state is explicit and neutral', async () => {
    const h = await harness()
    expect(h.ctx.finalResponsePresentation.state(h.agent)).toEqual({ mode: 'off', epoch: 0 })
  })

  it('D-09: ACTIVE state identifies its transformer', async () => {
    const h = await harness()
    const control = h.activate(transformer('active-a', () => 'A'))
    expect(control.state()).toEqual({ mode: 'active', epoch: 1, transformerId: 'active-a' })
  })

  it('D-10: SWITCH atomically advances epoch and selection', async () => {
    const h = await harness()
    const control = h.activate(transformer('a', () => 'A'))
    expect(control.switch({ transformer: transformer('b', () => 'B') }))
      .toEqual({ mode: 'active', epoch: 2, transformerId: 'b' })
  })

  it('D-11: DISABLE advances epoch and restores neutral', async () => {
    const h = await harness()
    const control = h.activate(transformer('a', () => 'A'))
    expect(control.disable()).toEqual({ mode: 'off', epoch: 2 })
    expect(h.ctx.finalResponsePresentation.active(h.agent)).toBe(false)
  })

  it('D-12: Agent-scope disposal removes state and cached presentation', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    h.activate(transformer('a', () => 'A'))
    const result = await h.ctx.finalResponsePresentation.present(h.agent, h.session.events)
    expect(result.kind).toBe('presented')
    await h.scope.dispose()
    expect(h.ctx.finalResponsePresentation.state(h.agent)).toEqual({ mode: 'off', epoch: 0 })
  })

  it('D-13: rejects a result from a stale epoch', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const control = h.activate(transformer('a', async () => { await pending; return 'A' }))
    const presentation = h.ctx.finalResponsePresentation.present(h.agent, h.session.events)
    control.switch({ transformer: transformer('b', () => 'B') })
    release()
    expect(await presentation).toEqual({ kind: 'neutral', reason: 'stale-epoch' })
  })

  it('D-14: transformer A display cache cannot leak into B', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    const control = h.activate(transformer('a', () => 'A voice'))
    const a = await h.ctx.finalResponsePresentation.present(h.agent, h.session.events)
    expect(a.kind).toBe('presented')
    if (a.kind !== 'presented') throw new Error('expected A presentation')
    expect(h.ctx.finalResponsePresentation.annotation(h.session, a.messageSeq)).toMatchObject({ text: 'A voice' })
    control.switch({ transformer: transformer('b', () => 'B voice') })
    expect(h.ctx.finalResponsePresentation.annotation(h.session, a.messageSeq)).toBeUndefined()
    const b = await h.ctx.finalResponsePresentation.present(h.agent, h.session.events)
    expect(b).toMatchObject({ kind: 'presented', text: 'B voice', epoch: 2 })
  })

  it('D-15: model reasoning stays private while final text remains presentable', async () => {
    const h = await harness()
    let candidateText = ''
    h.activate(transformer('reasoning-safe', (candidate) => {
      candidateText = candidate.text
      return 'Changed'
    }))
    h.session.append('turn/start', { turn: 1 })
    h.session.append('step/start', { turn: 1, step: 1 })
    h.session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'caption' }, { type: 'reasoning', text: 'structured' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    h.session.append('step/end', { turn: 1, step: 1 })
    h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toMatchObject({ kind: 'presented', text: 'Changed' })
    expect(candidateText).toBe('caption')
  })

  it('D-23: mixed text and tool calls still bypass before application code', async () => {
    const h = await harness()
    let called = false
    h.activate(transformer('structured', () => { called = true; return 'Changed' }))
    h.session.append('turn/start', { turn: 1 })
    h.session.append('step/start', { turn: 1, step: 1 })
    h.session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [
          { type: 'text', text: 'caption' },
          { type: 'tool-call', id: CallId('call-mixed'), name: 'echo', arguments: '{"value":"fixed"}' },
        ],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    h.session.append('step/end', { turn: 1, step: 1 })
    h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toEqual({ kind: 'neutral', reason: 'invalid-candidate' })
    expect(called).toBe(false)
  })

  it('D-16: tool output bypasses presentation', async () => {
    const h = await harness()
    let called = false
    h.activate(transformer('tool-result-denied', () => { called = true; return 'Changed' }))
    h.session.append('turn/start', { turn: 1 })
    h.session.append('step/start', { turn: 1, step: 1 })
    h.session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('tool-result-1'),
        content: [{ type: 'text', text: 'tool-owned output' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    h.session.append('step/end', { turn: 1, step: 1 })
    h.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toEqual({ kind: 'neutral', reason: 'invalid-candidate' })
    expect(called).toBe(false)
  })

  it('D-21: application eligibility bypasses artifact-owned style', async () => {
    const h = await harness()
    appendTextTurn(h.session, '{"machine":true}')
    h.ctx.finalResponsePresentation.activate(h.agent, {
      transformer: { id: 'artifact-bypass', eligible: () => false, transform: () => 'Changed' },
    })
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toEqual({ kind: 'neutral', reason: 'ineligible' })
  })

  it('D-17: canonical model history is unaffected', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    h.activate(transformer('history', () => 'Displayed only'))
    await h.ctx.finalResponsePresentation.present(h.agent, h.session.events)
    const assistant = h.session.deriveMessages().find(message => message.role === 'assistant')
    expect(assistant?.content).toEqual([{ type: 'text', text: 'Canonical answer' }])
  })

  it('D-18: presentation emits no durable events', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    const count = h.session.events.length
    h.activate(transformer('no-write', () => 'Displayed only'))
    await h.ctx.finalResponsePresentation.present(h.agent, h.session.events)
    expect(h.session.events).toHaveLength(count)
  })

  it('D-19: no-transformer path leaves the canonical event list byte-identical', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    const before = JSON.stringify(h.session.events)
    expect(await h.ctx.finalResponsePresentation.present(h.agent, h.session.events))
      .toEqual({ kind: 'neutral', reason: 'off' })
    expect(JSON.stringify(h.session.events)).toBe(before)
  })

  it('D-22: output annotations stay separate from canonical SessionEvent values', async () => {
    const h = await harness()
    appendTextTurn(h.session)
    h.activate(transformer('annotation', () => 'Display'))
    const result = await h.ctx.finalResponsePresentation.present(h.agent, h.session.events)
    if (result.kind !== 'presented') throw new Error('expected presentation')
    expect(h.ctx.finalResponsePresentation.annotation(h.session, result.messageSeq)).toEqual({
      kind: 'text', epoch: 1, sourceMessageId: result.sourceMessageId, text: 'Display',
    })
    expect('presentation' in h.session.events[result.messageSeq]!).toBe(false)
  })

  it('D-20: independent sessions keep transformer, epoch, and cache isolated', async () => {
    const a = await harness('session-a')
    const b = await harness('session-b')
    appendTextTurn(a.session)
    appendTextTurn(b.session)
    a.activate(transformer('a', (candidate: FinalResponseCandidate) => `A:${candidate.text}`))
    b.activate(transformer('b', (candidate: FinalResponseCandidate) => `B:${candidate.text}`))
    expect(await a.ctx.finalResponsePresentation.present(a.agent, a.session.events)).toMatchObject({ text: 'A:Canonical answer' })
    expect(await b.ctx.finalResponsePresentation.present(b.agent, b.session.events)).toMatchObject({ text: 'B:Canonical answer' })
  })
})
