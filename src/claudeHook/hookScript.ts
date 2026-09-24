import { runHook } from './hookClient';

// Entry point Claude Code runs for each Edit/Write PreToolUse event. Always
// exits 0: it either prints an allow/deny decision or prints nothing (no position).
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  runHook(input)
    .catch(() => '')
    .then((output) => {
      // Exit from the write callback: stdout to a pipe is async, and exiting
      // immediately can truncate the decision JSON.
      process.stdout.write(output, () => process.exit(0));
    });
});
