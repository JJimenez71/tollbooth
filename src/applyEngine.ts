import * as vscode from 'vscode';
import { Hunk } from './types';

export interface ApplyResult {
  success: boolean;
  reason?: 'stale' | 'edit-rejected';
}

/**
 * Applies one hunk to the live document and navigates the editor to what was
 * just written. Re-slices the live document at originalRange immediately
 * before editing and refuses to apply if it no longer matches hunk.originalText
 * — the file may have changed elsewhere since the session started (§7).
 */
export async function applyHunk(document: vscode.TextDocument, hunk: Hunk): Promise<ApplyResult> {
  const range = new vscode.Range(new vscode.Position(hunk.originalRange.startLine, 0), new vscode.Position(hunk.originalRange.endLine, 0));

  const liveText = document.getText(range);
  if (liveText !== hunk.originalText) {
    return { success: false, reason: 'stale' };
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, range, hunk.targetText);
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    return { success: false, reason: 'edit-rejected' };
  }

  const insertedEndOffset = document.offsetAt(range.start) + hunk.targetText.length;
  const insertedEndPosition = document.positionAt(insertedEndOffset);
  const writtenRange = new vscode.Range(range.start, insertedEndPosition);

  const editor = await vscode.window.showTextDocument(document, { preserveFocus: false });
  editor.selection = new vscode.Selection(writtenRange.start, writtenRange.end);
  editor.revealRange(writtenRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

  return { success: true };
}
