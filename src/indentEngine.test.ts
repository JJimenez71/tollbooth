import { buildIndent, detectIndentStyle, detectIndentUnit, indentWidth } from './indentEngine';

describe('detectIndentStyle', () => {
  it('detects spaces', () => {
    expect(detectIndentStyle(['function f() {', '  return 1;', '}'])).toBe('spaces');
  });

  it('detects tabs', () => {
    expect(detectIndentStyle(['function f() {', '\treturn 1;', '}'])).toBe('tabs');
  });

  it('returns null when nothing is indented, so the user setting can apply', () => {
    expect(detectIndentStyle(['const a = 1;', '', 'const b = 2;'])).toBeNull();
  });

  it('ignores block-comment continuation lines', () => {
    expect(detectIndentStyle(['/**', ' * doc', ' */', 'function f() {', '\treturn 1;', '}'])).toBe('tabs');
  });
});

describe('detectIndentUnit', () => {
  it('finds a 2-space unit', () => {
    expect(detectIndentUnit(['a {', '  b {', '    c;', '  }', '}'], 4)).toBe(2);
  });

  it('finds a 4-space unit', () => {
    expect(detectIndentUnit(['a {', '    b {', '        c;', '    }', '}'], 2)).toBe(4);
  });

  it('measures tabs in columns of tabSize', () => {
    expect(detectIndentUnit(['a {', '\tb;', '}'], 4)).toBe(4);
  });

  it('is not fooled by JSDoc continuation lines', () => {
    expect(detectIndentUnit(['/**', ' * a', ' * b', ' */', 'f() {', '  x;', '}'], 4)).toBe(2);
  });

  it('returns null with no indentation evidence', () => {
    expect(detectIndentUnit(['a;', 'b;'], 4)).toBeNull();
  });
});

describe('indentWidth / buildIndent', () => {
  it('counts tabs as tabSize columns', () => {
    expect(indentWidth('\t  ', 4)).toBe(6);
  });

  it('builds tab indentation with a space remainder', () => {
    expect(buildIndent(6, 'tabs', 4)).toBe('\t  ');
  });

  it('builds space indentation', () => {
    expect(buildIndent(4, 'spaces', 4)).toBe('    ');
  });

  it('returns empty for zero or negative widths', () => {
    expect(buildIndent(0, 'tabs', 4)).toBe('');
    expect(buildIndent(-2, 'spaces', 4)).toBe('');
  });
});
