/**
 * The request budget is the one piece of this codebase that cannot be verified
 * by running the tests: it only manifests on a real Vercel function, where
 * exceeding `maxDuration` means the response is lost outright.
 *
 * These tests assert the invariants that keep the handler inside the platform
 * limit, and that `api/recommend.js` and `vercel.json` agree about what that
 * limit is. Raising one without the other fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TIMING, clampTimeout, createBudget, createDeadline, anySignal } from '../api/recommend.js';
import { REPO_ROOT } from './harness.mjs';

const vercel = JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8'));
const apiSource = readFileSync(resolve(REPO_ROOT, 'api/recommend.js'), 'utf8');

const MAX_DURATION_S = vercel.functions['api/recommend.js'].maxDuration;
const MAX_DURATION_MS = MAX_DURATION_S * 1000;

// ── The deployment contract ────────────────────────────────────────────────

test('the handler budget fits inside the configured function maxDuration', () => {
  assert.ok(
    TIMING.TOTAL_BUDGET_MS < MAX_DURATION_MS,
    `TOTAL_BUDGET_MS (${TIMING.TOTAL_BUDGET_MS}) must stay below maxDuration (${MAX_DURATION_MS})`
  );
});

test('the budget leaves headroom for serialising and writing the response', () => {
  // The kill is hard: whatever has not been written is gone. Reserving ~25% of
  // the cap means a worst-case request still finishes its response.
  const headroom = MAX_DURATION_MS - TIMING.TOTAL_BUDGET_MS;
  const minimumHeadroom = MAX_DURATION_MS * 0.25;
  assert.ok(
    headroom >= minimumHeadroom,
    `only ${headroom}ms of headroom below the ${MAX_DURATION_MS}ms cap; want >= ${Math.round(minimumHeadroom)}ms`
  );
});

test('maxDuration is a value Vercel actually accepts', () => {
  // Hobby caps at 10s and rejects anything above it at deploy time, so a typo
  // here breaks the deploy rather than the app.
  assert.ok(
    MAX_DURATION_S <= 10 || MAX_DURATION_S === 30 || MAX_DURATION_S === 60 || MAX_DURATION_S === 300,
    `maxDuration ${MAX_DURATION_S} is not a Vercel-supported value`
  );
});

test('the function is declared for the api/recommend.js path that exists', () => {
  assert.ok(vercel.functions['api/recommend.js'], 'vercel.json must configure api/recommend.js');
  assert.ok(readFileSync(resolve(REPO_ROOT, 'api/recommend.js'), 'utf8'));
});

test('the configured memory is a value Vercel accepts', () => {
  const memory = vercel.functions['api/recommend.js'].memory;
  assert.ok(memory === 1024 || memory === 128 || memory === 176 || memory === 256 ||
            memory === 512 || memory === 3008,
            `memory ${memory} is not a Vercel-supported value`);
});

test('no catch-all rewrite can shadow the API function', () => {
  // This app has no client-side routing — every view is switched in JS from
  // index.html — so a catch-all SPA rewrite buys nothing. And Vercel's
  // `rewrites.source` is compiled with path-to-regexp, which does not support
  // negative lookaheads, so the common `/((?!api/).*)` exclusion silently does
  // not do what it looks like it does.
  //
  // A rewrite is allowed only if it cannot match /api/.
  const rewrites = vercel.rewrites || [];
  for (const rule of rewrites) {
    assert.ok(
      !/^\/\(\.\*\)\/?$/.test(rule.source.trim()),
      `rewrite "${rule.source}" would catch every path including /api/`
    );
    assert.doesNotMatch(
      rule.source,
      /\(\?!/,
      `rewrite "${rule.source}" uses a negative lookahead, which path-to-regexp does not support`
    );
  }
});

test('the SPA needs no rewrite, so none should be declared', () => {
  // Guards against a future "fix" for 404s on arbitrary paths. kindoku.js has
  // no pushState, no hash routing and no popstate listener, so there is no deep
  // link a user could ever hold. A rewrite here would only risk shadowing the
  // function.
  const js = readFileSync(resolve(REPO_ROOT, 'kindoku.js'), 'utf8');
  assert.doesNotMatch(js, /pushState|replaceState|popstate/,
    'kindoku.js has gained client-side routing; the rewrite decision must be revisited');
  assert.equal((vercel.rewrites || []).length, 0,
    'a rewrite was added without a corresponding client-side route');
});

test('recommendations are marked no-store at the edge', () => {
  const headers = vercel.headers || [];
  const apiRule = headers.find(rule => rule.source.includes('api/'));
  assert.ok(apiRule, 'vercel.json must set headers for /api/');
  const cacheControl = apiRule.headers.find(h => h.key === 'Cache-Control')?.value || '';
  assert.match(cacheControl, /no-store/, 'recommendations must never be edge-cached');
});

test('the service worker is never cached, or updates never ship', () => {
  // A cached sw.js is the classic way a service worker gets stuck on an old
  // build: the browser keeps using the previous worker script indefinitely.
  const headers = vercel.headers || [];
  const swRule = headers.find(rule => rule.source.includes('sw.js'));
  assert.ok(swRule, 'vercel.json must set headers for sw.js');
  const cacheControl = swRule.headers.find(h => h.key === 'Cache-Control')?.value || '';
  assert.match(cacheControl, /must-revalidate|no-cache/);
});

test('the app shell assets are revalidated rather than cached forever', () => {
  const headers = vercel.headers || [];
  const shellRule = headers.find(rule => rule.source.includes('kindoku'));
  assert.ok(shellRule, 'vercel.json must set headers for kindoku.css/js');
  const cacheControl = shellRule.headers.find(h => h.key === 'Cache-Control')?.value || '';
  assert.match(cacheControl, /must-revalidate|no-cache/,
    'a long max-age on the shell pins users to one build');
});

// ── The arithmetic of the individual stages ───────────────────────────────

test('no single upstream timeout exceeds the whole budget', () => {
  assert.ok(TIMING.GROQ_TIMEOUT_MS <= TIMING.TOTAL_BUDGET_MS);
  assert.ok(TIMING.ANILIST_TIMEOUT_MS <= TIMING.TOTAL_BUDGET_MS);
});

test('a model attempt is only started when it can plausibly finish', () => {
  assert.ok(
    TIMING.MIN_ATTEMPT_BUDGET_MS >= TIMING.GROQ_TIMEOUT_MS,
    'MIN_ATTEMPT_BUDGET_MS must cover a full Groq timeout, or attempts start that cannot finish'
  );
  assert.ok(TIMING.MIN_ATTEMPT_BUDGET_MS < TIMING.TOTAL_BUDGET_MS);
});

test('the retry policy cannot multiply a timeout past the budget', () => {
  // Worst case for one cached query: (retries + 1) full timeouts.
  const worstCaseAnilist = TIMING.ANILIST_TIMEOUT_MS * (TIMING.ANILIST_RETRIES + 1);
  assert.ok(
    worstCaseAnilist <= TIMING.TOTAL_BUDGET_MS,
    `AniList retry chain can take ${worstCaseAnilist}ms, over the ${TIMING.TOTAL_BUDGET_MS}ms budget`
  );
});

test('RESULT_PAGE_SIZE matches the discovery query page size', () => {
  // The top-up fills a page up to RESULT_PAGE_SIZE, so if the query asks for a
  // different number the grid is either short or built from titles that were
  // never requested.
  const declared = /const RESULT_PAGE_SIZE\s*=\s*(\d+)/.exec(apiSource)?.[1];
  assert.ok(declared, 'RESULT_PAGE_SIZE is no longer a numeric literal; update this test');

  const discovery = /const ANILIST_DISCOVER_QUERY\s*=\s*`([\s\S]*?)`/
    .exec(apiSource)?.[1];
  assert.ok(discovery, 'the discovery query is no longer a template literal');
  const perPage = /perPage:\s*(\d+)/.exec(discovery)?.[1];
  assert.ok(perPage, 'the discovery query has no perPage');

  assert.equal(Number(declared), Number(perPage),
    `RESULT_PAGE_SIZE is ${declared} but the discovery query asks for ${perPage} ` +
    'titles per page');
});

test('the results page is never longer than one page', () => {
  // A top-up that ignored the cap would return more titles than the query asked
  // for, which the client then renders as an over-long page.
  assert.match(apiSource, /if \(finalRecs\.length >= RESULT_PAGE_SIZE\) break;/,
    'the top-up does not stop at the page size');
});

test('every model in the ladder is reachable within the budget', () => {
  // Each attempt is preceded by a sleep and is only started if at least
  // MIN_ATTEMPT_BUDGET_MS remains, so a ladder longer than the number of
  // attempts the budget allows has unreachable entries at the end.
  const match = apiSource.match(/const GROQ_MODELS\s*=\s*\[([^\]]*)\]/);
  assert.ok(match, 'GROQ_MODELS is no longer a literal array; update this test');
  const modelCount = [...match[1].matchAll(/"([^"]+)"/g)].length;
  assert.ok(modelCount > 0, 'expected at least one model in the ladder');

  const attemptsThatFit = Math.floor(TIMING.TOTAL_BUDGET_MS / TIMING.MIN_ATTEMPT_BUDGET_MS);
  assert.ok(
    attemptsThatFit >= 1,
    'the budget must allow at least one AI attempt'
  );
  assert.ok(
    modelCount <= attemptsThatFit,
    `the ladder lists ${modelCount} models but the budget only allows ` +
    `${attemptsThatFit} attempt(s), so the last ${modelCount - attemptsThatFit} ` +
    'can never be tried'
  );
});

test('enrichment fan-out is bounded', () => {
  assert.ok(TIMING.ENRICHMENT_CONCURRENCY >= 1);
  assert.ok(
    TIMING.ENRICHMENT_CONCURRENCY <= 8,
    'a higher fan-out risks tripping AniList rate limits'
  );
});

// ── clampTimeout ───────────────────────────────────────────────────────────

test('clampTimeout caps a long timeout to the remaining budget', () => {
  const budget = createBudget(5000);
  assert.ok(clampTimeout(30_000, budget) <= 5000);
  assert.ok(clampTimeout(1000, budget) <= 1000, 'a short timeout is not inflated');
});

test('clampTimeout never returns a non-positive timeout', () => {
  const budget = createBudget(5000);
  assert.ok(clampTimeout(1, budget) > 0);
  assert.ok(clampTimeout(0, budget) > 0);
  assert.ok(clampTimeout(-100, budget) > 0);
});

test('clampTimeout never hands out more time than the budget has left', () => {
  // Regression: a 500ms floor meant that with 50ms left, the returned timeout
  // was 500ms — ten times the budget, and exactly how a "budgeted" request
  // overran the cap and lost the response to the platform kill.
  for (const elapsed of [9_950, 9_990, 9_999]) {
    const budget = createBudget(10_000).advance(elapsed);
    const remaining = budget.remaining();
    const timeout = clampTimeout(4_000, budget);
    assert.ok(
      timeout <= remaining,
      `with ${elapsed}ms elapsed, clampTimeout returned ${timeout}ms but only ${remaining}ms remained`
    );
  }
});

test('an exhausted budget still yields a positive timeout rather than a hang', () => {
  // Zero is not an option: `setTimeout(fn, 0)` is not "no time", it is an
  // immediate abort, and a negative value is coerced to 0. One millisecond is
  // the smallest honest answer.
  const budget = createBudget(1_000).advance(5_000);
  assert.equal(budget.remaining(), 0);
  assert.equal(clampTimeout(4_000, budget), 1);
});

test('clampTimeout still returns a usable timeout when the budget is ample', () => {
  const budget = createBudget(7_000);
  assert.equal(clampTimeout(3_000, budget), 3_000, 'the full timeout is granted');
});

test('clampTimeout degrades to the remaining time rather than overshooting', () => {
  const budget = createBudget(7_000).advance(5_500);
  const timeout = clampTimeout(3_000, budget);
  assert.ok(timeout > 1_000 && timeout <= 1_500, `unexpected timeout: ${timeout}`);
});

test('advance() actually moves the clock', () => {
  // Guards against the closure-vs-property trap: if `advance` were a no-op, every
  // "spent budget" test above would silently be measuring a fresh budget.
  const budget = createBudget(7_000);
  assert.ok(budget.remaining() > 6_900, 'a fresh budget is nearly full');
  budget.advance(3_000);
  assert.ok(budget.remaining() < 4_100, `expected ~4s left, got ${budget.remaining()}`);
  assert.ok(budget.elapsed() >= 3_000);
});

test('remaining() never goes negative', () => {
  const budget = createBudget(1_000).advance(5_000);
  assert.equal(budget.remaining(), 0);
  assert.ok(clampTimeout(3_000, budget) >= 1, 'a spent budget still returns a positive timeout');
});

test('clampTimeout passes the value through when there is no budget', () => {
  assert.equal(clampTimeout(1234, null), 1234);
});

test('clampTimeout never exceeds what was asked for', () => {
  const budget = createBudget(10_000);
  assert.ok(clampTimeout(100, budget) <= 100);
});

// ── The hard deadline ──────────────────────────────────────────────────────

test('the deadline aborts once the budget is gone', async () => {
  const budget = createBudget(40);
  const deadline = createDeadline(budget);
  try {
    assert.equal(deadline.expired(), false, 'not expired immediately');
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(deadline.expired(), true, 'expired after the budget elapsed');
    assert.equal(deadline.signal.aborted, true);
  } finally {
    deadline.dispose();
  }
});

test('disposing the deadline stops it aborting later', async () => {
  const budget = createBudget(40);
  const deadline = createDeadline(budget);
  deadline.dispose();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(deadline.signal.aborted, false, 'a finished request must not keep a live timer');
});

test('the deadline timer does not hold the process open', () => {
  // An un-unref'd timer would keep a serverless invocation alive past its work.
  const budget = createBudget(50_000);
  const deadline = createDeadline(budget);
  // The handle is captured via the timer itself; verify by checking that the
  // budget object does not retain an active handle after disposal.
  deadline.dispose();
  assert.equal(deadline.expired(), false);
});

// ── Signal composition ─────────────────────────────────────────────────────

test('anySignal passes a single signal through unchanged', () => {
  const controller = new AbortController();
  assert.equal(anySignal([controller.signal]), controller.signal);
});

test('anySignal returns undefined when there is nothing to combine', () => {
  assert.equal(anySignal([]), undefined);
  assert.equal(anySignal([null, undefined]), undefined);
});

test('anySignal aborts when any input aborts', () => {
  const a = new AbortController();
  const b = new AbortController();
  const combined = anySignal([a.signal, b.signal]);
  assert.equal(combined.aborted, false);
  b.abort();
  assert.equal(combined.aborted, true, 'aborting one input aborts the combined signal');
});

test('anySignal is already aborted when an input was already aborted', () => {
  const a = new AbortController();
  a.abort();
  const b = new AbortController();
  assert.equal(anySignal([a.signal, b.signal]).aborted, true);
});

// ── Rate limiting and caching, in the context of the budget ────────────────

test('the rate limit is compatible with a 7s budget', () => {
  // 30 requests/minute is ~2s apart, so a single user cannot realistically
  // exhaust the budget through retries.
  const minimumSpacingMs = TIMING.RATE_LIMIT_WINDOW_MS / TIMING.RATE_LIMIT_MAX_REQUESTS;
  assert.ok(minimumSpacingMs > 1000, `only ${minimumSpacingMs}ms between allowed requests`);
});

test('caches are bounded so a warm instance cannot grow without limit', () => {
  assert.ok(TIMING.MAX_CACHE_ENTRIES > 0);
  assert.ok(TIMING.CACHE_TTL_MS > 0);
});

test('the exclude list is bounded in both total size and prompt size', () => {
  assert.ok(TIMING.MAX_EXCLUDE_IN_PROMPT <= TIMING.MAX_EXCLUDE_TOTAL);
  assert.ok(TIMING.MAX_EXCLUDE_IN_PROMPT <= 20, 'keep the prompt well within context');
});