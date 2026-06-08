import DOMPurify from 'isomorphic-dompurify';

export function sanitizeHtml(input) {
  if (typeof input !== 'string') return '';
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

export function escapeSqlLike(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[%_]/g, '\\$&');
}

export function stripHtml(input) {
  return sanitizeHtml(input);
}
