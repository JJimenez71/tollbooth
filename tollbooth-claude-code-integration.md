# Tollbooth — Claude Code Integration Notes

This document covers an alternative (and likely better) trigger path for Tollbooth: hooking directly into Claude Code's tool-call layer, rather than relying on the clipboard-based flow or Tollbooth making its own AI API calls as described in the main spec.

The core idea: Claude Code (and similar coding agents) expose a proposed file edit as **structured data** before it's ever printed to the console as a diff. That structured data is already shaped almost exactly like Tollbooth's `Hunk` type — so instead of building a trigger that diffs a full file rewrite, Tollbooth can tap directly into the edit as Claude Code is about to make it.

## 1. `--output-format stream-json`

Running Claude Code with `-p` and `--output-format stream-json` produces newline-delimited JSON, where each line is a standalone event emitted as it happens — useful for anything that needs to know what Claude is doing in real time, rather than waiting for a final text blob.

These events include tool calls and tool results. When Claude Code invokes its `Edit` tool, that call arrives as a structured JSON event, not console text. The `Edit` tool's payload is essentially a hunk already:

- `file_path`
- `old_string`
- `new_string`

No diff reconstruction needed — you get the pre/post text pair directly as data. This is useful if you want to build a Tollbooth mode that watches a running Claude Code session's output stream and queues up hunks as they're proposed.

## 2. Hooks — the integration point that matters most

Claude Code has a **hooks system**: scripts that run at defined points in its execution lifecycle. The two relevant hook events:

- **`PreToolUse`** — fires *before* Claude invokes a tool. The hook can block the tool call entirely by exiting with code 2, and Claude receives the hook's stderr as feedback.
- **`PostToolUse`** — fires *after* a tool completes. Useful for reacting to an edit that already landed (e.g., logging, formatting), rather than intercepting it beforehand.

For Tollbooth, `PreToolUse` is the interesting one, because it lets you intercept an edit **before it touches disk**.

### What the hook receives

A hook is a shell command registered in `.claude/settings.json` (project-level) or `~/.claude/settings.json` (global). It receives JSON on stdin:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/dir",
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/absolute/path/to/file.ts",
    "old_string": "...",
    "new_string": "..."
  }
}
```

For a `Write` tool call, `tool_input` instead carries `file_path` and `content` (the full new file content, since `Write` is a full-file write rather than a targeted replace).

Hook registration looks like:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "/path/to/tollbooth-hook.sh" }
        ]
      }
    ]
  }
}
```

### Exit code behavior

| Exit code | Meaning | Effect |
|---|---|---|
| `0` | Success | Tool proceeds normally |
| `2` (PreToolUse only) | Block | Tool call is stopped; stderr is surfaced to Claude as feedback |
| other | Error | Treated as a hook error, doesn't block the tool |

This exit-code-2 behavior is what makes the integration possible: Tollbooth's hook can unconditionally block every matched `Edit`/`Write` call, take ownership of applying it, and never let Claude Code's own file write happen.

## 3. Proposed integration flow

1. Claude Code decides to call `Edit` (or `Write`) on a file.
2. Tollbooth's `PreToolUse` hook script intercepts the call via stdin JSON, extracting `file_path` / `old_string` / `new_string` (or `file_path` / `content` for `Write`).
3. The hook script exits with code `2`, blocking the edit from being applied by Claude Code.
4. The hook script hands the payload off to Tollbooth's running extension/core service — e.g., by writing to a local socket or a watched file/queue that the extension is listening on.
5. Tollbooth opens its typing-drill UI for that hunk (using `old_string`/`new_string` directly as `originalText`/`targetText` — no separate diff engine call needed for this trigger path).
6. Once the user types the hunk out, Tollbooth applies it itself via `WorkspaceEdit` — Claude Code never writes the file directly; Tollbooth does, and only after the retype is complete.
7. Claude Code, having received the blocked-tool feedback, continues its turn as normal.

### Why this is a better trigger than the clipboard/API-call flow

- Works with whatever the user is **already running** (Claude Code, or any other agent with an equivalent hook/tool-call layer) — no separate manual "start a review" step, no need for Tollbooth to make its own AI API calls at all.
- The AI content arrives already split into individual proposed edits (one hook firing per `Edit`/`Write` call), rather than as one large rewritten-file blob that Tollbooth has to diff itself.
- Blocking is native and clean via exit code 2 — there's no race condition to manage between "AI wrote the file" and "user hasn't typed it yet," because the write simply never happens until Tollbooth applies it.

### Caveat to design around

`old_string`/`new_string` from a single `Edit` call carries no surrounding context the way the spec's `contextBefore`/`contextAfter` fields do. If Tollbooth wants read-only context lines around the change for orientation, the hook (or the extension after receiving the payload) needs to separately read a few lines around the match from the live file at `file_path`.

## 4. Portability note

This same pattern — a pre-write hook or tool-call interception layer exposing structured `(file_path, old_content, new_content)` — isn't unique to Claude Code. Any coding agent that exposes tool calls for file edits (rather than only printing a diff to a terminal) can, in principle, support the same interception approach, provided it has an equivalent hook mechanism. Claude Code's hooks system is simply the first, well-documented one worth building against.
