import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { safeAssetUrl } from './binary.js';

export function releaseNotesHtml(notes: string): string {
  const clean = DOMPurify.sanitize(marked.parse(notes, { async: false, gfm: true }), {
    // Passive Markdown only: HTML profiles include media and other automatic
    // resource loaders. No src/poster/srcset/style/ping or embed namespaces.
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'blockquote',
      'ul',
      'ol',
      'li',
      'pre',
      'code',
      'em',
      'strong',
      'del',
      's',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'a',
    ],
    ALLOWED_ATTR: ['href', 'title', 'start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const link of template.content.querySelectorAll('a')) {
    const href = safeAssetUrl(link.getAttribute('href'));
    if (href) {
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else link.removeAttribute('href');
  }
  return template.innerHTML;
}
