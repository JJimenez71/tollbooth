# Tollbooth — MVP Specification

## 1. Project goal

This is **not** a typing speed tool. It is a comprehension tool disguised as one.

The problem it addresses: when an AI assistant proposes a code change, the common workflow is to glance at a diff and click "Accept." That motion takes less time than actually reading the change, so it's very easy to merge code you don't fully understand — new logic, an unfamiliar API call, a subtly wrong edge case — without ever having engaged with it at the character level.

The core mechanic: **before an AI-proposed change is allowed to land in your file, you must manually retype it.** Not paste it, not accept it — type it, character by character, in a focused view. The retyping is a forcing function for attention. You cannot type code you haven't looked at closely, and mistakes surface exactly where you weren't paying attention.

This has a direct effect on the design:

- **No prominent WPM, no leaderboard, no streaks-for-speed.** Optimizing for typing speed would defeat the purpose — it would train the user to type on autopilot, which is the opposite of "getting to know your code." If any metric is shown, it should be secondary (e.g. a quiet accuracy/completion indicator), never the focal point of the UI.
- **Errors should force correction, not just get marked and skip past.** The user should not be able to blast through incorrect characters — an incorrect keystroke should require an actual fix before moving forward, because the point is that they engage with what's actually there, not just what they expect to be there.
- **Unchanged context around the change should be visible (read-only), not hidden.** Part of "knowing your code" is seeing the change in the situ of the surrounding function/file, not as an isolated snippet.
- **The unit of work is a hunk of an AI-proposed diff**, not an arbitrary code snippet or drill. The content is never synthetic — it's always the actual pending change to the actual file.

If a future version adds gamified elements, they should reward *thoroughness* (e.g., "no uncorrected mistakes," "reviewed full context before typing") rather than *speed*.

## 2. MVP scope

### In scope for v1
- One VS Code command that takes an AI-proposed rewrite of the **currently open file** and walks the user through retyping the changed parts before applying them.
- Single file at a time. Single AI call per invocation (no multi-file batch orchestration yet).
- A diff engine that reduces the AI's rewrite to a minimal set of changed hunks, so the user only retypes what actually changed, not the whole file.
- A webview-based typing UI: read-only context above/below, an active hunk the user types into, character-level correct/incorrect feedback, forced correction on mistakes.
- On completing a hunk: apply that hunk to the real file via `WorkspaceEdit`, then advance to the next hunk (if any), then navigate the editor to what was just written.
- A basic escape hatch: user can cancel mid-session with no partial changes applied for the hunk in progress.

### Explicitly out of scope for v1 (defer to later iterations)
- Multi-file batch review (looping over several files the AI touched in one go).
- Any stats history, accuracy trends, or dashboards.
- Themes, sound effects, custom fonts.
- Adaptive difficulty or targeted practice based on past mistakes.
- Streaming the AI response token-by-token into the webview.
- Real syntax highlighting in the webview (a v1 can use plain monospace text with minimal color; see section 6).
- Handling the case where the user edits the file in a totally different way mid-session beyond a basic staleness check (see section 7).

## 3. High-level architecture

Two runtime contexts, talking over `postMessage`:

**Extension host** (Node.js, TypeScript, runs with full VS Code API access)
- Owns the command registration, AI API calls, diffing, and all file mutations.
- Never trusts the webview with anything except "which hunk index is currently active" and "the hunk is complete" — the actual text applied to the file always comes from the host's own diff data, never from reading the webview's DOM/state, to avoid any risk of the applied text drifting from what was actually verified.

**Webview panel** (sandboxed HTML/CSS/JS, no direct file or network access)
- Pure presentation and keystroke capture for the *current* hunk.
- Sends events up (keystroke, hunk-complete, cancel); receives commands down (load-hunk, session-complete).

```
Extension host                         Webview
───────────────                        ───────
1. Read original file
2. Call AI, get rewritten content
3. Diff → list of Hunks
4. postMessage("loadHunk", hunk[0]) ──▶ 5. Render context + typing target
                                        6. Capture keystrokes, compare
                                        7. On full match, postMessage("hunkComplete")
8. Receive hunkComplete          ◀──────
9. Apply hunk via WorkspaceEdit
10. Navigate editor to the change
11. postMessage("loadHunk", hunk[1]) ─▶ … repeat until hunks exhausted
12. postMessage("sessionComplete") ──▶ 13. Show simple completion state, panel closes
```

## 4. Data model

```ts
interface Hunk {
  id: string;                 // stable id for this hunk within the session
  filePath: string;
  originalRange: {            // range in the ORIGINAL document, computed once up front
    startLine: number;
    endLine: number;
  };
  contextBefore: string;      // a few unchanged lines above, read-only, for orientation
  contextAfter: string;       // a few unchanged lines below
  originalText: string;       // the text being replaced (may be empty for pure insertions)
  targetText: string;         // the text the user must type (the AI's new version of this hunk)
}

interface ReviewSession {
  sessionId: string;
  filePath: string;
  originalDocumentVersion: number; // vscode document version at session start, for staleness checks
  hunks: Hunk[];
  currentHunkIndex: number;
}
```

Notes on `originalRange`: compute every hunk's range against the **original, pre-edit document**, once, up front — not recomputed after each apply. Because applying an earlier hunk shifts line numbers for everything below it, hunks must be **applied in a stable, safe order**: either bottom-to-top (so earlier applies don't invalidate the line numbers of hunks not yet applied), or re-validated against the live document immediately before each apply (see section 7). For the MVP, bottom-to-top application order is simpler and recommended, even though it means the user experiences hunks out of top-to-bottom reading order — a v2 concern to improve, not a v1 blocker (see section 8, "Known MVP compromise").

## 5. Component breakdown

### 5.1 Command entry point
- Command: `tollbooth.reviewChangesForCurrentFile`
- Preconditions: an editor is active; there is "pending AI content" to diff against. For the MVP, the simplest trigger is: the user has AI-suggested content on the clipboard (copied from wherever they got the suggestion — chat UI, another tool, etc.), or the extension makes its own AI API call using the current file as input and a prompt the user supplies via an input box. Recommend building the clipboard-based flow first since it has zero AI-integration dependency and lets you validate the diff/type/apply loop in isolation; add the direct API call as the very next step.

### 5.2 AI integration module (`aiClient.ts`)
- Thin wrapper around a single API call: given file content + instructions, return the full rewritten file content (not a diff — let your own diff engine compute that, so you're not trusting the model to produce a clean patch format).
- Config: API key via VS Code `SecretStorage`, model name via extension settings.
- For MVP, synchronous request/response is fine — no streaming.

### 5.3 Diff module (`diffEngine.ts`)
- Use the `diff` npm package (`diffLines`, potentially `diffWordsWithSpace` for tightening hunks within a changed line block).
- Input: original file text, AI-rewritten file text.
- Output: `Hunk[]` as defined above, with reasonable context lines included (e.g. 2 lines before/after, configurable).
- Include a size guard: if the diff touches more than some threshold (e.g. >70% of the file, or more than N total changed lines), skip the typing flow entirely for that invocation and just apply the change directly with a notification — this is not a good typing exercise and shouldn't pretend to be one.

### 5.4 Webview panel (`webviewPanel.ts` + `media/panel.html/js/css`)
- Created with `vscode.window.createWebviewPanel`, `enableScripts: true`, strict CSP with a nonce for the inline script.
- `retainContextWhenHidden: true` isn't necessary for MVP since the panel is short-lived per session.
- Message protocol (all messages are `{ type: string, payload: any }`):
  - Host → Webview: `loadHunk` (payload: `Hunk`, plus hunk index / total for a simple "2 of 5" indicator), `sessionComplete`
  - Webview → Host: `ready` (webview finished mounting, host can send first hunk), `hunkComplete` (payload: `{ hunkId }`), `cancelSession`
- Webview typing logic:
  - Render `contextBefore` and `contextAfter` as plain, dimmed, non-interactive text.
  - Render `targetText` character-by-character; track a cursor index.
  - On keydown, compare typed character to `targetText[cursorIndex]`. Match → advance cursor, color the character as correct. Mismatch → color as incorrect, **do not advance the cursor** — the user must produce the correct character before proceeding (this is the "forced correction" behavior from section 1). Backspace moves the cursor back and clears the correct/incorrect mark for that character.
  - When cursor reaches `targetText.length`, send `hunkComplete`.
  - No WPM/timer UI in the MVP. If you want any feedback at all, a simple non-numeric "in progress / done" state per hunk is enough.

### 5.5 Apply + navigate (`applyEngine.ts`)
- On `hunkComplete`, host builds a `vscode.WorkspaceEdit`:
  ```ts
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, hunk.originalRange, hunk.targetText);
  await vscode.workspace.applyEdit(edit);
  ```
- After applying, call `vscode.window.showTextDocument(document, { selection: newRangeOfInsertedText })` so the user visually lands on what they just wrote.
- Advance `session.currentHunkIndex`; if hunks remain, send the next `loadHunk`; otherwise send `sessionComplete` and dispose the panel.

## 6. Suggested file/folder structure

```
tollbooth/
├── package.json                 # command + settings contributions
├── src/
│   ├── extension.ts              # activate(), command registration
│   ├── aiClient.ts                # AI API call wrapper
│   ├── diffEngine.ts               # original+new text -> Hunk[]
│   ├── applyEngine.ts               # WorkspaceEdit application, navigation
│   ├── webviewPanel.ts               # panel lifecycle, message handling
│   └── types.ts                       # Hunk, ReviewSession interfaces
└── media/
    ├── panel.html
    ├── panel.css                 # plain monospace, minimal color: correct/incorrect/context/cursor
    └── panel.js                  # keystroke capture + rendering, no framework needed for MVP
```

Keep the webview vanilla JS/HTML/CSS for the MVP — there's no state complex enough to justify React or any framework yet, and it avoids a build step for the webview bundle entirely.

## 7. Edge cases the MVP should still handle

Even at MVP scope, these are cheap to handle and expensive to skip:

- **Document changed elsewhere during the session.** Before applying each hunk, check `document.version` against the version captured at session start (or re-slice the live text at `originalRange` and confirm it still equals `hunk.originalText`). If it doesn't match, abort that hunk's apply, notify the user, and end the session rather than silently corrupting the file.
- **Oversized diffs.** As noted in 5.3, bypass the typing flow entirely above a size threshold.
- **Non-contiguous changes in one file.** These naturally become separate hunks/separate "levels" in the sequence — no special handling needed beyond what the diff engine already produces.
- **Pure insertions or pure deletions.** A hunk with empty `originalText` (pure insertion) or empty `targetText` (pure deletion) should still work through the same flow — a deletion hunk can auto-apply without a typing step (there's nothing to type), while an insertion is typed as normal.
- **User cancels mid-hunk.** No partial edit should ever be applied — the `WorkspaceEdit` only happens on `hunkComplete`, so cancellation before that point is a no-op on the file by construction. Just dispose the panel.
- **Indentation.** Compare characters exactly, including whitespace — don't try to be lenient about tabs vs. spaces in the MVP. If this proves too punishing in practice, a v2 option could normalize leading whitespace comparisons, but start strict.

## 8. Known MVP compromises (acceptable for v1, worth revisiting later)

- Applying hunks bottom-to-top to avoid range invalidation means the user may type changes in a different order than they appear in the file. Fine for v1; a v2 could re-diff against the live document after each apply to allow true top-to-bottom order.
- No syntax highlighting in the webview — plain monospace with three states (untyped/correct/incorrect) is enough to validate the core mechanic.
- Single file, single AI call per session — multi-file orchestration is a straightforward extension of this same loop once the single-file version works, but isn't needed to prove out the concept.

## 9. Suggested build order

1. `types.ts` + `diffEngine.ts` — get diffing right first, test it against hand-written before/after strings with no UI at all.
2. `webviewPanel.ts` + `media/` — build the typing UI against a **hardcoded** `Hunk[]` (no AI call yet) to validate the keystroke/forced-correction mechanic in isolation.
3. `applyEngine.ts` — wire up `WorkspaceEdit` + navigation, still against hardcoded hunks.
4. Clipboard-based trigger — command that diffs the current file against clipboard content, replacing the hardcoded hunks with real ones.
5. `aiClient.ts` — replace "paste AI content from clipboard" with an actual API call, once the rest of the loop is proven out.
