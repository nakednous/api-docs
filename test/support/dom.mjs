/**
 * @file The suite's page: a jsdom document with the globals CodeMirror reads,
 * and a frame loop that never runs.
 * @license AGPL-3.0-only
 *
 * The suite is a DOM-level suite: it checks the contract, the state and the
 * markup a view produces, not layout. jsdom has no layout engine, and a real
 * measure would throw on the missing range rectangles, so `requestAnimationFrame`
 * is a function that returns an id and calls nothing back — deterministic, and
 * the view still builds its document DOM synchronously, which is what the suite
 * reads. Layout, paint, tokens and the theme switch are the browser probe's
 * business.
 *
 * `install()` must run before CodeMirror is imported: the module reads
 * `navigator` and `document` at load time.
 */

import { JSDOM } from 'jsdom';

const FROM_WINDOW = [
  'Window', 'Document', 'Element', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent',
  'InputEvent', 'DOMRect', 'Range', 'Text', 'getComputedStyle', 'MutationObserver',
];

/**
 * A page with the given body, installed as the process's globals.
 * @param {string} body  HTML for `<body>`.
 * @returns {{ window: Object, document: Object }} the page
 */
export function install(body = '') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    url: 'https://docs.test/',
  });
  const { window } = dom;
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};

  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserver;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.ResizeObserver = ResizeObserver;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  globalThis.getSelection = () => window.getSelection();
  for (const name of FROM_WINDOW) {
    if (window[name] !== undefined) globalThis[name] = window[name];
  }
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  return { window, document: window.document };
}

/** A fresh page per test: a new document, and the same globals re-installed. */
export function page(body = '') {
  return install(body);
}

/** The markup a page's example figure carries — the attribute set the renderer writes. */
export function figure(code) {
  return `<div class="editor"><textarea class="source" spellcheck="false" aria-label="sketch source">${code}</textarea></div>`;
}

/**
 * A key press on an element, as the browser would deliver it.
 * @param {Object} window
 * @param {Element} target
 * @param {Object} init  `KeyboardEvent` init: `key`, and the modifiers.
 * @returns {Object} the event
 */
export function press(window, target, init) {
  const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Let the view's DOM observer read a mutation and dispatch it. */
export const settle = () => new Promise((done) => setTimeout(done, 30));

/**
 * Insert text at the start of the first rendered line, the way a browser does
 * it: the DOM mutates, then an `input` event tells the view to read it.
 * @param {Object} window
 * @param {Element} editor  The `.cm-editor` element.
 * @param {string} text
 */
export function type(window, editor, text) {
  const line = editor.querySelector('.cm-line');
  line.textContent = text + line.textContent;
  const content = editor.querySelector('.cm-content');
  content.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

/** The text of the rendered lines, joined as the document's lines are. */
export const rendered = (editor) => [...editor.querySelectorAll('.cm-line')].map((line) => line.textContent).join('\n');
