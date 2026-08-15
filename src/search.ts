/**
 * Plugin discovery core for dsh-plugin-search.
 *
 * Searches two independent sources:
 * - npm registry (keywords/tags + text search over package metadata);
 * - the awesome-dsh-plugin curated README (markdown table entries).
 *
 * The fetch function is injectable so unit tests never hit the network while
 * the packaged integration test and CI smoke use the real registries.
 * @module dsh-plugin-search/search
 */

export interface SearchHit {
  name: string
  description?: string
  source: 'npm' | 'awesome'
  url: string
  version?: string
}

export interface PackageInfo {
  name: string
  version: string
  description?: string
  homepage?: string
  repository?: string
  author?: string
  npmUrl: string
}

export interface SearchOptions {
  timeoutMs: number
  cacheTtlMs: number
  awesomeRawUrl: string
}

export type FetchFn = (url: string, signal: AbortSignal) => Promise<Response>

export const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search'
export const DEFAULT_AWESOME_RAW_URL =
  'https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/README.md'

function clampLimit(value: number, fallback: number): number {
  return Math.min(Math.max(Math.trunc(value), 1), 30)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function timeoutSignal(parent: AbortSignal, timeoutMs: number): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = (): void => controller.abort()
  parent.addEventListener('abort', onAbort, { once: true })
  const signal = controller.signal
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  signal.addEventListener('abort', () => parent.removeEventListener('abort', onAbort), { once: true })
  return signal
}

/** Parse `[label](url) — description` rows out of the awesome README. */
export function parseAwesomeReadme(markdown: string): SearchHit[] {
  const hits: SearchHit[] = []
  const link = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  for (const match of markdown.matchAll(link)) {
    const label = match[1]?.trim() ?? ''
    const url = match[2]?.trim() ?? ''
    if (label === '' || url === '') continue
    if (url.includes('github.com/awesome-dsh-plugin') || label === 'awesome-dsh-plugin') continue
    hits.push({
      name: label,
      source: 'awesome',
      url,
    })
  }
  return hits
}

/** Create a searcher with an injectable fetch and a short TTL cache. */
export function createSearcher(fetchFn: FetchFn, options: SearchOptions) {
  const cache = new Map<string, { at: number; value: unknown }>()

  async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const entry = cache.get(key)
    if (entry !== undefined && Date.now() - entry.at < options.cacheTtlMs) {
      return entry.value as T
    }
    const value = await loader()
    cache.set(key, { at: Date.now(), value })
    return value
  }

  async function npmSearch(query: string, limit: number, parent: AbortSignal): Promise<SearchHit[]> {
    const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(query)}&size=${limit + 5}`
    const raw = await cached(`npm:${query}`, async () => {
      const response = await fetchFn(url, timeoutSignal(parent, options.timeoutMs))
      if (!response.ok) throw new Error(`npm search failed: HTTP ${response.status}`)
      return await response.json() as Record<string, unknown>
    })
    const objects = Array.isArray(raw.objects) ? raw.objects : []
    return objects.slice(0, limit).map((entry): SearchHit | null => {
      const pkg = (entry as Record<string, unknown>).package as Record<string, unknown> | null
      if (pkg === null || typeof pkg !== 'object') return null
      const name = asString(pkg.name)
      if (name === null) return null
      const links = pkg.links as Record<string, unknown> | null
      return {
        name,
        description: asString(pkg.description) ?? undefined,
        source: 'npm',
        url: links !== null && typeof links === 'object' ? asString(links.npm) ?? `https://www.npmjs.com/package/${name}` : `https://www.npmjs.com/package/${name}`,
        version: asString(pkg.version) ?? undefined,
      }
    }).filter((hit): hit is SearchHit => hit !== null)
  }

  async function awesomeList(parent: AbortSignal): Promise<SearchHit[]> {
    return await cached('awesome:list', async () => {
      const response = await fetchFn(options.awesomeRawUrl, timeoutSignal(parent, options.timeoutMs))
      if (!response.ok) throw new Error(`awesome list fetch failed: HTTP ${response.status}`)
      return parseAwesomeReadme(await response.text())
    })
  }

  return {
    /** Combined npm + awesome search, npm-first, deduplicated by name. */
    async searchPlugins(query: string, limitValue: number, parent: AbortSignal): Promise<SearchHit[]> {
      const limit = clampLimit(limitValue, 8)
      const q = query.trim()
      const [npmHits, awesome] = await Promise.all([
        npmSearch(q === '' ? 'keywords:dsh-plugin' : q, limit, parent),
        awesomeList(parent),
      ])
      const awesomeFiltered = awesome.filter((hit) => {
        const haystack = `${hit.name} ${hit.description ?? ''}`.toLowerCase()
        return q === '' || haystack.includes(q.toLowerCase())
      })
      const seen = new Set<string>()
      const merged: SearchHit[] = []
      for (const hit of [...npmHits, ...awesomeFiltered]) {
        const key = hit.name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(hit)
      }
      return merged.slice(0, limit)
    },

    /** Look up one npm package by exact name. */
    async lookupPackage(name: string, parent: AbortSignal): Promise<PackageInfo> {
      const raw = await cached(`npm:pkg:${name}`, async () => {
        const response = await fetchFn(`https://registry.npmjs.org/${encodeURIComponent(name)}`, timeoutSignal(parent, options.timeoutMs))
        if (response.status === 404) throw new Error(`package not found on npm: ${name}`)
        if (!response.ok) throw new Error(`npm lookup failed: HTTP ${response.status}`)
        return await response.json() as Record<string, unknown>
      })
      const distTags = raw['dist-tags'] as Record<string, unknown> | null
      const latest = distTags !== null && typeof distTags === 'object' ? asString(distTags.latest) : null
      const repository = raw.repository as Record<string, unknown> | null
      const author = raw.author as Record<string, unknown> | string | null
      return {
        name: asString(raw.name) ?? name,
        version: latest ?? 'unknown',
        description: asString(raw.description) ?? undefined,
        homepage: asString(raw.homepage) ?? undefined,
        repository: repository !== null && typeof repository === 'object' ? asString(repository.url) ?? undefined : undefined,
        author: typeof author === 'string' ? author : asString((author as Record<string, unknown> | null)?.name) ?? undefined,
        npmUrl: `https://www.npmjs.com/package/${name}`,
      }
    },

    /** Curated entries from the awesome list, top N. */
    async awesomeTop(limitValue: number, parent: AbortSignal): Promise<SearchHit[]> {
      const limit = clampLimit(limitValue, 10)
      return (await awesomeList(parent)).slice(0, limit)
    },
  }
}

export type Searcher = ReturnType<typeof createSearcher>
