export interface LineRange {
  /** 0-based, inclusive line index where this range starts, against the ORIGINAL document. */
  startLine: number;
  /** 0-based, exclusive line index where this range ends, against the ORIGINAL document. */
  endLine: number;
}

export interface Hunk {
  id: string;
  filePath: string;
  originalRange: LineRange;
  contextBefore: string;
  contextAfter: string;
  originalText: string;
  targetText: string;
}

export interface DiffStats {
  totalOriginalLines: number;
  totalChangedLines: number;
  changedRatio: number;
}

export interface DiffOptions {
  contextLines: number;
}

export interface ReviewSession {
  sessionId: string;
  filePath: string;
  originalDocumentVersion: number;
  hunks: Hunk[];
  currentHunkIndex: number;
}

export interface SizeGuardConfig {
  maxChangedLinesRatio: number;
  maxChangedLines: number;
}

/**
 * context: unchanged code. accepted: a change already reviewed this session.
 * removed: an original line the current change deletes. pending: original
 * code a later change in this session will modify.
 */
export type ViewRowKind = 'context' | 'accepted' | 'removed' | 'pending';

export interface ViewRow {
  kind: ViewRowKind;
  /** Line number in the file as it reads once the current change is accepted; null for removed lines. */
  lineNumber: number | null;
  text: string;
}

/** The whole file, split around the lines currently being typed. */
export interface FileView {
  before: ViewRow[];
  targetFirstLineNumber: number;
  after: ViewRow[];
}

export interface LoadHunkPayload {
  hunk: Hunk;
  index: number;
  total: number;
  view: FileView;
  tabSize: number;
}

export type HostToWebviewMessage =
  | { type: 'loadHunk'; payload: LoadHunkPayload }
  | { type: 'sessionComplete' };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'hunkComplete'; payload: { hunkId: string } }
  | { type: 'skipHunk'; payload: { hunkId: string } }
  | { type: 'cancelSession' };

export type AiProviderName = 'anthropic' | 'openai';

export type IndentStyle = 'tabs' | 'spaces';
