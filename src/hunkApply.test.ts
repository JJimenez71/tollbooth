import { diffToHunks } from './diffEngine';
import { applyEditsToText, hunksToEdits } from './hunkApply';
import { lineStartOffsets, splitLinesWithTerminators } from './textLines';
import { Hunk } from './types';

function hunk(startLine: number, endLine: number, targetText: string): Hunk {
  return { id: `h${startLine}`, filePath: 'f', originalRange: { startLine, endLine }, contextBefore: '', contextAfter: '', originalText: '', targetText };
}

describe('textLines', () => {
  it('splits lines keeping terminators, including CRLF and a final unterminated line', () => {
    expect(splitLinesWithTerminators('a\r\nb\nc')).toEqual(['a\r\n', 'b\n', 'c']);
    expect(splitLinesWithTerminators('')).toEqual([]);
  });

  it('maps line indices to offsets, with lineCount mapping to the end of the text', () => {
    expect(lineStartOffsets('ab\ncd')).toEqual([0, 3, 5]);
    expect(lineStartOffsets('ab\ncd\n')).toEqual([0, 3, 6]);
    expect(lineStartOffsets('')).toEqual([0]);
  });
});

describe('hunksToEdits / applyEditsToText', () => {
  it('inserts at the true end of a file whose last line has no newline', () => {
    const original = 'a\nb';
    const { text } = applyEditsToText(original, hunksToEdits(original, [hunk(2, 2, '\nc')]));
    expect(text).toBe('a\nb\nc');
  });

  it('applies several hunks against original offsets regardless of input order', () => {
    const original = 'one\ntwo\nthree\nfour\n';
    const edits = hunksToEdits(original, [hunk(3, 4, 'FOUR\n'), hunk(0, 1, 'ONE\n')]);
    expect(applyEditsToText(original, edits).text).toBe('ONE\ntwo\nthree\nFOUR\n');
  });

  it('reports the changed span in the resulting text', () => {
    const original = 'one\ntwo\nthree\n';
    const result = applyEditsToText(original, hunksToEdits(original, [hunk(1, 2, 'TWO!\n')]));
    expect(result.text.slice(result.changedStart, result.changedEnd)).toBe('TWO!\n');
  });

  it('rejects overlapping edits', () => {
    const original = 'a\nb\nc\n';
    expect(() => applyEditsToText(original, hunksToEdits(original, [hunk(0, 2, 'x\n'), hunk(1, 3, 'y\n')]))).toThrow();
  });

  it.each([
    ['modify middle', 'a\nb\nc\n', 'a\nB\nc\n'],
    ['insert at start', 'b\nc\n', 'a\nb\nc\n'],
    ['delete at end', 'a\nb\nc\n', 'a\nb\n'],
    ['append after unterminated last line', 'a\n}', 'a\n}\n\nfunction b() {\n}'],
    ['CRLF modify', 'a\r\nb\r\nc\r\n', 'a\r\nX\r\nY\r\nc\r\n'],
    ['everything changes', 'a\nb\n', 'x\ny\nz'],
    ['from empty', '', 'new\ncode\n'],
    ['to empty', 'old\ncode\n', ''],
  ])('diff hunks rebuild the updated text exactly: %s', (_label, original, updated) => {
    const { hunks } = diffToHunks(original, updated, 'f');
    expect(applyEditsToText(original, hunksToEdits(original, hunks)).text).toBe(updated);
  });
});
