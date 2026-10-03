# Kindoku (金 · 흑 · 読)

A manga / manhwa / manhua / light-novel recommender. Static PWA front end, one
Vercel serverless function for recommendations, AniList for metadata, Groq for
candidate titles.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | The whole UI: five views, modals, reader overlay, PWA manifest. |
| `kindoku.css` | All styling. Themeable via `data-theme` on `<html>`. |
| `kindoku.js` | Client controller. A classic (non-module) browser script. |
| `api/recommend.js` | Serverless handler. Also the only module that talks to Groq/AniList. |
| `sw.js` | Service worker: network-first navigations, stale-while-revalidate assets, never caches `/api/`. |
| `tests/` | Test suite (see below). |

## Running it

The API is a Vercel function, so a local static server alone will not serve
`/api/recommend`. Either:

```bash
npx vercel dev          # if you have the Vercel CLI
```

or point a static server at the directory and expect the API calls to fail
until something proxies `/api/`.

Copy `.env.example` to `.env` and set `GROQ_API_KEY` to enable the AI
candidate-generation path. Without it the handler falls back to the direct
AniList engine, which is fully functional on its own.

## Tests

```bash
npm test             # 307 tests, no dependencies, no network, ~15s
npm run test:fast    # skips the timing suite, ~5s — good for a save hook
npm run lint         # syntax check on the three shipped JS files
npm run check        # lint + full suite (run this)
npm run verify       # lint + suite twice; catches cross-test state leakage
npm run test:live    # AniList contract tests, needs network
npm run test:deployed  # contract tests against the live deployment, needs network
```

`npm test` deliberately excludes `live` and `deployed`, which both need network
and are run explicitly.

The suite uses Node's built-in `node:test` runner. There is nothing to install.

| File | Covers |
| --- | --- |
| `api-recommend.test.mjs` | Pure decision logic: genre/format matching, format derivation, synopsis cleanup, input sanitising, JSON repair, constraint-relaxation order, bounded concurrency. |
| `api-handler.test.mjs` | Full request/response cycle with `fetch` stubbed: rate limiting, caching, pagination, de-duplication, upstream failures, every status path. |
| `budget.test.mjs` | The request budget's arithmetic, and that `api/recommend.js` and `vercel.json` agree about the function limit. |
| `timing.test.mjs` | Real-clock behaviour: a hung upstream must still produce a response inside the budget. Prefixed `timing:` so `test:fast` can skip it. |
| `smoke.test.mjs` | The handler behind a real `http.Server`: an unparsed body, malformed JSON, a disconnecting client, concurrent requests. |
| `property.test.mjs` | Invariants over thousands of generated inputs, including a fuzz of the request boundary. Deterministic seeds, so a failure reproduces exactly. |
| `client.test.mjs` | The pure functions in `kindoku.js`, executed in a `vm` context against a stubbed DOM (`harness.mjs`). |
| `service-worker.test.mjs` | Caching strategy, driven through stubbed `self` and Cache Storage. |
| `html.test.mjs` | Markup structure and accessibility: labels, ARIA, iframe sandboxing, asset existence, nav/format/preset parity. |
| `dead-code.test.mjs` | Unused functions, constants and CSS classes; stray logging, TODOs, control bytes and encoding damage; bundle size budgets. |
| `diagnostics.test.mjs` | Every distinct upstream failure is reported, the logs never contain the API key or the user's query, and a dead AI path still degrades to the fallback. |
| `integrity.test.mjs` | Cross-file drift: every `getElementById` target exists, every injected class is styled, every precached asset exists, nothing unescaped reaches an `innerHTML`. |
| `live.test.mjs` | Contract tests against the real AniList API. Run by `npm run test:live`. |
| `deployed.test.mjs` | Contract tests against the live deployment, including which build is currently shipped. Run by `npm run test:deployed`. |

### CI

`.github/workflows/ci.yml` runs on every push and pull request against `main`:

| Job | What it does |
| --- | --- |
| `check` | `npm run lint`, then `npm run verify`, then the budget and service-worker suites in isolation so a misconfiguration is obvious rather than buried in the output. |
| `live` | The AniList contract tests. Scheduled and on demand only. |
| `deployed` | Contract tests against the live deployment. Hourly and on demand. |

No `npm install` step: the project has zero runtime and dev dependencies, so
there is no lockfile to install from. Node itself is the only requirement.

The `live` and `deployed` jobs are deliberately excluded from pushes and pull
requests. Both hit APIs outside this repository's control — AniList allows 30
requests per minute, and Vercel deploys asynchronously, so a job fired right
after a merge would race the deployment and report failures for a build that has
not shipped yet. Run them locally with `npm run test:live` and
`npm run test:deployed`, or trigger them from the Actions tab.

Set the deployment URL with a repository **variable** named `DEPLOY_URL` if the
app is not on `kindoku.vercel.app`. No secret is required: the endpoint holds
its own `GROQ_API_KEY`.

### Deployment smoke tests

`tests/deployed.test.mjs` is the only suite that exercises the real Groq
pipeline, because the key lives in Vercel and never leaves it. It also reports
**which build is deployed** — a pre-rewrite deployment is missing the
`exhausted` field and has no pagination, so those tests fail with a message
saying so rather than an obscure assertion.

It found seven real problems in production, including the AI path never being
reached and preset queries returning HTTP 500.

### When the AI path breaks

The handler falls back to the direct AniList engine, which is fully functional,
so a dead Groq integration looks completely healthy from the user's side. Every
failure is therefore logged to the Vercel logs with an actionable hint:

```
[kindoku] groq failed {"service":"groq","model":"llama-3.3-70b-versatile,llama-3.1-8b-instant",
 "reason":"all models failed; falling back to AniList",
 "attempts":[{"model":"llama-3.3-70b-versatile","reason":"http error","status":401,
   "code":"invalid_api_key","message":"Invalid API Key"}],
 "hint":"GROQ_API_KEY is missing, malformed or revoked"}
```

The key and the user's query are never written to the log — `diagnostics.test.mjs`
asserts both.

Line endings are pinned to LF by `.gitattributes`, so a Windows checkout and a
Linux CI run operate on identical bytes. Without it, `core.autocrlf=true` wrote
CRLF into the blobs and any test that split source on `"\n"` could pass on one
platform and fail on the other.

### Live contract tests

```bash
npm run test:live
```

These are the checks that cannot be faked, and they are the ones most likely to
catch real breakage — mocked tests stay green when an upstream schema changes.
They verify that AniList still accepts the query shapes, returns every field the
code reads, that `genre_in` genuinely filters, that `recommendations` still
returns rows, and that every tag the UI offers resolves to a tag AniList knows.

**They found a real bug.** Twelve of the thirty UI tags — `Villainess`,
`Time Travel`, `Academy`, `Beast Taming`, `Nobility` and others — were mapped to
tags that return nothing, so selecting them silently produced zero results.
`Villainess` was mapped to `Otome Game`, which does not exist; AniList spells it
`Villainess`. `TAG_MAP` has been corrected against the live vocabulary, and the
five tropes with no AniList equivalent are now listed in `DEAD_TAGS` and dropped
rather than mapped to something misleading.

Run these after any change to `TAG_MAP`, `ANILIST_GENRES`, or a GraphQL query.

### Notes for anyone adding tests

- The handler's rate-limit table and response caches live in module scope,
  exactly as they do in a warm serverless instance. `api-handler.test.mjs` loads
  a fresh module instance per test via a cache-busting query string; pass an
  explicit `handler` when a test needs to exercise cross-request behaviour.
- Anything that renders markup must go through `escapeHtml`. The
  `integrity.test.mjs` sink check enforces this across the whole file.
- Do not write raw control characters into a source file. Build them with
  `String.fromCharCode` — a literal NUL makes the file unreadable to diff
  tooling and silently changes the meaning of the test.
- `live.test.mjs` throttles itself to one AniList call every ~2s and retries
  429s. Do not remove the throttle: AniList allows 30 requests per minute.

## Conventions worth knowing

- **`kindoku.js` is a classic script.** Top-level declarations are ambient, so
  the file has no module boundary. `tests/harness.mjs` compiles it with
  `vm.compileFunction` and returns its top-level names, which is what makes the
  client testable without a bundler.
- **Genres come from AniList, never from the model.** A genre the user selects
  is enforced against AniList's canonical genre list and is never relaxed. UI
  genres AniList does not have (`Historical`, `Martial Arts`) are routed through
  the tag filter instead.
- **The AI proposes, AniList disposes.** The model supplies candidate titles
  only; every returned record is verified against AniList before it reaches the
  client.
- **Two response caches.** `aiRecommendationCache` for model output and
  `anilistQueryCache` for raw AniList pages. The latter is what keeps the app
  responsive when no API key is configured.
- **Every request runs on a wall-clock budget.** `TOTAL_BUDGET_MS` (7s) in
  `api/recommend.js` sits under the 10s Hobby-plan function cap with headroom to
  write the response. A hard deadline aborts all outstanding upstream work at
  once, so sequential stages cannot compose into an overrun — the request
  degrades to the direct AniList engine instead of being killed. `budget.test.mjs`
  fails the build if the two constants drift apart.

## Deployment

`vercel.json` pins `maxDuration: 10` for `api/recommend.js` and `memory: 1024`.
Hobby caps duration at 10s; raising it requires a paid plan.

There is deliberately **no** rewrite rule. The app has no client-side routing —
every view is switched in JavaScript from `index.html`, with no `pushState`, no
hash routing and no `popstate` listener — so a catch-all SPA rewrite serves no
purpose. It would also be risky: Vercel compiles `rewrites.source` with
path-to-regexp, which does not support negative lookaheads, so the common
`/((?!api/).*)` exclusion does not do what it appears to. `budget.test.mjs`
fails if a rewrite is added without a corresponding client-side route.

`Cache-Control` on `/api/*` is `no-store` so a cached recommendation can never
be served from the edge. `sw.js` and the app shell are sent with
`must-revalidate` — a long `max-age` on the shell is what pins users to one
build.