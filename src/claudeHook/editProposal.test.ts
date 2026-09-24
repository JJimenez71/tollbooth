import { proposeEdit } from './editProposal';

const FILE = 'function greet(name) {\n  return name;\n}\n\nfunction add(a, b) {\n  return a + b;\n}\n';

describe('proposeEdit', () => {
  it('applies an Edit by replacing old_string once', () => {
    const result = proposeEdit('Edit', { file_path: 'f', old_string: '  return a + b;', new_string: '  return a * b;' }, FILE);
    expect(result).toEqual({ kind: 'review', originalText: FILE, proposedText: FILE.replace('a + b', 'a * b') });
  });

  it('treats new_string literally ($& and friends are not replacement patterns)', () => {
    const result = proposeEdit('Edit', { file_path: 'f', old_string: 'return name;', new_string: 'return `$&${name}`;' }, FILE);
    expect(result.kind === 'review' && result.proposedText.includes('return `$&${name}`;')).toBe(true);
  });

  it('replaces every occurrence with replace_all', () => {
    const result = proposeEdit('Edit', { file_path: 'f', old_string: 'return', new_string: 'yield', replace_all: true }, FILE);
    expect(result.kind === 'review' && result.proposedText.split('yield').length - 1).toBe(2);
  });

  it('passes through an ambiguous old_string without replace_all (Claude Code rejects it itself)', () => {
    expect(proposeEdit('Edit', { file_path: 'f', old_string: 'return', new_string: 'yield' }, FILE).kind).toBe('passthrough');
  });

  it('reports notFound when old_string is not in the file yet', () => {
    expect(proposeEdit('Edit', { file_path: 'f', old_string: 'nope', new_string: 'x' }, FILE)).toEqual({ kind: 'notFound' });
  });

  it('matches an LF old_string against a CRLF file and keeps CRLF', () => {
    const crlf = 'a\r\nb\r\nc\r\n';
    const result = proposeEdit('Edit', { file_path: 'f', old_string: 'a\nb', new_string: 'a\nB' }, crlf);
    expect(result).toEqual({ kind: 'review', originalText: crlf, proposedText: 'a\r\nB\r\nc\r\n' });
  });

  it('passes through an Edit to a file that does not exist', () => {
    expect(proposeEdit('Edit', { file_path: 'f', old_string: 'a', new_string: 'b' }, null).kind).toBe('passthrough');
  });

  it('reviews a Write to a new file as an insertion of the whole content', () => {
    expect(proposeEdit('Write', { file_path: 'f', content: 'new\n' }, null)).toEqual({ kind: 'review', originalText: '', proposedText: 'new\n' });
  });

  it('reviews a Write over an existing file as a full-file change', () => {
    expect(proposeEdit('Write', { file_path: 'f', content: 'x\n' }, FILE)).toEqual({ kind: 'review', originalText: FILE, proposedText: 'x\n' });
  });

  it('passes through tools it does not review', () => {
    expect(proposeEdit('NotebookEdit', { file_path: 'f' }, FILE).kind).toBe('passthrough');
  });
});
