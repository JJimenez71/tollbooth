import { diffLines, Change } from 'diff';
import { DiffOptions, DiffStats, Hunk, LineRange, SizeGuardConfig } from './types';

const DEFAULT_OPTIONS: DiffOptions = { contextLines: 2 };

interface MergedBlock {
  removed: Change | null;
  added: Change | null;
}

type WalkBlock = { kind: 'context'; change: Change } | { kind: 'change'; merged: MergedBlock };

/**
 * Group diffLines() output into context blocks and changed blocks, merging an
 * adjacent removed+added pair (a "replace") into a single changed block so a
 * modified line reads as one hunk rather than a delete followed by an insert.
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
    const removed = change.removed ? change : null;
    const added = change.removed ? null : change;
    const next = changes[i + 1];
    if (removed && next && next.added) {
      blocks.push({ kind: 'change', merged: { removed, added: next } });
      i += 2;
    } else {
      blocks.push({ kind: 'change', merged: { removed, added } });
      i += 1;
    }
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

    const { removed, added } = block.merged;
    const removedCount = removed?.count ?? 0;
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
      originalText: removed?.value ?? '',
      targetText: added?.value ?? '',
    };

    hunks.push(hunk);
    totalChangedLines += (removed?.count ?? 0) + (added?.count ?? 0);
    originalLineIndex += removedCount;
  }

  const stats: DiffStats = {
    totalOriginalLines,
    totalChangedLines,
    changedRatio: totalOriginalLines === 0 ? (totalChangedLines > 0 ? 1 : 0) : totalChangedLines / totalOriginalLines,
  };

  return { hunks, stats };
}

export function exceedsSizeThreshold(stats: DiffStats, config: SizeGuardConfig): boolean {
  return stats.changedRatio > config.maxChangedLinesRatio || stats.totalChangedLines > config.maxChangedLines;
}
