export type EditProposal =
  | { kind: 'review'; originalText: string; proposedText: string }
  /** Claude Code will reject or special-case this call itself; Tollbooth takes no position. */
  | { kind: 'passthrough'; reason: string }
  /** old_string isn't in the file (yet) — e.g. a preceding edit hasn't been written. */
  | { kind: 'notFound' };

function countOccurrences(text: string, search: string): number {
  let count = 0;
  for (let at = text.indexOf(search); at !== -1; at = text.indexOf(search, at + search.length)) count++;
  return count;
}

function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

/**
 * Computes the file text Claude Code would produce for an Edit or Write call,
 * given the file's current contents (null if it doesn't exist).
 */
export function proposeEdit(toolName: string, toolInput: Record<string, unknown>, currentText: string | null): EditProposal {
  if (toolName === 'Write') {
    return typeof toolInput.content === 'string'
      ? { kind: 'review', originalText: currentText ?? '', proposedText: toolInput.content }
      : { kind: 'passthrough', reason: 'Write call without content' };
  }
  if (toolName !== 'Edit') {
    return { kind: 'passthrough', reason: `unsupported tool ${toolName}` };
  }

  const { old_string: oldString, new_string: newString, replace_all: replaceAll } = toolInput;
  if (typeof oldString !== 'string' || typeof newString !== 'string' || oldString === '') {
    return { kind: 'passthrough', reason: 'Edit call without a usable old_string/new_string' };
  }
  if (currentText === null) {
    return { kind: 'passthrough', reason: 'file does not exist' };
  }

  let search = oldString;
  let replacement = newString;
  let count = countOccurrences(currentText, search);
  if (count === 0 && currentText.includes('\r\n')) {
    search = toCrlf(oldString);
    replacement = toCrlf(newString);
    count = countOccurrences(currentText, search);
  }
  if (count === 0) {
    return { kind: 'notFound' };
  }
  if (count > 1 && replaceAll !== true) {
    return { kind: 'passthrough', reason: 'old_string is ambiguous; Claude Code will reject this edit' };
  }

  const proposedText =
    replaceAll === true
      ? currentText.split(search).join(replacement)
      : currentText.slice(0, currentText.indexOf(search)) + replacement + currentText.slice(currentText.indexOf(search) + search.length);
  return { kind: 'review', originalText: currentText, proposedText };
}
