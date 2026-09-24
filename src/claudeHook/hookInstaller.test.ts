import { hookCommand, mergeHookIntoSettings, settingsHaveHook } from './hookInstaller';

const COMMAND = hookCommand('/Apps/Code Helper (Plugin)', '/home/u/.tollbooth/tollbooth-claude-hook.js');

describe('hookCommand', () => {
  it('quotes paths with spaces and runs Electron as Node', () => {
    expect(COMMAND).toBe('ELECTRON_RUN_AS_NODE=1 "/Apps/Code Helper (Plugin)" "/home/u/.tollbooth/tollbooth-claude-hook.js"');
  });
});

describe('mergeHookIntoSettings', () => {
  it('creates settings from nothing', () => {
    const settings = JSON.parse(mergeHookIntoSettings(null, COMMAND));
    expect(settings.hooks.PreToolUse).toEqual([{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: COMMAND, timeout: 3600 }] }]);
  });

  it('keeps every unrelated setting and hook', () => {
    const existing = JSON.stringify({
      model: 'opus',
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
      },
    });
    const settings = JSON.parse(mergeHookIntoSettings(existing, COMMAND));

    expect(settings.model).toBe('opus');
    expect(settings.permissions).toEqual({ allow: ['Bash(npm test)'] });
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('guard.sh');
  });

  it('is idempotent: reinstalling replaces the old Tollbooth entry instead of adding another', () => {
    const once = mergeHookIntoSettings(null, hookCommand('/old/path', '/x/tollbooth-claude-hook.js'));
    const twice = JSON.parse(mergeHookIntoSettings(once, COMMAND));
    expect(twice.hooks.PreToolUse).toHaveLength(1);
    expect(twice.hooks.PreToolUse[0].hooks[0].command).toBe(COMMAND);
  });

  it('refuses to rewrite a file that is not valid JSON', () => {
    expect(() => mergeHookIntoSettings('{ "model": "opus", // comment\n }', COMMAND)).toThrow();
  });
});

describe('settingsHaveHook', () => {
  it('detects an installed hook and tolerates missing or broken files', () => {
    expect(settingsHaveHook(mergeHookIntoSettings(null, COMMAND))).toBe(true);
    expect(settingsHaveHook('{}')).toBe(false);
    expect(settingsHaveHook(null)).toBe(false);
    expect(settingsHaveHook('not json')).toBe(false);
  });
});
