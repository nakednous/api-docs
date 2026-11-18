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
 * The package owns the structure and the token-role mapping; a site owns the
 * colours. Every structural colour reads the page's own `--bg-2`, `--fg`,
 * `--border` and `--muted` first; every token role reads its `--cm-*` variable
 * and falls back to the page's ink, so a site that states no palette gets
 * monochrome code rather than another site's opinion. A site that wants colour
 * states `--cm-keyword`, `--cm-atom`, `--cm-number`, `--cm-string`,
 * `--cm-string-2`, `--cm-comment`, `--cm-def`, `--cm-variable-2`,
 * `--cm-property`, `--cm-operator`, `--cm-builtin`, `--cm-type`, `--cm-tag`,
 * `--cm-invalid`; the structural variables are `--cm-bg`, `--cm-caret`,
 * `--cm-selection`, `--cm-gutter-bg`, `--cm-gutter-fg`, `--cm-gutter-border`,
 * `--cm-active-line`, `--cm-active-gutter`, `--cm-special-char`,
 * `--cm-matching-bracket`, `--cm-comment-style`, `--cm-focus`.
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

/** A token role: the site's colour, or the page's ink — never a palette of the package's. */
const token = (name) => `var(--${name}, currentColor)`;

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
  // The base theme draws a dotted ring on focus. It is suppressed for a pointer,
  // and a keyboard focus gets the site's ring — `:has()` measures the content, so
  // no extension is needed to know how the editor was focused.
  '&.cm-focused': { outline: 'none' },
  '&:has(.cm-content:focus-visible)': {
    outline: '2px solid var(--cm-focus, var(--accent, currentColor))',
    outlineOffset: '2px',
  },
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
          tags.definitionKeyword, tags.modifier], color: token('cm-keyword') },
  { tag: [tags.atom, tags.bool, tags.null], color: token('cm-atom') },
  { tag: [tags.number, tags.integer, tags.float], color: token('cm-number') },
  { tag: [tags.string, tags.character, tags.docString, tags.escape,
          tags.color, tags.url], color: token('cm-string') },
  { tag: [tags.special(tags.string), tags.regexp], color: token('cm-string-2') },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: token('cm-comment'),
    fontStyle: 'var(--cm-comment-style, normal)' },
  { tag: [tags.definition(tags.variableName), tags.function(tags.variableName),
          tags.definition(tags.function(tags.variableName))], color: token('cm-def') },
  { tag: [tags.local(tags.variableName)], color: token('cm-variable-2') },
  { tag: [tags.propertyName, tags.special(tags.variableName), tags.attributeName],
    color: token('cm-property') },
  { tag: [tags.operator, tags.compareOperator, tags.arithmeticOperator, tags.logicOperator,
          tags.bitwiseOperator, tags.updateOperator, tags.definitionOperator, tags.typeOperator,
          tags.controlOperator], color: token('cm-operator') },
  { tag: [tags.standard(tags.variableName), tags.constant(tags.variableName),
          tags.macroName], color: token('cm-builtin') },
  { tag: [tags.typeName, tags.className, tags.namespace], color: token('cm-type') },
  { tag: [tags.tagName], color: token('cm-tag') },
  { tag: [tags.attributeValue], color: token('cm-string') },
  { tag: [tags.invalid], color: token('cm-invalid') },
]);
