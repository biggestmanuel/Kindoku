/**
 * Modal focus management.
 *
 * Opening a dialog used to leave focus on `<body>`, so a keyboard user who opened
 * the reader tabbed straight through the whole page *behind* the dialog before
 * reaching any of its controls, and closing it dropped focus on the floor instead
 * of returning it to the button that opened it. Both fail WCAG 2.4.3 (Focus
 * Order).
 *
 * Measured on the deployment before the fix: `document.activeElement` was BODY
 * with the reader overlay open, and still BODY after closing it.
 *
 * These drive the real `pushOverlay`/`popOverlay` through the vm harness, so the
 * scroll-lock behaviour that shares those functions is covered here too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const IDS = [
  'reader-overlay', 'reader-close-btn', 'reader-iframe',
  'detail-modal', 'detail-modal-close',
  'cmd-modal', 'cmd-input',
];

/**
 * Loads the app with the three overlays present, as the real page has them.
 *
 * Built from the harness's own elements rather than hand-rolled stubs, so
 * `focus()`, `querySelector` and `isConnected` behave as they do in a real DOM.
 * A stub without them would make every assertion here vacuous.
 */
function loadWithOverlays() {
  const app = loadApp({ provide: IDS });
  const doc = app.document;

  const build = (overlayId, closeId, closeClass, autofocusId) => {
    const node = doc.byId.get(overlayId);

    const close = doc.createElement('button');
    close.id = closeId;
    close.className = closeClass;
    node.children.push(close);

    let autofocus = null;
    if (autofocusId) {
      autofocus = doc.createElement('input');
      autofocus.id = autofocusId;
      autofocus.setAttribute('data-autofocus', '');
      node.children.push(autofocus);
    }
    return { node, close, autofocus };
  };

  const reader = build('reader-overlay', 'reader-close-btn', 'reader-btn');
  const detail = build('detail-modal', 'detail-modal-close', 'modal-close-btn');
  const cmd = build('cmd-modal', 'cmd-modal-close', 'modal-close-btn', 'cmd-input');

  const opener = doc.createElement('button');
  opener.id = 'opener';

  return { app, doc, reader, detail, cmd, cmdInput: cmd.autofocus, opener };
}

test('opening an overlay moves focus inside it', () => {
  const { app, doc, reader, opener } = loadWithOverlays();
  opener.focus();
  assert.equal(doc.activeElement, opener, 'precondition: focus is on the opener');

  app.pushOverlay('reader', reader.node);

  assert.equal(doc.activeElement, reader.close,
    'focus stayed outside the dialog, so a keyboard user tabs through the page ' +
    'behind it before reaching any control (WCAG 2.4.3)');
});

test('a data-autofocus target wins over the close button', () => {
  // The command palette is a text field: focusing its close button first and the
  // field a moment later means two focus events and a visible flash.
  const { app, doc, cmd, cmdInput, opener } = loadWithOverlays();
  opener.focus();

  app.pushOverlay('cmd', cmd.node);

  assert.equal(doc.activeElement, cmdInput,
    'an explicit autofocus target should receive focus directly');
});

test('closing an overlay restores focus to whatever opened it', () => {
  const { app, doc, reader, opener } = loadWithOverlays();
  opener.focus();

  app.pushOverlay('reader', reader.node);
  assert.notEqual(doc.activeElement, opener, 'precondition: focus moved into the dialog');

  app.popOverlay('reader');

  assert.equal(doc.activeElement, opener,
    'focus was not returned to the element that opened the dialog, so a ' +
    'keyboard user loses their place entirely');
});

test('nested overlays restore focus in the right order', () => {
  // The reader can open the detail modal. Both must not return to the same
  // element, or closing the inner one teleports focus out of the outer dialog.
  const { app, doc, reader, detail, opener } = loadWithOverlays();
  opener.focus();

  app.pushOverlay('reader', reader.node);
  app.pushOverlay('detail', detail.node);
  assert.equal(doc.activeElement, detail.close, 'precondition: inner dialog has focus');

  app.popOverlay('detail');
  assert.equal(doc.activeElement, reader.close,
    'closing the inner dialog should return focus to the outer one');

  app.popOverlay('reader');
  assert.equal(doc.activeElement, opener,
    'and the outer dialog to the original opener');
});

test('body is never treated as a restore target', () => {
  // If nothing was focused when the dialog opened — the common case for a mouse
  // click on a card — restoring to body is no better than not restoring, and it
  // wipes whatever the user did have focused.
  const { app, doc, reader } = loadWithOverlays();
  doc.activeElement = doc.body;

  app.pushOverlay('reader', reader.node);
  app.popOverlay('reader');

  assert.notEqual(doc.activeElement, doc.body,
    'focus was forced onto body, so a later dialog would restore focus to nothing');
});

test('focus is not restored to a detached opener', () => {
  // The card grid re-renders on every search, so the button that opened the
  // reader is frequently gone by the time it closes.
  const { app, doc, reader, opener } = loadWithOverlays();
  opener.focus();

  app.pushOverlay('reader', reader.node);
  opener._detached = true;
  doc.activeElement = doc.body;

  app.popOverlay('reader');

  assert.notEqual(doc.activeElement, opener,
    'focused a node that is no longer in the document, which silently does ' +
    'nothing and strands focus on body');
});

test('closing an overlay that was never opened is harmless', () => {
  const { app, doc, opener } = loadWithOverlays();
  opener.focus();

  assert.doesNotThrow(() => app.popOverlay('never-opened'));
  assert.equal(doc.activeElement, opener, 'an unmatched pop stole focus from the page');
});

test('focus management does not disturb the scroll lock', () => {
  // pushOverlay/popOverlay own both behaviours; the focus work must not have
  // broken the lock a previous fix added.
  const { app, doc, reader, detail, opener } = loadWithOverlays();
  opener.focus();

  app.pushOverlay('reader', reader.node);
  assert.equal(doc.body.style.overflow, 'hidden', 'opening one overlay must lock scroll');

  app.pushOverlay('detail', detail.node);
  app.popOverlay('detail');
  assert.equal(doc.body.style.overflow, 'hidden',
    'closing one of two open overlays must not unlock scrolling behind the other');

  app.popOverlay('reader');
  assert.equal(doc.body.style.overflow, '', 'closing the last overlay must unlock scroll');
});

test('every overlay is opened with its element', () => {
  // A call site that forgets the second argument still locks scroll, so the bug
  // is invisible: focus simply never moves.
  const { app, doc, reader, detail, cmd } = loadWithOverlays();

  for (const { name, node, close } of [
    { name: 'reader', node: reader.node, close: reader.close },
    { name: 'detail', node: detail.node, close: detail.close },
    { name: 'cmd', node: cmd.node, close: cmd.autofocus },
  ]) {
    app.pushOverlay(name, node);
    assert.equal(doc.activeElement, close, `${name} does not move focus into its overlay`);
    app.popOverlay(name);
  }
});