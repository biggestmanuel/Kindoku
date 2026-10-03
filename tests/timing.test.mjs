/**
 * Wall-clock behaviour of the handler under a slow or unresponsive upstream.
 *
 * The point of the request budget is that a slow Groq or AniList degrades the
 * response instead of losing it to the platform kill. That cannot be verified by
 * inspecting constants, so these tests use a real clock and assert the handler
 * actually returns inside its budget.
 *
 * These are the slowest tests in the suite by nature — each hangs an upstream
 * and waits for a real timeout — so the expensive paths are consolidated into
 * two cases rather than one test per assertion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { TIMING } from '../api/recommend.js';

const realFetch = globalThis.fetch;
const realApiKey = process.env.GROQ_API_KEY;

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const ANILIST_URL = 'https://graphql.anilist.co';

// Slack for scheduling jitter and the tail of writing the response.
const SLACK_MS = 1_500;

let originalConsoleLog = null;

function createRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

/**
 * A fetch that never answers within any plausible timeout.
 *
 * It resolves eventually so a test can never wedge the suite, and it rejects on
 * abort the way a real `fetch` does — which is what the handler's deadline
 * relies on to stop waiting.
 */
function neverAnswers(onAbort) {
  return (_url, options = {}) =>
    new Promise((resolve, reject) => {
      // Resolve eventually so a bug can never wedge the suite indefinitely.
      const timer = setTimeout(() => {
        resolve({ ok: true, status: 200, json: async () => ({ data: { Page: { media: [] } } }) });
      }, 30_000);

      const abort = () => {
        clearTimeout(timer);
        onAbort?.();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      };

      const signal = options.signal;
      if (!signal) return;
      // A signal that is ALREADY aborted will never fire 'abort' again — the
      // event already happened. Real `fetch` rejects immediately in that case;
      // a naive listener-only stub would hang forever, which is exactly what
      // this helper checks for.
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    });
}

/** An AniList response containing one title. */
function anilistPayload(title, overrides = {}) {
  return {
    data: {
      Page: {
        media: [{
          title: { english: title, romaji: title, native: title },
          description: 'A story.',
          coverImage: { large: null, medium: null },
          averageScore: 80,
          status: 'FINISHED',
          genres: ['Action'],
          siteUrl: null,
          format: 'MANGA',
          countryOfOrigin: 'JP',
          externalLinks: [],
          ...overrides,
        }],
      },
    },
  };
}

/** Groq returning the given titles. */
function groqPayload(titles) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(
            titles.map(title => ({ title, type: 'Manga', synopsis: 's' }))
          ),
        },
      },
    ],
  };
}

async function invoke(body) {
  const res = createRes();
  const started = Date.now();
  await handler({ method: 'POST', body, headers: {}, socket: {} }, res);
  return { res, elapsed: Date.now() - started };
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  if (realApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realApiKey;
});

// The handler's own diagnostics are useful in production but only add noise to
// test output, where the assertions are the signal.
test.beforeEach(() => {
  originalConsoleLog = console.log;
  console.log = () => {};
});

test.afterEach(() => {
  console.log = originalConsoleLog;
});

// Every test name here is prefixed with "timing:" so the whole file can be
// excluded from the fast run via `--test-skip-pattern="^timing:"`.
test('timing: a hung upstream returns a response inside the budget', async t => {
  // Covers the timeout path end to end: every assertion that would otherwise
  // need its own 7-second wait is folded in here.
  process.env.GROQ_API_KEY = 'test-key-0000';
  let attempts = 0;
  let aborts = 0;
  globalThis.fetch = async (url, options = {}) => {
    attempts++;
    return neverAnswers(() => aborts++)(url, options);
  };

  const { res, elapsed } = await invoke({
    mode: 'search',
    searchInput: 'Hung Upstream Probe',
  });

  await t.test('timing: the user gets a response, not a gateway timeout', () => {
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.recommendations), 'recommendations is always an array');
    assert.equal(res.body.error, undefined, 'an abort is not surfaced as an error');
  });

  await t.test('timing: it returned within the budget', () => {
    assert.ok(
      elapsed <= TIMING.TOTAL_BUDGET_MS + SLACK_MS,
      `took ${elapsed}ms against a ${TIMING.TOTAL_BUDGET_MS}ms budget`
    );
  });

  await t.test('timing: the deadline aborted the in-flight request', () => {
    assert.ok(aborts > 0, 'nothing was aborted; the handler must actively cancel');
  });

  await t.test('timing: the retry ladder is bounded', () => {
    assert.ok(
      attempts <= 8,
      `made ${attempts} upstream attempts; the ladder looks unbounded`
    );
  });
});

test('timing: a hung AniList still yields a well-formed, verified-only response', async () => {
  // Groq answers promptly, AniList never does. Discover mode must return
  // nothing: the model proposes, AniList disposes.
  process.env.GROQ_API_KEY = 'test-key-0000';
  globalThis.fetch = async (url, options = {}) => {
    if (url === GROQ_URL) {
      return { ok: true, status: 200, json: async () => groqPayload(['Invented One', 'Invented Two']) };
    }
    // `options` must be forwarded: the abort signal lives there, and dropping it
    // both hides a real handler bug and leaves the stub's fallback timer armed,
    // which stalls the whole suite until it fires.
    return neverAnswers()(url, options);
  };

  const { res, elapsed } = await invoke({
    mode: 'discover',
    genres: ['Action'],
    formats: ['Manhwa'],
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.recommendations,
    [],
    'titles AniList could not verify are never returned'
  );
  assert.ok(
    elapsed <= TIMING.TOTAL_BUDGET_MS + SLACK_MS,
    `took ${elapsed}ms against a ${TIMING.TOTAL_BUDGET_MS}ms budget`
  );
});

test('timing: a fast upstream is not slowed down by the budget machinery', async () => {
  // Guards the opposite failure: budget bookkeeping that serialises or delays a
  // request that would otherwise answer in milliseconds.
  delete process.env.GROQ_API_KEY;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => anilistPayload('Quick'),
  });

  const { res, elapsed } = await invoke({ mode: 'search', searchInput: 'Quick Probe' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.recommendations.length, 1);
  assert.equal(res.body.recommendations[0].title, 'Quick');
  assert.ok(elapsed < 1_000, `a fast request took ${elapsed}ms`);
});

test('timing: the AI path is fast when AniList answers promptly', async () => {
  // Confirms the common happy path still completes well inside the budget.
  process.env.GROQ_API_KEY = 'test-key-0000';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return { ok: true, status: 200, json: async () => groqPayload(['Berserk']) };
    }
    return { ok: true, status: 200, json: async () => anilistPayload('Berserk') };
  };

  const { res, elapsed } = await invoke({ mode: 'search', searchInput: 'Happy Path' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.recommendations[0].title, 'Berserk');
  assert.ok(elapsed < 2_000, `the happy path took ${elapsed}ms`);
});