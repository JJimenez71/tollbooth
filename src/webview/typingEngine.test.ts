import { backspace, initTypingState, isComplete, typeChar } from './typingEngine';

describe('typingEngine', () => {
  it('starts with every character pending and cursor at 0', () => {
    const state = initTypingState('abc');
    expect(state.charStates).toEqual(['pending', 'pending', 'pending']);
    expect(state.cursorIndex).toBe(0);
    expect(isComplete(state)).toBe(false);
  });

  it('advances the cursor and marks correct on a matching keystroke', () => {
    let state = initTypingState('abc');
    state = typeChar(state, 'a');
    expect(state.cursorIndex).toBe(1);
    expect(state.charStates).toEqual(['correct', 'pending', 'pending']);
  });

  it('does NOT advance the cursor on a mismatched keystroke (forced correction)', () => {
    let state = initTypingState('abc');
    state = typeChar(state, 'x');
    expect(state.cursorIndex).toBe(0);
    expect(state.charStates).toEqual(['incorrect', 'pending', 'pending']);
  });

  it('cannot be blasted through: repeated wrong keystrokes never advance', () => {
    let state = initTypingState('abc');
    state = typeChar(state, 'x');
    state = typeChar(state, 'y');
    state = typeChar(state, 'z');
    expect(state.cursorIndex).toBe(0);
    expect(isComplete(state)).toBe(false);
  });

  it('recovers after a mismatch once the correct character is typed', () => {
    let state = initTypingState('abc');
    state = typeChar(state, 'x');
    state = typeChar(state, 'a');
    expect(state.cursorIndex).toBe(1);
    expect(state.charStates[0]).toBe('correct');
  });

  it('reaches complete only once every character matches, in order', () => {
    let state = initTypingState('ab');
    state = typeChar(state, 'a');
    expect(isComplete(state)).toBe(false);
    state = typeChar(state, 'b');
    expect(isComplete(state)).toBe(true);
  });

  it('ignores further keystrokes once complete', () => {
    let state = initTypingState('a');
    state = typeChar(state, 'a');
    const after = typeChar(state, 'x');
    expect(after).toEqual(state);
  });

  it('treats a multi-line target\'s embedded newline as an ordinary character to type', () => {
    let state = initTypingState('a\nb');
    state = typeChar(state, 'a');
    state = typeChar(state, '\n');
    state = typeChar(state, 'b');
    expect(isComplete(state)).toBe(true);
    expect(state.charStates).toEqual(['correct', 'correct', 'correct']);
  });

  it('backspace on an incorrect in-place attempt clears it without moving the cursor', () => {
    let state = initTypingState('abc');
    state = typeChar(state, 'x');
    state = backspace(state);
    expect(state.cursorIndex).toBe(0);
    expect(state.charStates).toEqual(['pending', 'pending', 'pending']);
  });

  it('backspace on a clean position steps the cursor back and clears that character', () => {
    let state = initTypingState('abc');
    state = typeChar(state, 'a');
    state = typeChar(state, 'b');
    state = backspace(state);
    expect(state.cursorIndex).toBe(1);
    expect(state.charStates).toEqual(['correct', 'pending', 'pending']);
  });

  it('backspace at the very start is a no-op', () => {
    const state = initTypingState('abc');
    const after = backspace(state);
    expect(after).toEqual(state);
  });

  it('handles an empty target as already complete', () => {
    const state = initTypingState('');
    expect(isComplete(state)).toBe(true);
  });
});
