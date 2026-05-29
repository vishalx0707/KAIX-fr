# Provider-Neutral CLI and MCP Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `tastes fr` from a Claude/Codex-specific internal prompt forge into an open-source workflow where users choose any installed local AI CLI and optionally send generated prompts to configured MCP generation tools.

**Architecture:** Split the current hard-coded engine layer into provider-neutral adapters: local CLI discovery/execution, local user settings, prompt generation, and MCP generation targets. Keep prompt generation working without MCP, then add generation mode as an optional second step that calls a configured MCP tool with the generated prompt and selected media inputs.

**Tech Stack:** Node.js ESM, Express, browser HTML/CSS/JS, local child processes with `spawn(..., { shell: false })`, optional `@modelcontextprotocol/sdk` for MCP stdio clients.

---

## Scope

This plan is for the app workflow change only. It does not clean the repo for public release, remove private history/images, add a README, or publish to GitHub. Those should be a separate release-readiness plan.

## Target UX

The first control row becomes:

- Work mode: `Prompt` / `Generate`
- Content mode: `Video` / `Image`
- CLI: selected local command, displayed as `CLI`

Prompt mode:

1. User picks a local CLI.
2. User writes request and optionally attaches/reference-selects images.
3. App calls the selected CLI to produce structured JSON prompts.
4. App renders the same result cards it does today.

Generate mode:

1. User picks a local CLI.
2. User picks content mode: image or video.
3. User picks an MCP target with matching capability.
4. App first generates the prompt using the selected CLI.
5. App then sends the selected prompt and media inputs to the selected MCP tool.
6. App shows the prompt plus the MCP call result.

## Files

- Modify: `server.js`
  - Keep Express routes.
  - Replace hard-coded `callClaude`, `callCodex`, and `callEngine` with generic CLI and MCP helpers.
  - Add API routes for CLI discovery, settings, MCP targets, and MCP tool calls.

- Create: `lib/cli-registry.js`
  - Known local CLI definitions.
  - Cross-platform command discovery.
  - Safe command normalization.

- Create: `lib/cli-runner.js`
  - Runs selected CLI with prompt text and optional image path.
  - No shell interpolation for user-supplied values.
  - Returns stdout/stderr/code.

- Create: `lib/settings-store.js`
  - Reads/writes local ignored settings.
  - Stores selected CLI and configured MCP targets outside public committed source.

- Create: `lib/mcp-registry.js`
  - Validates MCP target config.
  - Lists MCP tools.
  - Calls selected tool for generation mode.

- Create: `lib/json-response.js`
  - Moves current `extractJson` out of `server.js`.

- Modify: `public/index.html`
  - Rename engine selector to CLI selector.
  - Add setup popover/modal for CLI selection.
  - Add Prompt/Generate segmented control.
  - Add MCP target selector shown only in Generate mode.

- Modify: `public/app.js`
  - Replace `ENGINE` with `SELECTED_CLI`.
  - Add `WORKFLOW_MODE = 'prompt' | 'generate'`.
  - Load `/api/cli`.
  - Load/save `/api/settings`.
  - Load `/api/mcp/targets`.
  - Include selected CLI, workflow mode, and MCP target in `/api/generate`.

- Modify: `public/style.css`
  - Add styles for CLI picker, tool availability states, and MCP selector.
  - Remove Claude/Codex-specific chip colors.

- Modify: `package.json`
  - Add `@modelcontextprotocol/sdk` only when direct MCP execution is implemented.
  - Add scripts for tests if test files are added.

- Create: `.gitignore`
  - Ignore `history/`, `images/uploads/`, logs, `.playwright-mcp/`, and local settings.

## Data Contracts

### CLI Definition

```js
{
  id: 'codex',
  label: 'Codex',
  commands: ['codex', 'codex.cmd'],
  kind: 'text-json',
  supportsImages: true,
  buildArgs({ imagePath }) {
    return imagePath
      ? ['exec', '-s', 'read-only', '--skip-git-repo-check', '-i', imagePath]
      : ['exec', '-s', 'read-only', '--skip-git-repo-check'];
  }
}
```

### User Settings

Persist to `.tastes-fr/settings.local.json`, ignored by git:

```json
{
  "selectedCliId": "codex",
  "customClis": [
    {
      "id": "opencode-local",
      "label": "OpenCode",
      "command": "opencode",
      "args": ["run", "--stdin"],
      "supportsImages": false
    }
  ],
  "mcpTargets": [
    {
      "id": "higgsfield-local",
      "label": "Higgsfield",
      "command": "npx",
      "args": ["-y", "higgsfield-mcp"],
      "capabilities": ["video"],
      "toolName": "generate_video"
    }
  ]
}
```

### Generate Request

```json
{
  "request": "make this photo into a slow cinematic reel",
  "mode": "video",
  "workflowMode": "generate",
  "cliId": "codex",
  "baseImage": "uploads/example.png",
  "taste": null,
  "tasteImage": null,
  "mcpTargetId": "higgsfield-local",
  "promptKey": "runway"
}
```

## Task 1: Add Local Settings Store

**Files:**
- Create: `lib/settings-store.js`
- Modify: `.gitignore`

- [ ] **Step 1: Create `.gitignore` entries**

Add:

```gitignore
node_modules/
history/
images/uploads/
.playwright-mcp/
.tastes-fr/
*.log
server.out.log
server.err.log
```

- [ ] **Step 2: Create settings helper**

Create `lib/settings-store.js`:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SETTINGS = {
  selectedCliId: null,
  customClis: [],
  mcpTargets: []
};

export function settingsPath(root) {
  return path.join(root, '.tastes-fr', 'settings.local.json');
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
```

- [ ] **Step 3: Add server routes**

In `server.js`, import helpers and add:

```js
import { readSettings, writeSettings } from './lib/settings-store.js';

app.get('/api/settings', async (_req, res) => {
  res.json({ ok: true, settings: await readSettings(ROOT) });
});

app.put('/api/settings', async (req, res) => {
  try {
    const settings = await writeSettings(ROOT, req.body || {});
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
```

- [ ] **Step 4: Verify settings route**

Run:

```powershell
npm.cmd start
```

Expected server output:

```text
tastes fr -> http://localhost:5174
```

Run:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5174/api/settings
```

Expected: HTTP `200` and JSON with `selectedCliId`, `customClis`, and `mcpTargets`.

## Task 2: Add Provider-Neutral CLI Discovery

**Files:**
- Create: `lib/cli-registry.js`
- Modify: `server.js`

- [ ] **Step 1: Create CLI registry**

Create `lib/cli-registry.js`:

```js
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
```

- [ ] **Step 2: Add `/api/cli` route**

In `server.js`:

```js
import { listAvailableClis } from './lib/cli-registry.js';

app.get('/api/cli', async (_req, res) => {
  const settings = await readSettings(ROOT);
  const clis = await listAvailableClis(settings);
  res.json({ ok: true, clis, selectedCliId: settings.selectedCliId });
});
```

- [ ] **Step 3: Verify CLI route**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5174/api/cli
```

Expected: HTTP `200`, JSON list containing `claude`, `codex`, and `opencode`, each with `available: true/false`.

## Task 3: Replace Hard-Coded Engine Runner

**Files:**
- Create: `lib/cli-runner.js`
- Create: `lib/json-response.js`
- Modify: `server.js`

- [ ] **Step 1: Move JSON extraction**

Create `lib/json-response.js`:

```js
export function extractJson(text) {
  let t = String(text || '').replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('No JSON in response');
  let body = t.slice(start, end + 1);

  try { return JSON.parse(body); } catch {}

  let repaired = body
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,(\s*[\]}])/g, '$1');
  try { return JSON.parse(repaired); } catch {}

  repaired = repaired.replace(/"((?:[^"\\]|\\.)*?)"/gs, (m, inner) => {
    return '"' + inner.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  });
  return JSON.parse(repaired);
}
```

- [ ] **Step 2: Create generic CLI runner**

Create `lib/cli-runner.js`:

```js
import { spawn } from 'node:child_process';

export function runCli(cli, executable, systemPrompt, userPrompt, { imagePath = null } = {}) {
  return new Promise((resolve, reject) => {
    const combined = `${systemPrompt}\n\n---\n\nUSER REQUEST:\n${userPrompt}\n\nRespond with the JSON object only.`;
    const args = cli.buildArgs({ imagePath });
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`${cli.label} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout.trim());
    });
    child.stdin.write(combined);
    child.stdin.end();
  });
}
```

- [ ] **Step 3: Replace `callClaude`, `callCodex`, `callEngine`**

In `server.js`, remove those three functions and import:

```js
import { getCliDefinition, listAvailableClis } from './lib/cli-registry.js';
import { runCli } from './lib/cli-runner.js';
import { extractJson } from './lib/json-response.js';
```

Add helper:

```js
async function callSelectedCli(cliId, systemPrompt, userPrompt, opts = {}) {
  const settings = await readSettings(ROOT);
  const cli = getCliDefinition(cliId || settings.selectedCliId, settings);
  if (!cli) throw new Error('No CLI selected. Open CLI settings and choose an installed local CLI.');

  const available = await listAvailableClis(settings);
  const detected = available.find(c => c.id === cli.id);
  if (!detected?.available || !detected.executable) {
    throw new Error(`${cli.label} is not available on this machine. Install it or choose another CLI.`);
  }

  if (opts.imagePath && !cli.supportsImages) {
    throw new Error(`${cli.label} does not support image input in this app. Choose a CLI with image support or remove the image.`);
  }

  return runCli(cli, detected.executable, systemPrompt, userPrompt, opts);
}
```

- [ ] **Step 4: Update existing routes**

In `/api/extract-taste`, change request parsing:

```js
const { tasteImage, cliId = null } = req.body || {};
```

Replace:

```js
const raw = await callEngine(safeEngine, system, intent, { imagePath: absPath });
```

with:

```js
const raw = await callSelectedCli(cliId, system, intent, { imagePath: absPath });
```

In `/api/generate`, change request parsing:

```js
const {
  request,
  mode = 'video',
  workflowMode = 'prompt',
  baseImage = null,
  cliId = null,
  taste: extractedTaste = null,
  tasteImage = null,
  mcpTargetId = null,
  promptKey = null
} = req.body || {};
```

Replace:

```js
const raw = await callEngine(safeEngine, system, intent, { imagePath: absPath });
```

with:

```js
const raw = await callSelectedCli(cliId, system, intent, { imagePath: absPath });
```

Persist:

```js
const entry = {
  id,
  ts,
  request,
  mode,
  workflowMode,
  baseImage,
  cliId,
  mcpTargetId,
  promptKey,
  taste: tasteActive ? extractedTaste : null,
  tasteImage: tasteActive ? tasteImage : null,
  result: parsed
};
```

- [ ] **Step 5: Verify prompt generation still works**

Run a POST with a detected CLI id:

```powershell
$body = @{
  request = "a lonely late night street shot"
  mode = "video"
  workflowMode = "prompt"
  cliId = "codex"
} | ConvertTo-Json
Invoke-WebRequest -UseBasicParsing http://localhost:5174/api/generate -Method POST -Body $body -ContentType "application/json"
```

Expected: HTTP `200` with `master_prompt` and `prompts`.

## Task 4: Update UI to CLI and Prompt/Generate Modes

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

- [ ] **Step 1: Replace engine buttons in HTML**

Replace the current engine segment:

```html
<div class="seg engine-seg" id="engine-seg" title="which AI brain to use">
  <button class="seg-btn active" data-engine="claude">claude</button>
  <button class="seg-btn" data-engine="codex">codex</button>
</div>
```

with:

```html
<div class="seg" id="workflow-seg" title="choose what the app should do">
  <button class="seg-btn active" data-workflow="prompt">prompt</button>
  <button class="seg-btn" data-workflow="generate">generate</button>
</div>

<button id="cli-open" type="button" class="mini-btn cli-open">
  CLI: <span id="cli-label">select</span>
</button>
```

Add the CLI modal near the history drawer:

```html
<aside id="cli-drawer" class="drawer hidden">
  <div class="drawer-head">
    <h2>local CLI</h2>
    <button id="cli-close" class="mini-btn">close</button>
  </div>
  <div class="drawer-note">Use any local CLI installed on this machine. The app sends prompts through stdin and reads JSON back.</div>
  <div id="cli-list" class="tool-list"></div>
  <div class="drawer-note">Custom CLI</div>
  <input id="custom-cli-label" class="text-input" placeholder="label, e.g. My CLI" />
  <input id="custom-cli-command" class="text-input" placeholder="command, e.g. opencode" />
  <input id="custom-cli-args" class="text-input" placeholder="args, e.g. run --stdin" />
  <label class="check-row"><input id="custom-cli-images" type="checkbox" /> supports image input</label>
  <button id="custom-cli-save" class="primary small-primary">add custom CLI</button>
</aside>
```

Add MCP section inside composer, hidden by default:

```html
<div id="mcp-row" class="mcp-row hidden">
  <button id="mcp-open" type="button" class="mini-btn">MCP: <span id="mcp-label">select generation tool</span></button>
  <span class="dim">used only in generate mode</span>
</div>
```

- [ ] **Step 2: Replace engine state in JS**

At top of `public/app.js`, replace:

```js
let ENGINE = 'claude';
```

with:

```js
let WORKFLOW_MODE = 'prompt';
let SELECTED_CLI = null;
let CLI_OPTIONS = [];
let MCP_TARGETS = [];
let SELECTED_MCP = null;
```

- [ ] **Step 3: Add CLI loading**

Add:

```js
async function loadCliOptions() {
  const r = await fetch('/api/cli');
  const data = await r.json();
  CLI_OPTIONS = data.clis || [];
  SELECTED_CLI = data.selectedCliId || CLI_OPTIONS.find(c => c.available)?.id || null;
  renderCliState();
}

function renderCliState() {
  const selected = CLI_OPTIONS.find(c => c.id === SELECTED_CLI);
  $('#cli-label').textContent = selected ? selected.label : 'select';
  const list = $('#cli-list');
  if (!list) return;
  list.innerHTML = '';
  for (const cli of CLI_OPTIONS) {
    const div = document.createElement('button');
    div.className = 'tool-option' + (cli.id === SELECTED_CLI ? ' active' : '') + (!cli.available ? ' disabled' : '');
    div.disabled = !cli.available;
    div.innerHTML = `<span>${escapeHtml(cli.label)}</span><span class="dim">${cli.available ? 'available' : 'not found'}</span>`;
    div.addEventListener('click', async () => {
      SELECTED_CLI = cli.id;
      await saveSettings({ selectedCliId: SELECTED_CLI });
      renderCliState();
      closeCliDrawer();
    });
    list.appendChild(div);
  }
}

async function saveSettings(patch) {
  const current = await (await fetch('/api/settings')).json();
  const settings = { ...(current.settings || {}), ...patch };
  await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  });
}
```

- [ ] **Step 4: Add workflow mode behavior**

Add:

```js
function setWorkflowMode(mode) {
  WORKFLOW_MODE = mode === 'generate' ? 'generate' : 'prompt';
  $$('#workflow-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.workflow === WORKFLOW_MODE));
  $('#mcp-row')?.classList.toggle('hidden', WORKFLOW_MODE !== 'generate');
  updateGoLabel();
}

$$('#workflow-seg .seg-btn').forEach(b => b.addEventListener('click', () => setWorkflowMode(b.dataset.workflow)));
```

Update `updateGoLabel()`:

```js
function updateGoLabel() {
  if (WORKFLOW_MODE === 'generate') {
    $('#go').textContent = MODE === 'video' ? 'generate video' : 'generate image';
    return;
  }
  const verb = BASE_IMAGE ? (MODE === 'video' ? 'animate' : 'edit') : 'forge';
  $('#go').textContent = `${verb} prompt`;
}
```

- [ ] **Step 5: Update `/api/generate` call**

In the submit handler body:

```js
body: JSON.stringify({
  request,
  mode: MODE === 'modify' ? 'image' : MODE,
  workflowMode: WORKFLOW_MODE,
  baseImage,
  cliId: SELECTED_CLI,
  taste: TASTE_ACTIVE ? EXTRACTED_TASTE : null,
  tasteImage: TASTE_ACTIVE ? TASTE_IMAGE : null,
  mcpTargetId: WORKFLOW_MODE === 'generate' ? SELECTED_MCP : null
})
```

- [ ] **Step 6: Remove Claude/Codex-specific history chips**

Replace:

```js
<span class="chip engine-chip engine-${escapeAttr(it.engine || 'claude')}">${escapeHtml(it.engine || 'claude')}</span>
```

with:

```js
<span class="chip engine-chip">${escapeHtml(it.cliId || it.engine || 'cli')}</span>
```

In `loadHistory`, replace engine restoration with CLI restoration:

```js
SELECTED_CLI = data.cliId || data.engine || SELECTED_CLI;
renderCliState();
```

- [ ] **Step 7: Add styles**

Add to `public/style.css`:

```css
.cli-open { margin-left: auto; }
.drawer-note { color: var(--ink-dim); font-size: 12px; line-height: 1.5; padding: 8px 10px; }
.tool-list { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
.tool-option {
  border: 1px solid var(--line);
  background: rgba(255,255,255,0.03);
  color: var(--ink);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  justify-content: space-between;
  cursor: pointer;
}
.tool-option.active { border-color: var(--accent); background: rgba(227,107,58,0.12); }
.tool-option.disabled { opacity: .45; cursor: not-allowed; }
.text-input {
  width: calc(100% - 20px);
  margin: 6px 10px;
  border: 1px solid var(--line);
  background: rgba(0,0,0,.25);
  color: var(--ink);
  border-radius: 8px;
  padding: 10px;
}
.check-row { display: flex; gap: 8px; align-items: center; padding: 8px 10px; color: var(--ink-dim); font-size: 12px; }
.small-primary { margin: 8px 10px; width: calc(100% - 20px); }
.mcp-row { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
```

- [ ] **Step 8: Verify UI load**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5174
```

Expected: HTTP `200`.

Open browser and verify:

- The UI shows `CLI: select` or an available CLI name.
- There are no visible `claude` or `codex` engine buttons.
- Prompt/Generate controls are visible.
- MCP row appears only when Generate is selected.

## Task 5: Add MCP Target Registry Without Direct Execution

This task makes MCP visible and configurable. It does not call MCP yet. It keeps generation mode honest by requiring a configured target and returning a clear "not wired yet" response if direct execution is not implemented.

**Files:**
- Create: `lib/mcp-registry.js`
- Modify: `server.js`
- Modify: `public/app.js`

- [ ] **Step 1: Create MCP registry validation**

Create `lib/mcp-registry.js`:

```js
export function normalizeMcpTarget(target) {
  if (!target || typeof target !== 'object') throw new Error('MCP target must be an object');
  const id = String(target.id || '').trim();
  const label = String(target.label || '').trim();
  const command = String(target.command || '').trim();
  const args = Array.isArray(target.args) ? target.args.map(String) : [];
  const capabilities = Array.isArray(target.capabilities)
    ? target.capabilities.filter(x => ['image', 'video', 'audio'].includes(x))
    : [];
  const toolName = String(target.toolName || '').trim();

  if (!id || !/^[a-z0-9_-]+$/i.test(id)) throw new Error('MCP target id must be letters, numbers, dash, or underscore');
  if (!label) throw new Error('MCP target label is required');
  if (!command) throw new Error('MCP target command is required');
  if (!capabilities.length) throw new Error('MCP target needs at least one capability: image, video, or audio');
  if (!toolName) throw new Error('MCP target toolName is required');

  return { id, label, command, args, capabilities, toolName };
}

export function listCompatibleTargets(settings, mode) {
  const targets = settings.mcpTargets || [];
  return targets.filter(t => Array.isArray(t.capabilities) && t.capabilities.includes(mode));
}
```

- [ ] **Step 2: Add MCP target routes**

In `server.js`:

```js
import { listCompatibleTargets, normalizeMcpTarget } from './lib/mcp-registry.js';

app.get('/api/mcp/targets', async (req, res) => {
  const settings = await readSettings(ROOT);
  const mode = req.query.mode ? String(req.query.mode) : null;
  const targets = mode ? listCompatibleTargets(settings, mode) : settings.mcpTargets;
  res.json({ ok: true, targets });
});

app.post('/api/mcp/targets', async (req, res) => {
  try {
    const settings = await readSettings(ROOT);
    const target = normalizeMcpTarget(req.body || {});
    const mcpTargets = [
      ...(settings.mcpTargets || []).filter(t => t.id !== target.id),
      target
    ];
    const next = await writeSettings(ROOT, { ...settings, mcpTargets });
    res.json({ ok: true, targets: next.mcpTargets });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});
```

- [ ] **Step 3: Wire frontend target loading**

Add to `public/app.js`:

```js
async function loadMcpTargets() {
  const mode = MODE === 'modify' ? 'image' : MODE;
  const r = await fetch('/api/mcp/targets?mode=' + encodeURIComponent(mode));
  const data = await r.json();
  MCP_TARGETS = data.targets || [];
  if (!MCP_TARGETS.find(t => t.id === SELECTED_MCP)) {
    SELECTED_MCP = MCP_TARGETS[0]?.id || null;
  }
  renderMcpState();
}

function renderMcpState() {
  const selected = MCP_TARGETS.find(t => t.id === SELECTED_MCP);
  $('#mcp-label').textContent = selected ? selected.label : 'select generation tool';
}
```

Call `loadMcpTargets()` when mode or workflow changes.

- [ ] **Step 4: Guard generate mode before API call**

In submit handler before fetch:

```js
if (!SELECTED_CLI) {
  $('#status').textContent = 'select a local CLI first';
  return;
}

if (WORKFLOW_MODE === 'generate' && !SELECTED_MCP) {
  $('#status').textContent = 'select or add an MCP generation target first';
  return;
}
```

- [ ] **Step 5: Verify MCP target storage**

Run:

```powershell
$target = @{
  id = "example-video"
  label = "Example Video MCP"
  command = "npx"
  args = @("-y", "example-video-mcp")
  capabilities = @("video")
  toolName = "generate_video"
} | ConvertTo-Json
Invoke-WebRequest -UseBasicParsing http://localhost:5174/api/mcp/targets -Method POST -Body $target -ContentType "application/json"
Invoke-WebRequest -UseBasicParsing "http://localhost:5174/api/mcp/targets?mode=video"
```

Expected: both requests return HTTP `200`, and the target is listed for video mode.

## Task 6: Add Direct MCP Generation Execution

This is the riskier layer. Implement it after Tasks 1-5 are working.

**Files:**
- Modify: `package.json`
- Modify: `lib/mcp-registry.js`
- Modify: `server.js`

- [ ] **Step 1: Install SDK**

Run:

```powershell
npm.cmd install @modelcontextprotocol/sdk
```

Expected: dependency added to `package.json` and `package-lock.json`.

- [ ] **Step 2: Add MCP call helper**

Extend `lib/mcp-registry.js`:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export async function callMcpTarget(target, payload) {
  const clean = normalizeMcpTarget(target);
  const transport = new StdioClientTransport({
    command: clean.command,
    args: clean.args
  });
  const client = new Client({ name: 'tastes-fr', version: '1.0.0' });
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: clean.toolName,
      arguments: payload
    });
    return result;
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 3: Add generation mode post-processing**

In `/api/generate`, after `parsed` is created:

```js
let generation = null;
if (workflowMode === 'generate') {
  const settings = await readSettings(ROOT);
  const target = (settings.mcpTargets || []).find(t => t.id === mcpTargetId);
  if (!target) throw new Error('Selected MCP target was not found');
  if (!target.capabilities.includes(mode)) throw new Error(`Selected MCP target does not support ${mode}`);

  const selectedPrompt =
    (promptKey && parsed.prompts?.[promptKey]) ||
    parsed.prompts?.runway ||
    parsed.prompts?.midjourney ||
    parsed.master_prompt;

  if (!selectedPrompt) throw new Error('No prompt was available to send to MCP target');

  generation = await callMcpTarget(target, {
    prompt: selectedPrompt,
    mode,
    baseImage: baseImage ? path.join(ROOT, 'images', baseImage).replace(/\\/g, '/') : null,
    request,
    negativePrompt: parsed.negative_prompt || ''
  });
}
```

Add `generation` to the response and history entry:

```js
res.json({ ok: true, ...parsed, generation, raw, _id: id });
```

- [ ] **Step 4: Render generation result**

In `public/app.js`, inside `render(d)`, add a card if `d.generation` exists:

```js
if (d.generation) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head"><h2>generation result</h2></div>
    <pre>${escapeHtml(JSON.stringify(d.generation, null, 2))}</pre>
  `;
  $('#result').prepend(card);
}
```

- [ ] **Step 5: Verify with a test MCP server**

Use a local test MCP server before trying Higgsfield or paid tools. Expected behavior:

- App starts.
- MCP target is visible in Generate mode.
- Generate mode first creates the prompt.
- The selected MCP tool receives `prompt`, `mode`, `baseImage`, `request`, and `negativePrompt`.
- The generation result appears in the UI.

## Task 7: Open-Source Safety Pass

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`
- Review: `history/`, `images/uploads/`, `.playwright-mcp/`

- [ ] **Step 1: Add README setup section**

Document:

```md
## How it works

Tastes FR is a local prompt workflow. It does not ship with Claude, Codex, OpenCode, Higgsfield, or any MCP server. Install your own CLI tools, then select them inside the app.

Prompt mode uses a selected local AI CLI to turn your taste library and request into structured prompts.

Generate mode first creates the prompt, then sends it to a user-configured MCP generation target.
```

- [ ] **Step 2: Add security note**

Document:

```md
## Security

Only configure CLI and MCP commands you trust. This app runs local commands on your machine. Local settings are stored in `.tastes-fr/settings.local.json`, which should not be committed.
```

- [ ] **Step 3: Verify private data is ignored**

Run:

```powershell
git status --short
```

Expected after initializing git: no `history/`, no `images/uploads/`, no `.playwright-mcp/`, no logs, no `.tastes-fr/`.

## Execution Order

1. Task 1: settings store
2. Task 2: CLI discovery
3. Task 3: provider-neutral prompt execution
4. Task 4: UI workflow changes
5. Task 5: MCP target registry
6. Task 6: direct MCP execution
7. Task 7: open-source safety docs

## Risk Controls

- Do not use `shell: true` for local CLI/MCP execution.
- Do not commit `.tastes-fr/settings.local.json`.
- Do not commit generated history or uploaded images.
- Keep MCP execution optional.
- Make Prompt mode fully usable even when MCP is not configured.
- Treat Higgsfield and other generation MCPs as user-provided integrations, not bundled dependencies.

## Recommended MVP Cut

Ship Tasks 1-5 first. That makes the project open-source friendly and provider-neutral while avoiding the most fragile MCP execution layer. Then implement Task 6 after confirming one real MCP target shape.
