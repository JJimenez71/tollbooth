import { diffArrays } from 'diff';
import { buildIndent, detectIndentStyle, detectIndentUnit, indentWidth, leadingWhitespace } from './indentEngine';
import { detectEol, splitLinesWithTerminators, stripTerminator } from './textLines';
import { IndentStyle, LineRange } from './types';

export type PlacementMode = 'snippet' | 'fullFile';

export interface PlacementInput {
  originalText: string;
  snippetText: string;
  /** 'snippet': find where the pasted code belongs; 'fullFile': it replaces the whole file. */
  mode: PlacementMode;
  /** A non-empty editor selection, as whole lines. Overrides automatic matching. */
  selection?: LineRange;
  cursor: { line: number; character: number };
  /** Used only when the file has no indentation to learn from (e.g. an empty file). */
  fallbackIndentStyle: IndentStyle;
  tabSize: number;
}

export interface PlacementResult {
  proposedText: string;
  /** The lines of the ORIGINAL file the snippet replaces (empty range = insertion). */
  region: LineRange;
  /** False when nothing in the file matched and the snippet was inserted as new code. */
  anchored: boolean;
}

const EXACT_SIGNIFICANT = 4;
const EXACT_TRIVIAL = 1;
const SIMILAR = 1;
const MISMATCH = -3;
const GAP = -1;
const SIMILARITY_THRESHOLD = 0.6;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** Blank or bracket/punctuation-only lines match all over a file, so they're weak evidence. */
function isTrivial(trimmed: string): boolean {
  return /^[{}()[\];,]*$/.test(trimmed);
}

/** Cheap edit-similarity: share of characters covered by a common prefix and suffix. */
function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  const minLen = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < minLen && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < minLen - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return (prefix + suffix) / max;
}

function pairScore(fileLine: string, snipLine: string): number {
  if (fileLine === snipLine) {
    return isTrivial(fileLine) ? EXACT_TRIVIAL : EXACT_SIGNIFICANT;
  }
  if (!isTrivial(fileLine) && !isTrivial(snipLine) && similarity(fileLine, snipLine) >= SIMILARITY_THRESHOLD) {
    return SIMILAR;
  }
  return MISMATCH;
}

/**
 * Fitting alignment: aligns the whole snippet against the best-scoring
 * contiguous run of file lines (file lines outside the run are free). Returns
 * that run as the region the snippet should replace.
 */
function bestMatchingRegion(fileKeys: string[], snipKeys: string[]): { region: LineRange; score: number } {
  const S = snipKeys.length;
  let prevScore = new Float64Array(S + 1);
  let prevStart = new Int32Array(S + 1);
  let curScore = new Float64Array(S + 1);
  let curStart = new Int32Array(S + 1);
  for (let j = 0; j <= S; j++) {
    prevScore[j] = j * GAP;
    prevStart[j] = 0;
  }
  let best = { score: prevScore[S], start: 0, end: 0 };

  for (let i = 1; i <= fileKeys.length; i++) {
    curScore[0] = 0;
    curStart[0] = i;
    for (let j = 1; j <= S; j++) {
      const diag = prevScore[j - 1] + pairScore(fileKeys[i - 1], snipKeys[j - 1]);
      const up = prevScore[j] + GAP;
      const left = curScore[j - 1] + GAP;
      if (diag >= up && diag >= left) {
        curScore[j] = diag;
        curStart[j] = prevStart[j - 1];
      } else if (left >= up) {
        curScore[j] = left;
        curStart[j] = curStart[j - 1];
      } else {
        curScore[j] = up;
        curStart[j] = prevStart[j];
      }
    }
    if (curScore[S] > best.score) {
      best = { score: curScore[S], start: curStart[S], end: i };
    }
    [prevScore, curScore] = [curScore, prevScore];
    [prevStart, curStart] = [curStart, prevStart];
  }
  return { region: { startLine: best.start, endLine: best.end }, score: best.score };
}

/** Pairs of (file line index, snippet line index) whose trimmed content is identical. */
function exactPairs(fileKeys: string[], region: LineRange, snipKeys: string[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let fi = region.startLine;
  let si = 0;
  for (const change of diffArrays(fileKeys.slice(region.startLine, region.endLine), snipKeys)) {
    const count = change.count ?? change.value.length;
    if (change.added) {
      si += count;
    } else if (change.removed) {
      fi += count;
    } else {
      for (let k = 0; k < count; k++) pairs.push([fi + k, si + k]);
      fi += count;
      si += count;
    }
  }
  return pairs;
}

const DECLARATION_PATTERNS = [
  /\b(?:function\*?|def|class|fn|func|interface|struct|enum|trait|type)\s+([A-Za-z_$][\w$]*)/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
];

function declaredName(trimmed: string): string | null {
  for (const pattern of DECLARATION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * A snippet that declares a differently-named function/class than the code it
 * best matches is new code that merely resembles existing code (e.g. a
 * near-copy of a sibling function), not a rewrite of it.
 */
function declaresDifferentEntity(fileKeys: string[], region: LineRange, snipKeys: string[]): boolean {
  const firstFile = fileKeys.slice(region.startLine, region.endLine).find((k) => !isTrivial(k));
  const firstSnip = snipKeys.find((k) => !isTrivial(k));
  if (firstFile === undefined || firstSnip === undefined) return false;
  const fileName = declaredName(firstFile);
  const snipName = declaredName(firstSnip);
  return fileName !== null && snipName !== null && fileName !== snipName;
}

function cleanSnippetLines(snippetText: string): string[] {
  const trimBlankEdges = (lines: string[]): string[] => {
    let start = 0;
    let end = lines.length;
    while (start < end && isBlank(lines[start])) start++;
    while (end > start && isBlank(lines[end - 1])) end--;
    return lines.slice(start, end);
  };
  let lines = trimBlankEdges(snippetText.split(/\r?\n/));
  if (lines.length >= 2 && /^\s*```/.test(lines[0]) && /^\s*```\s*$/.test(lines[lines.length - 1])) {
    lines = trimBlankEdges(lines.slice(1, -1));
  }
  return lines;
}

function insertionLine(fileLines: string[], cursor: { line: number; character: number }): number {
  if (cursor.line >= fileLines.length) return fileLines.length;
  const text = fileLines[cursor.line];
  if (!isBlank(text) && cursor.character >= text.length) return cursor.line + 1;
  return cursor.line;
}

/** Indent width new code should start at when inserted before `line`. */
function insertionBaseWidth(fileLines: string[], line: number, unit: number, tabSize: number): number {
  for (let i = line; i < fileLines.length; i++) {
    if (isBlank(fileLines[i])) continue;
    const width = indentWidth(leadingWhitespace(fileLines[i]), tabSize);
    return /^\s*[}\])]/.test(fileLines[i]) ? width + unit : width;
  }
  return 0;
}

export function placeSnippet(input: PlacementInput): PlacementResult | null {
  const { originalText, tabSize } = input;
  const snippetLines = cleanSnippetLines(input.snippetText);
  if (snippetLines.length === 0) return null;

  const rawLines = splitLinesWithTerminators(originalText);
  const fileLines = rawLines.map(stripTerminator);
  const fileKeys = fileLines.map((l) => l.trim());
  const snipKeys = snippetLines.map((l) => l.trim());

  let region: LineRange;
  let anchored: boolean;
  let pairs: Array<[number, number]>;
  if (input.mode === 'fullFile' || input.selection) {
    region = input.mode === 'fullFile' ? { startLine: 0, endLine: fileLines.length } : input.selection!;
    anchored = true;
    pairs = exactPairs(fileKeys, region, snipKeys);
  } else {
    const match = bestMatchingRegion(fileKeys, snipKeys);
    pairs = exactPairs(fileKeys, match.region, snipKeys);
    const significantPairs = pairs.filter(([, si]) => !isTrivial(snipKeys[si])).length;
    anchored = match.score > 0 && significantPairs > 0 && !declaresDifferentEntity(fileKeys, match.region, snipKeys);
    if (anchored) {
      region = match.region;
    } else {
      const at = insertionLine(fileLines, input.cursor);
      region = { startLine: at, endLine: at };
      pairs = [];
    }
  }

  const fileStyle = detectIndentStyle(fileLines) ?? input.fallbackIndentStyle;
  const fileUnit = detectIndentUnit(fileLines, tabSize) ?? tabSize;
  const snipUnit = detectIndentUnit(snippetLines, tabSize) ?? fileUnit;
  const scale = (delta: number) => Math.round((delta * fileUnit) / snipUnit);

  const verbatim = new Map<number, string>();
  const votes = new Map<number, Map<string, number>>();
  for (const [fi, si] of pairs) {
    verbatim.set(si, fileLines[fi]);
    if (isBlank(snippetLines[si])) continue;
    const width = indentWidth(leadingWhitespace(snippetLines[si]), tabSize);
    const indent = leadingWhitespace(fileLines[fi]);
    const forWidth = votes.get(width) ?? new Map<string, number>();
    forWidth.set(indent, (forWidth.get(indent) ?? 0) + 1);
    votes.set(width, forWidth);
  }
  const indentForWidth = new Map<number, string>();
  for (const [width, candidates] of votes) {
    const [indent] = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0];
    indentForWidth.set(width, indent);
  }
  const knownWidths = [...indentForWidth.keys()].sort((a, b) => a - b);

  const snippetWidths = snippetLines.filter((l) => !isBlank(l)).map((l) => indentWidth(leadingWhitespace(l), tabSize));
  const minSnippetWidth = snippetWidths.length ? Math.min(...snippetWidths) : 0;
  const baseWidth = anchored ? 0 : insertionBaseWidth(fileLines, region.startLine, fileUnit, tabSize);

  const reindent = (line: string): string => {
    if (isBlank(line)) return '';
    const width = indentWidth(leadingWhitespace(line), tabSize);
    const content = line.slice(leadingWhitespace(line).length);
    const exact = indentForWidth.get(width);
    if (exact !== undefined) return exact + content;
    let newWidth: number;
    if (knownWidths.length > 0) {
      const reference = [...knownWidths].reverse().find((k) => k <= width) ?? knownWidths[0];
      newWidth = indentWidth(indentForWidth.get(reference)!, tabSize) + scale(width - reference);
    } else {
      newWidth = baseWidth + scale(width - minSnippetWidth);
    }
    return buildIndent(newWidth, fileStyle, tabSize) + content;
  };

  const newLines = snippetLines.map((line, si) => verbatim.get(si) ?? reindent(line));

  const eol = detectEol(originalText);
  const prefix = rawLines.slice(0, region.startLine).join('');
  const suffix = rawLines.slice(region.endLine).join('');
  let body = newLines.join(eol);
  const reachesEof = region.endLine === rawLines.length;
  if (!reachesEof || originalText.endsWith('\n') || originalText.length === 0) {
    body += eol;
  }
  if (prefix.length > 0 && !prefix.endsWith('\n')) {
    body = eol + body;
  }

  return { proposedText: prefix + body + suffix, region, anchored };
}
