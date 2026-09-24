import { Hunk } from './types';
import { lineStartOffsets } from './textLines';

export interface HunkEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Converts hunks (line ranges against the original text) into character-offset
 * edits against that same original text, sorted top-to-bottom. Offsets are
 * used instead of line/column positions so an insertion after a final line
 * with no trailing newline lands at the true end of the document.
 */
export function hunksToEdits(originalText: string, hunks: Hunk[]): HunkEdit[] {
  const offsets = lineStartOffsets(originalText);
  return [...hunks]
    .sort((a, b) => a.originalRange.startLine - b.originalRange.startLine)
    .map((hunk) => ({
      start: offsets[hunk.originalRange.startLine],
      end: offsets[hunk.originalRange.endLine],
      text: hunk.targetText,
    }));
}

export interface AppliedResult {
  text: string;
  /** Offsets in the resulting text spanning from the first to the last change. */
  changedStart: number;
  changedEnd: number;
}

export function applyEditsToText(originalText: string, edits: HunkEdit[]): AppliedResult {
  let result = '';
  let cursor = 0;
  let changedStart = -1;
  let changedEnd = -1;
  for (const edit of edits) {
    if (edit.start < cursor) {
      throw new Error('Overlapping hunk edits');
    }
    result += originalText.slice(cursor, edit.start);
    if (changedStart === -1) {
      changedStart = result.length;
    }
    result += edit.text;
    changedEnd = result.length;
    cursor = edit.end;
  }
  result += originalText.slice(cursor);
  return {
    text: result,
    changedStart: Math.max(changedStart, 0),
    changedEnd: Math.max(changedEnd, 0),
  };
}
