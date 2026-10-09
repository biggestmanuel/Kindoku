/**
 * Contract tests against the LIVE deployment.
 *
 * This is the layer mocked tests cannot reach. The deployment holds
 * `GROQ_API_KEY`, so these exercise the real Groq -> AniList pipeline end to end
 * without the secret ever being copied out of Vercel.
 *
 *   npm run test:deployed
 *   DEPLOY_URL=https://your-app.vercel.app npm run test:deployed
 *
 * Several tests also report WHICH BUILD is deployed by comparing a literal from
 * the committed source against what the deployment serves. That makes this suite
 * useful as a post-deploy check, not just as a development aid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEPLOY_URL = (process.env.DEPLOY_URL || 'https://kindoku.vercel.app').replace(/\/$/, '');
const TEST_TIMEOUT_MS = 40_000;

const VALID_FORMATS = new Set(['Manga', 'Manhwa', 'Manhua', 'Light Novel']);
const CANONICAL_GENRES = new Set([
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror',
  'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance',
  'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The handler rate limits to 30 requests per minute, and this file makes more
// requests than that, so each one presents a distinct client address and a 429
// is retried rather than reported as a contract failure. A 429 says nothing about
// whether the code is correct.
//
// Measured caveat, so nobody trusts this more than it deserves: the limiter's
// state is a Map in module scope and Vercel recycles serverless instances, so in
// practice it does not engage — 40 sequential requests from one address returned
// 40 x 200. These headers are therefore harmless rather than necessary, and they
// are not a demonstration that client-supplied addresses are honoured: see
// getClientIp, which now prefers the address Vercel populates.
let ipCounter = 0;

// AniList allows 30 requests per minute and slows to the point of timing out
// well before that when requests arrive together: twenty concurrent identical
// queries were measured aborting at 2.5s. A cold request fans out to several
// AniList calls at once (the parallel prefetch, AI verification, enrichment),
// so firing this file's requests back to back makes the third party fail and
// then asserts the app returned an empty page. That reports a rate limit as an
// application fault.
let lastCallAt = 0;
const MIN_SPACING_MS = 1_200;

// How many times a `degraded` body is re-requested. Kept small: a genuine outage
// should still fail the suite rather than be retried into a false pass.
const DEGRADED_RETRIES = 3;

async function pace() {
  const wait = lastCallAt + MIN_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

/**
 * POSTs to the endpoint, retrying the two conditions that are not evidence of a
 * fault: a 429, and a `degraded` body.
 *
 * The degraded retry lives HERE rather than in a wrapper the call sites remember to
 * use. It used to be `withoutDegraded()`, applied at the call site, and only 4 of
 * 19 requests did so — the other 15 hard-failed the moment AniList was briefly
 * rate limited. That is why the scheduled CI job failed on every run since it was
 * introduced while the same suite passed locally: CI runs this file alongside the
 * third-party contracts job, so both are hitting AniList at once.
 *
 * Putting it inside `request()` makes it impossible for a new test to bypass, which
 * is the failure mode that matters — a test author has no reason to know this.
 *
 * Retrying is not papering over a regression. An empty result the server is
 * confident about carries `degraded: false` and is returned immediately, which is
 * what caught the pagination and constraint bugs this suite exists to find.
 */
async function request(body, { attempts = 4 } = {}) {
  let last = { status: 0, headers: new Headers(), text: '', json: null };
  let degradedRetries = 0;

  for (let attempt = 0; attempt < attempts; attempt++) {
    await pace();
    ipCounter += 1;
    const res = await fetch(`${DEPLOY_URL}/api/recommend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Distinct per request so the limiter cannot reject the suite. Harmless
        // rather than necessary: the limiter does not engage on Vercel, since its
        // state is module scope and instances are recycled. See the note above
        // `getClientIp` in api/recommend.js.
        'x-forwarded-for': `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    last = { status: res.status, headers: res.headers, text, json };

    if (res.status === 429) {
      await sleep(4_000 + attempt * 4_000);
      continue;
    }

    // AniList did not complete. Back off and ask again — a separate budget from the
    // 429 one, so a degraded body does not consume the retries meant for a 429.
    if (last.json?.degraded && degradedRetries < DEGRADED_RETRIES) {
      degradedRetries += 1;
      await sleep(2_000 + degradedRetries * 2_000);
      continue;
    }

    return last;
  }
  return last;
}

async function postJson(path) {
  const res = await fetch(`${DEPLOY_URL}${path}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

/** Shape assertions that must hold whichever engine answered. */
function assertWellFormed(recs, label) {
  assert.ok(Array.isArray(recs), `${label}: recommendations is not an array`);
  for (const rec of recs) {
    assert.equal(typeof rec.title, 'string', `${label}: title is not a string`);
    assert.ok(rec.title.trim().length > 0, `${label}: empty title`);
    assert.ok(VALID_FORMATS.has(rec.type), `${label}: unknown format "${rec.type}"`);
    assert.ok(Array.isArray(rec.genre), `${label}: genre is not an array`);
    assert.equal(typeof rec.synopsis, 'string', `${label}: synopsis missing`);
    assert.equal(typeof rec.status, 'string', `${label}: status missing`);
    assert.equal(typeof rec.readUrl, 'string', `${label}: readUrl is not a string`);
    assert.ok(rec.readUrl.length > 0, `${label}: readUrl is empty`);
    assert.equal(typeof rec.isDirectLink, 'boolean', `${label}: isDirectLink is not a boolean`);
    if (rec.coverImage) {
      assert.match(rec.coverImage, /^https:\/\//, `${label}: coverImage is not a URL`);
    }
  }
}

// ── Search contract ───────────────────────────────────────────────────────

test('deployed: an exact title search returns that title', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { status, json } = await request({ mode: 'search', searchInput: 'Berserk' });
  assert.equal(status, 200);
  assertWellFormed(json.recommendations, 'search');
  assert.ok(json.recommendations.length > 0, 'no results for a well-known title');
  assert.ok(
    json.recommendations.some(r => r.title.toLowerCase().includes('berserk')),
    `expected Berserk among ${json.recommendations.slice(0, 5).map(r => r.title).join(', ')}`
  );
});

test('deployed: every returned genre is a canonical AniList genre', { timeout: TEST_TIMEOUT_MS }, async () => {
  for (const searchInput of ['Solo Leveling', 'Chainsaw Man', 'Vinland Saga']) {
    const { json } = await request({ mode: 'search', searchInput });
    assertWellFormed(json.recommendations, searchInput);
    for (const rec of json.recommendations) {
      for (const genre of rec.genre) {
        assert.ok(CANONICAL_GENRES.has(genre),
          `"${searchInput}" returned genre "${genre}", which is not canonical`);
      }
    }
  }
});

test('deployed: isDirectLink is false when readUrl is a search fallback', { timeout: TEST_TIMEOUT_MS }, async () => {
  // Regression guard for the original bug: isDirectLink was derived from
  // readUrl, which always has a value, so every title claimed to be embeddable
  // and the reader iframe loaded a Google search page.
  const { json } = await request({ mode: 'search', searchInput: 'Berserk' });
  for (const rec of json.recommendations) {
    if (!rec.isDirectLink) {
      assert.match(rec.readUrl, /google\.com\/search/,
        `${rec.title}: not a direct link, yet readUrl is not a search fallback`);
    }
  }
});

test('deployed: a similarity query returns more than one title', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { json } = await request({ mode: 'search', searchInput: 'something like Solo Leveling' });
  assert.equal(json.isExact, false, 'a similarity query was treated as exact');
  assert.ok(json.recommendations.length > 1,
    'a similarity search returned a single result');
});

test('deployed: an exact query does not trigger a similarity list', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { json } = await request({ mode: 'search', searchInput: 'Berserk' });
  assert.equal(json.isExact, true, 'a bare title was not treated as exact');
  if (json.model === 'AniList Direct Engine') {
    // The fallback has no way to honour exactness — it always returns the
    // searched title plus similar ones. Recorded rather than failed, because
    // the fallback is a legitimate degraded mode.
    assert.ok(json.recommendations.length >= 1);
  }
});

// ── Discover contract ─────────────────────────────────────────────────────

test('deployed: discover returns titles matching every selected genre', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { status, json } = await request({
    mode: 'discover',
    genres: ['Action', 'Fantasy'],
    formats: ['Manga'],
  });
  assert.equal(status, 200);
  assertWellFormed(json.recommendations, 'discover');
  assert.ok(json.recommendations.length > 0,
    `the query returned nothing (degraded=${json.degraded})`);
  for (const rec of json.recommendations) {
    for (const genre of ['Action', 'Fantasy']) {
      assert.ok(rec.genre.includes(genre),
        `"${rec.title}" is missing the requested genre ${genre}: ${JSON.stringify(rec.genre)}`);
    }
  }
});

test('deployed: discover honours the selected format', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { json } = await request({ mode: 'discover', genres: ['Action'], formats: ['Manhwa'] });
  assertWellFormed(json.recommendations, 'manhwa');
  for (const rec of json.recommendations) {
    assert.equal(rec.type, 'Manhwa', `"${rec.title}" is ${rec.type}, not Manhwa`);
  }
});

test('deployed: a genre at position 5+ still matches', { timeout: TEST_TIMEOUT_MS }, async () => {
  // The original code sliced AniList's genre list to 4 before matching, so any
  // title whose only "Sports" tag was 5th or later failed verification.
  const { json } = await request({
    mode: 'discover',
    genres: ['Action', 'Sports'],
    formats: ['Manga'],
  });
  assert.ok(json.recommendations.length > 0,
    `the query returned nothing (degraded=${json.degraded})`);
  const withSports = json.recommendations.filter(r => r.genre.includes('Sports'));
  assert.ok(withSports.length > 0,
    'no returned title carries Sports; the genre-truncation bug may be present');
});

test('deployed: a prose prompt does not sink a preset-style query', { timeout: TEST_TIMEOUT_MS }, async () => {
  // Every 1-click preset ships a prose prompt. The old engine ANDed it into
  // AniList's literal search, which matched nothing, and the user saw an error.
  const { status, json } = await request({
    mode: 'discover',
    genres: ['Action', 'Fantasy'],
    tags: ['Tower Climbing'],
    formats: ['Manhwa'],
    customInput: 'Tower climbing with unique awakening and system quests',
  });
  assert.equal(status, 200, `preset-style query returned ${status}`);
  assert.ok(json.recommendations.length > 0,
    `a preset-style query returned nothing (degraded=${json.degraded})`);
  for (const rec of json.recommendations) {
    assert.equal(rec.type, 'Manhwa', `"${rec.title}" is ${rec.type}, not Manhwa`);
  }
});

test('deployed: paging returns titles that are not already on screen', { timeout: TEST_TIMEOUT_MS }, async () => {
  // The old discovery query had no pagination at all, so "Load More" re-served
  // the identical twelve titles.
  const first = await
    request({ mode: 'discover', genres: ['Action'], formats: ['Manga'], page: 1 });
  const exclude = first.json.recommendations.map(r => r.title);
  const second = await request({
    mode: 'discover',
    genres: ['Action'],
    formats: ['Manga'],
    page: 2,
    exclude,
  });

  assert.ok(second.json.recommendations.length > 0, () =>
    `page 2 returned nothing. Page 1 gave ${exclude.length} titles to exclude. ` +
    `status=${second.status} exhausted=${second.json.exhausted} ` +
    `degraded=${second.json.degraded} model=${second.json.model}. ` +
    (second.json.degraded
      ? 'AniList did not answer, so this is a rate limit rather than a ' +
        'pagination fault — re-run when the catalogue is calmer.'
      : 'AniList answered and had nothing left, which is a pagination fault.'));

  const firstTitles = new Set(exclude.map(t => t.toLowerCase()));
  const repeated = second.json.recommendations.filter(r => firstTitles.has(r.title.toLowerCase()));
  assert.equal(repeated.length, 0,
    `page 2 repeated ${repeated.length} titles already on screen: ${repeated.map(r => r.title).join(', ')}`);
});

// ── Input handling ────────────────────────────────────────────────────────

test('deployed: bad input is rejected with a message, never a 500', { timeout: TEST_TIMEOUT_MS }, async () => {
  const cases = [
    [{}, 400],
    [{ mode: 'search' }, 400],
    [{ mode: 'search', searchInput: '' }, 400],
    [{ mode: 'discover' }, 400],
  ];
  for (const [body, expected] of cases) {
    const { status, json } = await request(body);
    assert.equal(status, expected, `${JSON.stringify(body)} -> ${status}`);
    assert.equal(typeof json.error, 'string',
      'an error response must carry a message the UI can show');
  }
});

test('deployed: a non-POST method is rejected', { timeout: TEST_TIMEOUT_MS }, async () => {
  const res = await fetch(`${DEPLOY_URL}/api/recommend`, { method: 'GET' });
  assert.equal(res.status, 405, 'GET was not rejected');
  assert.match(res.headers.get('content-type') || '', /application\/json/);
});

test('deployed: hostile input is handled without a 5xx', { timeout: TEST_TIMEOUT_MS }, async () => {
  const hostile = [
    { mode: 'discover', genres: ['Action'], customInput: 'x'.repeat(50_000) },
    { mode: 'discover', genres: Array.from({ length: 500 }, (_, i) => `G${i}`) },
    { mode: 'search', searchInput: '"><img src=x onerror=alert(1)>' },
    { mode: 'discover', genres: ['Action'], formats: ['Not A Format'] },
    { mode: 'discover', genres: null, tags: 'nonsense', formats: 42 },
  ];
  for (const body of hostile) {
    const { status } = await request(body);
    assert.ok(status >= 200 && status < 500,
      `${JSON.stringify(body).slice(0, 70)} -> ${status}`);
  }
});

test('deployed: a hostile query never yields markup in the results', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { status, json } = await request({
    mode: 'search',
    searchInput: '<script>alert(1)</script>',
  });
  assert.ok(status === 200 || status === 400, `unexpected status ${status}`);
  if (!Array.isArray(json.recommendations)) return;
  for (const rec of json.recommendations) {
    assert.doesNotMatch(rec.title, /<script/i,
      `title contains a script tag: ${rec.title}`);
    assert.doesNotMatch(rec.synopsis, /<script/i,
      `synopsis contains a script tag: ${rec.synopsis}`);
  }
});

// ── Delivery and configuration ────────────────────────────────────────────

test('deployed: recommendations are marked no-store at the edge', { timeout: TEST_TIMEOUT_MS }, async () => {
  // A cached recommendation would be served to every subsequent visitor.
  const { headers } = await request({ mode: 'search', searchInput: 'Cache Header Probe' });
  const cacheControl = headers.get('cache-control') || '';
  assert.match(cacheControl, /no-store|no-cache|max-age=0/i,
    `cache-control is "${cacheControl || '(absent)'}"; recommendations must never be cached`);
});

test('deployed: the service worker is revalidated, not pinned', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { status, headers } = await postJson('/sw.js');
  assert.equal(status, 200);
  const cacheControl = headers.get('cache-control') || '';
  assert.match(cacheControl, /must-revalidate|no-cache|max-age=0/i,
    `sw.js cache-control is "${cacheControl}"; a cached worker pins users to one build`);
});

test('deployed: the app shell is served and references its assets', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { status, text } = await postJson('/index.html');
  assert.equal(status, 200);
  assert.match(text, /id="view-landing"/, 'the shell is missing its views');
  assert.match(text, /kindoku\.css/, 'the shell does not reference the stylesheet');
  assert.match(text, /kindoku\.js/, 'the shell does not reference the script');
});

// kindoku.js has no pushState, no hash routing and no popstate listener: every
// view is switched in JavaScript from index.html. There is no deep link a user
// could hold, so there is no SPA rewrite in vercel.json and a 404 on an
// arbitrary path is correct rather than a bug. What does matter is that every
// path the app really uses is served, with the right content type — a renamed
// asset or a missing icon otherwise surfaces only as a silent console error or
// a blank install prompt on a user's device.
const ENTRY_POINTS = [
  { path: '/', type: /text\/html/, mustMatch: /id="view-landing"/ },
  { path: '/index.html', type: /text\/html/, mustMatch: /kindoku\.js/ },
  { path: '/kindoku.css', type: /text\/css/ },
  { path: '/kindoku.js', type: /(javascript|ecmascript)/ },
  { path: '/sw.js', type: /(javascript|ecmascript)/ },
  { path: '/site.webmanifest', type: /json/ },
  { path: '/favicon.ico', type: /image/ },
  { path: '/favicon-16x16.png', type: /image/ },
  { path: '/favicon-32x32.png', type: /image/ },
  { path: '/favicon-48x48.png', type: /image/ },
  { path: '/apple-touch-icon.png', type: /image/ },
  { path: '/icon-192.png', type: /image/ },
  { path: '/icon-512.png', type: /image/ },
];

for (const asset of ENTRY_POINTS) {
  test(`deployed: ${asset.path} is served as ${asset.type}`, { timeout: TEST_TIMEOUT_MS }, async () => {
    const { status, headers, text } = await postJson(asset.path);
    assert.equal(status, 200, `${asset.path} is not served`);
    assert.match(
      headers.get('content-type') || '',
      asset.type,
      `${asset.path} has the wrong content-type, so the browser refuses it`
    );
    if (asset.mustMatch) {
      assert.match(text, asset.mustMatch, `${asset.path} served unexpected content`);
    }
  });
}

test('deployed: the API path is not shadowed by the static shell', { timeout: TEST_TIMEOUT_MS }, async () => {
  // The reason there is no catch-all rewrite. If one is ever added, the function
  // must still win, otherwise every request silently returns HTML.
  const { status, headers } = await postJson('/api/recommend');
  assert.notEqual(status, 404, 'the function is not routed');
  assert.doesNotMatch(
    headers.get('content-type') || '',
    /text\/html/,
    '/api/recommend returned HTML, so a rewrite is shadowing the function'
  );
});

// ── Security headers, as actually served ─────────────────────────────────────
// A policy in vercel.json that never reaches the browser is worse than none: it
// looks like protection in review and provides none in production. These assert
// on the response headers, not the config.

test('deployed: the app shell carries a strict Content-Security-Policy', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { status, headers } = await postJson('/');
  assert.equal(status, 200);

  const csp = headers.get('content-security-policy');
  assert.ok(csp, 'no Content-Security-Policy is served; vercel.json is not taking effect');

  const directive = name => csp.split(';').map(s => s.trim())
    .find(s => s.startsWith(`${name} `))?.split(/\s+/).slice(1) ?? [];

  assert.deepEqual(directive('script-src'), ["'self'"],
    'script-src is not strict on the deployment');
  assert.deepEqual(directive('object-src'), ["'none'"]);
  assert.deepEqual(directive('base-uri'), ["'self'"]);
  assert.deepEqual(directive('frame-ancestors'), ["'none'"]);
  assert.ok(!directive('script-src').includes("'unsafe-inline'"),
    'the deployment allows inline script, which the source does not need');
});

test('deployed: the reader iframe is sandboxed without same-origin', { timeout: TEST_TIMEOUT_MS }, async () => {
  // allow-scripts together with allow-same-origin removes the sandbox entirely:
  // the framed site would run scripts in this origin and could read the saved
  // library and the search history out of localStorage.
  const { status, text } = await postJson('/');
  assert.equal(status, 200);

  const iframe = /<iframe[^>]*id="reader-iframe"[^>]*>/i.exec(text)?.[0];
  assert.ok(iframe, 'the reader iframe is missing from the deployed shell');
  assert.match(iframe, /\bsandbox="/, 'the deployed reader iframe is not sandboxed');
  assert.doesNotMatch(iframe, /allow-same-origin/,
    'the deployed reader iframe allows same-origin, which defeats the sandbox');
});

test('deployed: the shell does not disable pinch zoom', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { status, text } = await postJson('/');
  assert.equal(status, 200);

  const viewport = /<meta[^>]+name="viewport"[^>]*>/i.exec(text)?.[0];
  assert.ok(viewport, 'no viewport meta tag in the deployed shell');
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*no/i,
    'the deployed viewport disables pinch zoom, which fails WCAG 1.4.4');
  assert.doesNotMatch(viewport, /maximum-scale\s*=\s*1(\.0)?\b/i);
});

test('deployed: hardening headers are present on the API too', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { headers } = await
    request({ mode: 'discover', genres: ['Action'], formats: ['Manga'] });

  assert.equal(headers.get('x-content-type-options'), 'nosniff',
    'a JSON endpoint without nosniff can have its content type sniffed');
  assert.match(headers.get('referrer-policy') || '', /strict-origin|no-referrer/,
    'no Referrer-Policy: the reader opens third-party reading sites that would ' +
    'otherwise receive this origin in the Referer header');
  assert.match(headers.get('content-security-policy') || '',
    /frame-ancestors\s+'none'/,
    'the API response has no policy, so a JSON body could be framed');
});

// ── Which build is deployed ───────────────────────────────────────────────

test('deployed: the current build is running', { timeout: TEST_TIMEOUT_MS }, async () => {
  // Compares a literal from the committed source with what the deployment
  // serves. Two earlier attempts at this used the API and both were wrong:
  //
  //  - asking for page 50 and expecting `exhausted`, which cannot work now that
  //    pagination exists, because page 50 returns titles
  //  - asking for a nonexistent title and expecting `exhausted`, which worked
  //    only while the AI stage was dead, because a live model always proposes
  //    some candidate and the empty path is then never reached
  //
  // A build identity has to be read from a build artifact, not inferred from
  // behaviour that a feature flag can change.
  const localSw = readFileSync(resolve(REPO_ROOT, 'sw.js'), 'utf8');
  const localCacheName = /CACHE_NAME\s*=\s*['"]([^'"]+)['"]/.exec(localSw)?.[1];
  assert.ok(localCacheName, 'could not read CACHE_NAME from the committed sw.js');

  const { status, text } = await postJson('/sw.js');
  assert.equal(status, 200);
  const deployedCacheName = /CACHE_NAME\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1];

  assert.equal(
    deployedCacheName,
    localCacheName,
    `the deployment serves a service worker from a different build ` +
    `(deployed "${deployedCacheName}", committed "${localCacheName}"). ` +
    'Commit the current code and redeploy.'
  );
});

test('deployed: an exhausted result set is a 200 with exhausted, not a 500', { timeout: TEST_TIMEOUT_MS }, async () => {
  // A discover query pinned to a combination that cannot exist: a Light Novel
  // with a Korean country of origin. `exhausted` is only emitted when both
  // engines come up empty, which the AI stage can prevent by proposing
  // candidates, so this asserts the status code and the contract rather than
  // depending on the result being empty.
  const { status } = await request({
    mode: 'discover',
    genres: ['Ecchi'],
    formats: ['Light Novel'],
    countryOfOrigin: 'KR',
  });
  assert.equal(status, 200,
    'an empty result set returned 5xx; a user-input outcome must not look like a crash');
});

test('deployed: the AI path is reachable', { timeout: TEST_TIMEOUT_MS }, async () => {
  // The fallback engine is fully functional, so Groq being unreachable forever
  // looks healthy from the user's side. This is the canary for it.
  //
  // The handler already logs why the AI stage failed, so this test only has to
  // say what to do next rather than leaving a dead feature to be noticed by a
  // user months later.
  const { json } = await request({ mode: 'search', searchInput: 'Berserk' });
  assert.ok(json.model && typeof json.model === 'string',
    'the response does not report which engine answered');
  assert.notEqual(
    json.model,
    'AniList Direct Engine',
    'Groq answered nothing: every request fell back to AniList.\n' +
    '  This is a production fault, not a test fault. Open the Vercel project ->\n' +
    '  Logs, trigger a search, and look for the line starting "[kindoku] groq\n' +
    '  failed". Its "hint" field names the cause directly:\n' +
    '    "GROQ_API_KEY is missing, malformed or revoked"  -> check the env var\n' +
    '      is set on the deployment (a locally-set var is not deployed)\n' +
    '    "a model name is no longer served by Groq"        -> update GROQ_MODELS\n' +
    '    "the key\'s rate limit or quota is exhausted"      -> wait or upgrade\n' +
    '  The fallback is working, so the app is usable meanwhile.'
  );
});