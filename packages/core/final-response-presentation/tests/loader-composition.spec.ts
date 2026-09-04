/**
 * Real-composition proof: the neutral service row boots through the actual
 * Loader + Include path and a consumer can opt one Agent into a presentation
 * without changing the canonical Session log.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import FinalResponsePresentation from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('final-response-presentation real Loader composition', () => {
  it('boots the shipped row shape and keeps canonical bytes unchanged', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-final-presentation-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-final-response-presentation'",
      '  config:',
      '    timeoutMs: 50',
      '    maxOutputBytes: 1024',
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== '@deepseek-ai/dsh-final-response-presentation') {
          throw new Error(`unexpected Loader import: ${specifier}`)
        }
        return FinalResponsePresentation
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()

    const session = Session.create(SessionId('loader-composed'))
    const agent = { id: session.id, session } as Agent
    const scope = createScope(ctx, agent)
    Object.defineProperty(agent, 'ctx', { value: scope.ctx.extend({ agent }) })
    ctx.finalResponsePresentation.activate(agent, {
      transformer: { id: 'loader-test', transform: candidate => `Display:${candidate.text}` },
    })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Canonical' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const before = JSON.stringify(session.events)

    expect(await ctx.finalResponsePresentation.present(agent, session.events))
      .toMatchObject({ kind: 'presented', text: 'Display:Canonical' })
    expect(JSON.stringify(session.events)).toBe(before)
  })
})
