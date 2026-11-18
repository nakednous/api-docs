/**
 * @file The adapter's conformance suite: mount, Run, Reset, undo, the fixed
 * extension set, wrapping, two editors on a page, the themes and the fallback.
 * @license AGPL-3.0-only
 *
 * What it can and cannot see: jsdom has no layout, so this suite reads the
 * contract (`getValue`/`reset`), the state (facets, history, transactions) and
 * the markup (editor DOM, tokens, hidden textarea, injected CSS). Computed
 * colours, caret geometry and the live theme switch are checked in a browser by
 * a consuming site's probe.
 *
 * Every test opens its own page: a view left mounted by one test cannot colour
 * another's document, its observers or its editor count.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { figure, install, page, press, rendered, settle, type } from './support/dom.mjs';

install(figure('installed before the adapter loads'));
const { mountEditor } = await import('../src/editor.js');
const { EditorState } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');
const { indentUnit } = await import('@codemirror/language');

const SOURCE = 'const value = 1;\n\n// a comment with a trailing space \n\tlet tabbed = "é — 🙂";\n';

/** A fresh page holding one example figure, and its textarea. */
function fresh(text = SOURCE) {
  const { window, document } = page(figure(text));
  return { window, document, textarea: document.querySelector('textarea.source') };
}

/** Another figure on the page, in a box of its own. */
function another(document, text) {
  const box = document.createElement('div');
  box.className = 'editor-box';
  box.innerHTML = figure(text);
  document.body.append(box);
  return box.querySelector('textarea.source');
}

const editorOf = (textarea) => textarea.parentElement.querySelector('.cm-editor');
const contentOf = (textarea) => editorOf(textarea).querySelector('.cm-content');

/** Mod is Ctrl on a Linux page, which is what jsdom reports. */
const MOD = { ctrlKey: true };

test('mount: the contract, the inserted view, the hidden textarea last', () => {
  const { document, textarea } = fresh();
  const adapter = mountEditor(textarea, {});
  for (const verb of ['getValue', 'reset', 'focus', 'destroy']) assert.equal(typeof adapter[verb], 'function');
  assert.equal(adapter.getValue(), SOURCE);
  assert.equal(textarea.hidden, true, 'the textarea is hidden once the view is in');
  assert.equal(textarea.style.display, 'none', 'and by inline style, which no stylesheet outranks');
  assert.ok(editorOf(textarea), 'the view sits in the textarea\'s parent');
  assert.equal(document.querySelectorAll('.cm-editor').length, 1);
  adapter.destroy();
});

test('mount: value is the Reset target only — an empty textarea stays empty', () => {
  const { document, textarea } = fresh('');
  const adapter = mountEditor(textarea, { value: 'let seeded = 1;\n' });
  assert.equal(adapter.getValue(), '', 'the document is the textarea\'s text, empty or not');
  adapter.reset();
  assert.equal(adapter.getValue(), 'let seeded = 1;\n', 'and Reset is what restores `value`');
  assert.equal(document.querySelectorAll('.cm-editor').length, 1);
  adapter.destroy();
});

test('mount: the document is the textarea\'s current value, so a late edit survives', () => {
  const { textarea } = fresh();
  const late = `${SOURCE}// edited while loading\n`;
  textarea.value = late;
  const calls = [];
  const adapter = mountEditor(textarea, { value: SOURCE, onRun: () => calls.push('run') });
  assert.equal(adapter.getValue(), late, 'the edit made before the mount is kept');
  adapter.reset();
  assert.equal(adapter.getValue(), SOURCE, 'and Reset goes back to the source the runner captured');
  assert.deepEqual(calls, []);
  adapter.destroy();
});

test('reset: byte-exact, history cleared, and the textarea agrees', async () => {
  const { window, textarea } = fresh();
  const adapter = mountEditor(textarea, {});
  adapter.focus();
  press(window, contentOf(textarea), { key: 'Enter' });
  type(window, editorOf(textarea), 'X');
  await settle();
  assert.notEqual(adapter.getValue(), SOURCE, 'the document was edited');

  adapter.reset();
  assert.equal(adapter.getValue(), SOURCE);
  assert.equal(textarea.value, SOURCE);
  assert.equal(rendered(editorOf(textarea)), SOURCE, 'the rendered DOM matches the document');
  assert.equal(press(window, contentOf(textarea), { key: 'z', ...MOD }).defaultPrevented, true,
    'the key is still a history binding');
  assert.equal(adapter.getValue(), SOURCE, 'but the history is empty: there is nothing to undo');
  adapter.destroy();
});

test('undo and redo: Mod-z and Mod-y drive the history the mount installed', async () => {
  const { window, textarea } = fresh();
  const adapter = mountEditor(textarea, {});
  adapter.focus();
  type(window, editorOf(textarea), 'X');
  await settle();
  const edited = adapter.getValue();
  assert.notEqual(edited, SOURCE);

  assert.equal(press(window, contentOf(textarea), { key: 'z', ...MOD }).defaultPrevented, true);
  assert.equal(adapter.getValue(), SOURCE, 'undo returns the source');
  assert.equal(press(window, contentOf(textarea), { key: 'y', ...MOD }).defaultPrevented, true);
  assert.equal(adapter.getValue(), edited, 'redo returns the edit');
  adapter.destroy();
});

test('Mod-Enter runs once, before the default keymap, and leaves the source alone', async () => {
  const { window, textarea } = fresh();
  let runs = 0;
  const adapter = mountEditor(textarea, { onRun: () => { runs += 1; } });
  adapter.focus();

  const event = press(window, contentOf(textarea), { key: 'Enter', ...MOD });
  assert.equal(runs, 1);
  assert.equal(event.defaultPrevented, true, 'the binding consumes the key');
  assert.equal(adapter.getValue(), SOURCE, 'the default map\'s insert-blank-line never runs');

  press(window, contentOf(textarea), { key: 'Enter', ...MOD });
  assert.equal(runs, 2, 'each press runs the sketch once');

  assert.equal(press(window, contentOf(textarea), { key: 'Enter' }).defaultPrevented, true);
  await settle();
  assert.notEqual(adapter.getValue(), SOURCE, 'plain Enter still inserts a line');
  adapter.destroy();
});

test('the fixed extension set: indent unit, tab size, Tab, gutter, tokens, selection layer', () => {
  const { window, document, textarea } = fresh();
  let ran = null;
  const adapter = mountEditor(textarea, { onRun: () => { ran = 'run'; } });
  const dom = editorOf(textarea);
  const view = EditorView.findFromDOM(dom);

  assert.equal(view.state.facet(indentUnit), '  ');
  assert.equal(view.state.facet(EditorState.tabSize), 2);
  assert.equal(view.state.facet(EditorView.darkTheme), false, 'one theme, no dark facet: the switch is CSS');

  assert.ok(dom.querySelector('.cm-lineNumbers'), 'a line-number gutter');
  assert.ok(dom.querySelector('.cm-selectionLayer'), 'the drawn selection layer');
  const keywords = [...dom.querySelectorAll('.cm-line span')].filter((s) => s.textContent === 'const');
  assert.equal(keywords.length, 1, 'the JavaScript grammar coloured the first keyword');
  assert.ok(keywords[0].className, 'and gave it a class');
  assert.equal(ran, null, 'mounting does not run the sketch');

  view.dispatch({ selection: { anchor: 0 } });
  adapter.focus();
  assert.equal(press(window, contentOf(textarea), { key: 'Tab' }).defaultPrevented, true);
  assert.equal(adapter.getValue().startsWith('  const'), true, 'Tab indents by the two-space unit');
  assert.equal(press(window, contentOf(textarea), { key: 'Tab', shiftKey: true }).defaultPrevented, true);
  assert.equal(adapter.getValue(), SOURCE, 'Shift-Tab outdents back to the source');

  adapter.destroy();
  assert.equal(document.querySelectorAll('.cm-editor').length, 0, 'destroy takes the DOM with it');
});

test('wrapping is opt-in: absent by default, present only for wrap: true', () => {
  const { document } = fresh();
  const first = document.querySelector('textarea.source');
  const second = another(document, SOURCE);

  const plain = mountEditor(first, {});
  const wrapped = mountEditor(second, { wrap: true });
  const wrapping = (ta) => editorOf(ta).querySelector('.cm-content').classList.contains('cm-lineWrapping');
  assert.equal(wrapping(first), false);
  assert.equal(wrapping(second), true);
  plain.destroy();
  wrapped.destroy();
});

test('two editors on one page: separate state, separate histories, separate resets', async () => {
  const { window, document } = fresh();
  const second = another(document, 'let other = 2;\n');
  const first = document.querySelector('textarea.source');

  const runs = [];
  const a = mountEditor(first, { onRun: () => runs.push('a') });
  const b = mountEditor(second, { onRun: () => runs.push('b') });
  assert.equal(document.querySelectorAll('.cm-editor').length, 2, 'two editors, one page');
  assert.equal(a.getValue(), SOURCE);
  assert.equal(b.getValue(), 'let other = 2;\n');

  type(window, editorOf(first), 'X');
  await settle();
  assert.notEqual(a.getValue(), SOURCE);
  assert.equal(b.getValue(), 'let other = 2;\n', 'the second editor is untouched');

  press(window, contentOf(first), { key: 'Enter', ...MOD });
  assert.deepEqual(runs, ['a'], 'Mod-Enter reaches only the editor that has focus');

  a.reset();
  assert.equal(a.getValue(), SOURCE);
  assert.equal(b.getValue(), 'let other = 2;\n');
  b.reset();
  assert.equal(b.getValue(), 'let other = 2;\n');
  a.destroy();
  b.destroy();
});

test('the accessible name: the textarea\'s aria-label reaches the editor\'s content DOM', () => {
  const { window, document, textarea } = fresh();
  const labelled = mountEditor(textarea, {});
  assert.equal(labelled.getValue(), SOURCE);
  assert.equal(textarea.getAttribute('aria-label'), 'sketch source');
  assert.equal(textarea.parentElement.querySelector('.cm-content').getAttribute('aria-label'),
    'sketch source', 'the mounted textbox keeps the name the textarea had');
  labelled.destroy();

  const bare = document.createElement('div');
  bare.innerHTML = '<textarea class="source"></textarea>';   // no aria-label: no attribute
  document.body.append(bare);
  const plain = mountEditor(bare.querySelector('textarea'), {});
  assert.equal(bare.querySelector('.cm-content').hasAttribute('aria-label'), false,
    'a textarea without a label adds no attribute');
  plain.destroy();
  assert.equal(document.querySelectorAll('.cm-content').length, 0, 'both views are gone');
});

test('the theme and the highlight style are CSS variables with light and dark fallbacks', () => {
  const { document, textarea } = fresh();
  const adapter = mountEditor(textarea, {});
  const css = [...document.head.querySelectorAll('style')].map((style) => style.textContent).join('\n');
  for (const variable of ['--cm-keyword', '--cm-selection', '--cm-gutter-bg', '--cm-caret', '--cm-comment']) {
    assert.ok(css.includes(`var(${variable}`), `${variable} is what the rules read`);
  }
  assert.equal(css.includes('light-dark('), true, 'and each has a light and a dark fallback');
  adapter.destroy();
});

test('destroy hands the text back to the textarea', async () => {
  const { window, textarea } = fresh();
  const adapter = mountEditor(textarea, {});
  type(window, editorOf(textarea), 'X');
  await settle();
  const edited = adapter.getValue();
  adapter.destroy();
  assert.equal(textarea.hidden, false);
  assert.equal(textarea.value, edited);
  assert.equal(textarea.dataset.editor, undefined);
  assert.equal(editorOf(textarea), null);
});

test('a mount that throws leaves the textarea usable and marked fallback', () => {
  const { document, textarea } = fresh();
  Object.defineProperty(textarea, 'parentElement', {
    get() { throw new Error('detached from its document'); },
  });
  const adapter = mountEditor(textarea, {});
  assert.equal(textarea.dataset.editor, 'fallback');
  assert.equal(textarea.hidden, false, 'nothing was hidden');
  assert.equal(adapter.getValue(), SOURCE);
  textarea.value = 'edited with no editor';
  adapter.reset();
  assert.equal(adapter.getValue(), SOURCE, 'Reset still restores the source');
  adapter.focus();
  adapter.destroy();
  assert.equal(document.querySelector('.cm-editor'), null, 'no editor was ever built');
});
