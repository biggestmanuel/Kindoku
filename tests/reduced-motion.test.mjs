/**
 * Reduced motion.
 *
 * The landing page runs three continuously drifting background orbs, a pulsing
 * logo, and up to 160 particles repainting every animation frame. That is a lot
 * of persistent background movement, which is the specific pattern that triggers
 * vestibular symptoms in people who have asked their operating system for less
 * of it.
 *
 * Asserting this matters twice over. It is an accessibility requirement, and the
 * particle loop was also an unconditional 60fps repaint of a full-viewport
 * canvas — so honouring the preference is a performance win as well.
 *
 * The animation loop is verified by counting animation frames rather than by
 * inspecting the DOM, because "nothing visibly moves" is not the same as "no
 * loop is running".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadApp } from './harness.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(REPO_ROOT, 'kindoku.css'), 'utf8');
const clientJs = readFileSync(resolve(REPO_ROOT, 'kindoku.js'), 'utf8');

const provide = ['particle-canvas', 'view-landing'];

/** A canvas stand-in that records what was drawn onto it. */
function countingCanvas() {
  const calls = { clearRect: 0, restore: 0 };
  return {
    calls,
    width: 1280,
    height: 800,
    getContext: () => ({
      clearRect: () => { calls.clearRect += 1; },
      restore: () => { calls.restore += 1; },
      // The Particle class calls a broad slice of the 2D API; they only need to
      // exist, and must not throw.
      save() { }, beginPath() { }, moveTo() { }, lineTo() { }, arc() { },
      fill() { }, stroke() { }, translate() { }, rotate() { }, scale() { },
      createRadialGradient: () => ({ addColorStop() { } }),
      setTransform() { }, closePath() { }, fillRect() { }, rect() { },
    }),
    addEventListener() { },
    getBoundingClientRect: () => ({ width: 1280, height: 800, top: 0, left: 0 }),
  };
}

test('the particle loop does not run when reduced motion is requested', () => {
  const app = loadApp({
    provide,
    elements: { 'particle-canvas': countingCanvas() },
    prefersReducedMotion: true,
  });

  assert.equal(app.prefersReducedMotion(), true,
    'the preference is not being read at all');
  assert.equal(app.frameStats().pending, 0,
    'an animation frame was requested despite reduced motion; the canvas will ' +
    'repaint at 60fps forever');
  assert.equal(app.particles.length > 0, true,
    'the field is not built, so nothing static can be shown either');
});

test('the particle field is drawn once when reduced motion is requested', () => {
  const canvas = countingCanvas();
  const app = loadApp({
    provide,
    elements: { 'particle-canvas': canvas },
    prefersReducedMotion: true,
  });

  assert.ok(canvas.calls.clearRect > 0,
    'nothing was painted, so the canvas is blank rather than showing a static field');
});

test('the particle loop runs when motion is allowed', () => {
  const app = loadApp({
    provide,
    elements: { 'particle-canvas': countingCanvas() },
    prefersReducedMotion: false,
  });

  assert.equal(app.prefersReducedMotion(), false);
  assert.ok(app.frameStats().pending > 0,
    'no animation frame was requested, so the background is static even though ' +
    'the user did not ask for reduced motion');
});

test('turning reduced motion on mid-session stops the loop', () => {
  // The preference can change while the page is open; checking it only at load
  // would leave the loop running for anyone who changed it in system settings
  // after loading.
  const canvas = countingCanvas();
  const app = loadApp({
    provide,
    elements: { 'particle-canvas': canvas },
    prefersReducedMotion: false,
  });

  assert.ok(app.frameStats().pending > 0, 'precondition: the loop should be running');

  app.motionQuery.__set(true);

  assert.equal(app.frameStats().pending, 0,
    'the loop kept running after the preference changed to reduce');
  assert.ok(app.frameStats().cancelled > 0,
    'the pending frame was not cancelled, so one more frame will still paint');
});

test('turning reduced motion off mid-session starts the loop again', () => {
  const app = loadApp({
    provide,
    elements: { 'particle-canvas': countingCanvas() },
    prefersReducedMotion: true,
  });

  assert.equal(app.frameStats().pending, 0, 'precondition: the loop should be stopped');

  app.motionQuery.__set(false);

  assert.ok(app.frameStats().pending > 0,
    'the loop did not restart after the preference was lifted');
});

test('the listener is registered through the modern API with a legacy fallback', () => {
  // Safari below 14 only has addListener. Without the fallback the preference
  // change would simply go unnoticed there.
  assert.match(clientJs, /addEventListener\('change'/, 'no change listener for the media query');
  assert.match(clientJs, /addListener\(syncParticlesWithMotionPreference\)/,
    'no addListener fallback for older Safari');
});

test('the stylesheet honours reduced motion for the whole document', () => {
  const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(block, 'kindoku.css has no prefers-reduced-motion block');

  assert.match(block[1], /animation-iteration-count:\s*1\s*!important/,
    'infinite animations are not stopped');
  assert.match(block[1], /transition-duration:\s*0\.01ms\s*!important/,
    'transitions are not collapsed');
  assert.match(block[1], /scroll-behavior:\s*auto/,
    'smooth scrolling is not disabled');
});

test('the universal selector means new animations are covered automatically', () => {
  // Per-rule opt-out is how this rots: a new keyframe animation works again the
  // moment someone forgets to exclude it.
  const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.match(block[1], /\*\s*,\s*\*::before\s*,\s*\*::after/,
    'the reduced-motion block does not use the universal selector, so a new ' +
    'animation would not be covered');
});

test('every infinite animation is inside the scope the media query covers', () => {
  // Guards the claim above: no animation is declared in a way that escapes the
  // universal override, such as inside an inline style attribute.
  const infinite = [...css.matchAll(/animation:[^;]*infinite/g)];
  assert.ok(infinite.length > 0, 'no infinite animations left; this test has nothing to check');
  assert.doesNotMatch(clientJs, /style="[^"]*animation[^"]*infinite/,
    'an infinite animation is set via an inline style, which the stylesheet ' +
    'media query cannot override');
});

test('the particle canvas is not composited under reduced motion', () => {
  // With the JS loop stopped there is nothing to show, but an empty
  // full-viewport canvas still costs a compositing layer on every paint.
  const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.match(block[1], /#particle-canvas[\s\S]*display:\s*none/,
    'the particle canvas is still composited under reduced motion');
});