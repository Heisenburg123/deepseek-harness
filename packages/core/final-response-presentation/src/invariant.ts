/**
 * Package-owned invariant companion for final-response presentation.
 * @module @deepseek-ai/dsh-final-response-presentation/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-final-response-presentation'

/** Cordis companion plugin name. */
export const name = 'final-response-presentation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service owns no durable event vocabulary, and its
 * registration, epoch, cache, and disposal contracts are asserted directly.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
