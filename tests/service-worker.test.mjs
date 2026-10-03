/**
 * Tests for the service worker's caching strategy.
 *
 * `sw.js` registers `install` / `activate` / `fetch` listeners on `self`, so a
 * stub `self` plus a minimal Cache Storage implementation is enough to drive it
 * end-to-end without a browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './harness.mjs';

const swSource = readFileSync(resolve(REPO_ROOT, 'sw.js'), 'utf8');

/**
 * In-memory Cache Storage.
 *
 * `initial` entries map a cache name to its `[url, response]` pairs. `available`
 * is the set of URLs the precache is allowed to "fetch"; anything else makes
 * `addAll` reject, exactly as the real API does when one asset 404s.
 */
function createCaches(initial = {}, available = null) {
  const stores = new Map(
    Object.entries(initial).map(([name, entries]) => [name, new Map(entries)])
  );

  const cacheApi = entries => ({
    async addAll(requests) {
      // Requests arrive as `Request` objects built from relative paths; the
      // real Cache resolves those against the worker's scope before fetching.
      const urls = requests.map(request =>
        new URL(typeof request === 'string' ? request : request.url, `${origin}/`).href
      );
      // Real Cache.addAll is atomic: one failure rejects the whole batch.
      const missing = available === null ? [] : urls.filter(url => !available.has(url));
      if (missing.length) {
        throw new TypeError(`Failed to fetch ${missing[0]}`);
      }
      for (const url of urls) entries.set(url, okResponse);
    },
    async put(request, response) {
      entries.set(typeof request === 'string' ? request : request.url, response);
    },
    async match(request) {
      const url = typeof request === 'string' ? request : request.url;
      return entries.get(url) ?? null;
    },
  });

  return {
    __stores: stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return cacheApi(stores.get(name));
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(request) {
      // Real Cache.match resolves a relative key against the worker's scope, so
      // './index.html' and the absolute document URL address the same entry.
      const url = typeof request === 'string' ? request : request.url;
      const absolute = new URL(url, `${origin}/`).href;
      for (const entries of stores.values()) {
        if (entries.has(url)) return entries.get(url);
        if (entries.has(absolute)) return entries.get(absolute);
      }
      return null;
    },
  };
}

/** Loads sw.js with stubbed globals and returns the captured listeners. */
function loadServiceWorker({ caches, fetchImpl, origin = 'https://kindoku.test' } = {}) {
  const listeners = new Map();
  const requestsMade = [];

  const self = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    skipWaiting() {
      self.__skippedWaiting = true;
    },
    clients: { claim: () => { self.__claimed = true; } },
    location: { origin },
    __skippedWaiting: false,
    __claimed: false,
  };

  const Request = class Request {
    constructor(input) {
      this.url = typeof input === 'string' ? input : input.url;
    }
  };

  const sandbox = {
    self,
    caches,
    fetch: fetchImpl ?? (async () => {
      throw new TypeError('network unavailable');
    }),
    Request,
    URL,
    console,
    Promise,
    Response: class Response {},
  };

  // Evaluate in a function scope so `self.addEventListener` above is the sink.
  new Function(
    'self', 'caches', 'fetch', 'Request', 'URL', 'console', 'Response',
    swSource
  )(self, caches, fetchImpl ?? sandbox.fetch, Request, URL, console, sandbox.Response);

  return { self, listeners, requestsMade };
}

/** Runs the fetch listener and returns the response it responded with. */
async function runFetch(listeners, request) {
  let respondWith;
  const event = {
    request,
    respondWith(promise) {
      respondWith = promise;
    },
    waitUntil(promise) {
      event._waitUntil = promise;
    },
    _waitUntil: null,
  };
  for (const handler of listeners.get('fetch') || []) handler(event);
  assert.ok(respondWith, 'the fetch handler must call respondWith for cacheable requests');
  const response = await respondWith;
  // Let any fire-and-forget cache writes settle.
  if (event._waitUntil) await event._waitUntil;
  return response;
}

/** True when the fetch handler called respondWith for this request. */
function wasIntercepted(listeners, request) {
  let responded = false;
  for (const handler of listeners.get('fetch') || []) {
    handler({
      request,
      respondWith() {
        responded = true;
      },
      waitUntil() {},
    });
  }
  return responded;
}

const origin = 'https://kindoku.test';

const okResponse = { ok: true, status: 200, clone: () => okResponse };

/** The precache list from sw.js, resolved against the worker scope. */
const PRECACHE_URLS = new Set(
  [...swSource.matchAll(/'(\.\/[^']*)'/g)]
    .map(match => match[1])
    .map(path => new URL(path, `${origin}/`).href)
);

function shellRequest(path = '/index.html') {
  return {
    url: `${origin}${path}`,
    method: 'GET',
    mode: 'navigate',
    headers: new Map(),
  };
}

function assetRequest(path) {
  return {
    url: `${origin}${path}`,
    method: 'GET',
    mode: 'no-cors',
    headers: new Map(),
  };
}

test('the install handler precaches the app shell', async () => {
  const caches = createCaches({ 'kindoku-cache-v3': [] }, PRECACHE_URLS);
  const { self, listeners } = loadServiceWorker({ caches });

  let installed;
  for (const handler of listeners.get('install') || []) {
    handler({ waitUntil: p => { installed = p; } });
  }
  await installed;

  assert.equal(self.__skippedWaiting, true, 'a new build activates immediately');
  const cached = caches.__stores.get('kindoku-cache-v3');
  assert.equal(cached.size, PRECACHE_URLS.size);
  for (const url of PRECACHE_URLS) {
    assert.ok(cached.has(url), `${url} was not precached`);
  }
});

test('a failing precache asset rejects the whole install', async () => {
  // Real `addAll` is atomic; a partially-populated shell must not activate.
  const incomplete = new Set([...PRECACHE_URLS].slice(0, 3));
  const caches = createCaches({ 'kindoku-cache-v3': [] }, incomplete);
  const { listeners } = loadServiceWorker({ caches });

  let installed;
  for (const handler of listeners.get('install') || []) {
    handler({ waitUntil: p => { installed = p; } });
  }
  await assert.rejects(installed, /Failed to fetch/);
});

test('activate deletes every cache except the current one', async () => {
  const caches = createCaches({
    'kindoku-cache-v1': [['/old', okResponse]],
    'kindoku-cache-v2': [['/older', okResponse]],
    'kindoku-cache-v3': [['/current', okResponse]],
  });
  const { self, listeners } = loadServiceWorker({ caches });

  let activated;
  for (const handler of listeners.get('activate') || []) {
    handler({ waitUntil: p => { activated = p; } });
  }
  await activated;

  assert.deepEqual([...caches.__stores.keys()], ['kindoku-cache-v3']);
  assert.equal(self.__claimed, true, 'open tabs are taken over immediately');
});

test('navigations are network-first so a deploy is picked up (regression)', () => {
  // Regression: cache-first served a stale index.html indefinitely. A returning
  // visitor could be pinned to an old build for as long as the cache entry lived.
  let fetchCalls = 0;
  const caches = createCaches({
    'kindoku-cache-v3': [[`${origin}/index.html`, { ok: true, status: 200, stale: true }]],
  });
  const { listeners } = loadServiceWorker({
    caches,
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, status: 200, fresh: true, clone: () => okResponse };
    },
  });

  return runFetch(listeners, shellRequest()).then(response => {
    assert.equal(fetchCalls, 1, 'the network is consulted first');
    assert.equal(response.fresh, true, 'the fresh document is what the browser gets');
  });
});

test('a cached document is still served when the network is down', async () => {
  const cachedShell = { ok: true, status: 200, fromCache: true };
  const caches = createCaches({
    'kindoku-cache-v3': [[`${origin}/index.html`, cachedShell]],
  });
  const { listeners } = loadServiceWorker({
    caches,
    fetchImpl: async () => {
      throw new TypeError('offline');
    },
  });

  const response = await runFetch(listeners, shellRequest());
  assert.equal(response.fromCache, true, 'the app still opens offline');
});

test('navigations fall back to the root precache entry too', async () => {
  const cachedRoot = { ok: true, status: 200, fromRoot: true };
  const caches = createCaches({ 'kindoku-cache-v3': [[`${origin}/`, cachedRoot]] });
  const { listeners } = loadServiceWorker({
    caches,
    fetchImpl: async () => {
      throw new TypeError('offline');
    },
  });

  const response = await runFetch(listeners, shellRequest('/some/deep/link'));
  assert.equal(response.fromRoot, true);
});

test('static assets are served from cache and refreshed in the background', async () => {
  const cachedCss = { ok: true, status: 200, fromCache: true };
  const caches = createCaches({ 'kindoku-cache-v3': [[`${origin}/kindoku.css`, cachedCss]] });
  let fetchCalls = 0;
  const { listeners } = loadServiceWorker({
    caches,
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, status: 200, fresh: true, clone: () => ({ ok: true, status: 200 }) };
    },
  });

  return runFetch(listeners, assetRequest('/kindoku.css')).then(response => {
    assert.equal(response.fromCache, true, 'cache wins for instant paint');
    assert.equal(fetchCalls, 1, 'but the entry is still revalidated');
  });
});

test('an uncached asset falls through to the network', async () => {
  const caches = createCaches({ 'kindoku-cache-v3': [] });
  const { listeners } = loadServiceWorker({
    caches,
    fetchImpl: async () => ({ ok: true, status: 200, fresh: true, clone: () => okResponse }),
  });

  const response = await runFetch(listeners, assetRequest('/kindoku.js'));
  assert.equal(response.fresh, true);
});

test('an offline uncached asset resolves to undefined rather than throwing', async () => {
  const caches = createCaches({ 'kindoku-cache-v3': [] });
  const { listeners } = loadServiceWorker({
    caches,
    fetchImpl: async () => {
      throw new TypeError('offline');
    },
  });

  const response = await runFetch(listeners, assetRequest('/never-seen.png'));
  assert.equal(response ?? null, null, 'no unhandled rejection escapes the worker');
});

test('API requests always go to the network and are never cached', async () => {
  const caches = createCaches({ 'kindoku-cache-v3': [] });
  let fetchCalls = 0;
  const { listeners } = loadServiceWorker({
    caches,
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, status: 200, recommendations: [], clone: () => ({}) };
    },
  });

  const response = await runFetch(listeners, {
    url: `${origin}/api/recommend`,
    method: 'POST',
    mode: 'cors',
    headers: new Map(),
  });

  assert.equal(fetchCalls, 1);
  assert.deepEqual(response.recommendations, []);
  assert.equal(caches.__stores.get('kindoku-cache-v3').size, 0, 'nothing was written to the cache');
});

test('a cached API response is never served', async () => {
  // Even if something poisoned the cache, recommendations must always be fresh.
  const caches = createCaches({
    'kindoku-cache-v3': [[`${origin}/api/recommend`, { ok: true, recommendations: ['stale'] }]],
  });
  let fetchCalls = 0;
  const { listeners } = loadServiceWorker({
    caches,
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, recommendations: ['fresh'] };
    },
  });

  const response = await runFetch(listeners, {
    url: `${origin}/api/recommend`,
    method: 'GET',
    mode: 'cors',
    headers: new Map(),
  });

  assert.equal(fetchCalls, 1);
  assert.deepEqual(response.recommendations, ['fresh']);
});

test('a non-GET request outside /api/ is left to the browser', async () => {
  const caches = createCaches({ 'kindoku-cache-v3': [] });
  const { listeners } = loadServiceWorker({ caches });

  const responded = wasIntercepted(listeners, {
    url: `${origin}/index.html`,
    method: 'POST',
    mode: 'navigate',
  });
  assert.equal(responded, false, 'the worker does not intercept mutations');
});

test('a non-GET API request is passed straight through, never cached', async () => {
  const caches = createCaches({ 'kindoku-cache-v3': [] });
  let fetchCalls = 0;
  const { listeners } = loadServiceWorker({
    caches,
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, status: 200 };
    },
  });

  const response = await runFetch(listeners, {
    url: `${origin}/api/recommend`,
    method: 'DELETE',
    mode: 'cors',
  });
  assert.equal(fetchCalls, 1, 'the request still reaches the network');
  assert.equal(response.status, 200);
  assert.equal(caches.__stores.get('kindoku-cache-v3').size, 0);
});

test('cross-origin requests are not intercepted or cached', async () => {
  const caches = createCaches({ 'kindoku-cache-v3': [] });
  const { listeners } = loadServiceWorker({ caches });

  const responded = wasIntercepted(listeners, {
    url: 'https://fonts.googleapis.com/css2?family=Cinzel',
    method: 'GET',
    mode: 'cors',
  });
  assert.equal(responded, false, "font requests are the browser/CDN's business");
  assert.equal(caches.__stores.get('kindoku-cache-v3').size, 0);
});

test('the cache version is bumped past the stale build', () => {
  // v2 was the original cache-first version that shipped stale shells.
  const version = swSource.match(/CACHE_NAME\s*=\s*'([^']+)'/)[1];
  assert.notEqual(version, 'kindoku-cache-v2');
  assert.match(version, /^kindoku-cache-v\d+$/);
});

test('precaching bypasses the HTTP cache so a deploy is not re-cached stale', () => {
  assert.ok(
    /new Request\(asset, \{ cache: ['"]reload['"] \}\)/.test(swSource),
    'precache entries must be fetched with cache: "reload"'
  );
});