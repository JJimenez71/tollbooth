import { diffToHunks, exceedsSizeThreshold } from './diffEngine';

const FILE = 'test.ts';

describe('diffToHunks', () => {
  it('produces a single replace hunk for a one-line modification', () => {
    const original = 'line1\nline2\nline3\nline4\nline5';
    const updated = 'line1\nline2\nline3-changed\nline4\nline5';

    const { hunks, stats } = diffToHunks(original, updated, FILE);

    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      filePath: FILE,
      originalRange: { startLine: 2, endLine: 3 },
      contextBefore: 'line1\nline2',
      contextAfter: 'line4\nline5',
      originalText: 'line3\n',
      targetText: 'line3-changed\n',
    });
    expect(stats.totalOriginalLines).toBe(5);
    expect(stats.totalChangedLines).toBe(2);
  });

  it('produces an empty-range insertion hunk with empty originalText', () => {
    const original = 'a\nb\nc';
    const updated = 'a\nb\nNEW\nc';

    const { hunks } = diffToHunks(original, updated, FILE);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].originalRange).toEqual({ startLine: 2, endLine: 2 });
    expect(hunks[0].originalText).toBe('');
    expect(hunks[0].targetText).toBe('NEW\n');
    expect(hunks[0].contextBefore).toBe('a\nb');
    expect(hunks[0].contextAfter).toBe('c');
  });

  it('produces a deletion hunk with empty targetText', () => {
    const original = 'a\nb\nc';
    const updated = 'a\nc';

    const { hunks } = diffToHunks(original, updated, FILE);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].originalRange).toEqual({ startLine: 1, endLine: 2 });
    expect(hunks[0].originalText).toBe('b\n');
    expect(hunks[0].targetText).toBe('');
  });

  it('produces separate hunks for non-contiguous changes, in document order', () => {
    const original = 'a\nb\nc\nd\ne\nf\ng';
    const updated = 'a\nB\nc\nd\ne\nF\ng';

    const { hunks, stats } = diffToHunks(original, updated, FILE);

    expect(hunks).toHaveLength(2);
    expect(hunks[0].originalRange).toEqual({ startLine: 1, endLine: 2 });
    expect(hunks[0].originalText).toBe('b\n');
    expect(hunks[0].targetText).toBe('B\n');
    expect(hunks[1].originalRange).toEqual({ startLine: 5, endLine: 6 });
    expect(hunks[1].originalText).toBe('f\n');
    expect(hunks[1].targetText).toBe('F\n');
    expect(stats.totalOriginalLines).toBe(7);
    expect(stats.totalChangedLines).toBe(4);
  });

  it('truncates context to what is available near file boundaries', () => {
    const original = 'first\nsecond\nthird';
    const updated = 'FIRST\nsecond\nthird';

    const { hunks } = diffToHunks(original, updated, FILE);

    expect(hunks[0].contextBefore).toBe('');
    expect(hunks[0].contextAfter).toBe('second\nthird');
  });

  it('respects a custom contextLines option', () => {
    const original = ['1', '2', '3', '4', '5', 'X', '6', '7', '8', '9', '10'].join('\n');
    const updated = original.replace('X', 'CHANGED');

    const { hunks } = diffToHunks(original, updated, FILE, { contextLines: 3 });

    expect(hunks[0].contextBefore).toBe('3\n4\n5');
    expect(hunks[0].contextAfter).toBe('6\n7\n8');
  });

  it('preserves lack of trailing newline on a final-line modification', () => {
    const original = 'a\nb\nc';
    const updated = 'a\nb\nC';

    const { hunks } = diffToHunks(original, updated, FILE);

    expect(hunks[0].originalText).toBe('c');
    expect(hunks[0].targetText).toBe('C');
  });

  it('does not inflate changedRatio to 100% when pasting into an empty file', () => {
    const original = '';
    const updated = 'function insertionSort(arr) {\n  return arr;\n}';

    const { stats } = diffToHunks(original, updated, FILE);

    expect(stats.totalOriginalLines).toBe(0);
    expect(stats.changedRatio).toBe(0);
    expect(exceedsSizeThreshold(stats, { maxChangedLinesRatio: 0.7, maxChangedLines: 400 })).toBe(false);
  });

  it('does not trip the ratio guard on a small file even when most of it changes', () => {
    const original = ['function add(a, b) {', '  let sum = a;', '  sum = sum + b;', '  return sum;', '}'].join('\n');
    const updated = ['function add(a, b) {', '  return a + b;', '}'].join('\n');

    const { stats } = diffToHunks(original, updated, FILE);

    expect(stats.totalOriginalLines).toBe(5);
    expect(stats.changedRatio).toBe(0);
    expect(exceedsSizeThreshold(stats, { maxChangedLinesRatio: 0.7, maxChangedLines: 400 })).toBe(false);
  });

  it('still applies the ratio guard once the file is large enough for a percentage to be meaningful', () => {
    const original = Array.from({ length: 25 }, (_, i) => `line${i}`).join('\n');
    const updated = Array.from({ length: 25 }, (_, i) => (i < 20 ? `CHANGED${i}` : `line${i}`)).join('\n');

    const { stats } = diffToHunks(original, updated, FILE);

    expect(stats.totalOriginalLines).toBe(25);
    expect(stats.changedRatio).toBeGreaterThan(0.7);
    expect(exceedsSizeThreshold(stats, { maxChangedLinesRatio: 0.7, maxChangedLines: 400 })).toBe(true);
  });

  it('handles an empty diff with no hunks', () => {
    const text = 'a\nb\nc';
    const { hunks, stats } = diffToHunks(text, text, FILE);

    expect(hunks).toHaveLength(0);
    expect(stats.totalChangedLines).toBe(0);
  });

  it('assigns stable, ordered hunk ids', () => {
    const original = 'a\nb\nc\nd\ne';
    const updated = 'A\nb\nc\nD\ne';

    const { hunks } = diffToHunks(original, updated, FILE);

    expect(hunks.map((h) => h.id)).toEqual(['h0', 'h1']);
  });
});

describe('exceedsSizeThreshold', () => {
  const config = { maxChangedLinesRatio: 0.7, maxChangedLines: 400 };

  it('returns false for a small, targeted change', () => {
    const stats = { totalOriginalLines: 100, totalChangedLines: 4, changedRatio: 0.04 };
    expect(exceedsSizeThreshold(stats, config)).toBe(false);
  });

  it('returns true when the changed ratio exceeds the configured threshold', () => {
    const stats = { totalOriginalLines: 100, totalChangedLines: 80, changedRatio: 0.8 };
    expect(exceedsSizeThreshold(stats, config)).toBe(true);
  });

  it('returns true when the absolute changed-line count exceeds the configured threshold', () => {
    const stats = { totalOriginalLines: 10000, totalChangedLines: 500, changedRatio: 0.05 };
    expect(exceedsSizeThreshold(stats, config)).toBe(true);
  });
});
