export type CharState = 'pending' | 'correct' | 'incorrect';

export interface TypingState {
  targetText: string;
  cursorIndex: number;
  charStates: CharState[];
}

export function initTypingState(targetText: string): TypingState {
  return {
    targetText,
    cursorIndex: 0,
    charStates: new Array(targetText.length).fill('pending'),
  };
}

export function isComplete(state: TypingState): boolean {
  return state.cursorIndex >= state.targetText.length;
}

/**
 * Applies one typed character. A correct match advances the cursor; a
 * mismatch marks the current character incorrect and holds the cursor in
 * place, forcing the user to produce the right character before continuing.
 *
 * Special case: pressing Enter on a blank (whitespace-only) line completes
 * that whole line and moves to the next one. AI output often pads "empty"
 * lines with invisible trailing whitespace the user has no way to see or
 * blindly type, so exact-match enforcement is waived for that span only —
 * it never applies to a line that has real content.
 */
export function typeChar(state: TypingState, ch: string): TypingState {
  if (isComplete(state)) {
    return state;
  }

  if (ch === '\n') {
    const lineEnd = nextNewlineIndex(state.targetText, state.cursorIndex);
    const restOfLine = state.targetText.slice(state.cursorIndex, lineEnd);
    if (/^[ \t]*$/.test(restOfLine)) {
      const charStates = state.charStates.slice();
      const newCursor = lineEnd < state.targetText.length ? lineEnd + 1 : lineEnd;
      for (let i = state.cursorIndex; i < newCursor; i++) {
        charStates[i] = 'correct';
      }
      return { ...state, charStates, cursorIndex: newCursor };
    }
  }

  const charStates = state.charStates.slice();
  if (ch === state.targetText[state.cursorIndex]) {
    charStates[state.cursorIndex] = 'correct';
    return { ...state, charStates, cursorIndex: state.cursorIndex + 1 };
  }
  charStates[state.cursorIndex] = 'incorrect';
  return { ...state, charStates };
}

function nextNewlineIndex(text: string, from: number): number {
  const idx = text.indexOf('\n', from);
  return idx === -1 ? text.length : idx;
}

/**
 * Backspace first cancels an in-place incorrect attempt (the cursor never
 * advanced past it); only once the current slot is clean does it step the
 * cursor back and clear the character it lands on.
 */
export function backspace(state: TypingState): TypingState {
  if (state.cursorIndex < state.charStates.length && state.charStates[state.cursorIndex] === 'incorrect') {
    const charStates = state.charStates.slice();
    charStates[state.cursorIndex] = 'pending';
    return { ...state, charStates };
  }
  if (state.cursorIndex > 0) {
    const charStates = state.charStates.slice();
    const newIndex = state.cursorIndex - 1;
    charStates[newIndex] = 'pending';
    return { ...state, charStates, cursorIndex: newIndex };
  }
  return state;
}
