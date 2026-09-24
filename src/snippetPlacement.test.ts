import { diffToHunks } from './diffEngine';
import { applyEditsToText, hunksToEdits } from './hunkApply';
import { PlacementInput, placeSnippet } from './snippetPlacement';

const DEFAULTS = {
  mode: 'snippet' as const,
  cursor: { line: 0, character: 0 },
  fallbackIndentStyle: 'tabs' as const,
  tabSize: 4,
};

/** Places the snippet, diffs, and asserts the hunks rebuild the proposed text exactly. */
function review(originalText: string, snippetText: string, overrides: Partial<PlacementInput> = {}) {
  const placement = placeSnippet({ ...DEFAULTS, originalText, snippetText, ...overrides });
  if (!placement) throw new Error('placement returned null');
  const { hunks } = diffToHunks(originalText, placement.proposedText, 'f.js');
  const rebuilt = applyEditsToText(originalText, hunksToEdits(originalText, hunks)).text;
  expect(rebuilt).toBe(placement.proposedText);
  return { ...placement, hunks };
}

const GREET = ['function greet(name) {', '    return "Hello, " + name;', '}'];
const INSERTION_SORT = [
  'function insertionSort(arr) {',
  '    for (let i = 1; i < arr.length; i++) {',
  '        let key = arr[i];',
  '        let j = i - 1;',
  '        while (j >= 0 && arr[j] > key) {',
  '            arr[j + 1] = arr[j];',
  '            j--;',
  '        }',
  '        arr[j + 1] = key;',
  '    }',
  '    return arr;',
  '}',
];
const FILE = [...GREET, '', ...INSERTION_SORT, ''].join('\n');

describe('placeSnippet — the reported bug', () => {
  it('pasting only a rewritten function never touches the other function in the file', () => {
    const snippet = [
      'function insertionSort(arr) {',
      '    const result = [...arr];',
      '    for (let i = 1; i < result.length; i++) {',
      '        const key = result[i];',
      '        let j = i - 1;',
      '        while (j >= 0 && result[j] > key) {',
      '            result[j + 1] = result[j];',
      '            j--;',
      '        }',
      '        result[j + 1] = key;',
      '    }',
      '    return result;',
      '}',
    ].join('\n');

    const { anchored, region, hunks, proposedText } = review(FILE, snippet);

    expect(anchored).toBe(true);
    expect(region).toEqual({ startLine: 4, endLine: 16 });
    expect(proposedText.startsWith(GREET.join('\n') + '\n\n')).toBe(true);
    expect(hunks.every((h) => h.originalRange.startLine >= 4)).toBe(true);
    expect(hunks.some((h) => h.originalText.includes('greet'))).toBe(false);
  });

  it('a one-line change pasted with different indentation yields exactly one one-line hunk', () => {
    const twoSpaceSnippet = [
      'function insertionSort(arr) {',
      '  for (let i = 1; i < arr.length; i++) {',
      '    let key = arr[i];',
      '    let j = i - 1;',
      '    while (j >= 0 && arr[j] > key) {',
      '      arr[j + 1] = arr[j];',
      '      j--;',
      '    }',
      '    arr[j + 1] = key;',
      '  }',
      '  return arr.slice();',
      '}',
    ].join('\n');

    const { hunks } = review(FILE, twoSpaceSnippet);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].originalText).toBe('    return arr;\n');
    expect(hunks[0].targetText).toBe('    return arr.slice();\n');
  });

  it('a removed line inside the function is the only deletion — nothing outside it is removed', () => {
    const snippet = INSERTION_SORT.filter((l) => !l.includes('j--')).join('\n');

    const { hunks } = review(FILE, snippet);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].originalText).toBe('            j--;\n');
    expect(hunks[0].targetText).toBe('');
  });
});

describe('placeSnippet — indentation matches the file', () => {
  it('re-indents new lines with tabs in a tab-indented file', () => {
    const file = 'function f() {\n\tconst a = 1;\n\treturn a;\n}\n';
    const snippet = 'function f() {\n    const a = 1;\n    const b = 2;\n    return a;\n}';

    const { hunks } = review(file, snippet);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].targetText).toBe('\tconst b = 2;\n');
  });

  it('re-bases a method copied at column 0 onto its nesting level inside a class', () => {
    const file = ['class Sorter {', '  constructor() {', '    this.count = 0;', '  }', '', '  sort(arr) {', '    return arr.sort();', '  }', '}', ''].join(
      '\n'
    );
    const snippet = 'sort(arr) {\n  this.count++;\n  return arr.sort();\n}';

    const { hunks, region } = review(file, snippet);

    expect(region).toEqual({ startLine: 5, endLine: 8 });
    expect(hunks).toHaveLength(1);
    expect(hunks[0].originalText).toBe('');
    expect(hunks[0].targetText).toBe('    this.count++;\n');
  });

  it('uses the indentStyle setting only for a file with no indentation to learn from', () => {
    const { proposedText } = review('', 'function a() {\n    return 1;\n}', { fallbackIndentStyle: 'tabs' });
    expect(proposedText).toBe('function a() {\n\treturn 1;\n}\n');
  });
});

describe('placeSnippet — new code goes at the cursor', () => {
  it('inserts a brand-new function at the cursor without touching existing code', () => {
    const file = 'function greet(name) {\n  return name;\n}\n';
    const { anchored, hunks, proposedText } = review(file, 'function add(a, b) {\n  return a + b;\n}', {
      cursor: { line: 3, character: 0 },
    });

    expect(anchored).toBe(false);
    expect(proposedText.startsWith(file)).toBe(true);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].originalText).toBe('');
  });

  it('treats a near-copy with a different name as a new function, not a rewrite of the original', () => {
    const snippet = INSERTION_SORT.map((l) => l.replace('insertionSort', 'insertionSortDesc').replace('arr[j] > key', 'arr[j] < key')).join('\n');
    const endOfFile = { line: 17, character: 0 };

    const { anchored, proposedText } = review(FILE, snippet, { cursor: endOfFile });

    expect(anchored).toBe(false);
    expect(proposedText.startsWith(FILE)).toBe(true);
  });

  it('indents new code to the surrounding block when inserted inside a class', () => {
    const file = 'class A {\n  foo() {\n    return 1;\n  }\n}\n';
    const { anchored, proposedText } = review(file, 'bar() {\n  return 2;\n}', { cursor: { line: 4, character: 0 } });

    expect(anchored).toBe(false);
    expect(proposedText).toBe('class A {\n  foo() {\n    return 1;\n  }\n  bar() {\n    return 2;\n  }\n}\n');
  });

  it('appends after a final line that has no trailing newline when the cursor is at its end', () => {
    const { proposedText } = review('const a = 1;', 'const b = 2;', { cursor: { line: 0, character: 12 } });
    expect(proposedText).toBe('const a = 1;\nconst b = 2;');
  });
});

describe('placeSnippet — explicit regions and modes', () => {
  it('an editor selection overrides matching and replaces exactly the selected lines', () => {
    const file = 'function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\nfunction c() {\n  return 3;\n}\n';
    const { proposedText } = review(file, 'function z() {\n  return 26;\n}', { selection: { startLine: 3, endLine: 6 } });

    expect(proposedText).toBe('function a() {\n  return 1;\n}\nfunction z() {\n  return 26;\n}\nfunction c() {\n  return 3;\n}\n');
  });

  it('fullFile mode (the AI command) lets a rewrite delete code anywhere in the file', () => {
    const file = 'function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\n';
    const { proposedText, hunks } = review(file, 'function b() {\n  return 2;\n}', { mode: 'fullFile' });

    expect(proposedText).toBe('function b() {\n  return 2;\n}\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].targetText).toBe('');
  });
});

describe('placeSnippet — clipboard hygiene and line endings', () => {
  it('strips a wrapping markdown code fence', () => {
    const file = 'function greet(name) {\n  return name;\n}\n';
    const { proposedText } = review(file, '```js\nfunction greet(name) {\n  return name.trim();\n}\n```');
    expect(proposedText).toBe('function greet(name) {\n  return name.trim();\n}\n');
  });

  it('keeps CRLF line endings in a CRLF file', () => {
    const file = 'function a() {\r\n  return 1;\r\n}\r\n';
    const { proposedText, hunks } = review(file, 'function a() {\n  return 2;\n}');

    expect(proposedText).toBe('function a() {\r\n  return 2;\r\n}\r\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].targetText).toBe('  return 2;\r\n');
  });

  it('preserves a missing trailing newline at end of file', () => {
    const { proposedText } = review('function a() {\n  return 1;\n}', 'function a() {\n  return 2;\n}');
    expect(proposedText).toBe('function a() {\n  return 2;\n}');
  });

  it('returns null for a clipboard with no code', () => {
    expect(placeSnippet({ ...DEFAULTS, originalText: 'x', snippetText: '  \n\n' })).toBeNull();
  });
});
