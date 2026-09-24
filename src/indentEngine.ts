import { IndentStyle } from './types';

function leadingWhitespaceWidth(leading: string, tabSize: number): number {
  let width = 0;
  for (const ch of leading) {
    width += ch === '\t' ? tabSize : 1;
  }
  return width;
}

function buildIndent(width: number, style: IndentStyle, tabSize: number): string {
  if (style === 'spaces') {
    return ' '.repeat(width);
  }
  const tabs = Math.floor(width / tabSize);
  const remainder = width % tabSize;
  return '\t'.repeat(tabs) + ' '.repeat(remainder);
}

/**
 * Rewrites each line's leading whitespace to the requested indent style,
 * preserving the same visual column width. Only touches indentation —
 * whitespace elsewhere on a line (inside strings, alignment, etc.) is left
 * alone.
 */
export function normalizeIndentation(text: string, style: IndentStyle, tabSize: number): string {
  return text
    .split('\n')
    .map((line) => {
      const match = line.match(/^[\t ]*/);
      const leading = match ? match[0] : '';
      if (leading.length === 0) {
        return line;
      }
      const width = leadingWhitespaceWidth(leading, tabSize);
      return buildIndent(width, style, tabSize) + line.slice(leading.length);
    })
    .join('\n');
}
