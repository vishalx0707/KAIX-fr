import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SETTINGS = {
  selectedCliId: null,
  customClis: [],
  mcpTargets: []
};

export function settingsPath(root) {
  return path.join(root, '.kaix-fr', 'settings.local.json');
}

export async function readSettings(root) {
  try {
    const raw = await readFile(settingsPath(root), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      customClis: Array.isArray(parsed.customClis) ? parsed.customClis : [],
      mcpTargets: Array.isArray(parsed.mcpTargets) ? parsed.mcpTargets : []
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(root, settings) {
  const next = {
    selectedCliId: typeof settings.selectedCliId === 'string' ? settings.selectedCliId : null,
    customClis: Array.isArray(settings.customClis) ? settings.customClis : [],
    mcpTargets: Array.isArray(settings.mcpTargets) ? settings.mcpTargets : []
  };
  const file = settingsPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2));
  return next;
}
