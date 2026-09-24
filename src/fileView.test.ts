import { buildFileView } from './fileView';
import { Hunk } from './types';

function hunk(id: string, startLine: number, endLine: number, targetText: string): Hunk {
  return { id, filePath: 'f', originalRange: { startLine, endLine }, contextBefore: '', contextAfter: '', originalText: '', targetText };
}

const ORIGINAL = 'a\nb\nc\nd\n';
const HUNKS = [hunk('h0', 1, 2, 'B\n'), hunk('h1', 3, 3, 'x\ny\n')];

describe('buildFileView', () => {
  it('shows the whole file around the first change, with its removed line struck and later changes pending', () => {
    const view = buildFileView(ORIGINAL, HUNKS, 0);

    expect(view.before).toEqual([
      { kind: 'context', lineNumber: 1, text: 'a' },
      { kind: 'removed', lineNumber: null, text: 'b' },
    ]);
    expect(view.targetFirstLineNumber).toBe(2);
    expect(view.after).toEqual([
      { kind: 'context', lineNumber: 3, text: 'c' },
      { kind: 'context', lineNumber: 4, text: 'd' },
    ]);
  });

  it('shows earlier changes as accepted and numbers lines as the file will read', () => {
    const view = buildFileView(ORIGINAL, HUNKS, 1);

    expect(view.before).toEqual([
      { kind: 'context', lineNumber: 1, text: 'a' },
      { kind: 'accepted', lineNumber: 2, text: 'B' },
      { kind: 'context', lineNumber: 3, text: 'c' },
    ]);
    expect(view.targetFirstLineNumber).toBe(4);
    expect(view.after).toEqual([{ kind: 'context', lineNumber: 6, text: 'd' }]);
  });

  it('marks original lines a later change will modify as pending', () => {
    const view = buildFileView('a\nb\nc\nd\n', [hunk('h0', 0, 1, 'A\n'), hunk('h1', 2, 3, 'C\n')], 0);
    expect(view.after).toEqual([
      { kind: 'context', lineNumber: 2, text: 'b' },
      { kind: 'pending', lineNumber: 3, text: 'c' },
      { kind: 'context', lineNumber: 4, text: 'd' },
    ]);
  });

  it('a pure deletion occupies no line numbers', () => {
    const view = buildFileView('a\nb\nc\n', [hunk('h0', 1, 2, '')], 0);
    expect(view.before[1]).toEqual({ kind: 'removed', lineNumber: null, text: 'b' });
    expect(view.targetFirstLineNumber).toBe(2);
    expect(view.after).toEqual([{ kind: 'context', lineNumber: 2, text: 'c' }]);
  });

  it('strips CRLF terminators from displayed text', () => {
    const view = buildFileView('a\r\nb\r\n', [hunk('h0', 1, 2, 'B\r\n')], 0);
    expect(view.before).toEqual([
      { kind: 'context', lineNumber: 1, text: 'a' },
      { kind: 'removed', lineNumber: null, text: 'b' },
    ]);
  });
});
