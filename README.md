# dsh-plugin-search

[English](#english) · [中文](#中文)

## English

Plugin discoverability for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): three model-facing tools that find and inspect dsh plugins **from inside the agent** — no more guessing which plugin exists before building your own. Answers [discussion #1715](https://github.com/deepseek-ai/deepseek-harness/discussions/1715).

### Tools

| Tool | What it does |
|---|---|
| `dsh_search_plugins` | Searches npm + the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) curated list, npm-first, deduplicated, with version + source labels. |
| `dsh_plugin_lookup` | Exact lookup: npm metadata (latest version, description, homepage, repository, author), with a GitHub repository search fallback for git-only plugins. |
| `dsh_awesome_top` | Browsers the current curated awesome list — a quick ecosystem snapshot. |

### Install

```sh
# from GitHub (this repository, after release)
dsh plugin --profile web add https://github.com/zoahdev/dsh-plugin-search/releases/download/v1.1.0/dsh-plugin-search-1.1.0.tgz
# or from a local build
dsh plugin --profile web add ./dsh-plugin-search-1.1.0.tgz
```

Then ask the agent inside DSH:

> 帮我找一个能监控 GitHub release 的 dsh 插件。
> Find me a dsh plugin that tracks GitHub releases.

### Verification

- Unit tests with injected fetch (parsing, merging, dedupe, caching, 404 handling).
- Packaged integration test executes the **real handlers** against the real npm registry and the real awesome list.
- CI installs the packed tarball into a fresh DSH profile, verifies the composed config, and boots `dsh web`.

### Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm pack
node scripts/integration-test.mjs
```

### License

MIT © 2026 zoahdev

---

## 中文

**dsh-plugin-search** —— 面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件发现工具：agent 在 DSH 里直接搜索/查看 dsh 插件，不用再凭猜。回应了官方讨论 [#1715](https://github.com/deepseek-ai/deepseek-harness/discussions/1715)「缺 dsh-plugin-search」。

### 工具

| 工具 | 作用 |
|---|---|
| `dsh_search_plugins` | 同时搜 npm 与 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 精选清单，npm 优先、去重、带版本与来源标签。 |
| `dsh_plugin_lookup` | 精确查询：npm 元数据（最新版本、描述、主页、仓库、作者），查不到时自动回退 GitHub 仓库搜索（git-only 插件也能查）。 |
| `dsh_awesome_top` | 浏览当前精选清单，快速了解生态全貌。 |

### 安装

```sh
# 从 GitHub Release
dsh plugin --profile web add https://github.com/zoahdev/dsh-plugin-search/releases/download/v1.1.0/dsh-plugin-search-1.1.0.tgz
# 或本地构建
dsh plugin --profile web add ./dsh-plugin-search-1.1.0.tgz
```

然后在 DSH 里对 agent 说：

> 帮我找一个能监控 GitHub release 的 dsh 插件。

### 验证

- 单元测试注入 fetch：解析、合并、去重、缓存、404 处理全覆盖。
- 打包集成测试对**真实 npm registry 与真实 awesome 清单**执行真实 handler 并断言。
- CI 把 tarball 装进全新 DSH profile、验证合成配置、并真实启动 `dsh web`。

### 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm pack
node scripts/integration-test.mjs
```

### 许可证

MIT © 2026 zoahdev
