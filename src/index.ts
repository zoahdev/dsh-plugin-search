/**
 * dsh-plugin-search — plugin discoverability for DeepSeek Harness.
 *
 * Three model-facing tools: combined npm + awesome-list search, exact npm
 * package lookup, and a curated awesome-list browser. Answers the request in
 * https://github.com/deepseek-ai/deepseek-harness/discussions/1715.
 * @module dsh-plugin-search
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createSearcher, DEFAULT_AWESOME_RAW_URL, type SearchHit } from './search.js'

export const name = 'dsh-plugin-search'

/** Services required by this plugin. */
export const inject = ['tools']

/** Plugin configuration supplied through cordis.yml. */
export interface Config {
  /** Request timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number
  /** TTL of the in-memory response cache. Defaults to 60000. */
  cacheTtlMs?: number
  /** Default result count when the model omits `limit`. Defaults to 8. */
  defaultLimit?: number
  /** Raw URL of the awesome-dsh-plugin README. */
  awesomeRawUrl?: string
}

/** Schemastery schema with defaults. */
export const Config: Schema<Config> = Schema.object({
  timeoutMs: Schema.number().default(10_000),
  cacheTtlMs: Schema.number().default(60_000),
  defaultLimit: Schema.number().default(8),
  awesomeRawUrl: Schema.string().default(DEFAULT_AWESOME_RAW_URL),
})

function clampLimit(value: number, fallback: number): number {
  return Math.min(Math.max(Math.trunc(value), 1), 30)
}

function renderHits(items: SearchHit[]): string {
  if (items.length === 0) return 'No plugins found. Try a broader query, e.g. "dsh-plugin" or "github".'
  return items.map((item, index) => {
    const version = item.version !== undefined && item.version !== null ? `@${item.version}` : ''
    return `${index + 1}. ${item.name}${version} [${item.source}] — ${item.description ?? 'no description'} ${item.url}`
  }).join('\n')
}

/**
 * Register the three discovery tools on the tool registry.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const searcher = createSearcher((url, signal) => fetch(url, { signal }), {
    timeoutMs: config.timeoutMs ?? 10_000,
    cacheTtlMs: config.cacheTtlMs ?? 60_000,
    awesomeRawUrl: config.awesomeRawUrl ?? DEFAULT_AWESOME_RAW_URL,
  })
  const defaultLimit = config.defaultLimit ?? 8

  ctx.tools.register(defineTool({
    name: 'dsh_search_plugins',
    description:
      'Search DeepSeek Harness plugins across npm and the awesome-dsh-plugin curated list. '
      + 'Use it to discover plugins for a task (e.g. "github", "release", "search") before building your own.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search query (package name, keyword, or task description).' },
      limit: { type: 'number', description: `How many results (1-30, default ${defaultLimit}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string' },
                source: { type: 'string', required: true },
                url: { type: 'string', required: true },
                version: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value: { query: string; items: SearchHit[] }) => [
        { type: 'text', text: `Plugins matching "${value.query}":\n${renderHits(value.items)}` },
      ],
    },
    async execute(args, exec) {
      const items = await searcher.searchPlugins(
        String(args.query ?? ''),
        clampLimit(Number(args.limit ?? defaultLimit), defaultLimit),
        exec.signal,
      )
      return { query: String(args.query ?? ''), items }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Search plugins: ${String(args.query)}`,
      kind: 'search',
      rawInput: args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'dsh_plugin_lookup',
    description:
      'Look up an exact npm package by name: latest version, description, homepage, repository, author, and npm URL.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact npm package name (e.g. dsh-plugin-doctor).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          version: { type: 'string', required: true },
          description: { type: 'string' },
          homepage: { type: 'string' },
          repository: { type: 'string' },
          author: { type: 'string' },
          npmUrl: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.name}@${value.version} — ${value.description ?? 'no description'}\n`
          + `author: ${value.author ?? 'n/a'} · repo: ${value.repository ?? 'n/a'}\n`
          + `${value.homepage ?? ''}\n${value.npmUrl}`,
      }],
    },
    async execute(args, exec) {
      return await searcher.lookupPackage(String(args.name ?? '').trim(), exec.signal)
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Look up plugin: ${String(args.name)}`,
      kind: 'search',
      rawInput: args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'dsh_awesome_top',
    description:
      'Browse the current awesome-dsh-plugin curated list (top entries), useful for understanding the ecosystem before choosing a plugin.',
    parameters: {
      limit: { type: 'number', description: `How many entries (1-30, default ${defaultLimit}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string' },
                source: { type: 'string', required: true },
                url: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value: { items: SearchHit[] }) => [
        { type: 'text', text: `Curated dsh plugins:\n${renderHits(value.items)}` },
      ],
    },
    async execute(args, exec) {
      const items = await searcher.awesomeTop(
        clampLimit(Number(args.limit ?? defaultLimit), defaultLimit),
        exec.signal,
      )
      return { items }
    },
    presentCall: () => ({
      card: 'generic',
      title: 'Browse awesome-dsh-plugin',
      kind: 'search',
      rawInput: {},
    }),
  }))
}
