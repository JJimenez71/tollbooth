import { diffLines, Change } from 'diff';
import { DiffOptions, DiffStats, Hunk, LineRange, SizeGuardConfig } from './types';

const DEFAULT_OPTIONS: DiffOptions = { contextLines: 2 };

interface MergedBlock {
  removedValue: string;
  removedCount: number;
  addedValue: string;
  addedCount: number;
}

type WalkBlock = { kind: 'context'; change: Change } | { kind: 'change'; merged: MergedBlock };

/**
 * Group diffLines() output into context blocks and changed blocks. Any run of
 * adjacent added/removed chunks (in either order) becomes ONE changed block,
 * so a modified region is a single hunk rather than separate edits that touch
 * at the same position.
 */
function groupChanges(changes: Change[]): WalkBlock[] {
  const blocks: WalkBlock[] = [];
  let i = 0;
  while (i < changes.length) {
    const change = changes[i];
    if (!change.added && !change.removed) {
      blocks.push({ kind: 'context', change });
      i++;
      continue;
    }
    const merged: MergedBlock = { removedValue: '', removedCount: 0, addedValue: '', addedCount: 0 };
    while (i < changes.length && (changes[i].added || changes[i].removed)) {
      const c = changes[i];
      if (c.removed) {
        merged.removedValue += c.value;
        merged.removedCount += c.count ?? 0;
      } else {
        merged.addedValue += c.value;
        merged.addedCount += c.count ?? 0;
      }
      i++;
    }
    blocks.push({ kind: 'change', merged });
  }
  return blocks;
}

function lastNLines(value: string, n: number): string {
  if (n <= 0) return '';
  const lines = splitPreservingCount(value);
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

function firstNLines(value: string, n: number): string {
  if (n <= 0) return '';
  const lines = splitPreservingCount(value);
  return lines.slice(0, n).join('\n');
}

/** Splits a diff chunk's value into individual lines, stripping the trailing
 * empty element `split('\n')` produces when the value ends in a newline. */
function splitPreservingCount(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '' && value.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

export function diffToHunks(
  originalText: string,
  updatedText: string,
  filePath: string,
  options: Partial<DiffOptions> = {}
): { hunks: Hunk[]; stats: DiffStats } {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const changes = diffLines(originalText, updatedText);
  const blocks = groupChanges(changes);

  const hunks: Hunk[] = [];
  let originalLineIndex = 0;
  let totalOriginalLines = 0;
  let totalChangedLines = 0;

  for (const change of changes) {
    if (!change.added) {
      totalOriginalLines += change.count ?? 0;
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.kind === 'context') {
      originalLineIndex += block.change.count ?? 0;
      continue;
    }

    const { removedValue, removedCount, addedValue, addedCount } = block.merged;
    const originalRange: LineRange = {
      startLine: originalLineIndex,
      endLine: originalLineIndex + removedCount,
    };

    const precedingContext = i > 0 && blocks[i - 1].kind === 'context' ? (blocks[i - 1] as { kind: 'context'; change: Change }).change.value : '';
    const followingContext = i < blocks.length - 1 && blocks[i + 1].kind === 'context' ? (blocks[i + 1] as { kind: 'context'; change: Change }).change.value : '';

    const hunk: Hunk = {
      id: `h${hunks.length}`,
      filePath,
      originalRange,
      contextBefore: lastNLines(precedingContext, opts.contextLines),
      contextAfter: firstNLines(followingContext, opts.contextLines),
      originalText: removedValue,
      targetText: addedValue,
    };

    hunks.push(hunk);
    totalChangedLines += removedCount + addedCount;
    originalLineIndex += removedCount;
  }

  // "% of file touched" is meaningless for a small file: rewriting 6 of an 8-line
  // file is 75%, over the default 70% threshold, yet 6 lines is a perfectly
  // reasonable typing exercise. Below this floor, only the absolute
  // maxChangedLines threshold can trigger the size guard's direct-apply bypass.
  const MIN_LINES_FOR_RATIO_GUARD = 20;
  const stats: DiffStats = {
    totalOriginalLines,
    totalChangedLines,
    changedRatio: totalOriginalLines < MIN_LINES_FOR_RATIO_GUARD ? 0 : totalChangedLines / totalOriginalLines,
  };

  return { hunks, stats };
}

export function exceedsSizeThreshold(stats: DiffStats, config: SizeGuardConfig): boolean {
  return stats.changedRatio > config.maxChangedLinesRatio || stats.totalChangedLines > config.maxChangedLines;
}
