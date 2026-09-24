import { normalizeIndentation } from './indentEngine';

describe('normalizeIndentation', () => {
  it('converts space indentation to tabs', () => {
    const input = 'function f() {\n    return 1;\n}';
    expect(normalizeIndentation(input, 'tabs', 4)).toBe('function f() {\n\treturn 1;\n}');
  });

  it('converts tab indentation to spaces', () => {
    const input = 'function f() {\n\treturn 1;\n}';
    expect(normalizeIndentation(input, 'spaces', 4)).toBe('function f() {\n    return 1;\n}');
  });

  it('handles multiple levels of indentation', () => {
    const input = 'a\n    b\n        c';
    expect(normalizeIndentation(input, 'tabs', 4)).toBe('a\n\tb\n\t\tc');
  });

  it('leaves lines with no leading whitespace untouched', () => {
    const input = 'const x = 1;\nconst y = 2;';
    expect(normalizeIndentation(input, 'tabs', 2)).toBe(input);
  });

  it('preserves a partial indent remainder that does not divide evenly', () => {
    const input = '  a';
    expect(normalizeIndentation(input, 'tabs', 4)).toBe('  a');
  });

  it('does not touch whitespace after the leading indentation', () => {
    const input = '  const x = 1;   // comment';
    expect(normalizeIndentation(input, 'spaces', 2)).toBe(input);
  });

  it('is idempotent when already in the target style', () => {
    const input = '\t\tfoo';
    expect(normalizeIndentation(input, 'tabs', 4)).toBe(input);
  });
});
