# Plan — Repo Scaffold & Architecture

Single-repo, single-domain static SPA hosted on GitHub Pages.

## 1. Binding constraints → design decisions

| Constraint (verified 2026-09) | Design decision |
|---|---|
| GH Pages is static-only: no server code, DB, or long-running processes | All logic client-side; Web Workers + WASM for heavy work |
| Published site ≤ 1 GB; source repo recommended ≤ 1 GB | Logs opened from user's disk in-browser; only the app bundle ships (~few MB). Keep fixtures < 50 MB total, use LFS if ever needed |
| 100 GB/month bandwidth soft limit | N/A for data (user logs never traverse GitHub); fine for app traffic |
| No custom response headers on Pages → no COOP/COEP → no SharedArrayBuffer | Multi-threading via ordinary workers + transferable ArrayBuffers / MessageChannel only |
| No SPA route rewrites (only built-in 404 page) | Hash-based routing (`#/report/...`); single `index.html` entry |
| Build timeout 10 min; 10 builds/hr (Actions builds exempt) | Vite build is well under limits; Actions workflow for CI + deploy |
| One user/org site per account; custom domain via CNAME | Repo `logviewplus-web`; CNAME file + DNS CNAME → `<user>.github.io` (or own domain later) |
| ToS: no commercial SaaS on Pages | Personal/internal use only; no accounts, no billing, no user-data collection |
| Closed-source original; EULA likely prohibits RE | Clean-room from public docs only; no decompilation |

## 2. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Build | Vite + TypeScript (strict) | Fast dev/build, first-class worker import (`?worker`), tiny config |
| UI | React 18 (hooks only, no router lib) | Ecosystem for grid/charts; hash routing is trivial |
| Grid | AG Grid Community (MIT) | Virtualized, handles 100k+ rows; grouping, row coloring, column menu map to LVP features |
| Charts | Chart.js 4 | Lightweight dashboards |
| SQL engine | DuckDB-WASM (M3 decision; fallback sql.js) | Real SQL over parsed entries for filters/reports; ~14 MB bundle loaded lazily on demand |
| State | Zustand | Minimal, testable store |
| Persistence | IndexedDB via `idb` | Caches, workspaces, saved filters |
| Zip | fflate | Fast, small |
| Tests | Vitest (unit) + Playwright (E2E, headless Chromium) | Parser logic is pure → high unit coverage; E2E smoke only |
| Lint/format | ESLint 9 + Prettier | CI gate |
| CI/CD | GitHub Actions → `actions/deploy-pages` | One workflow: lint → test → build → publish artifact |

## 3. Repo layout

```
logviewplus-web/
├─ .github/workflows/deploy.yml     # CI + Pages deploy (build on main)
├─ public/                          # static assets (favicon, 404.html if needed)
├─ src/
│  ├─ components/                   # grid, toolbar, filter bar, dropzone, dashboard
│  ├─ parsers/                      # PatternParser, RegexParser, JsonParser, XmlParser...
│  │  └─ specifiers.ts              # LVP-style conversion specifier grammar (%d %S %s %l %m ...)
│  ├─ workers/
│  │  ├─ parser.worker.ts           # chunked streaming parse, progress + batched rows out
│  │  └─ sql.worker.ts              # M3: DuckDB-WASM query execution
│  ├─ store/                        # zustand stores (file registry, filters, view state)
│  ├─ lib/                          # file IO (slice/chunk), indexdb, export/share encoders, levels
│  ├─ styles/
│  ├─ App.tsx / main.tsx
├─ tests/
│  ├─ unit/                         # vitest suites per module
│  ├─ e2e/                          # playwright specs
│  └─ fixtures/logs/                # sample logs: gc.log, IIS u_ex, JSON lines, apache, mixed-level;
│                                   # + scripts/gen-large.ts (deterministic N MB generator)
├─ index.html
├─ vite.config.ts                   # base '/logviewplus-web/', worker plugin, test config
├─ tsconfig.json / eslint.config.js / .prettierrc
├─ package.json
└─ README.md / PLAN.md / MILESTONE-1.md
```

## 4. Deployment (GitHub Pages)

1. GitHub repo `logviewplus-web` (private OK on paid plan, public on free).
2. Actions workflow (single file): on `push: branches: [main]` →
   `npm ci` → lint → `vitest run` → `vite build` → `actions/upload-pages-artifact@v3`
   → `actions/deploy-pages@v4` (environment: `github-pages`).
3. `Settings → Pages → Source: GitHub Actions`.
4. Vite: `base: '/logviewplus-web/'` so assets resolve at `/<user>.github.io/logviewplus-web/`.
5. Custom domain (optional, still single domain): repo-root `CNAME` file with the
   apex/domain + DNS CNAME; Pages serves HTTPS automatically.
6. Routing: hash-only (`#/open`, `#/report/:id`) — deep links work without server rewrites.

## 5. Roadmap (summary)

- **M1 — Parse pipeline MVP** (see `MILESTONE-1.md`): file ingest → worker parse
  → virtualized grid → text/level filters; perf gate on 10 MB / 100 MB.
- M2 — Parser breadth + dates: JSON/XML/Log4Xml/DSV parsers, date resolution,
  multi-file merge, zip + clipboard ingest, saved filters, entry export.
- M3 — Reporting: SQL filter/report engine (DuckDB-WASM), dashboards with charts,
  navigation reports, groupings/stats views.
- M4 — Power features: tail + directory monitor (File System Access API, Chromium),
  local `.sqlite` open (sql.js), highlights/bookmarks/notes, rules & row coloring,
  workspace archive save/share, webhook notifications (replaces command-line provider).
- M5 — Polish: encodings/culture, performance pass (1 GB+ files), a11y, docs section.

## 6. Risks & open items

- T-SQL subset coverage: LVP uses a custom T-SQL-based engine; we guarantee a
  documented SQL subset (SELECT/WHERE/GROUP BY/JOIN on entry columns), not full T-SQL.
- File System Access API is Chromium-only → tail/monitor features degrade gracefully
  (feature-detect, show notice elsewhere).
- AG Grid Community: verify needed column-menu/grouping APIs are not Enterprise-gated
  during M1 (fallback: TanStack Virtual + custom grid).
- DuckDB-WASM bundle size (~14 MB): lazy-load on first report use; sql.js if too heavy.
- EULA text was not retrievable (page 404) — do **not** decompile/distribute anything
  from the original binary; keep this project clean-room.