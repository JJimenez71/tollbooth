import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { DEFAULT_INSTANCES_DIR, HOOK_CLIENT_TIMEOUT_MS, InstanceInfo, PASSTHROUGH, ReviewDecision, ReviewRequest } from './protocol';

const REVIEWED_TOOLS = new Set(['Edit', 'Write']);

function comparable(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'darwin' || process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function folderContains(folder: string, filePath: string): boolean {
  const dir = comparable(folder);
  const file = comparable(filePath);
  return file === dir || file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

/** Instances whose workspace contains the file, most specific workspace folder first. */
export function findInstances(filePath: string, instancesDir: string): InstanceInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(instancesDir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const matches: Array<{ instance: InstanceInfo; depth: number }> = [];
  for (const name of names) {
    try {
      const instance = JSON.parse(fs.readFileSync(path.join(instancesDir, name), 'utf8')) as InstanceInfo;
      const depth = Math.max(-1, ...instance.folders.filter((f) => folderContains(f, filePath)).map((f) => comparable(f).length));
      if (depth >= 0) matches.push({ instance, depth });
    } catch {
      // Unreadable or half-written instance file: skip it.
    }
  }
  return matches.sort((a, b) => b.depth - a.depth).map((m) => m.instance);
}

class ConnectionError extends Error {}

function requestReview(instance: InstanceInfo, request: ReviewRequest, timeoutMs: number): Promise<ReviewDecision> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(request);
    let settled = false;
    const finish = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    const req = http.request(
      {
        host: '127.0.0.1',
        port: instance.port,
        path: '/review',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${instance.token}`,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () =>
          finish(() => {
            try {
              resolve(res.statusCode === 200 ? (JSON.parse(text) as ReviewDecision) : PASSTHROUGH);
            } catch {
              resolve(PASSTHROUGH);
            }
          })
        );
      }
    );
    const timer = setTimeout(() => {
      finish(() => resolve(PASSTHROUGH));
      req.destroy();
    }, timeoutMs);
    req.on('error', (err) => finish(() => reject(new ConnectionError(err.message))));
    req.end(body);
  });
}

/** The JSON Claude Code expects on stdout, or '' to take no position. */
export function formatDecision(decision: ReviewDecision): string {
  if (decision.decision === 'passthrough') {
    return '';
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.decision,
      permissionDecisionReason: decision.reason ?? '',
    },
  });
}

/**
 * Handles one PreToolUse invocation. Any failure — Tollbooth not running, a
 * stale instance, a bad payload, the wait timing out — yields '' so the edit
 * continues through Claude Code's normal permission flow.
 */
export async function runHook(stdinText: string, options: { instancesDir?: string; timeoutMs?: number } = {}): Promise<string> {
  let input: { tool_name?: unknown; tool_input?: unknown; session_id?: string; tool_use_id?: string; agent_type?: string };
  try {
    input = JSON.parse(stdinText);
  } catch {
    return '';
  }
  const toolInput = input.tool_input as Record<string, unknown> | undefined;
  const filePath = toolInput?.file_path;
  if (typeof input.tool_name !== 'string' || !REVIEWED_TOOLS.has(input.tool_name) || typeof filePath !== 'string') {
    return '';
  }

  const request: ReviewRequest = {
    tool_name: input.tool_name,
    tool_input: toolInput!,
    session_id: input.session_id,
    tool_use_id: input.tool_use_id,
    agent_type: input.agent_type,
  };
  for (const instance of findInstances(filePath, options.instancesDir ?? DEFAULT_INSTANCES_DIR)) {
    try {
      return formatDecision(await requestReview(instance, request, options.timeoutMs ?? HOOK_CLIENT_TIMEOUT_MS));
    } catch (err) {
      if (!(err instanceof ConnectionError)) return '';
      // Stale instance (VS Code window gone): try the next match.
    }
  }
  return '';
}
