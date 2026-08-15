#!/usr/bin/env node
/**
 * Real-registry agent-visibility check.
 *
 * Mounts the REAL Cordis context + REAL dsh-tools ToolRuntime + a real scoped
 * agent context, applies the plugin through the real registration path, and
 * asserts all three tools are visible in the agent's registry view. Catches
 * the dual-instance shadowing class (discussions #1697/#1782).
 */

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { apply, name } from '../lib/index.js'

const ctx = new Context()
await ctx.plugin(SystemPrompt, { persona: '' })
await ctx.plugin(ToolRuntime)

apply(ctx, { timeoutMs: 5_000, cacheTtlMs: 60_000, defaultLimit: 5, awesomeRawUrl: 'https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/README.md' })

const agent = createScope(ctx, 'agent-visibility')
const schemas = ctx.tools.schemas(scopeOf(agent.ctx))
const names = new Set(schemas.map((schema) => schema.name))
const required = ['dsh_search_plugins', 'dsh_plugin_lookup', 'dsh_awesome_top']
const missing = required.filter((tool) => !names.has(tool))
if (missing.length > 0) {
  throw new Error(`plugin ${name}: tools invisible to a real agent scope: ${missing.join(', ')}`)
}
console.log(`PASS [visibility] plugin ${name}: ${required.join(', ')} visible to a real agent scope`)
