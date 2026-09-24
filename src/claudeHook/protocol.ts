import * as os from 'os';
import * as path from 'path';

/** Shared between the extension (review server) and the Claude Code hook script. */

export const TOLLBOOTH_HOME = path.join(os.homedir(), '.tollbooth');
export const DEFAULT_INSTANCES_DIR = path.join(TOLLBOOTH_HOME, 'instances');
export const HOOK_SCRIPT_NAME = 'tollbooth-claude-hook.js';

/** Configured on the Claude Code hook. The script gives up a minute earlier so it
 * always answers (with "no decision") rather than being killed mid-request. */
export const HOOK_TIMEOUT_SECONDS = 3600;
export const HOOK_CLIENT_TIMEOUT_MS = (HOOK_TIMEOUT_SECONDS - 60) * 1000;

/** Written by each VS Code window while Tollbooth mode is on. */
export interface InstanceInfo {
  port: number;
  token: string;
  pid: number;
  folders: string[];
}

export interface ReviewRequest {
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id?: string;
  tool_use_id?: string;
  agent_type?: string;
}

/**
 * allow: the user retyped the edit — Claude Code applies it with no further prompt.
 * deny: the user rejected it — Claude is told why.
 * passthrough: Tollbooth takes no position — Claude Code's normal permission flow runs.
 */
export interface ReviewDecision {
  decision: 'allow' | 'deny' | 'passthrough';
  reason?: string;
}

export const PASSTHROUGH: ReviewDecision = { decision: 'passthrough' };
export const ALLOW: ReviewDecision = { decision: 'allow', reason: 'The user retyped and approved this edit in Tollbooth.' };
export const DENY: ReviewDecision = {
  decision: 'deny',
  reason:
    'The user rejected this edit in Tollbooth instead of retyping it. Do not retry the same edit; ask the user how they would like to proceed.',
};
