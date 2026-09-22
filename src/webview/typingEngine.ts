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
 */
export function typeChar(state: TypingState, ch: string): TypingState {
  if (isComplete(state)) {
    return state;
  }
  const charStates = state.charStates.slice();
  if (ch === state.targetText[state.cursorIndex]) {
    charStates[state.cursorIndex] = 'correct';
    return { ...state, charStates, cursorIndex: state.cursorIndex + 1 };
  }
  charStates[state.cursorIndex] = 'incorrect';
  return { ...state, charStates };
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
