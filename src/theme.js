/**
 * @file The editor's one theme and one highlight style — every colour is a CSS
 * variable, so a page switches light and dark without rebuilding the view.
 * @license AGPL-3.0-only
 *
 * The structural colours read the page's own variables first — `--bg-2`, `--fg`,
 * `--border`, `--muted` — so an editor inherits the palette the site already
 * states, and each variable has a `light-dark()` pair behind it for a page that
 * states none. The switch is `color-scheme` only: no `Compartment`, no view
 * rebuild.
 *
 * The variables: `--cm-bg`, `--cm-caret`, `--cm-selection`, `--cm-gutter-bg`,
 * `--cm-gutter-fg`, `--cm-gutter-border`, `--cm-active-line`,
 * `--cm-active-gutter`, `--cm-special-char`, `--cm-matching-bracket`,
 * `--cm-invalid`, `--cm-comment-style`, and one per token class: `--cm-keyword`,
 * `--cm-atom`, `--cm-number`, `--cm-string`, `--cm-string-2`, `--cm-comment`,
 * `--cm-def`, `--cm-variable-2`, `--cm-property`, `--cm-operator`,
 * `--cm-builtin`, `--cm-type`, `--cm-tag`.
 *
 * Specificity: the base theme's colour rules are two or three classes deep, so
 * the overrides below state the same depth and depend on the order the view
 * mounts its style modules in — base first, this theme after it.
 */

import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/** A variable with a light and a dark fallback. */
const colour = (name, light, dark) => `var(--${name}, light-dark(${light}, ${dark}))`;

/** A variable, then the page's own variable of that role, then the pair. */
const site = (name, role, light, dark) => `var(--${name}, var(--${role}, light-dark(${light}, ${dark})))`;

const INK        = colour('fg', '#1c1e22', '#e4e6ea');

const CARET      = site('cm-caret', 'fg', '#1c1e22', '#e4e6ea');
const SELECTION  = colour('cm-selection', '#d7d4f0', '#2b3340');
const GUTTER_BG  = site('cm-gutter-bg', 'bg-2', '#f5f6f8', '#1b1d22');
const GUTTER_FG  = site('cm-gutter-fg', 'muted', '#646870', '#9a9ea7');
const GUTTER_BD  = site('cm-gutter-border', 'border', '#e1e4e9', '#2b2e35');

export const editorTheme = EditorView.theme({
  '&': {
    color: INK,
    backgroundColor: site('cm-bg', 'bg-2', '#f5f6f8', '#1b1d22'),
    fontSize: 'var(--cm-font-size, .8125rem)',
    lineHeight: 'var(--cm-line-height, 1.5)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--cm-font, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace)',
    lineHeight: 'inherit',
  },
  '.cm-content': { caretColor: CARET },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: CARET },
  '.cm-content ::selection': { backgroundColor: SELECTION },
  '.cm-selectionBackground': { backgroundColor: SELECTION },
  // The base theme's focused rule is five classes deep; this one must be too.
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: SELECTION },
  '.cm-gutters': {
    backgroundColor: GUTTER_BG,
    color: GUTTER_FG,
    border: '0',
  },
  '& .cm-gutters.cm-gutters-before': { borderRight: `1px solid ${GUTTER_BD}` },
  '& .cm-gutters.cm-gutters-after': { borderLeft: `1px solid ${GUTTER_BD}` },
  '.cm-gutters .cm-gutterElement': { padding: '0 2px 0 0' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 10px' },
  '.cm-activeLine': { backgroundColor: colour('cm-active-line', 'transparent', 'transparent') },
  '.cm-activeLineGutter': { backgroundColor: colour('cm-active-gutter', 'transparent', 'transparent') },
  '.cm-specialChar': { color: colour('cm-special-char', '#f00', '#f78') },
  '.cm-matchingBracket': { color: colour('cm-matching-bracket', '#0b0', '#fff'), textDecoration: 'none' },
  '.cm-selectionMatch': { backgroundColor: colour('cm-selection-match', 'transparent', 'transparent') },
});

/**
 * The token palette: one entry per tag group, in the order the old static
 * stylesheet stated them, with the tag names the JavaScript grammar emits.
 */
export const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword,
          tags.definitionKeyword, tags.modifier], color: colour('cm-keyword', '#708', '#c792ea') },
  { tag: [tags.atom, tags.bool, tags.null], color: colour('cm-atom', '#219', '#f78c6c') },
  { tag: [tags.number, tags.integer, tags.float], color: colour('cm-number', '#164', '#f78c6c') },
  { tag: [tags.string, tags.character, tags.docString, tags.escape,
          tags.color, tags.url], color: colour('cm-string', '#a11', '#c3e88d') },
  { tag: [tags.special(tags.string), tags.regexp], color: colour('cm-string-2', '#f50', '#c3e88d') },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: colour('cm-comment', '#a50', '#7f8c98'),
    fontStyle: 'var(--cm-comment-style, normal)' },
  { tag: [tags.definition(tags.variableName), tags.function(tags.variableName),
          tags.definition(tags.function(tags.variableName))], color: colour('cm-def', '#00f', '#82aaff') },
  { tag: [tags.local(tags.variableName)], color: colour('cm-variable-2', '#05a', '#addb67') },
  { tag: [tags.propertyName, tags.special(tags.variableName), tags.attributeName],
    color: colour('cm-property', '#1c1e22', '#80cbc4') },
  { tag: [tags.operator, tags.compareOperator, tags.arithmeticOperator, tags.logicOperator,
          tags.bitwiseOperator, tags.updateOperator, tags.definitionOperator, tags.typeOperator,
          tags.controlOperator], color: colour('cm-operator', '#1c1e22', '#89ddff') },
  { tag: [tags.standard(tags.variableName), tags.constant(tags.variableName),
          tags.macroName], color: colour('cm-builtin', '#30a', '#ffcb6b') },
  { tag: [tags.typeName, tags.className, tags.namespace], color: colour('cm-type', '#00f', '#82aaff') },
  { tag: [tags.tagName], color: colour('cm-tag', '#708', '#f07178') },
  { tag: [tags.attributeValue], color: colour('cm-string', '#a11', '#c3e88d') },
  { tag: [tags.invalid], color: colour('cm-invalid', '#e45649', '#ff7676') },
]);
