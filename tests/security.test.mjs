/**
 * Security headers.
 *
 * A Content-Security-Policy is only as good as its accuracy. One that is too
 * strict breaks the app in ways that look like unrelated bugs — a blocked font
 * is a fallback typeface, a blocked image is an empty card, a blocked frame is a
 * reader that never loads. One that is too loose is decoration.
 *
 * So the policy is asserted against what the code actually does: every origin
 * the browser contacts, every inline style it emits, every frame it embeds. When
 * someone adds a feature that talks to a new host, this fails and names the
 * directive to widen, instead of the feature failing silently in production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(resolve(REPO_ROOT, ...p), 'utf8');

const vercel = JSON.parse(read('vercel.json'));
const indexHtml = read('index.html');
const clientJs = read('kindoku.js');
const css = read('kindoku.css');

const csp = vercel.headers
  .flatMap(rule => rule.headers)
  .find(h => h.key.toLowerCase() === 'content-security-policy')?.value;

assert.ok(csp, 'no Content-Security-Policy is configured');

// Values are normalised: quotes stripped and any scheme removed, so assertions
// compare bare tokens like `self` and `fonts.googleapis.com` rather than
// `'self'` and `https://fonts.googleapis.com`.
const directives = new Map(
  csp.split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values.map(v => v.replace(/^['"]|['"]$/g, '').replace(/^https?:\/\//, ''))];
    })
);

/** Every origin the browser can be asked to contact, gathered from the source. */
function originsIn(source) {
  return new Set([...source.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()));
}

const origins = {
  index: originsIn(indexHtml),
  client: originsIn(clientJs),
};

// Vercel validates vercel.json against a schema and fails the build on an
// unknown top-level key. `vercel.json` is plain JSON, not JSON5, so there is no
// comment syntax — the obvious way to document a header rule is a "//" key, and
// adding one silently stopped the deployment from building for 13 minutes before
// anything said so.
//
// https://vercel.com/docs/project-configuration
const VERCEL_SCHEMA_KEYS = new Set([
  '$schema', 'builds', 'functions', 'headers', 'redirects', 'rewrites',
  'cleanUrls', 'trailingSlash', 'git', 'crons', 'regions', 'images',
  'framework', 'installCommand', 'devCommand', 'buildCommand',
  'outputDirectory', 'ignoreCommand', 'public', 'overrides', 'env',
]);

test('vercel.json contains only keys Vercel accepts', () => {
  const unknown = Object.keys(vercel).filter(k => !VERCEL_SCHEMA_KEYS.has(k));
  assert.deepEqual(unknown, [],
    `vercel.json has top-level key(s) outside Vercel's schema: ${unknown.join(', ')}. ` +
    'Vercel fails the build on these, so nothing deploys. vercel.json is plain ' +
    'JSON with no comment syntax — document it in the README instead.');
});

test('the API path carries the security headers explicitly', () => {
  // `/(.*)` demonstrably does not reach a serverless function response: the
  // policy was absent from /api/recommend while present on the shell. So the
  // API is covered by its own rule rather than relying on the catch-all.
  const apiRule = vercel.headers.find(r => r.source.startsWith('/api/'));
  assert.ok(apiRule, 'no header rule covers /api/');

  const keys = apiRule.headers.map(h => h.key.toLowerCase());
  for (const required of [
    'content-security-policy',
    'x-content-type-options',
    'referrer-policy',
  ]) {
    assert.ok(keys.includes(required),
      `/api/ responses would be served without ${required}`);
  }

  // A stricter policy than the shell's is fine; a *looser* one is not.
  const apiCsp = apiRule.headers
    .find(h => h.key.toLowerCase() === 'content-security-policy').value;
  assert.match(apiCsp, /script-src 'self'/);
  assert.doesNotMatch(apiCsp, /unsafe-inline|unsafe-eval/,
    'the API response policy allows inline script, which JSON never needs');
});

test('every header rule uses a header key Vercel recognises', () => {
  const allowed = new Set([
    'cache-control', 'content-security-policy', 'strict-transport-security',
    'x-content-type-options', 'x-frame-options', 'referrer-policy',
    'permissions-policy', 'cross-origin-opener-policy',
    'cross-origin-embedder-policy', 'cross-origin-resource-policy',
    'service-worker-allowed', 'x-robots-tag', 'etag', 'link', 'vary',
    'content-language', 'x-vercel-cache', 'age',
  ]);

  for (const rule of vercel.headers) {
    for (const header of rule.headers) {
      assert.ok(allowed.has(header.key.toLowerCase()),
        `the header "${header.key}" on "${rule.source}" is not a recognised ` +
        'Vercel header and will be ignored');
    }
  }
});

test('a policy is configured, and it applies to every path', () => {
  const global = vercel.headers.find(r => r.source === '/(.*)');
  assert.ok(global,
    'no catch-all header rule, so the policy is absent from most responses');
  const keys = global.headers.map(h => h.key.toLowerCase());
  for (const required of [
    'content-security-policy',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
    'strict-transport-security',
  ]) {
    assert.ok(keys.includes(required), `${required} is not set on every response`);
  }
});

test('script-src does not allow inline or eval', () => {
  // The directive that carries the weight. This codebase builds HTML from
  // strings, so it is exactly the case CSP exists for.
  const scriptSrc = directives.get('script-src') || [];
  assert.deepEqual(scriptSrc, ['self'],
    `script-src is "${scriptSrc.join(' ')}". Inline script or eval must not be ` +
    'allowed: this app assembles markup with innerHTML throughout.');
});

test('the app genuinely has no inline script for the strict policy to break', () => {
  // If someone adds an inline <script> or an eval() later, the policy above
  // will silently break the feature at runtime. Fail here instead, where the
  // message can explain why.
  assert.doesNotMatch(indexHtml, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i,
    'index.html contains an inline <script>; script-src \'self\' will block it');
  for (const [name, source] of [['kindoku.js', clientJs], ['sw.js', read('sw.js')]]) {
    assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/,
      `${name} uses eval or new Function, which script-src 'self' blocks`);
  }
});

test('style-src is strict: there are no inline style attributes left', () => {
  // The last permissive directive in the policy. Every style="" attribute in the
  // markup and in the generated card HTML was moved to a class so that
  // 'unsafe-inline' could be dropped — which is what lets a style-based
  // injection do nothing.
  assert.ok(!(directives.get('style-src') || []).includes('unsafe-inline'),
    "style-src still allows 'unsafe-inline'");

  for (const [name, source] of [['index.html', indexHtml], ['kindoku.js', clientJs]]) {
    const inline = [...source.matchAll(/\sstyle="[^"]*"/g)];
    assert.deepEqual(inline.length, 0,
      `${name} has ${inline.length} inline style attribute(s): ` +
      `${inline.map(m => m[0].trim()).join(', ')}`);
  }
});

test('the replacement classes exist and are referenced', () => {
  // A class in the stylesheet that nothing uses, or a class in the markup that
  // the stylesheet never defines, both mean a silently unstyled element.
  for (const name of [
    'card-cover-placeholder-tall',
    'card-genres-spaced',
    'toast-icon',
  ]) {
    assert.ok(css.includes(`.${name}`), `${name} is used but never defined in the CSS`);
    assert.ok(clientJs.includes(name) || indexHtml.includes(name),
      `${name} is defined in the CSS but never used`);
  }

  // Every theme swatch colour must still resolve, or the picker shows five grey
  // dots. Keyed off data-theme, so a rename of either side breaks it silently.
  for (const [theme, colour] of [
    ['gold', '#e8b84b'],
    ['crimson', '#e74c3c'],
    ['jade', '#1abc9c'],
    ['amethyst', '#bb86fc'],
    ['azure', '#64d2ff'],
  ]) {
    assert.match(css, new RegExp(`data-theme="${theme}"\\s*\\]\\s*\\.opt-dot\\s*\\{[^}]*${colour}`),
      `the ${theme} swatch colour ${colour} is missing from the stylesheet`);
    assert.ok(indexHtml.includes(`data-theme="${theme}"`),
      `no swatch button declares data-theme="${theme}"`);
  }

  // The showcase covers carry hardcoded AniList URLs that used to be inline.
  const covers = [...css.matchAll(/\.showcase-([a-z]+) \.showcase-cover \{[^}]*anilistcdn/g)];
  assert.equal(covers.length, 6,
    `expected six showcase cover rules in the CSS, found ${covers.length}`);
  const cards = [...indexHtml.matchAll(/class="showcase-card showcase-([a-z]+)"/g)].map(m => m[1]);
  assert.equal(cards.length, 6, `expected six showcase cards, found ${cards.length}`);
  for (const card of cards) {
    assert.ok(css.includes(`.showcase-${card} .showcase-cover {`),
      `showcase-${card} has no background rule, so its cover renders empty`);
  }
});

test('the elements the script reveals are hidden by CSS, not by an inline style', () => {
  // The user-agent [hidden] rule loses to any author rule, so `.install-btn
  // { display: flex }` would leave the install button permanently visible. These
  // id-scoped rules are what prevent that, and they must still lose to an inline
  // display value or the script could not reveal anything.
  const revealed = [
    'install-btn', 'search-clear-btn', 'recent-searches-box', 'error-msg',
    'results-content', 'library-file-input', 'library-empty', 'library-no-matches',
  ];

  for (const id of revealed) {
    assert.ok(indexHtml.includes(`id="${id}"`),
      `#${id} is missing from the markup`);
    assert.match(indexHtml, new RegExp(`id="${id}"[^>]*hidden`),
      `#${id} does not start hidden, so it flashes before the script runs`);
    assert.match(css, new RegExp(`#${id}\\[hidden\\]`),
      `#${id}[hidden] has no CSS rule; an author display rule would beat the ` +
      'user-agent [hidden] rule and leave it permanently visible');
  }
});

test('object-src and base-uri are closed', () => {
  assert.deepEqual(directives.get('object-src'), ['none'],
    'object-src must be none; plugins are never used');
  assert.deepEqual(directives.get('base-uri'), ['self'],
    'base-uri must be pinned, or an injected <base> redirects every asset');
  assert.deepEqual(directives.get('form-action'), ['self'],
    'form-action must be pinned, or an injected form posts credentials offsite');
});

test('the app cannot be framed', () => {
  assert.deepEqual(directives.get('frame-ancestors'), ['none']);
  const xfo = vercel.headers
    .flatMap(r => r.headers)
    .find(h => h.key.toLowerCase() === 'x-frame-options')?.value;
  assert.ok(xfo && /^(DENY|SAMEORIGIN)$/i.test(xfo),
    'X-Frame-Options is missing or permissive; frame-ancestors is ignored by old browsers');
});

test('every third-party origin the app contacts is allowed explicitly', () => {
  // Anything the browser fetches cross-origin has to be named, or the feature
  // breaks in production and nowhere else.
  const required = {
    'style-src': ['fonts.googleapis.com'],
    'font-src': ['fonts.gstatic.com'],
    'img-src': ['anilist.co'],
  };

  for (const [directive, hosts] of Object.entries(required)) {
    const allowed = (directives.get(directive) || []).join(' ');
    for (const host of hosts) {
      assert.ok(allowed.includes(host),
        `${directive} does not allow ${host}; the browser will refuse those ` +
        'requests and the feature will fail only in production');
    }
  }
});

test('no origin in the source is silently unaccounted for', () => {
  // The reverse direction, which is the one that catches new work. Every origin
  // the code can reach must be classified here, and the policy must allow it
  // through the matching directive. Adding an integration therefore fails this
  // test with a directive to widen, rather than shipping a blocked request.
  const frameSrc = directives.get('frame-src') || [];
  const frameAllowsHttps = frameSrc.includes('https:');

  // Hosts used as top-level navigation from a link or window.open. CSP does not
  // govern navigation, so they need no directive.
  const navigationOnly = new Set(['translate.google.com', 'www.google.com']);

  const all = new Set([...origins.index, ...origins.client]);
  assert.ok(all.size > 0, 'no origins found; this test has stopped looking');

  for (const host of all) {
    if (navigationOnly.has(host)) continue;

    if (host.endsWith('anilist.co')) {
      assert.ok((directives.get('img-src') || []).some(a => a === 'anilist.co' || a === '*.anilist.co'),
        `img-src does not allow ${host}, so covers will not load`);
      continue;
    }
    if (host === 'fonts.googleapis.com') {
      assert.ok((directives.get('style-src') || []).includes('fonts.googleapis.com'),
        `style-src does not allow ${host}, so the webfonts request is blocked`);
      continue;
    }
    if (host === 'fonts.gstatic.com') {
      assert.ok((directives.get('font-src') || []).includes('fonts.gstatic.com'),
        `font-src does not allow ${host}, so the font files themselves are blocked`);
      continue;
    }

    // Everything else in the source is a reading site, which the reader frames.
    assert.ok(frameAllowsHttps,
      `${host} can be framed by the reader but frame-src does not permit https`);
    assert.ok(!navigationOnly.has(host),
      `${host} is unclassified: add it to the policy or to navigationOnly`);
  }
});

test('the reader can embed third-party reading sites', () => {
  // frame-src cannot enumerate these: AniList links a different site per title.
  const frameSrc = (directives.get('frame-src') || []).join(' ');
  assert.match(frameSrc, /https:/,
    'frame-src must permit https framing or the in-app reader never loads');
  assert.doesNotMatch(frameSrc, /\*|\bdata:/,
    'frame-src is unrestricted beyond https, which is more than the reader needs');
});

test('the viewport does not disable pinch zoom', () => {
  // `maximum-scale=1, user-scalable=no` stops people zooming, which fails WCAG
  // 1.4.4 (Resize Text) and is one of the most common mobile accessibility
  // faults there is. The meta tag is the only place it can be set, so it is
  // asserted rather than left to review.
  const viewport = /<meta[^>]+name="viewport"[^>]*>/i.exec(indexHtml)?.[0];
  assert.ok(viewport, 'no viewport meta tag');
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*no/i,
    'the viewport disables pinch zoom');
  assert.doesNotMatch(viewport, /maximum-scale\s*=\s*1(\.0)?\b/i,
    'the viewport caps zoom at 1x');
  assert.match(viewport, /width\s*=\s*device-width/i);
});

test('the reader iframe is sandboxed', () => {
  // The reader displays a different site's markup in a same-origin frame, which
  // is the single most dangerous thing this app does. A sandbox without
  // allow-same-origin keeps that page unable to reach our DOM or storage.
  const iframe = /<iframe[^>]*id="reader-iframe"[^>]*>/i.exec(indexHtml)?.[0]
    || /<iframe[^>]*>/i.exec(indexHtml)?.[0];
  assert.ok(iframe, 'no iframe in the shell');
  assert.match(iframe, /\bsandbox="/,
    'the reader iframe is not sandboxed; a malicious reading site gets same-origin access');
  assert.doesNotMatch(iframe, /allow-same-origin/,
    'the reader iframe allows same-origin, which defeats the sandbox');
});

test('the stylesheet has no inline javascript urls', () => {
  assert.doesNotMatch(css, /url\(\s*['"]?javascript:/i);
  assert.doesNotMatch(indexHtml, /javascript:/i,
    'index.html contains a javascript: url');
});