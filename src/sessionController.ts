import * as vscode from 'vscode';
import { applyHunk } from './applyEngine';
import { diffToHunks, exceedsSizeThreshold } from './diffEngine';
import { Hunk } from './types';
import { TollboothPanel } from './webviewPanel';

export interface SizeGuardSettings {
  maxChangedLinesRatio: number;
  maxChangedLines: number;
}

export interface ReviewFlowOptions {
  contextLines: number;
  sizeGuard: SizeGuardSettings;
}

/**
 * Diffs `newText` against the document's current content and either starts a
 * typing review session, or — if the diff is too large to be a meaningful
 * typing exercise (§5.3/§7) — applies it directly with a notification.
 */
export async function startReviewFlow(
  document: vscode.TextDocument,
  newText: string,
  extensionUri: vscode.Uri,
  options: ReviewFlowOptions
): Promise<void> {
  const originalText = document.getText();
  const { hunks, stats } = diffToHunks(originalText, newText, document.uri.fsPath, { contextLines: options.contextLines });

  if (hunks.length === 0) {
    vscode.window.showInformationMessage('Tollbooth: no changes detected.');
    return;
  }

  if (exceedsSizeThreshold(stats, options.sizeGuard)) {
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(originalText.length));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage('Tollbooth: this change is too large to be a useful typing review, so it was applied directly.');
    return;
  }

  runReviewSession(document, hunks, extensionUri);
}

/**
 * Drives one review session end to end: presents typed hunks in the webview,
 * applies each via WorkspaceEdit on completion, auto-applies pure-deletion
 * hunks with no typing step, and aborts the whole session (per §7) if a
 * staleness check ever fails.
 *
 * `topToBottomHunks` must be in natural document order; this walks them
 * bottom-to-top so an earlier apply never invalidates a later hunk's
 * originalRange (§4's accepted MVP compromise).
 */
export function runReviewSession(document: vscode.TextDocument, topToBottomHunks: Hunk[], extensionUri: vscode.Uri): TollboothPanel {
  const applyOrder = [...topToBottomHunks].reverse();
  const total = applyOrder.length;
  let cursor = 0;

  const panel = TollboothPanel.createOrShow(extensionUri, {
    onHunkComplete: async (hunkId: string) => {
      const hunk = applyOrder[cursor];
      if (!hunk || hunk.id !== hunkId) {
        return;
      }
      const result = await applyHunk(document, hunk);
      if (!result.success) {
        abort(result.reason);
        return;
      }
      cursor++;
      await advance();
    },
    onCancel: () => {
      panel.dispose();
    },
  });

  function abort(reason: ApplyFailureReason | undefined): void {
    vscode.window.showWarningMessage(`Tollbooth: session ended — ${describeFailure(reason)}`);
    panel.dispose();
  }

  async function advance(): Promise<void> {
    while (cursor < total) {
      const hunk = applyOrder[cursor];
      if (hunk.targetText.length === 0) {
        const result = await applyHunk(document, hunk);
        if (!result.success) {
          abort(result.reason);
          return;
        }
        cursor++;
        continue;
      }
      panel.loadHunk({ hunk, index: cursor, total });
      return;
    }
    panel.sessionComplete();
  }

  void advance();
  return panel;
}

type ApplyFailureReason = 'stale' | 'edit-rejected';

function describeFailure(reason: ApplyFailureReason | undefined): string {
  if (reason === 'stale') {
    return 'the file changed elsewhere since this session started.';
  }
  return 'the edit could not be applied.';
}
