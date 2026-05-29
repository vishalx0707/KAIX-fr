import { access } from 'node:fs/promises';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const pathExt = isWindows
  ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
  : [''];

export const BUILT_IN_CLIS = [
  {
    id: 'claude',
    label: 'Claude Code',
    commands: ['claude', 'claude.cmd'],
    supportsImages: true,
    buildArgs({ imagePath }) {
      const args = ['-p', '--output-format', 'text'];
      if (imagePath) args.push('--allowedTools', 'Read');
      return args;
    }
  },
  {
    id: 'codex',
    label: 'Codex',
    commands: ['codex', 'codex.cmd'],
    supportsImages: true,
    buildArgs({ imagePath }) {
      const args = ['exec', '-s', 'read-only', '--skip-git-repo-check'];
      if (imagePath) args.push('-i', imagePath);
      return args;
    }
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    commands: ['opencode', 'opencode.cmd'],
    supportsImages: false,
    buildArgs() {
      return [];
    }
  }
];

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function findCommand(command) {
  const hasExt = /\.[a-z0-9]+$/i.test(command);
  const names = isWindows && !hasExt
    ? pathExt.map(ext => command + ext.toLowerCase())
    : [command];

  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    for (const name of names) {
      if (await exists(name)) return name;
    }
    return null;
  }

  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

export async function listAvailableClis(settings = {}) {
  const custom = (settings.customClis || []).map(c => ({
    id: c.id,
    label: c.label || c.command,
    commands: [c.command],
    supportsImages: Boolean(c.supportsImages),
    custom: true,
    args: Array.isArray(c.args) ? c.args : []
  }));

  const all = [...BUILT_IN_CLIS, ...custom];
  const detected = [];
  for (const cli of all) {
    let executable = null;
    for (const command of cli.commands) {
      executable = await findCommand(command);
      if (executable) break;
    }
    detected.push({
      id: cli.id,
      label: cli.label,
      available: Boolean(executable),
      executable,
      supportsImages: Boolean(cli.supportsImages),
      custom: Boolean(cli.custom)
    });
  }
  return detected;
}

export function getCliDefinition(cliId, settings = {}) {
  const custom = (settings.customClis || []).find(c => c.id === cliId);
  if (custom) {
    return {
      id: custom.id,
      label: custom.label || custom.command,
      commands: [custom.command],
      supportsImages: Boolean(custom.supportsImages),
      buildArgs() {
        return Array.isArray(custom.args) ? custom.args : [];
      }
    };
  }
  return BUILT_IN_CLIS.find(c => c.id === cliId) || null;
}
