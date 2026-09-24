import * as vscode from 'vscode';
import * as fs from 'fs';
import { HostToWebviewMessage, LoadHunkPayload, WebviewToHostMessage } from './types';

export interface TollboothPanelCallbacks {
  onHunkComplete(hunkId: string): void;
  onSkipHunk(hunkId: string): void;
  onCancel(): void;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class TollboothPanel {
  public static currentPanel: TollboothPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly callbacks: TollboothPanelCallbacks;
  private ready = false;
  private pendingMessage: HostToWebviewMessage | undefined;

  public static createOrShow(extensionUri: vscode.Uri, callbacks: TollboothPanelCallbacks): TollboothPanel {
    if (TollboothPanel.currentPanel) {
      TollboothPanel.currentPanel.dispose();
    }
    const panel = vscode.window.createWebviewPanel('tollbooth', 'Tollbooth: Review Changes', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'media')],
    });
    const instance = new TollboothPanel(panel, extensionUri, callbacks);
    TollboothPanel.currentPanel = instance;
    return instance;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, callbacks: TollboothPanelCallbacks) {
    this.panel = panel;
    this.callbacks = callbacks;
    this.panel.webview.html = this.buildHtml(extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => this.handleMessage(message), null, this.disposables);
  }

  public loadHunk(payload: LoadHunkPayload): void {
    this.post({ type: 'loadHunk', payload });
  }

  public sessionComplete(): void {
    this.post({ type: 'sessionComplete' });
  }

  public dispose(): void {
    if (TollboothPanel.currentPanel === this) {
      TollboothPanel.currentPanel = undefined;
    }
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }

  private post(message: HostToWebviewMessage): void {
    if (!this.ready) {
      this.pendingMessage = message;
      return;
    }
    this.panel.webview.postMessage(message);
  }

  private handleMessage(message: WebviewToHostMessage): void {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        if (this.pendingMessage) {
          const toSend = this.pendingMessage;
          this.pendingMessage = undefined;
          this.panel.webview.postMessage(toSend);
        }
        break;
      case 'hunkComplete':
        this.callbacks.onHunkComplete(message.payload.hunkId);
        break;
      case 'skipHunk':
        this.callbacks.onSkipHunk(message.payload.hunkId);
        break;
      case 'cancelSession':
        this.callbacks.onCancel();
        break;
    }
  }

  private buildHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const mediaRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'media');
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'panel.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'panel.js'));
    const nonce = getNonce();

    const htmlPath = vscode.Uri.joinPath(mediaRoot, 'panel.html');
    const bytes = fs.readFileSync(htmlPath.fsPath, 'utf8');

    return bytes
      .replace(/{{cspSource}}/g, webview.cspSource)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{styleUri}}/g, styleUri.toString())
      .replace(/{{scriptUri}}/g, scriptUri.toString());
  }
}
