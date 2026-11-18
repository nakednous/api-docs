/**
 * @file The editor adapter — one CodeMirror 6 view behind a four-verb contract.
 * @license AGPL-3.0-only
 *
 * `mountEditor(textarea, { value, onRun, wrap })` puts an editor in place of a
 * textarea and returns `{ getValue, reset, focus, destroy }`. No CodeMirror
 * type crosses that boundary: the caller keeps the textarea, the buttons and
 * the frame.
 *
 * Approach. The textarea is the carrier of the source until the editor takes
 * over: the document is initialised from the textarea's **current** text, so an
 * edit made while the module was loading survives the mount, and the textarea is
 * hidden only once the view is inserted. `value`, when given, is the text
 * `reset()` restores — byte for byte — and the initial text when the textarea
 * is empty. A mount that throws leaves the textarea in place, marks it
 * `data-editor="fallback"` and returns the same four verbs over the bare
 * textarea, so nothing downstream has to branch.
 *
 * Limits. The extension set is fixed: JavaScript highlighting, line numbers,
 * history, `historyKeymap`, `defaultKeymap` with Mod-Enter bound ahead of it,
 * a two-space indent unit and tab size, `indentOnInput`, `drawSelection`,
 * `indentWithTab`, the highlight style and the theme. There is no `basicSetup`
 * — no autocomplete, search or folding, which the editor this replaces did not
 * have either — and no bracket matching. `EditorView.lineWrapping` is opt-in
 * through `wrap`. The theme's colours are CSS variables, so a theme switch is
 * CSS only; the view is never rebuilt for it.
 */

import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';

import { editorTheme, highlightStyle } from './theme.js';

/**
 * The extensions every editor gets, in the order the package fixes them.
 * @param {Object} options
 * @param {Function} [options.onRun]  Called by Mod-Enter; the binding consumes the key either way.
 * @param {boolean} [options.wrap]    Adds `EditorView.lineWrapping`.
 * @param {string|null} [options.label] The textarea's `aria-label`, when it has one.
 * @returns {Array} extensions
 */
function extensions({ onRun, wrap, label }) {
  return [
    javascript(),
    lineNumbers(),
    history(),
    indentUnit.of('  '),
    EditorState.tabSize.of(2),
    indentOnInput(),
    drawSelection(),
    syntaxHighlighting(highlightStyle),
    editorTheme,
    wrap ? EditorView.lineWrapping : [],
    label ? EditorView.contentAttributes.of({ 'aria-label': label }) : [],
    keymap.of([
      {
        key: 'Mod-Enter',
        preventDefault: true,
        run: () => {
          if (typeof onRun === 'function') onRun();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
  ];
}

/** The four verbs over the bare textarea: what a failed mount returns. */
function fallbackAdapter(textarea, original) {
  return {
    getValue: () => textarea.value,
    reset: () => { textarea.value = original; },
    focus: () => textarea.focus(),
    destroy: () => {},
  };
}

/**
 * Mount an editor over a textarea.
 * @param {HTMLTextAreaElement} textarea  The carrier; its current text becomes the document.
 * @param {Object} [options]
 * @param {string} [options.value]   The text `reset()` restores; defaults to the textarea's text.
 * @param {Function} [options.onRun] Called by Mod-Enter, before the default keymap sees the key.
 * @param {boolean} [options.wrap]   Wrap long lines; off unless a page asks for it.
 * @returns {{ getValue: function():string, reset: function():void, focus: function():void, destroy: function():void }}
 */
export function mountEditor(textarea, options = {}) {
  const { value, onRun, wrap = false } = options;
  const original = value ?? textarea.value;
  // The document is the textarea's text, empty or not: `value` is the Reset
  // target, never a way to resurrect a cleared box.
  const initial = textarea.value;
  const config = extensions({ onRun, wrap, label: textarea.getAttribute('aria-label') });

  let view = null;
  try {
    view = new EditorView({
      state: EditorState.create({ doc: initial, extensions: config }),
      parent: textarea.parentElement,
    });
  } catch (_) {
    textarea.dataset.editor = 'fallback';
    return fallbackAdapter(textarea, original);
  }

  // The view is in the document; only now does the textarea stop being it.
  textarea.hidden = true;
  textarea.style.display = 'none';

  return {
    getValue: () => view.state.doc.toString(),
    reset: () => {
      view.setState(EditorState.create({ doc: original, extensions: config }));
      textarea.value = original;
    },
    focus: () => view.focus(),
    destroy: () => {
      const text = view.state.doc.toString();
      view.destroy();
      view = null;
      textarea.value = text;
      textarea.hidden = false;
      textarea.style.removeProperty('display');
      delete textarea.dataset.editor;
    },
  };
}
