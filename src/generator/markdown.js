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

/** The instance every page is parsed by. */
export const marked = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      const text = this.parser.parseInline(tokens, this.parser.textRenderer);
      return `<h${depth} id="${slug(text)}">${html}</h${depth}>\n`;
    },
  },
});

/** Split markdown into [text, fence, text, fence, …] so links inside fenced code are left alone. */
export const splitFences = (md) => String(md).split(/(```[\s\S]*?```)/g);

/** The first sentence of a description, markdown stripped to plain text. */
export function firstSentence(text) {
  const plain = (text || '').replace(/\{@link\s+([^}\s]+)\s*\}/g, '$1')
    .replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(plain);
  return m ? m[1] : plain;
}
