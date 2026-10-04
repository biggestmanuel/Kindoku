# AGENTS.md

Guidance for anyone — human or agent — changing this repository. Everything here
was learned the expensive way; each rule names the failure that motivated it, so
you can judge whether it still applies.

## Verify before you trust

```bash
npm run check      # lint + the full offline suite. ~20s. Run this before committing.
npm run verify     # the suite twice, proving no cross-test state leakage. ~40s.
npm test           # the offline suite alone
npm run lint       # node --check on the three shipped JS files
```

Network-dependent suites are excluded from `npm test` and must be asked for:

```bash
npm run test:live       # AniList + Google Translate contracts. Paced; ~90s.
npm run test:groq       # Groq contracts. Self-skips without GROQ_API_KEY.
npm run test:deployed   # contracts against https://kindoku.vercel.app. ~60s.
```

**After pushing, `npm run test:deployed` is the only way to know a change reached
production.** CI cannot: Vercel deploys asynchronously and GitHub cannot wait for
its webhook, so the scheduled jobs would race the deploy.

## Never bulk-edit source with the shell

The most expensive mistake in this repository's history.

A PowerShell `-replace` regex run over `api/recommend.js` silently corrupted 16
object keys — `STATUS_MAP`, `FORMAT_MAP`, `error:`, the HTTP method names — into
`""`. `node --check` still passed, because the file remained valid JavaScript.
Only the test suite caught it.

It got worse: `git checkout api/recommend.js`, run to undo the damage,
**discarded every fix made to that file**, and it had to be rewritten from
scratch. The tests are what made that recoverable.

Rules:

- Use the **edit tool** with an exact `oldString`. It fails loudly when the text
  does not match exactly once, which is the behaviour you want.
- Never `-replace`, `sed -i`, `Set-Content`, or `ConvertTo-Json` over a source
  file. This machine is PowerShell, where quoting inside a replace expression is
  a minefield — it has broken twice on files containing `'`.
- If a bulk change really is unavoidable, copy the file somewhere outside the
  repo first, then diff the result before keeping it.
- After any shell-written file, check `git diff` reads the way you intended.

## Never discard uncommitted work

`git checkout <file>` and `git restore <file>` throw away every uncommitted change
to that file, not just the one you are looking at. That is what destroyed the
`api/recommend.js` rewrite.

To compare against HEAD without losing anything: `git diff <file>`. To stash:
`git stash push -- <file>`.

## Derive values, never duplicate them

Three separate bugs came from a value written down in two places:

| Duplicated | Consequence |
| --- | --- |
| `kindoku-cache-v3` in 14 places in `service-worker.test.mjs` | Bumping the version broke the tests instead of the tests following the bump |
| `/"llama-[^"]+"/` in `budget.test.mjs` | Matched nothing once the models were renamed; reported an empty ladder; **still passed** |
| "307 tests" in `README.md` | Stayed wrong through several commits |

Read the value out of the source it belongs to and assert on the *relationship* —
`service-worker.test.mjs` now reads `CACHE_NAME` out of `sw.js`, and
`budget.test.mjs` asserts `RESULT_PAGE_SIZE` equals the discovery query's
`perPage`. `docs.test.mjs` refuses to let a test count back into the README,
because the runner already prints the real one.

## A test that cannot fail is worse than no test

Two drafts of the regression test for the thin-page top-up **passed against the
code they were written for.** The scenario had the model return zero usable
titles, which the old recovery path already handled; the bug only appears when it
returns exactly one.

After writing a test for a bug you just fixed:

1. Revert the fix (by hand, on a copy).
2. Confirm the test fails.
3. Restore.

`assert.doesNotMatch` on a pattern you have not seen match is the usual symptom.
A test that never fails was never tested.

## Prove a deployment with a signal that cannot be a false positive

Fifteen minutes were lost polling for `exhausted: true` on `page: 50` — a signal
that *cannot* appear once pagination works, because page 50 returns titles. A
detector that cannot distinguish "deployed" from "not deployed" is worse than
none, because it looks like it is working.

`tests/deployed.test.mjs` compares `CACHE_NAME` from the committed `sw.js`
against the one the deployment serves. If you need a new build detector, use a
literal that exists in the source, never behaviour that a feature flag changes.

A build that fails to deploy is **silent**: Vercel keeps serving the previous
build, so the symptom is identical to "Vercel is being slow". If a change is
genuinely absent after ~3 minutes, suspect your own config before waiting longer.
A `"//"` comment key in `vercel.json` once stopped every deploy for 13 minutes,
and `security.test.mjs` now fails the build on any key outside Vercel's schema.

## Measure before calling something flaky

Two things were nearly "fixed" as flakes:

- A suite test failed intermittently. It was a real race: it slept a fixed 50ms
  hoping the handler had reached AniList, which is not enough when `timing.test.mjs`
  holds the event loop for seconds. Replaced with a bounded poll.
- Deployed tests failed intermittently with empty results. AniList allows 30
  requests per minute and degrades well before that — 20 concurrent queries were
  measured aborting at the 2.5s per-query timeout. Probing eight times showed 0/8
  failures, so the fix was pacing and a `degraded`-aware retry, not chasing a
  phantom.

When a third-party test fails, measure the rate before working around it.

## Scripts must run on Windows

This project is developed on Windows. `FOO=bar node --test` is a bash feature;
npm runs scripts through `cmd.exe`, where it parses as a command name and fails
with *"'FOO' is not recognized"*. CI is Linux, so this was invisible until
someone tried to run the script. `docs.test.mjs` now rejects the pattern.

## Platform notes

- PowerShell: avoid heredocs and inline replace expressions on files containing
  quotes. Prefer the edit tool, or a `node -e` script with a heredoc-free form.
- Line endings must be LF. `.gitattributes` pins them; a Windows append or
  `Set-Content` reintroduces CRLF, and a stray CR makes a regex behave
  differently on one platform than another. `dead-code.test.mjs` fails on any.
- Do not add dependencies. The project has zero, by design, which is why there is
  no lockfile and no install step. Adding one for a single helper is a poor trade.

## Things that are easy to get wrong here

- **`sandbox` + `allow-same-origin` is not a sandbox.** Those two tokens together
  let the framed site run scripts in our origin and read `localStorage`.
- **Reasoning models count reasoning tokens against `max_tokens`.** The Groq
  replacements truncate their JSON answer and look exactly like a refusal.
- **A live model can make results worse.** It proposes a few titles, verification
  keeps the few AniList has, and the page comes back thin. Recovery-only-when-empty
  does not help; the page is not empty. This is why step 5 tops up from the
  prefetched deterministic results.
- **The handler keeps caches and a rate-limit table in module scope**, exactly as
  a warm serverless instance does. Tests that build the same query share cached
  candidates — use a distinct genre per test rather than assuming isolation.
- **`maxDuration` is 10** because the Vercel plan is Hobby. Timing constants in
  `api/recommend.js` and `vercel.json` are asserted to agree by `budget.test.mjs`.
- **No client-side routing.** There is no `pushState`, no hash routing, no
  `popstate` listener, so a catch-all SPA rewrite is unnecessary *and* risky:
  Vercel compiles `rewrites.source` with path-to-regexp, which does not support
  the negative lookahead the usual `/((?!api/).*)` exclusion relies on.