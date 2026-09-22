import { stripCodeFence } from './aiClient';

describe('stripCodeFence', () => {
  it('strips a fenced block with a language tag', () => {
    const input = '```typescript\nconst x = 1;\nconst y = 2;\n```';
    expect(stripCodeFence(input)).toBe('const x = 1;\nconst y = 2;');
  });

  it('strips a fenced block with no language tag', () => {
    const input = '```\nconst x = 1;\n```';
    expect(stripCodeFence(input)).toBe('const x = 1;');
  });

  it('leaves unfenced content untouched aside from trimming', () => {
    const input = '  const x = 1;\nconst y = 2;  ';
    expect(stripCodeFence(input)).toBe('const x = 1;\nconst y = 2;');
  });

  it('does not strip backticks that appear mid-content, only a wrapping fence', () => {
    const input = 'const template = `hello ${name}`;';
    expect(stripCodeFence(input)).toBe(input);
  });
});
