import { CharState, backspace, initTypingState, isComplete, typeChar, TypingState } from './typingEngine';
import { HostToWebviewMessage, LoadHunkPayload, WebviewToHostMessage } from '../types';

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHostMessage): void };

const vscode = acquireVsCodeApi();

const editorScroll = document.getElementById('editor-scroll') as HTMLDivElement;
const contextBeforeEl = document.getElementById('context-before') as HTMLPreElement;
const contextAfterEl = document.getElementById('context-after') as HTMLPreElement;
const targetEl = document.getElementById('hunk-target') as HTMLDivElement;
const progressEl = document.getElementById('progress') as HTMLSpanElement;
const filePathEl = document.getElementById('file-path') as HTMLSpanElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const cancelButton = document.getElementById('cancel-button') as HTMLButtonElement;
const skipButton = document.getElementById('skip-button') as HTMLButtonElement;
const completeScreen = document.getElementById('complete-screen') as HTMLDivElement;
const mainView = document.querySelector('.editor-scroll') as HTMLElement;
const toolbar = document.querySelector('.toolbar') as HTMLElement;

let current: LoadHunkPayload | null = null;
let typing: TypingState = initTypingState('');

function loadHunk(payload: LoadHunkPayload): void {
  current = payload;
  typing = initTypingState(payload.hunk.targetText);
  contextBeforeEl.textContent = payload.hunk.contextBefore;
  contextAfterEl.textContent = payload.hunk.contextAfter;
  filePathEl.textContent = payload.hunk.filePath;
  filePathEl.title = payload.hunk.filePath;
  progressEl.textContent = `Hunk ${payload.index + 1} of ${payload.total}`;
  statusEl.textContent = 'Type the highlighted text exactly as shown. Mistakes must be corrected before you can continue.';
  render();
  editorScroll.focus();
}

function render(): void {
  if (!current) return;
  const target = typing.targetText;

  if (target.length === 0) {
    targetEl.innerHTML = '';
    const emptyNote = document.createElement('span');
    emptyNote.className = 'char pending';
    emptyNote.textContent = '(deletion — nothing to type)';
    targetEl.appendChild(emptyNote);
    return;
  }

  const frag = document.createDocumentFragment();
  for (let i = 0; i < target.length; i++) {
    const span = document.createElement('span');
    const state: CharState = typing.charStates[i];
    span.className = i === typing.cursorIndex ? `char ${state} cursor` : `char ${state}`;
    span.textContent = target[i];
    frag.appendChild(span);
  }
  targetEl.innerHTML = '';
  targetEl.appendChild(frag);
}

function handleChar(ch: string): void {
  if (!current) return;
  typing = typeChar(typing, ch);
  render();
  if (isComplete(typing)) {
    finishHunk();
  }
}

function handleBackspace(): void {
  if (!current) return;
  typing = backspace(typing);
  render();
}

function finishHunk(): void {
  if (!current) return;
  statusEl.textContent = 'Applying…';
  vscode.postMessage({ type: 'hunkComplete', payload: { hunkId: current.hunk.id } });
}

function showSessionComplete(): void {
  toolbar.hidden = true;
  mainView.hidden = true;
  statusEl.hidden = true;
  completeScreen.hidden = false;
}

editorScroll.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return;
  }
  if (e.key === 'Backspace') {
    e.preventDefault();
    handleBackspace();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    handleChar('\n');
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    handleChar('\t');
    return;
  }
  if (e.key.length === 1) {
    e.preventDefault();
    handleChar(e.key);
    return;
  }
});

editorScroll.addEventListener('paste', (e: ClipboardEvent) => {
  e.preventDefault();
});

editorScroll.addEventListener('click', () => editorScroll.focus());

cancelButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'cancelSession' });
});

skipButton.addEventListener('click', () => {
  if (!current) return;
  statusEl.textContent = 'Applying…';
  vscode.postMessage({ type: 'skipHunk', payload: { hunkId: current.hunk.id } });
});

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'loadHunk':
      loadHunk(message.payload);
      break;
    case 'sessionComplete':
      showSessionComplete();
      break;
  }
});

vscode.postMessage({ type: 'ready' });
