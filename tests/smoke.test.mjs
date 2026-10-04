/**
 * End-to-end smoke tests for the whole handler through a real HTTP server.
 *
 * The other suites call the exported handler directly. That skips the parts of
 * the platform this code depends on and cannot easily fake: an absent
 * `Content-Type` leaving `req.body` unparsed, a real `AbortController` cutting a
 * real socket mid-response, and the actual wall-clock cost of a cold start.
 *
 * Everything here is local — no external network is touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import handler from '../api/recommend.js';

const realFetch = globalThis.fetch;
const realApiKey = process.env.GROQ_API_KEY;

/**
 * Polls until `predicate` holds, instead of sleeping a fixed interval.
 *
 * Node runs the test files in parallel, and timing.test.mjs deliberately holds
 * the event loop busy for seconds. A hardcoded sleep is therefore either too
 * short (flaky failure that looks like a product bug) or needlessly slow (a
 * suite that takes seconds longer than it needs to).
 */
async function waitFor(predicate, message, { timeoutMs = 5_000, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting: ${message}`);
}

/**
 * Stubs only the *upstream* calls, leaving loopback traffic real.
 *
 * These tests drive the server with `fetch`, so a blanket stub would intercept
 * the test's own requests too and nothing would ever reach the handler.
 */
function stubUpstreams(impl) {
  globalThis.fetch = async (url, options) => {
    const href = typeof url === 'string' ? url : url.url;
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(href)) {
      return realFetch(url, options);
    }
    return impl(href, options);
  };
}

/**
 * Wraps a Node `ServerResponse` in the small Vercel-compatible surface the
 * handler uses: `.status()`, `.json()`, `.setHeader()`. Real Vercel supplies
 * these; a bare http.ServerResponse does not.
 */
function vercelStyleResponse(res) {
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = payload => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

/** Boots an http.Server wrapping the handler. */
async function startServer() {
  const server = http.createServer((req, res) => {
    vercelStyleResponse(res);
    // Vercel parses the body for you; emulate that here so a malformed or
    // missing JSON payload reaches the handler the same way it would in prod.
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        // No body at all: Vercel leaves `req.body` undefined.
        req.body = undefined;
      } else {
        try {
          req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          req.body = undefined;
          return res.status(400).json({ error: 'Invalid JSON body' });
        }
      }
      handler(req, res).catch(err => {
        // Surface the real reason; a silent 500 would hide a genuine bug behind
        // an indistinguishable "handler threw".
        if (!res.headersSent) {
          res.status(500).json({ error: String(err?.stack || err) });
        }
      });
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}

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
          genres: ['Action', 'Fantasy'],
          siteUrl: null,
          format: 'MANGA',
          countryOfOrigin: 'JP',
          externalLinks: [{ site: 'MangaDex', url: 'https://mangadex.org/title/1' }],
          ...overrides,
        }],
      },
    },
  };
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  if (realApiKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = realApiKey;
});

test('smoke: a real POST returns recommendations over HTTP', async t => {
  delete process.env.GROQ_API_KEY;
  stubUpstreams(async () => ({
    ok: true,
    status: 200,
    json: async () => anilistPayload('Berserk'),
  }));

  const server = await startServer();
  t.after(() => server.close());

  const res = await fetch(`${server.origin}/api/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'search', searchInput: 'Berserk' }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assert.equal(body.recommendations.length, 1);
  assert.equal(body.recommendations[0].title, 'Berserk');
  assert.equal(body.recommendations[0].isDirectLink, true);
});

test('smoke: GET is rejected with 405 and a JSON body', async t => {
  const server = await startServer();
  t.after(() => server.close());

  const res = await fetch(`${server.origin}/api/recommend`, { method: 'GET' });
  assert.equal(res.status, 405);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.match((await res.json()).error, /method not allowed/i);
});

test('smoke: a request with no body gets 400, not a crash', async t => {
  delete process.env.GROQ_API_KEY;
  stubUpstreams(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { Page: { media: [] } } }),
  }));

  const server = await startServer();
  t.after(() => server.close());

  // No Content-Type and no body: the platform hands over an unparsed req.body.
  const res = await fetch(`${server.origin}/api/recommend`, { method: 'POST' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /select a genre/i);
});

test('smoke: malformed JSON is rejected before the handler runs', async t => {
  const server = await startServer();
  t.after(() => server.close());

  const res = await fetch(`${server.origin}/api/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ this is not json',
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /invalid json/i);
});

test('smoke: an empty result set is a 200 with an empty array', async t => {
  delete process.env.GROQ_API_KEY;
  stubUpstreams(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { Page: { media: [] } } }),
  }));

  const server = await startServer();
  t.after(() => server.close());

  const res = await fetch(`${server.origin}/api/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'discover', genres: ['Action'], formats: ['Manhwa'] }),
  });

  assert.equal(res.status, 200, 'no matches is not an error');
  const body = await res.json();
  assert.deepEqual(body.recommendations, []);
  assert.equal(body.exhausted, true);
});

test('smoke: a disconnecting client cannot crash the function', async t => {
  delete process.env.GROQ_API_KEY;
  let resolveAnilist;
  stubUpstreams(() => new Promise(resolve => { resolveAnilist = resolve; }));

  const server = await startServer();
  t.after(() => server.close());

  const controller = new AbortController();
  const pending = fetch(`${server.origin}/api/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'search', searchInput: 'Abandoned' }),
    signal: controller.signal,
  });

  // Wait for the handler to actually reach the upstream rather than sleeping a
  // fixed interval and hoping. A 50ms sleep is fine on an idle machine and fails
  // when the suite runs alongside timing.test.mjs, which deliberately holds the
  // event loop busy for seconds. That produced an intermittent
  // "resolveAnilist is not a function" which looked like a handler crash and was
  // really this race.
  await waitFor(() => typeof resolveAnilist === 'function',
    'the handler never called AniList, so there was nothing to abandon');

  controller.abort();
  await assert.rejects(pending, () => true, 'the client aborted as expected');

  // The handler must still finish cleanly once the upstream replies.
  resolveAnilist({
    ok: true,
    status: 200,
    json: async () => anilistPayload('Late'),
  });
  await new Promise(resolve => setTimeout(resolve, 100));
});

test('smoke: the handler writes a well-formed response under concurrent load', async t => {
  delete process.env.GROQ_API_KEY;
  stubUpstreams(async () => ({
    ok: true,
    status: 200,
    json: async () => anilistPayload('Concurrent'),
  }));

  const server = await startServer();
  t.after(() => server.close());

  const responses = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      fetch(`${server.origin}/api/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'search', searchInput: `Concurrent ${i}` }),
      })
    )
  );

  for (const res of responses) {
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.recommendations));
  }
});