/**
 * Diagnostics coverage.
 *
 * The AI path failing used to be completely invisible: the handler falls back
 * to the direct AniList engine, which is fully functional, so a permanently
 * broken Groq integration produced responses that looked completely healthy.
 *
 * These tests assert that each distinct upstream failure is reported. They are
 * the reason a misconfigured deployment is now diagnosable from the Vercel logs
 * instead of requiring a bisect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/recommend.js';

const realFetch = globalThis.fetch;
const realApiKey = process.env.GROQ_API_KEY;

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const ANILIST_URL = 'https://graphql.anilist.co';

/** Captures console output produced during `fn`. */
async function captureLog(fn) {
  const lines = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const record = (...args) => {
    lines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  console.log = record;
  console.warn = record;
  console.error = record;
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  return lines.join('\n');
}

function createRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

async function invoke(body) {
  const res = createRes();
  await handler({ method: 'POST', body, headers: {}, socket: {} }, res);
  return res;
}

/** AniList answers, so the run gets as far as it can. */
function anilistOk() {
  return async url => {
    if (url === GROQ_URL) throw new Error('Groq should not be reached in this test');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          Page: {
            media: [{
              title: { english: 'Fallback Title', romaji: 'Fallback Title', native: 'x' },
              description: 'A story.',
              coverImage: { large: null, medium: null },
              averageScore: 80,
              status: 'FINISHED',
              genres: ['Action'],
              siteUrl: null,
              format: 'MANGA',
              countryOfOrigin: 'JP',
              externalLinks: [],
            }],
          },
        },
      }),
    };
  };
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  if (realApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realApiKey;
});

test('a missing API key is reported, not silently ignored', async () => {
  delete process.env.GROQ_API_KEY;
  globalThis.fetch = anilistOk();

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Key Probe' }));
  assert.match(log, /GROQ_API_KEY is not set/,
    'a deployment with no key must say so, otherwise the AI path looks healthy while dead');
});

test('a blank or too-short key is treated as missing', async () => {
  for (const value of ['', '   ', 'abc']) {
    process.env.GROQ_API_KEY = value;
    globalThis.fetch = anilistOk();
    const log = await captureLog(() => invoke({ mode: 'search', searchInput: `Blank ${value.length}` }));
    assert.match(log, /GROQ_API_KEY is not set/,
      `a key of "${value}" should be reported as missing`);
  }
});

test('a revoked key is reported with the upstream error code', async () => {
  process.env.GROQ_API_KEY = 'gsk_revoked-for-test';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return {
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' },
        }),
      };
    }
    return anilistOk()(url);
  };

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Revoked Probe' }));
  assert.match(log, /invalid_api_key/, 'the upstream error code must be surfaced');
  assert.match(log, /GROQ_API_KEY is missing, malformed or revoked/,
    'the log should carry an actionable hint');
});

test('a retired model is reported as such', async () => {
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'The model `llama-3.3-70b-versatile` has been decommissioned',
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        }),
      };
    }
    return anilistOk()(url);
  };

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Retired Model Probe' }));
  assert.match(log, /model_not_found/);
  assert.match(log, /update GROQ_MODELS/, 'a decommissioned model needs a code change, not a key change');
});

test('an exhausted quota is reported distinctly from a bad key', async () => {
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return { ok: false, status: 429, json: async () => ({ error: { message: 'Rate limit reached' } }) };
    }
    return anilistOk()(url);
  };

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Quota Probe' }));
  assert.match(log, /rate limit or quota is exhausted/,
    'a quota problem must not be misdiagnosed as a bad key');
});

test('an empty completion is reported', async () => {
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) };
    }
    return anilistOk()(url);
  };

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Empty Probe' }));
  assert.match(log, /no content in the choice/);
});

test('unparseable model output is reported', async () => {
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'I am sorry, I cannot help.' } }] }),
      };
    }
    return anilistOk()(url);
  };

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Refusal Probe' }));
  assert.match(log, /not a usable JSON array/);
});

test('a network failure to Groq is reported', async () => {
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) throw Object.assign(new Error('fetch failed'), { name: 'TypeError' });
    return anilistOk()(url);
  };

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Network Probe' }));
  assert.match(log, /network:/);
});

test('a non-JSON error body from Groq is reported without throwing', async () => {
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return {
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('Unexpected token < in JSON');
        },
      };
    }
    return anilistOk()(url);
  };

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Bad Body Probe' }));
  assert.match(log, /http error/);
  assert.match(log, /502/, 'the status is still reported when the body is unreadable');
});

test('a successful AI path logs nothing alarming', async () => {
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '[{"title":"Fallback Title"}]' } }],
        }),
      };
    }
    return anilistOk()(url);
  };

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Happy Path Probe' }));
  assert.doesNotMatch(log, /all models failed/);
  assert.doesNotMatch(log, /GROQ_API_KEY is not set/);
});

test('the logged output never contains the API key', async () => {
  // The single most important property of this feature: it must be safe to read
  // Vercel logs, which are visible to anyone with project access.
  const secret = 'gsk_SHOULD_NEVER_APPEAR_IN_LOGS';
  process.env.GROQ_API_KEY = secret;

  for (const failure of [
    () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API Key', code: 'invalid_api_key' } }) }),
    () => {
      throw Object.assign(new Error('fetch failed'), { name: 'TypeError' });
    },
    () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) }),
  ]) {
    globalThis.fetch = async url => {
      if (url === GROQ_URL) return failure();
      return anilistOk()(url);
    };
    const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Secret Probe' }));
    assert.ok(!log.includes(secret), `the API key leaked into: ${log}`);
  }
});

test('the logged output never contains the user prompt', async () => {
  // The prompt embeds the user's search text, which may be private.
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) };
    }
    return anilistOk()(url);
  };

  const log = await captureLog(() =>
    invoke({ mode: 'search', searchInput: 'MyPrivateSearchTerm987' }));
  assert.ok(!log.includes('MyPrivateSearchTerm987'),
    `the user's query leaked into the logs: ${log}`);
});

test('the Groq request asks for low reasoning and enough token headroom', async () => {
  // The replacements for the retired llama models are reasoning models: every
  // emitted token, reasoning included, counts against max_tokens. Without an
  // explicit low effort and headroom the answer is truncated mid-JSON, which
  // surfaces as an empty content field rather than as a timeout.
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  let sent = null;
  globalThis.fetch = async (url, init) => {
    if (url === GROQ_URL) {
      sent = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '[{"title":"Fallback Title"}]' } }] }),
      };
    }
    return anilistOk()(url);
  };

  await captureLog(() => invoke({ mode: 'search', searchInput: 'Reasoning Params Probe' }));

  assert.ok(sent, 'the Groq request was never sent');
  assert.equal(sent.reasoning_effort, 'low',
    'the default effort can spend the entire budget on reasoning');
  assert.equal(sent.include_reasoning, false,
    'the reasoning trace is never read, so it should not be transferred');

  // Generous enough for reasoning plus a JSON array of full recommendations.
  const estimate = 2000; // reasoning + 10 records with synopses
  assert.ok(sent.max_tokens >= estimate,
    `max_tokens is ${sent.max_tokens}, which leaves no room for reasoning ` +
    'before the JSON answer is cut off');
});

test('a truncated reasoning answer is reported as truncation', async () => {
  // finish_reason "length" with no content is a budget problem, not a refusal,
  // and the two need different fixes.
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '', reasoning: 'thinking...' }, finish_reason: 'length' }],
          usage: { completion_tokens: 3000 },
        }),
      };
    }
    return anilistOk()(url);
  };

  const log = await captureLog(() => invoke({ mode: 'search', searchInput: 'Truncated Probe' }));
  assert.match(log, /reasoning consumed the whole token budget/);
  assert.match(log, /"completionTokens":3000/,
    'the token usage is what makes this diagnosable');
});

test('a hallucinating AI stage falls back instead of returning an empty page', async () => {
  // The failure mode that only appears once the AI stage actually works.
  //
  // Groq proposes a title AniList has never heard of, verification rejects it,
  // and the response is empty. Meanwhile the deterministic query could have
  // answered the same request in 200ms. When that query ran only *after* the
  // Groq call, the 7s budget was already gone, so a live AI stage made the app
  // strictly worse than a dead one and queries AniList can serve came back
  // empty.
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';

  const hallucination = 'Totally Invented Title 9000';
  const realMedia = [{
    title: { english: 'Real Manga', romaji: 'Real Manga', native: 'リアル' },
    description: 'A real story.',
    coverImage: { large: null, medium: null },
    averageScore: 80,
    status: 'FINISHED',
    genres: ['Action', 'Sports'],
    siteUrl: null,
    format: 'MANGA',
    countryOfOrigin: 'JP',
    externalLinks: [],
  }];

  globalThis.fetch = async (url, init) => {
    if (url === GROQ_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify([{ title: hallucination, genre: ['Action', 'Sports'] }]),
            },
          }],
        }),
      };
    }

    // The verification lookup for the invented title finds nothing; every
    // other query gets the real result set.
    const body = String(init?.body || '');
    const media = body.includes(hallucination) ? [] : realMedia;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { Page: { media } } }),
    };
  };

  const res = await captureLog(() =>
    invoke({ mode: 'discover', genres: ['Action', 'Sports'], formats: ['Manga'] }));
  const actual = createRes();
  await handler(
    { method: 'POST', body: { mode: 'discover', genres: ['Action', 'Sports'], formats: ['Manga'] }, headers: {}, socket: {} },
    actual
  );

  assert.equal(actual.statusCode, 200);
  assert.ok(
    actual.body.recommendations.length > 0,
    'the AI stage invented a title, verification rejected it, and the request ' +
    'returned an empty page instead of the AniList results it already had'
  );
  assert.ok(
    !JSON.stringify(actual.body).includes(hallucination),
    'an unverified title reached the client'
  );
  assert.ok(res.length >= 0);
});

test('pages do not share a cached AI recommendation', async () => {
  // The AI recommendation cache was keyed on everything except `page`, so two
  // requests differing only by page shared one entry. The client grows `exclude`
  // on every "Load More", which made the keys differ by accident and hid this —
  // until page 1 returns nothing, `exclude` stays empty and page 2 is handed
  // page 1's candidates, which is the repeat-forever bug pagination fixes.
  process.env.GROQ_API_KEY = 'gsk_test-key-for-tests';

  let groqCall = 0;
  globalThis.fetch = async (url, init) => {
    if (url === GROQ_URL) {
      groqCall += 1;
      const title = groqCall === 1 ? 'First Page Only' : 'Second Page Only';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify([{ title }]) } }],
        }),
      };
    }
    const body = String(init?.body || '');
    const wanted = body.includes('Second Page Only') ? 'Second Page Only' : 'First Page Only';
    const media = body.includes(wanted) ? [{
      title: { english: wanted, romaji: wanted, native: wanted },
      description: 'A story.',
      coverImage: { large: null, medium: null },
      averageScore: 80,
      status: 'FINISHED',
      genres: ['Action'],
      siteUrl: null,
      format: 'MANGA',
      countryOfOrigin: 'JP',
      externalLinks: [],
    }] : [];
    return { ok: true, status: 200, json: async () => ({ data: { Page: { media } } }) };
  };

  const first = createRes();
  await handler(
    { method: 'POST', body: { mode: 'discover', genres: ['Action'], formats: ['Manga'], page: 1 }, headers: {}, socket: {} },
    first
  );
  const second = createRes();
  await handler(
    { method: 'POST', body: { mode: 'discover', genres: ['Action'], formats: ['Manga'], page: 2 }, headers: {}, socket: {} },
    second
  );

  assert.deepEqual(first.body.recommendations.map(r => r.title), ['First Page Only']);
  assert.deepEqual(second.body.recommendations.map(r => r.title), ['Second Page Only'],
    'page 2 was served page 1\'s cached AI candidates');
  assert.equal(groqCall, 2, 'the second page reused the first page\'s cache entry');
});

test('the fallback still returns results when the AI path is broken', async () => {
  // The whole point of the fallback: a dead Groq must degrade, not break.
  process.env.GROQ_API_KEY = 'gsk_revoked-for-test';
  globalThis.fetch = async url => {
    if (url === GROQ_URL) {
      return { ok: false, status: 401, json: async () => ({ error: { code: 'invalid_api_key' } }) };
    }
    return anilistOk()(url);
  };

  const res = await captureLog(() => invoke({ mode: 'search', searchInput: 'Degraded Probe' })) && null;
  const actual = createRes();
  await handler(
    { method: 'POST', body: { mode: 'search', searchInput: 'Degraded Probe' }, headers: {}, socket: {} },
    actual
  );

  assert.equal(actual.statusCode, 200, 'a dead AI path must not surface as an error');
  assert.ok(actual.body.recommendations.length > 0, 'the fallback produced nothing');
  assert.equal(actual.body.model, 'AniList Direct Engine');
  assert.ok(res === null);
});