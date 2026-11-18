/**
 * @file Markdown — the one parser the pages go through, its heading slugs, and
 * the plain-text helpers the tables and the search index read.
 * @license AGPL-3.0-only
 *
 * A heading gets a GitHub-style id, because a site's README and its own
 * Markdown pages were written against anchors that slug produced, and a link
 * written for the old site must land where it always did.
 */

import { Marked } from 'marked';

/** GitHub-style heading slug — the README's own table of contents depends on it. */
export const slug = (s) => String(s).toLowerCase().replace(/[^\w\- ]+/g, '').replace(/ /g, '-');

/** The heading rule every page's Markdown goes through. */
const heading = function ({ tokens, depth }) {
  const html = this.parser.parseInline(tokens);
  const text = this.parser.parseInline(tokens, this.parser.textRenderer);
  return `<h${depth} id="${slug(text)}">${html}</h${depth}>\n`;
};

/** The instance every page is parsed by. */
export const marked = new Marked({ renderer: { heading } });

/**
 * An instance with the same heading rule and one `code` rule of its own: a
 * carrier that treats a fence specially (a runnable example, a language's
 * callout) parses its pages with this rather than with the shared instance.
 * @param {Function} code  the `code` renderer
 */
export const markdownWith = (code) => new Marked({ gfm: true, renderer: { heading, code } });

/** Split markdown into [text, fence, text, fence, …] so links inside fenced code are left alone. */
export const splitFences = (md) => String(md).split(/(```[\s\S]*?```)/g);

/** The first sentence of a description, markdown stripped to plain text. */
export function firstSentence(text) {
  const plain = (text || '').replace(/\{@link\s+([^}\s]+)\s*\}/g, '$1')
    .replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(plain);
  return m ? m[1] : plain;
}
