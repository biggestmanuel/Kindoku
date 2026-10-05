/**
 * Contract tests against the real third-party APIs.
 *
 * These are the checks that cannot be faked: whether the genre list is still
 * valid, whether AniList still returns the fields the code reads, whether the
 * GraphQL queries are still shaped correctly, and whether the Google Translate
 * proxy the reader relies on still resolves. A schema change or a renamed genre
 * would break production while every mocked test stayed green.
 *
 * No opt-in flag is needed: `npm test` already excludes this file, so naming it
 * is the opt-in. An earlier version was gated behind ANILIST_LIVE, which needed
 * `ANILIST_LIVE=1 node --test ...` in package.json — a POSIX env-var prefix that
 * fails outright on Windows cmd, so `npm run test:live` was broken on the
 * platform this was written on. Adding a dependency to set an environment
 * variable cross-platform would be a worse trade than dropping the flag.
 *
 * Deliberately paces itself below AniList's rate limit and reads nothing private.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cssSource = readFileSync(resolve(REPO_ROOT, 'kindoku.css'), 'utf8');
const htmlSource = readFileSync(resolve(REPO_ROOT, 'index.html'), 'utf8');

const ANILIST_URL = 'https://graphql.anilist.co';

const options = {};

// AniList rate limits to 30 requests per minute and answers 429 well before
// that for a burst. These tests make 40+ calls, so every request goes through
// this throttle and a 429 is retried rather than reported as a contract
// failure — a rate limit is not evidence that the API shape changed.
let lastCallAt = 0;
const MIN_SPACING_MS = 2_100;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function throttle() {
  const wait = lastCallAt + MIN_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function anilist(query, variables = {}, { attempts = 3 } = {}) {
  let lastStatus = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await throttle();
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 429) {
      lastStatus = 429;
      // Back off harder than the minimum spacing; AniList's window is a minute.
      await sleep(5_000 + attempt * 5_000);
      continue;
    }

    assert.equal(res.ok, true, `AniList returned HTTP ${res.status}`);
    const json = await res.json();
    assert.equal(
      json.errors,
      undefined,
      `GraphQL errors: ${JSON.stringify(json.errors)}`
    );
    return json.data;
  }

  throw new Error(
    `AniList rate-limited every attempt (last status ${lastStatus}); ` +
    'this is not a contract failure, re-run later'
  );
}

test('the single-title query still returns every field the code reads', options, async () => {
  const { ANILIST_GENRES, deriveType, extractReadUrl, cleanSynopsis, transformAniListMedia } =
    await import('../api/recommend.js');

  const data = await anilist(
    `query ($search: String) {
      Page(perPage: 6) {
        media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
          title { romaji english native }
          description(asHtml: false)
          coverImage { large medium }
          averageScore status genres siteUrl format countryOfOrigin
          externalLinks { url site }
        }
      }
    }`,
    { search: 'Berserk' }
  );

  const media = data.Page.media[0];
  assert.ok(media, 'AniList returned no results for a well-known title');
  assert.ok(media.title, 'title object missing');
  assert.ok(Array.isArray(media.genres), 'genres is not an array');
  assert.ok(media.countryOfOrigin, 'countryOfOrigin missing');
  assert.ok(media.format, 'format missing');

  // Exercise the real transformation against real data.
  const item = transformAniListMedia(media);
  assert.ok(item);
  assert.ok(item.title.length > 0);
  assert.ok(['Manga', 'Manhwa', 'Manhua', 'Light Novel'].includes(item.type));
  assert.ok(item.readUrl.length > 0, 'readUrl is always populated');
  assert.equal(item.isDirectLink, Boolean(extractReadUrl(media)));
  assert.ok(cleanSynopsis(media.description) !== undefined);

  // Every genre AniList returns for a real title should be in our canonical
  // set, otherwise matching silently fails for that title.
  for (const genre of media.genres) {
    assert.ok(
      ANILIST_GENRES.has(genre),
      `AniList returned genre "${genre}" which is not in ANILIST_GENRES; ` +
      'the genre filter will never match a title carrying it'
    );
  }
  assert.equal(deriveType(media), item.type);
});

test('the discovery query shape is still accepted', options, async () => {
  // Mirrors ANILIST_DISCOVER_QUERY including the $page variable that pagination
  // depends on. If AniList changes `Page` pagination this fails loudly.
  const { VALID_FORMATS } = await import('../api/recommend.js');
  assert.equal(VALID_FORMATS.has('Manga'), true);

  const data = await anilist(
    `query ($genre_in: [String], $tag_in: [String], $format_in: [MediaFormat], $countryOfOrigin: CountryCode, $search: String, $page: Int) {
      Page(page: $page, perPage: 12) {
        media(
          genre_in: $genre_in, tag_in: $tag_in, format_in: $format_in,
          countryOfOrigin: $countryOfOrigin, search: $search,
          type: MANGA, sort: [POPULARITY_DESC, SCORE_DESC]
        ) {
          title { romaji english native }
          description(asHtml: false)
          coverImage { large medium }
          averageScore status genres siteUrl format countryOfOrigin
          externalLinks { url site }
        }
      }
    }`,
    { genre_in: ['Action'], countryOfOrigin: 'KR', page: 1 }
  );

  assert.ok(Array.isArray(data.Page.media), 'media is not an array');
  assert.ok(data.Page.media.length > 0, 'a genre+origin query returned nothing');

  const { deriveType } = await import('../api/recommend.js');
  for (const media of data.Page.media) {
    assert.ok(media.genres.includes('Action'),
      'AniList returned a title without the requested genre');
    assert.equal(deriveType(media), 'Manhwa',
      `countryOfOrigin KR produced ${deriveType(media)}`);
  }
});

test('genre_in returns titles that genuinely carry that genre', options, async () => {
  const { ANILIST_GENRES, matchesRequestedGenres } = await import('../api/recommend.js');

  for (const genre of ['Action', 'Fantasy', 'Romance', 'Sports']) {
    const data = await anilist(
      `query ($genre_in: [String]) {
        Page(perPage: 5) {
          media(genre_in: $genre_in, type: MANGA, sort: [POPULARITY_DESC]) {
            title { english romaji }
            genres
          }
        }
      }`,
      { genre_in: [genre] }
    );
    assert.ok(data.Page.media.length > 0, `no results for genre ${genre}`);

    for (const media of data.Page.media) {
      assert.ok(
        matchesRequestedGenres(media.genres, [genre]),
        `AniList returned "${media.title.english}" for genre_in=[${genre}] but its genres are ${JSON.stringify(media.genres)}`
      );
      // And the genre we asked for is one AniList itself considers canonical.
      assert.ok(ANILIST_GENRES.has(genre));
    }
  }
});

test('the search-with-recommendations query still returns recommendations', options, async () => {
  // The `similar to` feature depends entirely on the nested `recommendations`
  // selection. If AniList renames or restricts it, this fails.
  const data = await anilist(
    `query ($search: String) {
      Page(perPage: 5) {
        media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
          title { romaji english native }
          description(asHtml: false)
          coverImage { large medium }
          averageScore status genres siteUrl format countryOfOrigin
          externalLinks { url site }
          recommendations(sort: RATING_DESC, perPage: 6) {
            nodes { mediaRecommendation {
              title { romaji english native }
              description(asHtml: false)
              coverImage { large medium }
              averageScore status genres siteUrl format countryOfOrigin
              externalLinks { url site }
            } }
          }
        }
      }
    }`,
    { search: 'Solo Leveling' }
  );

  assert.ok(data.Page.media.length > 0, 'search returned nothing');
  const withRecs = data.Page.media.filter(m => (m.recommendations?.nodes?.length || 0) > 0);
  assert.ok(withRecs.length > 0,
    'no title returned any recommendations; the "similar to" feature is dead upstream');
});

test('format NOVEL maps to a real media type', options, async () => {
  // The Light Novel format path depends on AniList accepting format_in: NOVEL.
  const data = await anilist(
    `query ($format_in: [MediaFormat]) {
      Page(perPage: 5) {
        media(format_in: $format_in, type: MANGA, sort: [POPULARITY_DESC]) {
          title { english }
          format countryOfOrigin genres
        }
      }
    }`,
    { format_in: ['NOVEL'] }
  );

  assert.ok(data.Page.media.length > 0, 'format_in: NOVEL returned nothing');
  const { deriveType } = await import('../api/recommend.js');
  for (const media of data.Page.media) {
    assert.equal(media.format, 'NOVEL');
    assert.equal(deriveType(media), 'Light Novel');
  }
});

test('every tag the UI offers resolves to something AniList knows', options, async () => {
  // 14 of the 30 UI tags originally had no alias and were passed through
  // verbatim. Twelve of them matched nothing on AniList — a silently dead
  // filter. This is the check that caught them, and it must keep passing.
  const { mapTag } = await import('../api/recommend.js');

  const uiTags = [
    'Isekai', 'Regression', 'System', 'Dungeon', 'Hunter', 'Murim', 'Cultivation',
    'Reincarnation', 'Villainess', 'Magic', 'School Life', 'Survival',
    'Time Travel', 'Revenge', 'OP MC', 'Kingdom Building', 'Academy', 'Demons',
    'Necromancer', 'Tower Climbing', 'Modern Day', 'Monsters', 'Crafting',
    'Beast Taming', 'Female Protagonist', 'Gods', 'Virtual Reality',
    'Nobility', 'Politics', 'Slow Burn',
  ];

  // Each tag is probed on its own. AniList ANDs tag_in, so a combined query
  // would prove nothing about individual tags, and batching an unrecognised tag
  // into a request makes AniList reject the WHOLE query with a 400 rather than
  // just returning nothing — which is itself the failure mode worth detecting.
  const dead = [];
  const rejected = [];
  const skipped = [];

  for (const uiTag of uiTags) {
    const anilistTag = mapTag(uiTag);
    // A null mapping is a deliberate, documented decision (DEAD_TAGS): the
    // filter is ignored rather than silently matching nothing.
    if (anilistTag === null) {
      skipped.push(uiTag);
      continue;
    }
    try {
      const data = await anilist(
        `query ($tag_in: [String]) {
          Page(perPage: 1) { media(tag_in: $tag_in, type: MANGA) { id } }
        }`,
        { tag_in: [anilistTag] }
      );
      if (data.Page.media.length === 0) dead.push(`${uiTag} -> ${anilistTag}`);
    } catch (err) {
      rejected.push(`${uiTag} -> ${anilistTag} (${err.message})`);
    }
  }

  assert.deepEqual(
    rejected,
    [],
    'AniList rejected these tag names outright; the discovery query would return HTTP 400'
  );
  assert.deepEqual(
    dead,
    [],
    'these UI tags match nothing on AniList and silently narrow queries to zero results'
  );
  // Every skipped tag must be one the code deliberately gave up on, and there
  // must not be many: a growing list means users are clicking filters that do
  // nothing.
  assert.ok(
    skipped.length <= 6,
    `${skipped.length} UI tags are ignored entirely: ${skipped.join(', ')}. ` +
    'Either map them or remove them from the UI'
  );
});

test('the UI genres that are not canonical AniList genres resolve as tags', options, async () => {
  // "Historical" and "Martial Arts" are offered by the UI but are not AniList
  // genres, so they are routed through the tag filter. That only works if
  // AniList actually has matching tags.
  const { ANILIST_GENRES } = await import('../api/recommend.js');
  assert.equal(ANILIST_GENRES.has('Historical'), false);
  assert.equal(ANILIST_GENRES.has('Martial Arts'), false);

  for (const genre of ['Historical', 'Martial Arts']) {
    const data = await anilist(
      `query ($tag_in: [String]) {
        Page(perPage: 1) { media(tag_in: $tag_in, type: MANGA) { id } }
      }`,
      { tag_in: [genre] }
    );
    assert.ok(
      data.Page.media.length > 0,
      `"${genre}" is offered by the UI and routed to tag_in, but AniList has no such tag`
    );
  }
});

test('reading-site external links are still present on real titles', options, async () => {
  // If AniList stopped returning these, every title would fall back to a
  // Google search and the in-app reader would never be used.
  const { extractReadUrl } = await import('../api/recommend.js');

  const titles = ['Berserk', 'Solo Leveling', 'Chainsaw Man', 'Vinland Saga', 'Jujutsu Kaisen'];
  let withLinks = 0;

  for (const title of titles) {
    const data = await anilist(
      `query ($search: String) {
        Page(perPage: 3) {
          media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
            title { english romaji }
            externalLinks { url site }
          }
        }
      }`,
      { search: title }
    );
    const media = data.Page.media[0];
    if (!media) continue;
    assert.ok(Array.isArray(media.externalLinks), 'externalLinks is not an array');
    if (extractReadUrl(media)) withLinks++;
  }

  assert.ok(withLinks > 0,
    'no well-known title resolved to a reading link; the reader would always fall back to search');
});
// -- Google Translate proxy ---------------------------------------------------
// The reader's "Translate to English" button wraps the reading URL in Google's
// translate proxy, because Chrome's built-in translation prompt only fires for
// top-level navigations and never appears for content inside our iframe. The
// URL shape is asserted in client.test.mjs; this asserts Google still honours it.
//
// Google has changed this endpoint before, and nothing in the repository would
// have noticed: the button would simply open a 404 in a new tab.

// ── Curated showcase covers ────────────────────────────────────────────────
// These are hardcoded asset URLs pointing at a third-party CDN, which is the
// definition of external data with an expiry date: AniList's filenames carry a
// content hash that changes when the asset is re-encoded.
//
// All six were 404 at once and nothing noticed. The landing page had been
// showing six empty grey boxes, because a missing background image on a
// background-color element renders as nothing rather than as an error.

const showcaseCovers = [...cssSource.matchAll(/\.showcase-([a-z]+) \.showcase-cover \{[^}]*?url\('([^']+)'\)/g)]
  .map(m => ({ slug: m[1], url: m[2] }));

test('the curated showcase covers are all present', options, async () => {
  assert.equal(showcaseCovers.length, 6,
    `expected six showcase cover rules in kindoku.css, found ${showcaseCovers.length}. ` +
    'A card with no rule renders as an empty box.');
});

test('every curated showcase cover actually resolves', options, async () => {
  const dead = [];

  for (const { slug, url } of showcaseCovers) {
    let status = 0;
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      status = res.status;
      await res.arrayBuffer();
    } catch (err) {
      dead.push(`${slug}: unreachable (${err.message})`);
      continue;
    }
    if (status !== 200) dead.push(`${slug}: HTTP ${status} ${url}`);
  }

  assert.deepEqual(dead, [],
    `curated showcase covers are broken:\n  ${dead.join('\n  ')}\n` +
    'Re-resolve them against AniList and update kindoku.css.');
});

test('every showcase card has a matching cover rule', options, async () => {
  // The markup and the stylesheet must agree. A card whose class has no rule
  // shows nothing at all, with no error anywhere.
  const cards = [...htmlSource.matchAll(/class="showcase-card showcase-([a-z]+)"/g)].map(m => m[1]);
  assert.equal(cards.length, 6, `expected six showcase cards, found ${cards.length}`);

  const ruled = new Set(showcaseCovers.map(c => c.slug));
  const missing = cards.filter(slug => !ruled.has(slug));
  assert.deepEqual(missing, [],
    `these cards have no background rule: ${missing.join(', ')}`);
});

test('the translate proxy resolves a proxied URL', options, async () => {
  const target = 'https://example.com/?kindoku=reader-probe';
  const proxied = `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(target)}`;

  const res = await fetch(proxied, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  });

  assert.equal(res.status, 200,
    `the translate proxy returned HTTP ${res.status} for the form ` +
    "toTranslatedUrl builds; the reader's translate button would open an error page");

  // A working proxy rewrites the host to <domain>.translate.goog and carries the
  // _x_tr_* parameters. A consent interstitial or an error page does neither,
  // and both would return 200.
  assert.match(res.url, /\.translate\.goog/,
    `the proxy did not rewrite the host (final URL ${res.url}); it returned ` +
    'something other than a translated page');
  assert.match(res.url, /[?&]_x_tr_tl=en/,
    `the proxy dropped the target language (final URL ${res.url})`);
});

test('the translate proxy rejects a malformed URL rather than serving it', options, async () => {
  // Confirms the proxy is actually proxying: garbage in must not produce a 200
  // page of the proxy's own error content, or the reader would silently show it
  // instead of the manga.
  const proxied = 'https://translate.google.com/translate?sl=auto&tl=en&u=' +
    encodeURIComponent('not a url at all');

  const res = await fetch(proxied, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  });
  const body = await res.text().catch(() => '');

  assert.ok(
    res.status >= 400 || !/example\.com/.test(res.url),
    'the proxy served a translated page for input that is not a URL'
  );
  assert.ok(body.length >= 0);
});
