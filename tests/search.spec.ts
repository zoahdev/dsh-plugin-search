import { describe, expect, it, vi } from 'vitest'
import { createSearcher, parseAwesomeReadme, type SearchOptions } from '../src/search.js'

const options: SearchOptions = {
  timeoutMs: 5_000,
  cacheTtlMs: 60_000,
  awesomeRawUrl: 'https://example.com/awesome.md',
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function mockFetch(routes: Record<string, unknown | ((url: string) => unknown)>) {
  return vi.fn(async (url: string) => {
    for (const [prefix, value] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        const resolved = typeof value === 'function' ? (value as (u: string) => unknown)(url) : value
        return jsonResponse(resolved)
      }
    }
    return new Response('not found', { status: 404 })
  })
}

describe('parseAwesomeReadme', () => {
  it('extracts table entries as markdown links', () => {
    const md = [
      '| [dsh-plugin-doctor](https://github.com/zoahdev/dsh-plugin-doctor) | health checks |',
      '| [dsh-github-intelligence](https://github.com/zoahdev/dsh-github-intelligence) | 170+ tools |',
      '[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)',
    ].join('\n')
    const hits = parseAwesomeReadme(md)
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ name: 'dsh-plugin-doctor', source: 'awesome' })
    expect(hits.some((h) => h.name === 'awesome-dsh-plugin')).toBe(false)
  })
})

describe('createSearcher', () => {
  it('merges npm and awesome results, npm-first, deduplicated by name', async () => {
    const fetch = mockFetch({
      'https://registry.npmjs.org/-/v1/search': {
        objects: [
          { package: { name: 'dsh-plugin-doctor', description: 'health checks', version: '1.3.0', links: { npm: 'https://www.npmjs.com/package/dsh-plugin-doctor' } } },
          { package: { name: 'dsh-other', description: 'other', version: '0.1.0', links: {} } },
        ],
      },
      'https://example.com/awesome.md': '| [dsh-plugin-doctor](https://github.com/zoahdev/dsh-plugin-doctor) | |',
    })
    const searcher = createSearcher(fetch, options)
    const hits = await searcher.searchPlugins('doctor', 8, new AbortController().signal)
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ name: 'dsh-plugin-doctor', source: 'npm', version: '1.3.0' })
    expect(hits[1]).toMatchObject({ name: 'dsh-other' })
  })

  it('looks up package metadata from the npm registry', async () => {
    const fetch = mockFetch({
      'https://registry.npmjs.org/%40deepseek-ai%2Fdsh-tools': {
        name: '@deepseek-ai/dsh-tools',
        description: 'tool authoring',
        homepage: 'https://github.com/deepseek-ai/deepseek-harness',
        'dist-tags': { latest: '0.1.0-rc.6' },
        repository: { url: 'git+https://github.com/deepseek-ai/deepseek-harness.git' },
        author: { name: 'deepseek-ai' },
      },
    })
    const searcher = createSearcher(fetch, options)
    const info = await searcher.lookupPackage('@deepseek-ai/dsh-tools', new AbortController().signal)
    expect(info).toMatchObject({
      name: '@deepseek-ai/dsh-tools',
      version: '0.1.0-rc.6',
      repository: 'git+https://github.com/deepseek-ai/deepseek-harness.git',
      author: 'deepseek-ai',
    })
  })

  it('fails loudly when a package exists on neither npm nor GitHub', async () => {
    const fetch = mockFetch({})
    const searcher = createSearcher(fetch, options)
    await expect(searcher.lookupPackage('no-such-pkg-xyz', new AbortController().signal))
      .rejects.toThrow(/not found|failed/)
  })

  it('falls back to GitHub repository search for git-only plugins', async () => {
    const fetch = mockFetch({
      'https://api.github.com/search/repositories': {
        items: [{
          full_name: 'zoahdev/dsh-github-intelligence',
          description: '185+ tools',
          homepage: null,
          html_url: 'https://github.com/zoahdev/dsh-github-intelligence',
          owner: { login: 'zoahdev' },
        }],
      },
    })
    const searcher = createSearcher(fetch, options)
    const info = await searcher.lookupPackage('dsh-github-intelligence', new AbortController().signal)
    expect(info).toMatchObject({
      name: 'zoahdev/dsh-github-intelligence',
      version: 'git',
      source: 'github',
      author: 'zoahdev',
    })
    expect(info.npmUrl).toBeUndefined()
  })

  it('caches responses within the TTL', async () => {
    const fetch = mockFetch({
      'https://registry.npmjs.org/-/v1/search': { objects: [] },
      'https://example.com/awesome.md': '| [a](https://x/a) | |',
    })
    const searcher = createSearcher(fetch, options)
    await searcher.awesomeTop(5, new AbortController().signal)
    await searcher.awesomeTop(5, new AbortController().signal)
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('https://example.com'))).toHaveLength(1)
  })
})
