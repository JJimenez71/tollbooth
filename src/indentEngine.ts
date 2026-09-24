import { IndentStyle } from './types';

export function leadingWhitespace(line: string): string {
  const match = line.match(/^[\t ]*/);
  return match ? match[0] : '';
}

export function indentWidth(whitespace: string, tabSize: number): number {
  let width = 0;
  for (const ch of whitespace) {
    width += ch === '\t' ? tabSize : 1;
  }
  return width;
}

export function buildIndent(width: number, style: IndentStyle, tabSize: number): string {
  if (width <= 0) {
    return '';
  }
  if (style === 'spaces') {
    return ' '.repeat(width);
  }
  return '\t'.repeat(Math.floor(width / tabSize)) + ' '.repeat(width % tabSize);
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** Block-comment continuation lines (" * foo") are offset by one column by
 * convention and would otherwise masquerade as a 1-space indent unit. */
function isCommentContinuation(line: string): boolean {
  return /^\s*\*/.test(line);
}

/** Returns the style most indented lines use, or null if nothing is indented. */
export function detectIndentStyle(lines: string[]): IndentStyle | null {
  let tabs = 0;
  let spaces = 0;
  for (const line of lines) {
    if (isBlank(line)) continue;
    if (line.startsWith('\t')) tabs++;
    else if (line.startsWith(' ') && !isCommentContinuation(line)) spaces++;
  }
  if (tabs === 0 && spaces === 0) return null;
  return tabs >= spaces ? 'tabs' : 'spaces';
}

/**
 * Infers the width of one indentation level as the most common positive step
 * between consecutive non-blank lines. Returns null when there is no evidence.
 */
export function detectIndentUnit(lines: string[], tabSize: number): number | null {
  const counts = new Map<number, number>();
  let previous: number | null = null;
  for (const line of lines) {
    if (isBlank(line) || isCommentContinuation(line)) continue;
    const width = indentWidth(leadingWhitespace(line), tabSize);
    if (previous !== null && width > previous) {
      const step = width - previous;
      counts.set(step, (counts.get(step) ?? 0) + 1);
    }
    previous = width;
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [step, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && step < best)) {
      best = step;
      bestCount = count;
    }
  }
  return best;
}
