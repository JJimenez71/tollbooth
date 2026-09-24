import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AiProviderName, Hunk, IndentStyle, LineRange } from './types';
import { reviewAndApply, ReviewFlowOptions, startReviewFlow } from './sessionController';
import { PlacementMode } from './snippetPlacement';
import { createAiClient } from './aiClient';
import { ClaudeReviewController, installClaudeHook } from './claudeHook/claudeReviewController';

function secretKeyFor(provider: AiProviderName): string {
  return `tollbooth.apiKey.${provider}`;
}

async function getOrPromptApiKey(context: vscode.ExtensionContext, provider: AiProviderName): Promise<string | undefined> {
  const existing = await context.secrets.get(secretKeyFor(provider));
  if (existing) {
    return existing;
  }

  const entered = await vscode.window.showInputBox({
    title: `Tollbooth: enter your ${provider} API key`,
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'API key is stored securely via VS Code SecretStorage',
  });
  if (!entered) {
    return undefined;
  }

  await context.secrets.store(secretKeyFor(provider), entered);
  return entered;
}

function selectedLines(editor: vscode.TextEditor): LineRange | undefined {
  const selection = editor.selection;
  if (selection.isEmpty) {
    return undefined;
  }
  const endsAtLineStart = selection.end.character === 0 && selection.end.line > selection.start.line;
  return { startLine: selection.start.line, endLine: endsAtLineStart ? selection.end.line : selection.end.line + 1 };
}

function getReviewFlowOptions(editor: vscode.TextEditor, mode: PlacementMode): ReviewFlowOptions {
  const config = vscode.workspace.getConfiguration('tollbooth');
  const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
  return {
    contextLines: config.get<number>('contextLines', 2),
    sizeGuard: {
      maxChangedLinesRatio: config.get<number>('maxChangedLinesRatio', 0.7),
      maxChangedLines: config.get<number>('maxChangedLines', 400),
    },
    fallbackIndentStyle: config.get<IndentStyle>('indentStyle', 'tabs'),
    tabSize,
    mode,
    selection: mode === 'snippet' ? selectedLines(editor) : undefined,
    cursor: { line: editor.selection.active.line, character: editor.selection.active.character },
  };
}

const DEV_FIXTURE_CONTENT = [
  'function total(items: Item[]): number {',
  '  let sum = 0;',
  '  sum += item.price;',
  '  return sum;',
  '}',
].join('\n');

const HARDCODED_DEV_HUNKS: Hunk[] = [
  {
    id: 'h0',
    filePath: 'tollbooth-dev-example.ts',
    originalRange: { startLine: 2, endLine: 3 },
    contextBefore: 'function total(items: Item[]): number {\n  let sum = 0;',
    contextAfter: '  return sum;\n}',
    originalText: '  sum += item.price;\n',
    targetText: '  sum += item.price * item.quantity;\n',
  },
  {
    id: 'h1',
    filePath: 'tollbooth-dev-example.ts',
    originalRange: { startLine: 5, endLine: 5 },
    contextBefore: '  return sum;\n}',
    contextAfter: '',
    originalText: '',
    targetText: '\nfunction average(items: Item[]): number {\n  return items.length === 0 ? 0 : total(items) / items.length;\n}\n',
  },
];

export function activate(context: vscode.ExtensionContext): void {
  const claudeReview = new ClaudeReviewController(context);
  context.subscriptions.push(
    claudeReview,
    vscode.commands.registerCommand('tollbooth.toggleClaudeReview', () => claudeReview.toggle()),
    vscode.commands.registerCommand('tollbooth.installClaudeHook', () => installClaudeHook(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tollbooth.reviewChangesForCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('Tollbooth: open a file to review changes for.');
        return;
      }

      const clipboardText = await vscode.env.clipboard.readText();
      if (!clipboardText) {
        vscode.window.showErrorMessage('Tollbooth: clipboard is empty. Copy the AI-proposed code first.');
        return;
      }

      await startReviewFlow(editor.document, clipboardText, context.extensionUri, getReviewFlowOptions(editor, 'snippet'));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tollbooth.generateAiReview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('Tollbooth: open a file to review changes for.');
        return;
      }

      const instructions = await vscode.window.showInputBox({
        title: 'Tollbooth: describe the change to make',
        placeHolder: 'e.g. "add input validation to the parseConfig function"',
        ignoreFocusOut: true,
      });
      if (!instructions) {
        return;
      }

      const config = vscode.workspace.getConfiguration('tollbooth');
      const provider = config.get<AiProviderName>('aiProvider', 'anthropic');
      const model = config.get<string>('model', 'claude-sonnet-5');

      const apiKey = await getOrPromptApiKey(context, provider);
      if (!apiKey) {
        return;
      }

      const client = createAiClient(provider, apiKey, model);

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Tollbooth: generating change…' },
        async () => {
          try {
            const rewritten = await client.getRewrittenFile(editor.document.getText(), instructions);
            await startReviewFlow(editor.document, rewritten, context.extensionUri, getReviewFlowOptions(editor, 'fullFile'));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Tollbooth: AI request failed — ${message}`);
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tollbooth.devHardcodedSession', async () => {
      const fixturePath = path.join(os.tmpdir(), 'tollbooth-dev-example.ts');
      fs.writeFileSync(fixturePath, DEV_FIXTURE_CONTENT, 'utf8');

      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath));
      await vscode.window.showTextDocument(document);

      reviewAndApply(document, DEV_FIXTURE_CONTENT, HARDCODED_DEV_HUNKS, context.extensionUri, 2);
    })
  );
}

export function deactivate(): void {}
