import { splitLinesWithTerminators, stripTerminator } from './textLines';
import { FileView, Hunk, ViewRow } from './types';

function plainLines(text: string): string[] {
  return splitLinesWithTerminators(text).map(stripTerminator);
}

/**
 * Lays out the entire file for the typing window while `hunks[currentIndex]`
 * is being typed. Hunks before it are shown as accepted (their new text),
 * hunks after it as pending (their original text), since the session walks
 * hunks top-to-bottom and writes nothing until the end.
 */
export function buildFileView(originalText: string, hunks: Hunk[], currentIndex: number): FileView {
  const original = plainLines(originalText);
  const ordered = [...hunks].sort((a, b) => a.originalRange.startLine - b.originalRange.startLine);
  const before: ViewRow[] = [];
  const after: ViewRow[] = [];
  let rows = before;
  let lineNumber = 1;
  let targetFirstLineNumber = 1;
  let line = 0;

  const pushOriginal = (from: number, to: number, kind: 'context' | 'pending') => {
    for (let i = from; i < to; i++) rows.push({ kind, lineNumber: lineNumber++, text: original[i] });
  };

  ordered.forEach((hunk, k) => {
    const { startLine, endLine } = hunk.originalRange;
    pushOriginal(line, startLine, 'context');
    if (k < currentIndex) {
      for (const text of plainLines(hunk.targetText)) rows.push({ kind: 'accepted', lineNumber: lineNumber++, text });
    } else if (k === currentIndex) {
      for (let i = startLine; i < endLine; i++) rows.push({ kind: 'removed', lineNumber: null, text: original[i] });
      targetFirstLineNumber = lineNumber;
      lineNumber += plainLines(hunk.targetText).length;
      rows = after;
    } else {
      pushOriginal(startLine, endLine, 'pending');
    }
    line = endLine;
  });
  pushOriginal(line, original.length, 'context');

  return { before, targetFirstLineNumber, after };
}
