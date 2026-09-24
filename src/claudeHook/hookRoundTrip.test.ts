import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runHook } from './hookClient';
import { ALLOW, DENY, PASSTHROUGH, ReviewDecision, ReviewRequest } from './protocol';
import { ReviewHandler, ReviewServer } from './reviewServer';

const WORKSPACE = path.join(os.tmpdir(), 'tollbooth-test-workspace');

function hookInput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: 's1',
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(WORKSPACE, 'src', 'a.ts'), old_string: 'a', new_string: 'b' },
    tool_use_id: 'toolu_1',
    ...overrides,
  });
}

describe('Claude Code hook ⇄ review server', () => {
  let instancesDir: string;
  let servers: ReviewServer[];

  beforeEach(() => {
    instancesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tollbooth-instances-'));
    servers = [];
  });

  afterEach(() => {
    servers.forEach((s) => s.stop());
    fs.rmSync(instancesDir, { recursive: true, force: true });
  });

  async function startServer(handler: ReviewHandler, folders = [WORKSPACE]): Promise<ReviewServer> {
    const server = new ReviewServer(handler, folders, instancesDir);
    await server.start();
    servers.push(server);
    return server;
  }

  it('returns an allow decision in the format Claude Code expects, with the edit forwarded intact', async () => {
    let received: ReviewRequest | undefined;
    await startServer(async (request) => {
      received = request;
      return ALLOW;
    });

    const out = JSON.parse(await runHook(hookInput(), { instancesDir }));

    expect(out).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: ALLOW.reason } });
    expect(received?.tool_name).toBe('Edit');
    expect(received?.tool_input).toEqual({ file_path: path.join(WORKSPACE, 'src', 'a.ts'), old_string: 'a', new_string: 'b' });
  });

  it('returns a deny decision with the reason Claude will see', async () => {
    await startServer(async () => DENY);
    const out = JSON.parse(await runHook(hookInput(), { instancesDir }));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe(DENY.reason);
  });

  it('prints nothing for passthrough, so Claude Code falls back to its normal flow', async () => {
    await startServer(async () => PASSTHROUGH);
    expect(await runHook(hookInput(), { instancesDir })).toBe('');
  });

  it('takes no position when Tollbooth is not running at all', async () => {
    expect(await runHook(hookInput(), { instancesDir: path.join(instancesDir, 'missing') })).toBe('');
  });

  it('ignores files outside every Tollbooth workspace', async () => {
    const handler = jest.fn(async () => ALLOW);
    await startServer(handler);
    const outside = hookInput({ tool_input: { file_path: path.join(os.tmpdir(), 'elsewhere', 'b.ts'), old_string: 'a', new_string: 'b' } });

    expect(await runHook(outside, { instancesDir })).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not treat a sibling folder with a shared prefix as inside the workspace', async () => {
    const handler = jest.fn(async () => ALLOW);
    await startServer(handler);
    const sibling = hookInput({ tool_input: { file_path: WORKSPACE + '-other/a.ts', old_string: 'a', new_string: 'b' } });

    expect(await runHook(sibling, { instancesDir })).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores tools other than Edit and Write', async () => {
    const handler = jest.fn(async () => ALLOW);
    await startServer(handler);
    expect(await runHook(hookInput({ tool_name: 'Bash', tool_input: { command: 'ls' } }), { instancesDir })).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });

  it('skips a stale instance left by a crashed window and reaches the live one', async () => {
    fs.writeFileSync(path.join(instancesDir, 'stale.json'), JSON.stringify({ port: 9, token: 'x', pid: 999999, folders: [WORKSPACE] }));
    await startServer(async () => DENY);
    const out = JSON.parse(await runHook(hookInput(), { instancesDir }));
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('routes to the window with the most specific workspace folder', async () => {
    await startServer(async () => DENY, [WORKSPACE]);
    await startServer(async () => ALLOW, [path.join(WORKSPACE, 'src')]);
    const out = JSON.parse(await runHook(hookInput(), { instancesDir }));
    expect(out.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('rejects requests without the instance token', async () => {
    const handler = jest.fn(async () => ALLOW);
    await startServer(handler);
    const [file] = fs.readdirSync(instancesDir);
    const info = JSON.parse(fs.readFileSync(path.join(instancesDir, file), 'utf8'));
    fs.writeFileSync(path.join(instancesDir, file), JSON.stringify({ ...info, token: 'wrong' }));

    expect(await runHook(hookInput(), { instancesDir })).toBe('');
    expect(handler).not.toHaveBeenCalled();
  });

  it('on timeout takes no position AND aborts the pending review in VS Code', async () => {
    let aborted: () => void = () => undefined;
    const abortedPromise = new Promise<void>((r) => (aborted = r));
    await startServer(
      (_request, signal) =>
        new Promise<ReviewDecision>(() => {
          signal.addEventListener('abort', () => aborted());
        })
    );

    expect(await runHook(hookInput(), { instancesDir, timeoutMs: 200 })).toBe('');
    await abortedPromise;
  });

  it('removes its instance file when stopped, so the hook stops routing to it', async () => {
    const server = await startServer(async () => ALLOW);
    expect(fs.readdirSync(instancesDir)).toHaveLength(1);
    server.stop();
    expect(fs.readdirSync(instancesDir)).toHaveLength(0);
    expect(await runHook(hookInput(), { instancesDir })).toBe('');
  });
});
