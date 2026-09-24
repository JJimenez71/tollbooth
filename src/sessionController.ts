import * as vscode from 'vscode';
import { applyAllHunks, ApplyResult } from './applyEngine';
import { diffToHunks, exceedsSizeThreshold } from './diffEngine';
import { buildFileView } from './fileView';
import { placeSnippet, PlacementMode } from './snippetPlacement';
import { Hunk, IndentStyle, LineRange } from './types';
import { TollboothPanel } from './webviewPanel';

export interface SizeGuardSettings {
  maxChangedLinesRatio: number;
  maxChangedLines: number;
}

export interface ReviewFlowOptions {
  contextLines: number;
  sizeGuard: SizeGuardSettings;
  fallbackIndentStyle: IndentStyle;
  tabSize: number;
  mode: PlacementMode;
  selection?: LineRange;
  cursor: { line: number; character: number };
}

/**
 * Places the proposed code into the file (only the region it belongs to can
 * change), diffs the result against the file, and starts a typing review of
 * the resulting hunks.
 */
export async function startReviewFlow(
  document: vscode.TextDocument,
  proposedSource: string,
  extensionUri: vscode.Uri,
  options: ReviewFlowOptions
): Promise<void> {
  const originalText = document.getText();
  const placement = placeSnippet({
    originalText,
    snippetText: proposedSource,
    mode: options.mode,
    selection: options.selection,
    cursor: options.cursor,
    fallbackIndentStyle: options.fallbackIndentStyle,
    tabSize: options.tabSize,
  });
  if (!placement) {
    vscode.window.showErrorMessage('Tollbooth: the proposed text contains no code.');
    return;
  }

  const { hunks, stats } = diffToHunks(originalText, placement.proposedText, document.uri.fsPath, {
    contextLines: options.contextLines,
  });
  if (hunks.length === 0) {
    vscode.window.showInformationMessage('Tollbooth: no changes detected.');
    return;
  }

  if (!placement.anchored) {
    vscode.window.showInformationMessage(
      `Tollbooth: no matching code found, so this will be inserted as new code at line ${placement.region.startLine + 1}. ` +
        'To replace specific code instead, select it before running the command.'
    );
  }

  if (exceedsSizeThreshold(stats, options.sizeGuard)) {
    const choice = await vscode.window.showWarningMessage(
      `Tollbooth: this change touches ${stats.totalChangedLines} lines, too many for a useful typing review. Apply it without typing?`,
      { modal: true },
      'Apply Without Typing'
    );
    if (choice === 'Apply Without Typing') {
      reportFailure(await applyAllHunks(document, originalText, hunks));
    }
    return;
  }

  reviewAndApply(document, originalText, hunks, extensionUri, options.tabSize);
}

/** Review session whose result is written to `document` in one edit at the end. */
export function reviewAndApply(document: vscode.TextDocument, originalText: string, hunks: Hunk[], extensionUri: vscode.Uri, tabSize: number): void {
  runReviewSession({
    originalText,
    hunks,
    extensionUri,
    tabSize,
    onAllAccepted: async (ordered) => {
      const result = await applyAllHunks(document, originalText, ordered);
      reportFailure(result);
      return result.success;
    },
  });
}

export interface ReviewSessionOptions {
  originalText: string;
  hunks: Hunk[];
  extensionUri: vscode.Uri;
  tabSize: number;
  panelTitle?: string;
  /** Runs once every hunk is accepted. Resolve true to show the completion screen, false to close the panel. */
  onAllAccepted: (orderedHunks: Hunk[]) => Promise<boolean>;
  /** Runs if the user cancels or closes the panel before accepting every hunk. */
  onRejected?: () => void;
}

export interface ReviewSession {
  /** Closes the panel without counting as a rejection. */
  close(): void;
}

/**
 * Walks the hunks top-to-bottom. Completing (or skipping) a hunk only records
 * it as accepted; nothing happens to the file until `onAllAccepted`, so
 * cancelling at any point is a no-op on disk.
 */
export function runReviewSession(options: ReviewSessionOptions): ReviewSession {
  const { originalText, tabSize } = options;
  const ordered = [...options.hunks].sort((a, b) => a.originalRange.startLine - b.originalRange.startLine);
  let cursor = 0;
  let settled = false;

  const panel = TollboothPanel.createOrShow(
    options.extensionUri,
    {
      onHunkComplete: (hunkId: string) => void accept(hunkId),
      onSkipHunk: (hunkId: string) => void accept(hunkId),
      onCancel: () => panel.dispose(),
      onDisposed: () => {
        if (!settled) {
          settled = true;
          options.onRejected?.();
        }
      },
    },
    options.panelTitle
  );

  function loadCurrent(): void {
    panel.loadHunk({
      hunk: ordered[cursor],
      index: cursor,
      total: ordered.length,
      view: buildFileView(originalText, ordered, cursor),
      tabSize,
    });
  }

  async function accept(hunkId: string): Promise<void> {
    if (settled || ordered[cursor]?.id !== hunkId) {
      return;
    }
    cursor++;
    if (cursor < ordered.length) {
      loadCurrent();
      return;
    }
    settled = true;
    if (await options.onAllAccepted(ordered)) {
      panel.sessionComplete();
    } else {
      panel.dispose();
    }
  }

  loadCurrent();
  return {
    close: () => {
      settled = true;
      panel.dispose();
    },
  };
}

function reportFailure(result: ApplyResult): void {
  if (result.success) return;
  const why =
    result.reason === 'stale'
      ? 'the file changed while you were reviewing, so nothing was written. Run Tollbooth again on the current file.'
      : 'VS Code rejected the edit, so nothing was written.';
  vscode.window.showWarningMessage(`Tollbooth: ${why}`);
}
