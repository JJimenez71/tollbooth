/**
 * Splits text into lines that each keep their own terminator ('\n' or '\r\n');
 * the last line has none if the text doesn't end in a newline. Joining any
 * slice reproduces that exact span of the original text.
 */
export function splitLinesWithTerminators(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

export function stripTerminator(line: string): string {
  return line.replace(/\r?\n$/, '');
}

/** offsets[i] is the character offset where line i starts; offsets[lineCount] is text.length. */
export function lineStartOffsets(text: string): number[] {
  const offsets: number[] = [];
  let start = 0;
  for (const line of splitLinesWithTerminators(text)) {
    offsets.push(start);
    start += line.length;
  }
  offsets.push(text.length);
  return offsets;
}

export function detectEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}
