#!/usr/bin/env node
/**
 * Packaged plugin smoke test: packs the real tarball, installs it into a
 * fresh host project, loads lib/index.js, registers the three tools through
 * apply()/ctx.tools.register, and executes the REAL handlers against the real
 * npm registry and awesome list. Assertions run on every step.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const tgzName = `dsh-plugin-search-${pkg.version}.tgz`
const tgz = path.join(root, tgzName)

if (!existsSync(tgz)) {
  console.error(`[integration] missing tarball: ${tgz} (run pnpm pack first)`)
  process.exit(1)
}

function runPnpm(args, cwd) {
  if (process.platform === 'win32') {
    return spawnSync(`pnpm ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
  }
  return spawnSync('pnpm', args, { cwd, stdio: 'inherit' })
}

const host = mkdtempSync(path.join(tmpdir(), 'dsh-search-host-'))
try {
  writeFileSync(
    path.join(host, 'package.json'),
    JSON.stringify({
      name: 'dsh-plugin-search-smoke-host',
      private: true,
      version: '1.0.0',
      dependencies: {
        '@deepseek-ai/cordis': '^4.0.1',
        '@deepseek-ai/dsh-tools': '0.1.0-rc.6',
        '@deepseek-ai/schemastery': '^3.18.1',
        'dsh-plugin-search': `file:${tgz.replaceAll('\\', '/')}`,
      },
    }, null, 2),
  )

  console.log('[integration] installing packed tarball into a fresh host project...')
  const install = runPnpm(['install'], host)
  if (install.status !== 0) process.exit(1)

  const entry = path.join(host, 'node_modules', 'dsh-plugin-search', 'lib', 'index.js')
  if (!existsSync(entry)) throw new Error('packed plugin entry lib/index.js missing after install')
  if (!existsSync(path.join(host, 'node_modules', 'dsh-plugin-search', 'cordis.patch.yml'))) {
    throw new Error('packed plugin is missing cordis.patch.yml')
  }

  console.log('[integration] loading packed plugin bundle...')
  const plugin = await import(pathToFileURL(entry).href)
  if (plugin.name !== 'dsh-plugin-search') throw new Error(`unexpected plugin name: ${plugin.name}`)

  const registered = []
  const ctx = {
    tools: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
  }
  plugin.apply(ctx, { defaultLimit: 5, timeoutMs: 15_000 })
  const names = registered.map((t) => t.name).sort()
  if (JSON.stringify(names) !== JSON.stringify(['dsh_awesome_top', 'dsh_plugin_lookup', 'dsh_search_plugins'])) {
    throw new Error(`unexpected tool set: ${JSON.stringify(names)}`)
  }

  const signal = new AbortController().signal
  console.log('[integration] executing dsh_search_plugins against the real npm registry + awesome list...')
  const search = registered.find((t) => t.name === 'dsh_search_plugins')
  const searchResult = await search.execute({ query: 'dsh-plugin', limit: 5 }, { signal })
  if (!Array.isArray(searchResult.items) || searchResult.items.length === 0) {
    throw new Error(`search returned no items: ${JSON.stringify(searchResult)}`)
  }
  for (const item of searchResult.items) {
    if (typeof item.name !== 'string' || typeof item.url !== 'string') {
      throw new Error(`malformed search item: ${JSON.stringify(item)}`)
    }
  }

  console.log('[integration] executing dsh_plugin_lookup against the real npm registry...')
  const lookup = registered.find((t) => t.name === 'dsh_plugin_lookup')
  const info = await lookup.execute({ name: '@deepseek-ai/dsh-tools' }, { signal })
  if (!/^0\.\d+\.\d+(-rc\.\d+)?$/.test(info.version)) {
    throw new Error(`unexpected dsh-tools version: ${JSON.stringify(info)}`)
  }
  if (info.name !== '@deepseek-ai/dsh-tools') throw new Error(`unexpected lookup name: ${JSON.stringify(info)}`)

  console.log('[integration] executing dsh_plugin_lookup with GitHub fallback (git-only plugin)...')
  const fallback = await lookup.execute({ name: 'dsh-github-intelligence' }, { signal })
  if (fallback.source !== 'github' || fallback.version !== 'git') {
    throw new Error(`unexpected GitHub fallback result: ${JSON.stringify(fallback)}`)
  }
  if (!String(fallback.repository).includes('github.com')) {
    throw new Error(`fallback repository missing: ${JSON.stringify(fallback)}`)
  }

  console.log('[integration] executing dsh_awesome_top against the real awesome list...')
  const top = registered.find((t) => t.name === 'dsh_awesome_top')
  const topResult = await top.execute({ limit: 5 }, { signal })
  if (!Array.isArray(topResult.items) || topResult.items.length === 0) {
    throw new Error(`awesome top returned no items: ${JSON.stringify(topResult)}`)
  }

  console.log('PASS [integration] packed plugin loaded, 3 tools registered, real handlers executed and asserted')
} finally {
  rmSync(host, { recursive: true, force: true })
}
