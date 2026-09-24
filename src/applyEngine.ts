import * as vscode from 'vscode';
import { applyEditsToText, hunksToEdits } from './hunkApply';
import { Hunk } from './types';

export interface ApplyResult {
  success: boolean;
  reason?: 'stale' | 'edit-rejected';
}

/**
 * Writes every accepted hunk to the document in a single WorkspaceEdit, then
 * selects the changed span. Nothing is written if the document's text differs
 * at all from `originalText` (the snapshot every hunk's line range was
 * computed against) — the user may have edited the file mid-session (§7).
 */
export async function applyAllHunks(document: vscode.TextDocument, originalText: string, hunks: Hunk[]): Promise<ApplyResult> {
  const live = await vscode.workspace.openTextDocument(document.uri);
  if (live.getText() !== originalText) {
    return { success: false, reason: 'stale' };
  }

  const edits = hunksToEdits(originalText, hunks);
  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of edits) {
    workspaceEdit.replace(live.uri, new vscode.Range(live.positionAt(edit.start), live.positionAt(edit.end)), edit.text);
  }
  if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
    return { success: false, reason: 'edit-rejected' };
  }

  const { changedStart, changedEnd } = applyEditsToText(originalText, edits);
  const editor = await vscode.window.showTextDocument(live, { preserveFocus: false });
  const written = new vscode.Range(live.positionAt(changedStart), live.positionAt(changedEnd));
  editor.selection = new vscode.Selection(written.start, written.end);
  editor.revealRange(written, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

  return { success: true };
}
