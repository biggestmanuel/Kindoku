/**
 * Secret scanning.
 *
 * A full-history audit found no real credential in this repository, but that was a
 * one-off. This makes it repeatable, so the next person who pastes a key into a
 * file finds out from CI instead of from a leaked-key alert.
 *
 * Scans the tracked working tree rather than all of history, for two reasons:
 * it has to run on every push, and a leak is almost always in the change being
 * made. The one-off audit covered every blob that has ever existed, deleted
 * files included.
 *
 * The four known matches are listed explicitly in ALLOWED rather than filtered by
 * a loose "looks like a test" heuristic. An allowlist is auditable; a regex that
 * decides what counts as fake will eventually suppress a real key — that is not
 * hypothetical, see the note on ALLOWED below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Credentials whose format is known, so a match is a match.
 *
 * Note the trailing `\b` is absent from every pattern. A greedy
 * `[A-Za-z0-9_-]{n,}` followed by `\b` backtracks catastrophically on strings
 * with many underscores — the first version of this file looped thousands of
 * times on `.env.example` alone. Dropping `\b` removes the backtracking and, far
 * more importantly, keeps these patterns matching the placeholder and fixture
 * values in ALLOWED. Narrowing the character class instead would have made them
 * match nothing here, which turns the allowlist into decoration and the scan
 * into theatre.
 */
const PATTERNS = [
  ['Groq', /\bgsk_[A-Za-z0-9_-]{16,}/g],
  ['OpenAI', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ['Anthropic', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['GitHub PAT', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['GitHub fine-grained PAT', /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['AWS access key', /\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/g],
  ['Google OAuth token', /\bya29\.[A-Za-z0-9_-]{20,}/g],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}/g],
  ['Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{16,}/g],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['Credentials in URL', /\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@/g],
  ['Database URL with password', /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|redis):\/\/[^\s/:@]*:[^\s/@]+@/g],
  ['Bearer literal', /\bBearer\s+[A-Za-z0-9._-]{24,}/g],
];

/**
 * The only credential-shaped strings allowed in the repository, with the reason.
 *
 * During the audit the scanner suppressed the sample AWS access key id published
 * in AWS's own documentation, because a blanket "ignore anything containing
 * 'example'" rule matched it. A leaked key can contain any ordinary English word,
 * so filtering on vocabulary is how scanners silently lose coverage. Anything
 * added here must be reviewed by a human and must be visibly fake.
 *
 * That sample key is deliberately not quoted here, and was not allowlisted
 * either. Quoting it would make this file flag itself, which is at least a
 * visible failure — but the fix is to not put a credential-shaped string in the
 * repository in the first place, not to teach the scanner about it.
 */
const ALLOWED = new Map([
  ['gsk_your_groq_api_key_here', '.env.example placeholder'],
  ['gsk_test-key-for-tests', 'diagnostics fixture for a valid key shape'],
  ['gsk_revoked-for-test', 'diagnostics fixture for a revoked key'],
  ['gsk_SHOULD_NEVER_APPEAR_IN_LOGS', 'canary proving the logger never emits the key'],
]);

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

test('no tracked file contains a credential', () => {
  const findings = [];

  for (const file of trackedFiles()) {
    // Vendored trees and binaries are not first-party source. The one-off audit
    // scanned them too; this runs on every push, so it stays fast.
    if (/^(node_modules|dist|build)\//.test(file)) continue;
    if (/\.(png|ico|jpg|jpeg|webp|gif|woff2?)$/i.test(file)) continue;

    const full = resolve(REPO_ROOT, file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, 'utf8');
    if (text.indexOf('\u0000') !== -1) continue; // binary

    // `lastIndex` must advance on an allowed match too. A bare `continue` leaves it
    // where it was, so exec returns the same match forever and the test hangs
    // instead of reporting. That is what the first version did, and it hung on
    // `.env.example` — the one file whose value is allowlisted, and therefore the
    // only one that ever reaches the `continue`.
    for (const [kind, re] of PATTERNS) {
      re.lastIndex = 0;
      let m;
      let guard = 0;
      while ((m = re.exec(text)) !== null) {
        if (guard++ > 10_000) {
          findings.push(`${file}  ${kind}: the pattern failed to advance past a match`);
          break;
        }
        if (m[0].length === 0) { re.lastIndex += 1; continue; }
        if (ALLOWED.has(m[0])) continue;
        const line = text.slice(0, m.index).split('\n').length;
        findings.push(`${file}:${line}  ${kind}: ${m[0].slice(0, 10)}…`);
      }
    }
  }

  assert.deepEqual(findings, [],
    `credential-shaped strings found in tracked files:\n  ${findings.join('\n  ')}\n\n` +
    'If one of these is real, revoke it first — removing it from git does not ' +
    'remove it from history — then rotate it and add the replacement to the ' +
    'Vercel environment rather than to the repository.');
});

test('every pattern is global', () => {
  // A non-global regex makes `exec` restart from 0 every time, so the loop
  // returns the same first match forever. That is not a subtle degradation: the
  // test hangs on `.env.example`, the one file whose value is allowlisted and
  // therefore the only one that reaches the `continue`. It happened because a
  // rewrite dropped the flag, and nothing caught it — until the self-test.
  for (const [kind, re] of PATTERNS) {
    assert.ok(re.global, `${kind} is not global; the scan loop cannot advance`);
  }
});

test('every allowlisted value is visibly fake', () => {
  // The allowlist is where a real key would hide. Each entry must announce itself
  // as a fixture, so a genuine credential cannot be waved through by adding a
  // line here.
  for (const [value, reason] of ALLOWED) {
    assert.ok(
      /your_|test|SHOULD_/i.test(value),
      `the allowlisted value "${value}" does not look like a fixture. ` +
      'A real credential must never be allowlisted; revoke it instead. ' +
      `Current reason: ${reason}`
    );
    assert.ok(reason.length > 10, `the allowlist entry "${value}" needs a real explanation`);
  }
});

test('the allowlist is not stale', () => {
  // An entry that no longer appears anywhere is either dead weight or, worse, a
  // value someone removed from the code but left quietly excused.
  const present = new Set();
  for (const file of trackedFiles()) {
    if (/^(node_modules|dist|build)\//.test(file)) continue;
    const full = resolve(REPO_ROOT, file);
    if (!existsSync(full)) continue;
    let text;
    try { text = readFileSync(full, 'utf8'); } catch { continue; }
    for (const value of ALLOWED.keys()) if (text.includes(value)) present.add(value);
  }
  const stale = [...ALLOWED.keys()].filter(v => !present.has(v));
  assert.deepEqual(stale, [],
    `these allowlist entries no longer appear in any tracked file: ${stale.join(', ')}`);
});

test('no environment file with real values is tracked', () => {
  const tracked = trackedFiles();
  const envFiles = tracked.filter(f => /(^|\/)\.env(\.|$)/.test(f) && f !== '.env.example');
  assert.deepEqual(envFiles, [],
    `.env files are tracked: ${envFiles.join(', ')}. Only .env.example belongs here.`);
});

test('.gitignore still covers real environment files', () => {
  const ignore = readFileSync(resolve(REPO_ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.env$/m,
    '.gitignore must ignore .env, which holds the real GROQ_API_KEY');
  assert.match(ignore, /^\.env\.\*$/m, '.gitignore must ignore .env.* variants');
  assert.match(ignore, /^!\.env\.example$/m,
    '.env.example must stay tracked; it is the documented template');
  assert.match(ignore, /^\.vercel\/$/m, '.vercel/ holds deployment credentials and must be ignored');
});

test('the repository has no committed dependencies', () => {
  // Commit 9c0e213 added the whole node_modules tree plus a lockfile. Nothing
  // secret, but it puts thousands of third-party files in history, which is both
  // bloat and extra surface for anything a future dependency ships.
  const tracked = trackedFiles();
  assert.deepEqual(
    tracked.filter(f => f.startsWith('node_modules/')).slice(0, 5), [],
    'node_modules is tracked; it must stay ignored'
  );
  assert.ok(!tracked.includes('package-lock.json'),
    'a lockfile is tracked but the project declares zero dependencies, so it ' +
    'should not exist');
});