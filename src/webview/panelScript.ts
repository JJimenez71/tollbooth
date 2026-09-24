import { backspace, initTypingState, isComplete, typeChar, TypingState } from './typingEngine';
import { HostToWebviewMessage, LoadHunkPayload, ViewRow, WebviewToHostMessage } from '../types';

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHostMessage): void };

const vscode = acquireVsCodeApi();

const editorScroll = document.getElementById('editor-scroll') as HTMLDivElement;
const codeEl = document.getElementById('code') as HTMLDivElement;
const rowsBeforeEl = document.getElementById('rows-before') as HTMLDivElement;
const targetEl = document.getElementById('hunk-target') as HTMLDivElement;
const rowsAfterEl = document.getElementById('rows-after') as HTMLDivElement;
const progressEl = document.getElementById('progress') as HTMLSpanElement;
const filePathEl = document.getElementById('file-path') as HTMLSpanElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const cancelButton = document.getElementById('cancel-button') as HTMLButtonElement;
const skipButton = document.getElementById('skip-button') as HTMLButtonElement;
const completeScreen = document.getElementById('complete-screen') as HTMLDivElement;
const toolbar = document.querySelector('.toolbar') as HTMLElement;

let current: LoadHunkPayload | null = null;
let typing: TypingState = initTypingState('');
let submitted = false;

// Typing only verifies attention; the host writes its own copy of the text
// (with the file's real line endings), so CRLF can be simplified here.
function forDisplay(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function isDeletion(): boolean {
  return current !== null && typing.targetText.length === 0;
}

function makeRow(kind: string, lineNumber: number | null, content: string | Node): HTMLDivElement {
  const row = document.createElement('div');
  row.className = `row ${kind}`;
  const ln = document.createElement('span');
  ln.className = 'ln';
  ln.textContent = lineNumber === null ? '' : String(lineNumber);
  const src = document.createElement('span');
  src.className = 'src';
  if (typeof content === 'string') {
    src.textContent = content;
  } else {
    src.appendChild(content);
  }
  row.append(ln, src);
  return row;
}

function renderRows(container: HTMLElement, rows: ViewRow[]): void {
  const frag = document.createDocumentFragment();
  for (const row of rows) {
    frag.appendChild(makeRow(row.kind, row.lineNumber, row.text));
  }
  container.replaceChildren(frag);
}

function lastLineNumber(payload: LoadHunkPayload): number {
  const numbered = [...payload.view.before, ...payload.view.after].map((r) => r.lineNumber ?? 0);
  const targetLines = forDisplay(payload.hunk.targetText).split('\n').length;
  return Math.max(payload.view.targetFirstLineNumber + targetLines, ...numbered);
}

function loadHunk(payload: LoadHunkPayload): void {
  current = payload;
  submitted = false;
  typing = initTypingState(forDisplay(payload.hunk.targetText));

  codeEl.style.setProperty('tab-size', String(payload.tabSize));
  codeEl.style.setProperty('--gutter-width', `${String(lastLineNumber(payload)).length}ch`);
  renderRows(rowsBeforeEl, payload.view.before);
  renderRows(rowsAfterEl, payload.view.after);

  const path = payload.hunk.filePath;
  filePathEl.textContent = path.split(/[\\/]/).pop() ?? path;
  filePathEl.title = path;
  progressEl.textContent = `Change ${payload.index + 1} of ${payload.total}`;
  statusEl.textContent = isDeletion()
    ? 'The struck-through lines will be removed. Press Enter to confirm.'
    : 'Type the highlighted lines exactly as shown. Mistakes must be corrected before you can continue.';

  renderTarget();
  editorScroll.focus();
  (targetEl.querySelector('.cursor') ?? targetEl).scrollIntoView({ block: 'center', inline: 'nearest' });
}

function renderTarget(): void {
  if (!current) return;
  const target = typing.targetText;
  const firstLine = current.view.targetFirstLineNumber;

  if (target.length === 0) {
    targetEl.replaceChildren(makeRow('target note', null, 'Removal only: press Enter to confirm.'));
    return;
  }

  const rows = document.createDocumentFragment();
  let line = document.createDocumentFragment();
  let rowIndex = 0;
  for (let i = 0; i < target.length; i++) {
    const span = document.createElement('span');
    const isNewline = target[i] === '\n';
    span.className = `char ${typing.charStates[i]}${isNewline ? ' newline' : ''}${i === typing.cursorIndex ? ' cursor' : ''}`;
    span.textContent = isNewline ? '↵' : target[i];
    line.appendChild(span);
    if (isNewline) {
      rows.appendChild(makeRow('target', firstLine + rowIndex, line));
      line = document.createDocumentFragment();
      rowIndex++;
    }
  }
  if (line.childNodes.length > 0) {
    rows.appendChild(makeRow('target', firstLine + rowIndex, line));
  }
  targetEl.replaceChildren(rows);
  targetEl.querySelector('.cursor')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function handleChar(ch: string): void {
  if (!current || submitted) return;
  if (isDeletion()) {
    if (ch === '\n') finishHunk();
    return;
  }
  typing = typeChar(typing, ch);
  renderTarget();
  if (isComplete(typing)) {
    finishHunk();
  }
}

function handleBackspace(): void {
  if (!current || submitted) return;
  typing = backspace(typing);
  renderTarget();
}

function finishHunk(): void {
  if (!current || submitted) return;
  submitted = true;
  statusEl.textContent = current.index + 1 === current.total ? 'Applying all changes…' : 'Accepted.';
  vscode.postMessage({ type: 'hunkComplete', payload: { hunkId: current.hunk.id } });
}

function showSessionComplete(): void {
  toolbar.hidden = true;
  editorScroll.hidden = true;
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
  if (!current || submitted) return;
  submitted = true;
  statusEl.textContent = current.index + 1 === current.total ? 'Applying all changes…' : 'Accepted without typing.';
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
