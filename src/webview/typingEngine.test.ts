import { backspace, initTypingState, isComplete, oddIndentSpaces, typeChar } from './typingEngine';

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

  it('lets Enter complete a truly empty line as before (regression)', () => {
    let state = initTypingState('a\n\nb');
    state = typeChar(state, 'a');
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(2);
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(3);
    state = typeChar(state, 'b');
    expect(isComplete(state)).toBe(true);
  });

  it('lets Enter complete a line that is only invisible trailing whitespace', () => {
    let state = initTypingState('a\n   \nb');
    state = typeChar(state, 'a');
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(2);
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(6);
    expect(state.charStates.slice(2, 6)).toEqual(['correct', 'correct', 'correct', 'correct']);
    state = typeChar(state, 'b');
    expect(isComplete(state)).toBe(true);
  });

  it('lets Enter complete a whitespace-only line made of tabs', () => {
    let state = initTypingState('a\n\t\t\nb');
    state = typeChar(state, 'a');
    state = typeChar(state, '\n');
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(5);
  });

  it('does NOT let Enter skip a line that has real content', () => {
    let state = initTypingState('a\nreal content\nb');
    state = typeChar(state, 'a');
    state = typeChar(state, '\n');
    const beforeCursor = state.cursorIndex;
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(beforeCursor);
    expect(state.charStates[beforeCursor]).toBe('incorrect');
  });

  it('requires one Enter per consecutive blank line, not a multi-line skip', () => {
    let state = initTypingState('a\n\n\nb');
    state = typeChar(state, 'a');
    state = typeChar(state, '\n');
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(3);
    expect(isComplete(state)).toBe(false);
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(4);
  });
});

function typeAll(state: ReturnType<typeof initTypingState>, keys: string[]) {
  return keys.reduce((s, k) => typeChar(s, k), state);
}

describe('typingEngine — Tab types one indentation level (default)', () => {
  it('covers one indent level of spaces per Tab press', () => {
    let state = initTypingState('        return x;', { tabSize: 4, indentUnit: 4 });
    state = typeChar(state, '\t');
    expect(state.cursorIndex).toBe(4);
    state = typeChar(state, '\t');
    expect(state.cursorIndex).toBe(8);
    expect(state.charStates.slice(0, 8).every((s) => s === 'correct')).toBe(true);
  });

  it('uses the file indent unit, not the tab size', () => {
    const state = typeChar(initTypingState('    x', { tabSize: 4, indentUnit: 2 }), '\t');
    expect(state.cursorIndex).toBe(2);
  });

  it('after some typed spaces, Tab completes to the next indent stop', () => {
    const state = typeAll(initTypingState('    x', { indentUnit: 4 }), [' ', '\t']);
    expect(state.cursorIndex).toBe(4);
  });

  it('never runs past the indentation into code', () => {
    const state = typeChar(initTypingState('  x', { indentUnit: 4 }), '\t');
    expect(state.cursorIndex).toBe(2);
  });

  it('still matches a real tab character exactly', () => {
    const state = typeChar(initTypingState('\treturn x;', { indentUnit: 4 }), '\t');
    expect(state.cursorIndex).toBe(1);
    expect(state.charStates[0]).toBe('correct');
  });

  it('Space still types single spaces in indentation', () => {
    const state = typeChar(initTypingState('    x'), ' ');
    expect(state.cursorIndex).toBe(1);
  });

  it('applies on every line, not just the first', () => {
    const state = typeAll(initTypingState('a\n    b', { indentUnit: 4 }), ['a', '\n', '\t']);
    expect(state.cursorIndex).toBe(6);
  });

  it('does not accept Tab for spaces in the middle of a line', () => {
    const state = typeAll(initTypingState('a = b'), ['a', '\t']);
    expect(state.cursorIndex).toBe(1);
    expect(state.charStates[1]).toBe('incorrect');
  });
});

describe('typingEngine — skip indentation setting', () => {
  const skip = { skipIndentation: true, indentUnit: 4 };

  it('starts the cursor after the first line indentation', () => {
    const state = initTypingState('    return x;', skip);
    expect(state.cursorIndex).toBe(4);
    expect(state.charStates.slice(0, 4)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
  });

  it('skips the next line indentation after Enter', () => {
    const state = typeAll(initTypingState('a\n\t\tb', skip), ['a', '\n']);
    expect(state.cursorIndex).toBe(4);
    expect(state.charStates[2]).toBe('skipped');
  });

  it('a whitespace-only line still takes one Enter', () => {
    let state = typeAll(initTypingState('a\n   \nb', skip), ['a', '\n']);
    expect(state.cursorIndex).toBe(5);
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(6);
  });

  it('backspace from the first typed character returns to the end of the previous line', () => {
    let state = typeAll(initTypingState('a\n    b', skip), ['a', '\n']);
    expect(state.cursorIndex).toBe(6);
    state = backspace(state);
    expect(state.cursorIndex).toBe(1);
    expect(state.charStates.slice(1, 6).every((s) => s === 'pending')).toBe(true);
    state = typeChar(state, '\n');
    expect(state.cursorIndex).toBe(6);
  });

  it('backspace cannot step into the first line indentation', () => {
    const state = initTypingState('  x', skip);
    expect(backspace(state)).toEqual(state);
  });

  it('never completes a change without a keystroke', () => {
    const state = initTypingState('   ', skip);
    expect(state.cursorIndex).toBe(0);
    expect(isComplete(state)).toBe(false);
  });
});

describe('oddIndentSpaces', () => {
  const marked = (text: string, indentUnit = 4) => [...oddIndentSpaces(text, 4, indentUnit)].sort((a, b) => a - b);

  it('marks nothing for indentation in whole indent levels', () => {
    expect(marked('        return a + b;\n\treturn;')).toEqual([]);
  });

  it('never marks spaces between words', () => {
    expect(marked('const total = a + b;')).toEqual([]);
  });

  it('marks only the leftover spaces past the last whole level', () => {
    expect(marked('      x')).toEqual([4, 5]);
  });

  it('marks the odd space before a JSDoc continuation', () => {
    expect(marked('/**\n * doc\n */')).toEqual([4, 11]);
  });

  it('marks leftover spaces after a tab', () => {
    expect(marked('\t  x')).toEqual([1, 2]);
  });

  it('respects a 2-column indent unit', () => {
    expect(marked('  a\n    b\n   c', 2)).toEqual([12]);
  });
});
