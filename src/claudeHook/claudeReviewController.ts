import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { diffToHunks, exceedsSizeThreshold } from '../diffEngine';
import { ReviewSession, runReviewSession } from '../sessionController';
import { EditProposal, proposeEdit } from './editProposal';
import { hookCommand, mergeHookIntoSettings, settingsHaveHook } from './hookInstaller';
import { ALLOW, DENY, HOOK_SCRIPT_NAME, PASSTHROUGH, ReviewDecision, ReviewRequest, TOLLBOOTH_HOME } from './protocol';
import { ReviewServer } from './reviewServer';

const ENABLED_KEY = 'tollbooth.claudeReviewEnabled';
const INSTALLED_HOOK_SCRIPT = path.join(TOLLBOOTH_HOME, HOOK_SCRIPT_NAME);
const USER_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

interface Job {
  request: ReviewRequest;
  signal: AbortSignal;
  resolve: (decision: ReviewDecision) => void;
}

function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

function readTextOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function candidateSettingsFiles(): string[] {
  const perProject = workspaceFolders().flatMap((f) => [path.join(f, '.claude', 'settings.json'), path.join(f, '.claude', 'settings.local.json')]);
  return [USER_SETTINGS, ...perProject];
}

function isHookInstalled(): boolean {
  return fs.existsSync(INSTALLED_HOOK_SCRIPT) && candidateSettingsFiles().some((file) => settingsHaveHook(readTextOrNull(file)));
}

function copyHookScript(context: vscode.ExtensionContext): void {
  fs.mkdirSync(TOLLBOOTH_HOME, { recursive: true });
  fs.copyFileSync(context.asAbsolutePath(path.join('dist', 'claude-hook.js')), INSTALLED_HOOK_SCRIPT);
}

/** Registers the PreToolUse hook in a Claude Code settings file of the user's choosing. */
export async function installClaudeHook(context: vscode.ExtensionContext): Promise<void> {
  const firstFolder = workspaceFolders()[0];
  const picks: Array<vscode.QuickPickItem & { file: string }> = [
    {
      label: 'All projects',
      description: '~/.claude/settings.json',
      detail: 'Recommended. The hook does nothing unless Tollbooth mode is on in the VS Code window that contains the file.',
      file: USER_SETTINGS,
    },
  ];
  if (firstFolder) {
    picks.push({
      label: 'This project only',
      description: '.claude/settings.local.json (not committed)',
      file: path.join(firstFolder, '.claude', 'settings.local.json'),
    });
  }
  const pick = await vscode.window.showQuickPick(picks, { title: 'Tollbooth: where should the Claude Code hook be installed?' });
  if (!pick) return;

  let merged: string;
  try {
    merged = mergeHookIntoSettings(readTextOrNull(pick.file), hookCommand(process.execPath, INSTALLED_HOOK_SCRIPT));
  } catch (err) {
    vscode.window.showErrorMessage(
      `Tollbooth: couldn't read ${pick.file} as JSON (${(err as Error).message}), so it was left untouched. Fix the file and try again.`
    );
    return;
  }
  copyHookScript(context);
  fs.mkdirSync(path.dirname(pick.file), { recursive: true });
  fs.writeFileSync(pick.file, merged);
  vscode.window.showInformationMessage(
    `Tollbooth: hook installed in ${pick.file}. Start a new Claude Code conversation so it picks up the hook.`
  );
}

/**
 * Tollbooth mode for Claude Code: while on, every Edit/Write Claude Code
 * proposes in this workspace waits (via the PreToolUse hook) until the user
 * retypes it. Accepting tells Claude Code to apply its own edit; cancelling
 * tells Claude the user rejected it. Tollbooth itself never writes the file.
 */
export class ClaudeReviewController implements vscode.Disposable {
  private server: ReviewServer | undefined;
  private readonly queue: Job[] = [];
  private busy = false;
  private readonly statusItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusItem.command = 'tollbooth.toggleClaudeReview';
    this.statusItem.show();
    this.disposables.push(
      this.statusItem,
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.server?.updateFolders(workspaceFolders()))
    );
    this.refreshStatus();

    // Keep an already-installed hook script in step with this extension version.
    if (fs.existsSync(INSTALLED_HOOK_SCRIPT)) {
      try {
        copyHookScript(context);
      } catch {
        // Not fatal: the previous copy keeps working.
      }
    }
    if (context.workspaceState.get<boolean>(ENABLED_KEY)) {
      void this.enable(false);
    }
  }

  async toggle(): Promise<void> {
    if (this.server) {
      this.disable();
    } else {
      await this.enable(true);
    }
  }

  dispose(): void {
    this.server?.stop();
    this.server = undefined;
    this.disposables.forEach((d) => d.dispose());
  }

  private async enable(interactive: boolean): Promise<void> {
    const folders = workspaceFolders();
    if (folders.length === 0) {
      if (interactive) vscode.window.showErrorMessage('Tollbooth: open a folder first. Claude Code edits are matched to this window by workspace folder.');
      return;
    }
    const server = new ReviewServer((request, signal) => this.enqueue(request, signal), folders);
    try {
      await server.start();
    } catch (err) {
      vscode.window.showErrorMessage(`Tollbooth: couldn't start the review listener (${(err as Error).message}).`);
      return;
    }
    this.server = server;
    await this.context.workspaceState.update(ENABLED_KEY, true);
    this.refreshStatus();

    if (!interactive) return;
    if (isHookInstalled()) {
      vscode.window.showInformationMessage('Tollbooth is on: Claude Code edits in this workspace will wait until you retype them.');
    } else {
      const choice = await vscode.window.showWarningMessage(
        "Tollbooth is on, but the Claude Code hook isn't installed, so Claude's edits won't reach Tollbooth yet.",
        'Install Hook'
      );
      if (choice === 'Install Hook') await installClaudeHook(this.context);
    }
  }

  private disable(): void {
    // Closing the server drops every waiting hook connection; their reviews
    // abort and those edits continue through Claude Code's normal flow.
    this.server?.stop();
    this.server = undefined;
    void this.context.workspaceState.update(ENABLED_KEY, false);
    this.refreshStatus();
  }

  private enqueue(request: ReviewRequest, signal: AbortSignal): Promise<ReviewDecision> {
    return new Promise((resolve) => {
      const job: Job = { request, signal, resolve };
      this.queue.push(job);
      signal.addEventListener(
        'abort',
        () => {
          const index = this.queue.indexOf(job);
          if (index !== -1) {
            this.queue.splice(index, 1);
            resolve(PASSTHROUGH);
            this.refreshStatus();
          }
        },
        { once: true }
      );
      this.refreshStatus();
      void this.pump();
    });
  }

  /** Reviews one edit at a time, in arrival order, so edits to the same file stay in sequence. */
  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        this.refreshStatus();
        job.resolve(await this.review(job).catch(() => PASSTHROUGH));
      }
    } finally {
      this.busy = false;
      this.refreshStatus();
    }
  }

  /**
   * An edit Claude Code allowed a moment ago may not be on disk yet when the
   * next queued edit (which builds on it) is dequeued, so briefly retry
   * before concluding old_string really isn't in the file.
   */
  private async propose(request: ReviewRequest, filePath: string): Promise<EditProposal> {
    for (let attempt = 0; ; attempt++) {
      let current: string | null;
      try {
        current = readTextOrNull(filePath);
      } catch {
        return { kind: 'passthrough', reason: 'file unreadable' };
      }
      const proposal = proposeEdit(request.tool_name, request.tool_input, current);
      if (proposal.kind !== 'notFound' || attempt >= 5) return proposal;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  private async review({ request, signal }: Job): Promise<ReviewDecision> {
    const filePath = request.tool_input.file_path;
    if (signal.aborted || typeof filePath !== 'string') return PASSTHROUGH;
    const fileName = path.basename(filePath);

    const proposal = await this.propose(request, filePath);
    if (proposal.kind !== 'review' || signal.aborted) return PASSTHROUGH;

    const config = vscode.workspace.getConfiguration('tollbooth');
    const { hunks, stats } = diffToHunks(proposal.originalText, proposal.proposedText, filePath, {
      contextLines: config.get<number>('contextLines', 2),
    });
    if (hunks.length === 0) return ALLOW;

    const sizeGuard = { maxChangedLinesRatio: config.get<number>('maxChangedLinesRatio', 0.7), maxChangedLines: config.get<number>('maxChangedLines', 400) };
    if (exceedsSizeThreshold(stats, sizeGuard)) {
      const choice = await vscode.window.showWarningMessage(
        `Tollbooth: Claude wants to change ${stats.totalChangedLines} lines in ${fileName}, too many for a useful typing review.`,
        { modal: true },
        'Apply Without Typing',
        'Review Anyway'
      );
      if (signal.aborted) return PASSTHROUGH;
      if (choice === 'Apply Without Typing') return ALLOW;
      if (choice !== 'Review Anyway') return DENY;
    }

    const tabSize = vscode.workspace.getConfiguration('editor', vscode.Uri.file(filePath)).get<number>('tabSize', 4);
    return new Promise<ReviewDecision>((resolve) => {
      let session: ReviewSession | undefined;
      const onAbort = () => {
        session?.close();
        const why = this.server ? 'Claude Code stopped waiting (it timed out or was interrupted)' : 'Tollbooth was turned off';
        vscode.window.showInformationMessage(`Tollbooth: ${why}, so the edit to ${fileName} went through Claude Code's normal approval.`);
        resolve(PASSTHROUGH);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      session = runReviewSession({
        originalText: proposal.originalText,
        hunks,
        extensionUri: this.context.extensionUri,
        tabSize,
        panelTitle: `Tollbooth: ${fileName}${request.agent_type ? ` (${request.agent_type})` : ''}`,
        onAllAccepted: async () => {
          signal.removeEventListener('abort', onAbort);
          resolve(ALLOW);
          return false;
        },
        onRejected: () => {
          signal.removeEventListener('abort', onAbort);
          resolve(DENY);
        },
      });
    });
  }

  private refreshStatus(): void {
    if (!this.server) {
      this.statusItem.text = '$(unlock) Tollbooth: Off';
      this.statusItem.tooltip = 'Claude Code edits apply normally. Click to require retyping them first.';
      return;
    }
    const waiting = this.queue.length + (this.busy ? 1 : 0);
    this.statusItem.text = waiting > 0 ? `$(lock) Tollbooth: ${waiting} waiting` : '$(lock) Tollbooth: On';
    this.statusItem.tooltip = 'Claude Code edits in this workspace wait until you retype them. Click to turn off.';
  }
}
