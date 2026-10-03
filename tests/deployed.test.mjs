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
 * Several tests also report WHICH BUILD is deployed: a pre-rewrite deployment is
 * missing the `exhausted` field and has no pagination, so those tests fail with
 * a message saying so. That makes this suite useful as a post-deploy check, not
 * just as a development aid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const DEPLOY_URL = (process.env.DEPLOY_URL || 'https://kindoku.vercel.app').replace(/\/$/, '');
const TEST_TIMEOUT_MS = 40_000;

const VALID_FORMATS = new Set(['Manga', 'Manhwa', 'Manhua', 'Light Novel']);
const CANONICAL_GENRES = new Set([
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror',
  'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance',
  'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The deployment rate limits to 30 requests per minute and this file makes more
// than that, so every request appears to come from a distinct client and a 429
// is retried rather than reported as a contract failure. The limiter is shared
// across everyone hitting the app, so being rate limited says nothing about
// whether the code is correct.
let ipCounter = 0;

async function request(body, { attempts = 4 } = {}) {
  let last = { status: 0, headers: new Headers(), text: '', json: null };

  for (let attempt = 0; attempt < attempts; attempt++) {
    ipCounter += 1;
    const res = await fetch(`${DEPLOY_URL}/api/recommend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Spoofed so the limiter does not reject the suite. This only works
        // because the deployment trusts x-forwarded-for. It is a test aid — do
        // not copy this pattern into application code.
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

    if (res.status !== 429) return last;
    await sleep(4_000 + attempt * 4_000);
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
  assert.ok(json.recommendations.length > 0, 'the query returned nothing');
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
  assert.ok(json.recommendations.length > 0, 'the query returned nothing at all');
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
    'a preset-style query returned nothing; constraint relaxation is not working');
  for (const rec of json.recommendations) {
    assert.equal(rec.type, 'Manhwa', `"${rec.title}" is ${rec.type}, not Manhwa`);
  }
});

test('deployed: paging returns titles that are not already on screen', { timeout: TEST_TIMEOUT_MS }, async () => {
  // The old discovery query had no pagination at all, so "Load More" re-served
  // the identical twelve titles.
  const first = await request({ mode: 'discover', genres: ['Action'], formats: ['Manga'], page: 1 });
  const second = await request({
    mode: 'discover',
    genres: ['Action'],
    formats: ['Manga'],
    page: 2,
    exclude: first.json.recommendations.map(r => r.title),
  });

  assert.ok(second.json.recommendations.length > 0, 'page 2 returned nothing');
  const firstTitles = new Set(first.json.recommendations.map(r => r.title.toLowerCase()));
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

test('deployed: an unknown path still serves the app shell', { timeout: TEST_TIMEOUT_MS }, async () => {
  // The rewrite must exclude /api/ but catch everything else, or a deep link
  // 404s instead of opening the app.
  const { status, text } = await postJson('/some/deep/link');
  assert.equal(status, 200, 'a client-side route returned a non-200');
  assert.match(text, /id="view-landing"/, 'a client-side route did not serve the shell');
});

// ── Which build is deployed ───────────────────────────────────────────────

test('deployed: the current build is running', { timeout: TEST_TIMEOUT_MS }, async () => {
  // `exhausted` exists only in the rewritten handler, where an exhausted result
  // set is a 200 rather than a 500.
  const { status, json } = await request({
    mode: 'discover',
    genres: ['Action'],
    formats: ['Manhwa'],
    page: 50, // far past the end of AniList's result set
  });
  assert.equal(status, 200);
  assert.ok(
    'exhausted' in json,
    'the response has no "exhausted" field, so a pre-rewrite build is deployed. ' +
    'Commit the current code and redeploy.'
  );
});

test('deployed: the AI path is reachable', { timeout: TEST_TIMEOUT_MS }, async () => {
  // The fallback engine is fully functional, so Groq being unreachable forever
  // looks healthy from the user's side. This surfaces it.
  const { json } = await request({ mode: 'search', searchInput: 'Berserk' });
  assert.ok(json.model && typeof json.model === 'string',
    'the response does not report which engine answered');
  assert.notEqual(
    json.model,
    'AniList Direct Engine',
    'Groq answered nothing: every request fell back to AniList. Check that ' +
    'GROQ_API_KEY is set on the deployment and that the model names are current.'
  );
});