import { HOOK_SCRIPT_NAME, HOOK_TIMEOUT_SECONDS } from './protocol';

interface HookHandler {
  type?: string;
  command?: string;
  timeout?: number;
}

interface MatcherGroup {
  matcher?: string;
  hooks?: HookHandler[];
}

/**
 * The command Claude Code runs. It uses VS Code's own runtime (Electron in Node
 * mode) so the hook works even when `node` isn't on the PATH Claude Code sees.
 */
export function hookCommand(runtimePath: string, hookScriptPath: string): string {
  return `ELECTRON_RUN_AS_NODE=1 "${runtimePath}" "${hookScriptPath}"`;
}

function isTollboothHandler(handler: HookHandler): boolean {
  return typeof handler.command === 'string' && handler.command.includes(HOOK_SCRIPT_NAME);
}

function parseSettings(text: string | null): Record<string, unknown> {
  if (text === null || text.trim() === '') return {};
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('settings file is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function settingsHaveHook(text: string | null): boolean {
  try {
    const hooks = parseSettings(text).hooks as Record<string, MatcherGroup[]> | undefined;
    return (hooks?.PreToolUse ?? []).some((group) => (group.hooks ?? []).some(isTollboothHandler));
  } catch {
    return false;
  }
}

/**
 * Returns the settings JSON with exactly one Tollbooth PreToolUse hook,
 * replacing any earlier Tollbooth entry and leaving every other setting and
 * hook untouched. Throws if the existing file isn't valid JSON, so a file the
 * user hand-edited is never clobbered.
 */
export function mergeHookIntoSettings(text: string | null, command: string): string {
  const settings = parseSettings(text);
  const hooks = (typeof settings.hooks === 'object' && settings.hooks !== null ? settings.hooks : {}) as Record<string, unknown>;
  const existing = Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as MatcherGroup[]) : [];

  const kept = existing
    .map((group) => ({ ...group, hooks: (group.hooks ?? []).filter((h) => !isTollboothHandler(h)) }))
    .filter((group) => group.hooks.length > 0);
  kept.push({ matcher: 'Edit|Write', hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] });

  settings.hooks = { ...hooks, PreToolUse: kept };
  return JSON.stringify(settings, null, 2) + '\n';
}
