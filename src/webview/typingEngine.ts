/** skipped: leading indentation filled in automatically (skip mode), not typed. */
export type CharState = 'pending' | 'correct' | 'incorrect' | 'skipped';

export interface TypingOptions {
  /** Columns a tab character occupies (tab stops every tabSize columns). */
  tabSize: number;
  /** Columns in one indentation level; one Tab press in leading indentation covers this many spaces. */
  indentUnit: number;
  /** Fill in each line's leading indentation automatically instead of having it typed. */
  skipIndentation: boolean;
}

const DEFAULT_OPTIONS: TypingOptions = { tabSize: 4, indentUnit: 4, skipIndentation: false };

export interface TypingState {
  targetText: string;
  cursorIndex: number;
  charStates: CharState[];
  options: TypingOptions;
}

export function initTypingState(targetText: string, options: Partial<TypingOptions> = {}): TypingState {
  return skipIndentation({
    targetText,
    cursorIndex: 0,
    charStates: new Array(targetText.length).fill('pending'),
    options: { ...DEFAULT_OPTIONS, ...options },
  });
}

export function isComplete(state: TypingState): boolean {
  return state.cursorIndex >= state.targetText.length;
}

function lineStartOf(text: string, index: number): number {
  let i = index;
  while (i > 0 && text[i - 1] !== '\n') i--;
  return i;
}

function indentEndOf(text: string, lineStart: number): number {
  let i = lineStart;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

/** True when `index` is a whitespace character in its line's leading indentation. */
function isInLeadingIndent(text: string, index: number): boolean {
  return index < indentEndOf(text, lineStartOf(text, index));
}

function visualColumn(text: string, from: number, to: number, tabSize: number): number {
  let column = 0;
  for (let i = from; i < to; i++) {
    column = text[i] === '\t' ? column + tabSize - (column % tabSize) : column + 1;
  }
  return column;
}

/**
 * Indices of indentation spaces past a line's last whole indent level: spacing
 * that doesn't come out to whole tabs, such as 6 spaces with a 4-column unit,
 * or the single space before a JSDoc " * ". Spaces anywhere else are ordinary.
 */
export function oddIndentSpaces(text: string, tabSize: number, indentUnit: number): Set<number> {
  const result = new Set<number>();
  const unit = Math.max(1, indentUnit);
  let lineStart = 0;
  for (;;) {
    const end = indentEndOf(text, lineStart);
    const wholeLevels = Math.floor(visualColumn(text, lineStart, end, tabSize) / unit) * unit;
    let column = 0;
    for (let i = lineStart; i < end; i++) {
      if (text[i] === ' ' && column >= wholeLevels) result.add(i);
      column = text[i] === '\t' ? column + tabSize - (column % tabSize) : column + 1;
    }
    const newline = text.indexOf('\n', lineStart);
    if (newline === -1) return result;
    lineStart = newline + 1;
  }
}

function advance(state: TypingState, to: number, mark: CharState): TypingState {
  const charStates = state.charStates.slice();
  for (let i = state.cursorIndex; i < to; i++) charStates[i] = mark;
  return { ...state, charStates, cursorIndex: to };
}

/**
 * In skip mode, moves the cursor past leading indentation it's sitting in.
 * Whitespace that runs to the very end of the text is left to be typed, so a
 * change is never completed without a keystroke.
 */
function skipIndentation(state: TypingState): TypingState {
  const { targetText: text, cursorIndex: cursor } = state;
  if (!state.options.skipIndentation || cursor >= text.length || !isInLeadingIndent(text, cursor)) {
    return state;
  }
  const end = indentEndOf(text, lineStartOf(text, cursor));
  return end < text.length ? advance(state, end, 'skipped') : state;
}

/**
 * Applies one typed character. A correct match advances the cursor; a
 * mismatch marks the current character incorrect and holds the cursor in
 * place, forcing the user to produce the right character before continuing.
 *
 * Exceptions to exact matching, all limited to whitespace:
 * - Enter on a blank (whitespace-only) line completes that line. AI output
 *   often pads "empty" lines with invisible trailing whitespace.
 * - Tab in a line's leading indentation types one indentation level, even
 *   when the file indents with spaces. How indentation is typed never
 *   changes what is written to the file.
 */
export function typeChar(state: TypingState, ch: string): TypingState {
  if (isComplete(state)) {
    return state;
  }
  const text = state.targetText;
  const cursor = state.cursorIndex;

  if (ch === '\n') {
    const lineEnd = nextNewlineIndex(text, cursor);
    if (/^[ \t]*$/.test(text.slice(cursor, lineEnd))) {
      return skipIndentation(advance(state, lineEnd < text.length ? lineEnd + 1 : lineEnd, 'correct'));
    }
  }

  if (ch === '\t' && text[cursor] === ' ' && isInLeadingIndent(text, cursor)) {
    const { tabSize, indentUnit } = state.options;
    const unit = Math.max(1, indentUnit);
    let column = visualColumn(text, lineStartOf(text, cursor), cursor, tabSize);
    const nextStop = (Math.floor(column / unit) + 1) * unit;
    let end = cursor;
    while (end < text.length && text[end] === ' ' && column < nextStop) {
      end++;
      column++;
    }
    return skipIndentation(advance(state, end, 'correct'));
  }

  if (ch === text[cursor]) {
    return skipIndentation(advance(state, cursor + 1, 'correct'));
  }
  const charStates = state.charStates.slice();
  charStates[cursor] = 'incorrect';
  return { ...state, charStates };
}

function nextNewlineIndex(text: string, from: number): number {
  const idx = text.indexOf('\n', from);
  return idx === -1 ? text.length : idx;
}

/**
 * Backspace first cancels an in-place incorrect attempt (the cursor never
 * advanced past it); only once the current slot is clean does it step the
 * cursor back and clear the character it lands on. In skip mode it steps over
 * auto-filled indentation to the end of the previous line in one press.
 */
export function backspace(state: TypingState): TypingState {
  const { targetText: text, cursorIndex: cursor } = state;
  if (cursor < state.charStates.length && state.charStates[cursor] === 'incorrect') {
    const charStates = state.charStates.slice();
    charStates[cursor] = 'pending';
    return { ...state, charStates };
  }
  if (cursor === 0) {
    return state;
  }
  let newIndex = cursor - 1;
  if (state.options.skipIndentation && state.charStates[newIndex] === 'skipped') {
    const lineStart = lineStartOf(text, newIndex);
    if (lineStart === 0) {
      return state;
    }
    newIndex = lineStart - 1;
  }
  const charStates = state.charStates.slice();
  for (let i = newIndex; i < cursor; i++) charStates[i] = 'pending';
  return { ...state, charStates, cursorIndex: newIndex };
}
