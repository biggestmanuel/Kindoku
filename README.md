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
npm test             # the whole offline suite, no dependencies, no network, ~20s
npm run test:fast    # skips the timing suite, ~5s — good for a save hook
npm run lint         # syntax check on the three shipped JS files
npm run check        # lint + full suite (run this)
npm run verify       # lint + suite twice; catches cross-test state leakage
npm run test:live    # AniList + Google Translate contract tests, needs network
npm run test:groq    # Groq contract tests, needs GROQ_API_KEY
npm run test:deployed  # contract tests against the live deployment, needs network
npm run test:watch    # re-runs the offline suite on change
```

`npm test` prints the exact count. It is deliberately not written down here: a
number in a README goes stale the moment someone adds a test, and `docs.test.mjs`
checks the things that actually matter — that every test file and every script is
still documented.

`npm test` deliberately excludes the three network-dependent suites, so an
offline run never touches the network and no opt-in flag is needed for the
others: naming the file is the opt-in. `groq-live` additionally skips itself
whenever `GROQ_API_KEY` is absent from the environment.

All scripts are plain `node` invocations. Nothing here relies on a POSIX-only
`VAR=value cmd` prefix, which silently fails on Windows cmd.

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
| `security.test.mjs` | The Content-Security-Policy is strict where it can be and stays in step with what the code actually contacts; the reader frame is sandboxed; pinch zoom works. |
| `reduced-motion.test.mjs` | The particle loop does not run and infinite CSS animations stop when the OS asks for reduced motion, including when that changes mid-session. |
| `docs.test.mjs` | The README has not drifted from reality: every suite and npm script is documented, every CI job is explained, and no stale test count or removed suite is left behind. |
| `diagnostics.test.mjs` | Every distinct upstream failure is reported, the logs never contain the API key or the user's query, and a dead AI path still degrades to the fallback. |
| `integrity.test.mjs` | Cross-file drift: every `getElementById` target exists, every injected class is styled, every precached asset exists, nothing unescaped reaches an `innerHTML`. |
| `live.test.mjs` | Contract tests against the real AniList API. Run by `npm run test:live`. |
| `models.test.mjs` | The Groq model ladder contains no retired model, and its length fits inside the request budget. |
| `groq-live.test.mjs` | Contract tests against the real Groq API. Runs automatically when `GROQ_API_KEY` is set, skipped otherwise. |
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

The suite spaces its API requests 1.2s apart on purpose. AniList allows 30
requests per minute and slows enough to time out well before that — twenty
concurrent identical queries were measured aborting at the 2.5s per-query
timeout. A cold request fans out to several AniList calls at once, so a burst
makes the third party fail and then asserts the app returned an empty page.
Pacing is the honest fix; retrying an empty result would hide a real regression.

### Degraded versus empty

Both an unreachable catalogue and a query with no matches produce an empty array,
and reporting the first as the second tells someone their filters are wrong when
the question was never asked. `runCachedAnilistQuery` records which happened on
the budget, the response carries `degraded`, and the client asks them to retry
rather than to loosen their criteria.

### When the AI path breaks

The handler falls back to the direct AniList engine, which is fully functional,
so a dead Groq integration looks completely healthy from the user's side. Every
failure is therefore logged to the Vercel logs with an actionable hint:

```
[kindoku] groq failed {"service":"groq","model":"openai/gpt-oss-20b,openai/gpt-oss-120b",
 "reason":"all models failed; falling back to AniList",
 "attempts":[{"model":"openai/gpt-oss-20b","reason":"http error","status":400,
   "code":"model_not_found","message":"..."}],
 "hint":"a model name is no longer served by Groq; update GROQ_MODELS"}
```

The key and the user's query are never written to the log — `diagnostics.test.mjs`
asserts both. One line per request is expected for as long as the fault lasts;
that is deliberate, because a fault that only appears intermittently needs its
own line each time.

### Groq model lifecycle

A model list is external data with an expiry date, and this one bit the project
hard: Groq retired `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` on
**2026-08-16** for free and developer-tier keys, making both Enterprise-only. The
AI stage had been dead for seven weeks and every response still said 200.

Three things now guard against a repeat:

- `models.test.mjs` pins the known-dead IDs and fails if the ladder lists one,
  and asserts every configured model is one Groq currently serves.
- `groq-live.test.mjs` compares the ladder against the live catalogue whenever a
  key is available, so a retirement is caught the moment someone runs it with
  `GROQ_API_KEY` set.
- The request sends `reasoning_effort: "low"` and `include_reasoning: false`.
  The replacements are reasoning models whose reasoning tokens count against
  `max_tokens`, so without both the JSON answer is truncated mid-sentence and
  arrives as an empty content field — a truncation that looks exactly like a
  refusal.

The ladder is ordered fastest first (`openai/gpt-oss-20b` at ~1000 tok/s ahead of
`openai/gpt-oss-120b` at ~500) because the request budget is 7s: leading with the
slower model spends most of it on one attempt and leaves no room for the AniList
fallback. Candidates are verified against AniList either way, so a hallucinated
title is dropped rather than shown.

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

### Security headers

Applied to every response, including `/api/*`:

- **`script-src 'self'`** with no `unsafe-inline` and no `unsafe-eval`. The app
  ships no inline script and calls no `eval`, so this costs nothing — and it is
  the directive that matters, because the codebase assembles markup from strings
  throughout. This is what turns an injected `<script>` into a refused one.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` — the three that
  have no legitimate use here.
- `frame-ancestors 'none'` plus `X-Frame-Options: DENY` for clickjacking.
- `X-Content-Type-Options: nosniff` — the API returns JSON.
- `Referrer-Policy: strict-origin-when-cross-origin` — the reader opens
  third-party reading sites that would otherwise receive this origin.
- `Permissions-Policy` disabling camera, microphone, geolocation, payment, USB
  and the motion sensors.
- HSTS, and `Cross-Origin-Opener-Policy: same-origin`.

`style-src` is the one permissive directive: `index.html` carries about twenty
`style=` attributes and `kindoku.js` emits three more. Moving those to classes is
the better end state, but it needs visual regression testing this repository
cannot do, and inline style is a materially smaller risk than inline script.
`security.test.mjs` asserts `'unsafe-inline'` is only ever allowed for styles, and
asserts those inline styles still exist so the day they are refactored the
permissive directive gets removed.

`frame-src https:` cannot be narrowed: AniList links a different reading site per
title, so there is nothing to enumerate.

### The reader frame

The reader is the most dangerous thing in the app: it displays a different site's
markup on every title. The iframe is sandboxed **without `allow-same-origin`**,
which matters more than it looks — `allow-scripts` together with `allow-same-origin`
is not a weaker sandbox, it is *no* sandbox. A sandboxed frame that is also
same-origin runs scripts in this origin, so the framed page could read the saved
library and the search history out of `localStorage` and rewrite the page. The
trade is that the framed site loses its own storage and cookies, which a manga
reader does not need.

### Accessibility

- **Pinch zoom works.** The viewport no longer carries `user-scalable=no` or
  `maximum-scale=1`, which stopped people zooming and failed WCAG 1.4.4.
- **Reduced motion is honoured**, live rather than once at load, so changing the
  preference in system settings takes effect without a reload. Three background
  orbs, a pulsing logo and up to 160 particles stop; the particle loop never
  starts, which also removes a full-viewport canvas repainting at 60fps
  indefinitely. The stylesheet override uses the universal selector so a new
  animation is covered the day it is added.

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

The service worker uses **navigation preload**. Navigations are network-first so
a deploy is picked up, and without preload every page load waits for the worker
to boot and then re-issues the request the browser has already made — the entire
cost a service worker adds to a page load, paid every time. With preload the
network response is already in flight by the time the worker handles the fetch.
It degrades to a plain fetch where the API is unavailable.