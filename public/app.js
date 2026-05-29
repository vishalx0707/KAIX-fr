const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let MODE = 'video';
let WORKFLOW_MODE = 'prompt';
let SELECTED_CLI = null;
let CLI_OPTIONS = [];
let MCP_TARGETS = [];
let SELECTED_MCP = null;
let IMAGES = [];
let BASE_IMAGE = null;
let TASTE_IMAGE = null;       // style-source image (relative path)
let TASTE_EXTRACTED = null;   // { image, taste } — only set after Extract Taste succeeds

async function loadImages() {
  const r = await fetch('/api/images');
  const { images } = await r.json();
  IMAGES = images;

  // Gallery
  const g = $('#gallery');
  g.innerHTML = '';
  for (const img of images) {
    const item = document.createElement('div');
    item.className = 'g-item';

    const el = document.createElement('img');
    el.src = '/images/' + img;
    el.alt = img;
    el.title = img;
    el.loading = 'lazy';
    el.addEventListener('click', () => {
      setMode('modify');
      selectBase(img);
      $('#request').focus();
    });

    // ✦ send to taste slot (style source)
    const taste = document.createElement('button');
    taste.className = 'g-taste';
    taste.title = 'use as taste reference (style only)';
    taste.textContent = '✦';
    taste.addEventListener('click', e => {
      e.stopPropagation();
      selectTaste(img);
      $('#taste-status').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const del = document.createElement('button');
    del.className = 'g-del';
    del.title = 'delete from library';
    del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); deleteImage(img); });

    item.appendChild(el);
    item.appendChild(taste);
    item.appendChild(del);
    g.appendChild(item);
  }
}

function shortName(p) {
  const m = p.match(/(\d+)_/);
  return m ? '#' + m[1] : p.split('/').pop().slice(0, 8);
}

async function deleteImage(img) {
  if (!confirm(`Delete "${img.split('/').pop()}" from your library?\nThis permanently removes the file.`)) return;
  $('#status').textContent = 'deleting…';
  try {
    const r = await fetch('/api/images', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: img }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'delete failed');
    // If the deleted image was selected anywhere, clear it.
    if (BASE_IMAGE === img) selectBase(null);
    if (TASTE_IMAGE === img) selectTaste(null);
    await loadImages();
    $('#status').textContent = 'deleted ' + img.split('/').pop();
  } catch (e) {
    $('#status').textContent = 'delete error: ' + e.message;
  }
}

function selectBase(img) {
  BASE_IMAGE = img;
  $$('#base-picker .pick').forEach(p => p.classList.toggle('selected', p.dataset.path === img));
  $('#base-selected-name').textContent = img ? '· ' + img.split('/').pop() : '';
  $('#base-clear').classList.toggle('hidden', !img);
  // Inline attach chip
  const chip = $('#attach-chip');
  if (img) {
    chip.classList.remove('hidden');
    $('#attach-thumb').src = '/images/' + img;
    $('#attach-name').textContent = img.split('/').pop();
  } else {
    chip.classList.add('hidden');
  }
  updateGoLabel();
}

async function getSettings() {
  const r = await fetch('/api/settings');
  const data = await r.json();
  return data.settings || {};
}

async function saveSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

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
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'tool-option' + (cli.id === SELECTED_CLI ? ' active' : '') + (!cli.available ? ' disabled' : '');
    item.disabled = !cli.available;
    item.innerHTML = `
      <span>${escapeHtml(cli.label)}</span>
      <span class="dim">${cli.available ? 'available' : 'not found'}</span>
    `;
    item.addEventListener('click', async () => {
      SELECTED_CLI = cli.id;
      await saveSettings({ selectedCliId: SELECTED_CLI });
      renderCliState();
      closeCliDrawer();
    });
    list.appendChild(item);
  }
}

function openCliDrawer() {
  $('#cli-drawer').classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
  renderCliState();
}

function closeCliDrawer() {
  $('#cli-drawer').classList.add('hidden');
  if ($('#history-drawer').classList.contains('hidden')) {
    $('#drawer-backdrop').classList.add('hidden');
  }
}

function parseArgs(input) {
  const args = [];
  const re = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let m;
  while ((m = re.exec(input || ''))) args.push(m[1] ?? m[2] ?? m[0]);
  return args;
}

function customCliId(command) {
  const base = command.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'cli';
  return `custom-${base}-${Date.now().toString(36)}`;
}

$('#base-clear').addEventListener('click', () => selectBase(null));

// --- Taste Reference (style source only) ---
let LAST_TASTE = null;   // last taste object viewable in the popup (current or from history)

function swatchHtml(colors) {
  return (Array.isArray(colors) ? colors : []).map(c => {
    const m = String(c).match(/#?[0-9a-fA-F]{6}/);
    const hx = m ? (m[0][0] === '#' ? m[0] : '#' + m[0]) : '#888';
    return `<span class="ts-sw" style="background:${escapeAttr(hx)}" title="${escapeAttr(c)}"></span>`;
  }).join('');
}

// Reflect the extract button + compact swatch row for the current taste state.
function updateTasteUI() {
  const btn = $('#extract-taste');
  const row = $('#taste-swatches-row');
  const extracted = !!(TASTE_IMAGE && TASTE_EXTRACTED && TASTE_EXTRACTED.image === TASTE_IMAGE);
  btn.disabled = !TASTE_IMAGE;
  btn.classList.toggle('armed', extracted);
  btn.textContent = extracted ? '✓ taste extracted — view' : '✦ extract taste';
  if (extracted) {
    row.innerHTML = swatchHtml(TASTE_EXTRACTED.taste.colors);
    row.classList.remove('hidden');
    $('#taste-status').textContent = 'will fuse on generate · click to view';
  } else {
    row.innerHTML = '';
    row.classList.add('hidden');
    $('#taste-status').textContent = TASTE_IMAGE ? 'not extracted yet — press extract taste' : '';
  }
}

function selectTaste(img) {
  TASTE_IMAGE = img;
  $('#taste-clear').classList.toggle('hidden', !img);
  const chip = $('#taste-chip');
  const thumb = $('#taste-thumb');
  const hint = $('#taste-zone-hint');
  if (img) {
    chip.classList.remove('hidden');
    $('#taste-name').textContent = img.split('/').pop();
    thumb.src = '/images/' + img;
    thumb.classList.remove('hidden');
    hint.classList.add('hidden');
  } else {
    chip.classList.add('hidden');
    thumb.classList.add('hidden');
    thumb.removeAttribute('src');
    hint.classList.remove('hidden');
  }
  // Changing (or clearing) the taste image invalidates any prior extraction.
  if (!TASTE_EXTRACTED || TASTE_EXTRACTED.image !== img) {
    TASTE_EXTRACTED = null;
    closeTasteModal();
  }
  updateTasteUI();
}

// Build the popup content (only shown on demand).
function renderTasteSummary(t) {
  LAST_TASTE = t;
  const box = $('#taste-summary');
  const rows = [
    ['lighting', t.lighting], ['blur', t.blur], ['grain', t.grain],
    ['shadows', t.shadows], ['highlights', t.highlights], ['contrast', t.contrast],
    ['mood', t.mood], ['framing', t.framing], ['camera', t.camera_feel],
  ].filter(([, v]) => v);
  box.innerHTML = `
    <div class="ts-head">
      <span>extracted taste <span class="dim">— style source</span></span>
      <button class="mini-btn" id="taste-modal-close" type="button">close</button>
    </div>
    ${swatchHtml(t.colors) ? `<div class="ts-colors">${swatchHtml(t.colors)}</div>` : ''}
    ${t.aesthetic ? `<div class="ts-aesthetic">${escapeHtml(t.aesthetic)}</div>` : ''}
    <div class="ts-grid">${rows.map(([k, v]) => `<div class="ts-row"><span class="ts-k">${escapeHtml(k)}</span><span class="ts-v">${escapeHtml(v)}</span></div>`).join('')}</div>
  `;
  $('#taste-modal-close').addEventListener('click', closeTasteModal);
}

function openTasteModal(t) {
  if (t) renderTasteSummary(t);
  else if (LAST_TASTE) renderTasteSummary(LAST_TASTE);
  else return;
  $('#taste-summary').classList.remove('hidden');
  $('#taste-modal-backdrop').classList.remove('hidden');
}
function closeTasteModal() {
  $('#taste-summary').classList.add('hidden');
  $('#taste-modal-backdrop').classList.add('hidden');
}
$('#taste-modal-backdrop').addEventListener('click', closeTasteModal);

// Taste clear / remove
$('#taste-clear').addEventListener('click', () => selectTaste(null));
$('#taste-remove').addEventListener('click', () => selectTaste(null));
$('#taste-swatches-row').addEventListener('click', () => { if (TASTE_EXTRACTED) openTasteModal(TASTE_EXTRACTED.taste); });

// Taste zone: upload / drag-drop / paste
const tasteZone = $('#taste-zone');
const tasteInput = $('#taste-input');
$('#taste-upload-link').addEventListener('click', e => { e.preventDefault(); tasteInput.click(); });
tasteInput.addEventListener('change', e => handleFiles(e.target.files, 'taste'));
['dragenter', 'dragover'].forEach(ev => tasteZone.addEventListener(ev, e => { e.preventDefault(); tasteZone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => tasteZone.addEventListener(ev, e => { e.preventDefault(); tasteZone.classList.remove('drag'); }));
tasteZone.addEventListener('drop', e => { if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, 'taste'); });
tasteZone.addEventListener('paste', e => {
  const items = [...(e.clipboardData?.items || [])];
  const imgs = items.filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  if (imgs.length) { e.preventDefault(); handleFiles(imgs, 'taste'); }
});

// Extract Taste — extracts if new; if already extracted, opens the popup instead.
$('#extract-taste').addEventListener('click', async () => {
  if (!TASTE_IMAGE) return;
  if (!SELECTED_CLI) {
    $('#taste-status').textContent = 'select a local CLI first';
    openCliDrawer();
    return;
  }
  // Already extracted for this image → just show the popup.
  if (TASTE_EXTRACTED && TASTE_EXTRACTED.image === TASTE_IMAGE) {
    openTasteModal(TASTE_EXTRACTED.taste);
    return;
  }
  const btn = $('#extract-taste');
  btn.disabled = true;
  btn.textContent = '✦ extracting…';
  $('#taste-status').textContent = 'reading the look… (10-40s)';
  try {
    const r = await fetch('/api/extract-taste', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tasteImage: TASTE_IMAGE, cliId: SELECTED_CLI }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'extract failed');
    TASTE_EXTRACTED = { image: TASTE_IMAGE, taste: data.taste };
    updateTasteUI();
    openTasteModal(data.taste);   // pop up once so you can see what was pulled
  } catch (e) {
    $('#taste-status').textContent = 'error: ' + e.message;
    updateTasteUI();
  }
});

function setMode(mode) {
  MODE = mode;
  $$('#mode-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  updateGoLabel();
}

function setWorkflowMode(mode) {
  WORKFLOW_MODE = mode === 'generate' ? 'generate' : 'prompt';
  $$('#workflow-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.workflow === WORKFLOW_MODE));
  $('#mcp-row')?.classList.toggle('hidden', WORKFLOW_MODE !== 'generate');
  updateGoLabel();
}

function updateGoLabel() {
  if (WORKFLOW_MODE === 'generate') {
    $('#go').textContent = MODE === 'video' ? 'generate video' : 'generate image';
    return;
  }
  const verb = BASE_IMAGE ? (MODE === 'video' ? 'animate' : 'edit') : 'forge';
  $('#go').textContent = `${verb} prompt`;
}

$$('#mode-seg .seg-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
$$('#workflow-seg .seg-btn').forEach(b => b.addEventListener('click', () => setWorkflowMode(b.dataset.workflow)));
$('#cli-open').addEventListener('click', openCliDrawer);
$('#cli-close').addEventListener('click', closeCliDrawer);
$('#mcp-open').addEventListener('click', () => {
  $('#status').textContent = 'MCP target setup is next; prompt mode is ready';
});
$('#custom-cli-save').addEventListener('click', async () => {
  const command = $('#custom-cli-command').value.trim();
  if (!command) {
    $('#status').textContent = 'custom CLI command required';
    return;
  }
  const settings = await getSettings();
  const custom = {
    id: customCliId(command),
    label: $('#custom-cli-label').value.trim() || command,
    command,
    args: parseArgs($('#custom-cli-args').value),
    supportsImages: $('#custom-cli-images').checked
  };
  await saveSettings({
    customClis: [...(settings.customClis || []), custom],
    selectedCliId: custom.id
  });
  $('#custom-cli-label').value = '';
  $('#custom-cli-command').value = '';
  $('#custom-cli-args').value = '';
  $('#custom-cli-images').checked = false;
  await loadCliOptions();
  $('#status').textContent = 'custom CLI added';
});

// Ref panel toggle
$('#ref-toggle').addEventListener('click', () => {
  const panel = $('#ref-panel');
  const open = panel.classList.toggle('hidden');
  $('#ref-toggle-arrow').textContent = open ? '▶' : '▼';
});

// Upload
const uploadZone = $('#upload-zone');
const uploadInput = $('#upload-input');
$('#upload-link').addEventListener('click', e => { e.preventDefault(); uploadInput.click(); });
uploadInput.addEventListener('change', e => handleFiles(e.target.files));
['dragenter','dragover'].forEach(ev => uploadZone.addEventListener(ev, e => { e.preventDefault(); uploadZone.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => uploadZone.addEventListener(ev, e => { e.preventDefault(); uploadZone.classList.remove('drag'); }));
uploadZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

async function handleFiles(fileList, target = 'main') {
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  $('#status').textContent = `uploading ${files.length}…`;
  const payload = await Promise.all(files.map(f => new Promise(res => {
    const r = new FileReader();
    r.onload = () => res({ name: f.name || `pasted_${Date.now()}.png`, data: r.result });
    r.readAsDataURL(f);
  })));
  const r = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: payload }),
  });
  const data = await r.json();
  if (data.ok) {
    await loadImages();
    if (data.saved[0]) {
      if (target === 'taste') {
        selectTaste(data.saved[0]);
        $('#status').textContent = `taste image saved — press extract taste`;
      } else {
        selectBase(data.saved[0]);
        $('#status').textContent = `attached + saved to gallery (${data.saved.length})`;
      }
    }
  } else {
    $('#status').textContent = 'upload failed: ' + (data.error || '');
  }
}

// Inline attach button
$('#attach-btn').addEventListener('click', () => $('#attach-input').click());
$('#attach-input').addEventListener('change', e => handleFiles(e.target.files));
$('#attach-remove').addEventListener('click', () => selectBase(null));

// Drag & drop directly on textarea
const ta = $('#request');
['dragenter','dragover'].forEach(ev => ta.addEventListener(ev, e => { e.preventDefault(); ta.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => ta.addEventListener(ev, e => { e.preventDefault(); ta.classList.remove('drag'); }));
ta.addEventListener('drop', e => {
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

// Paste image from clipboard
ta.addEventListener('paste', e => {
  const items = [...(e.clipboardData?.items || [])];
  const imgs = items.filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  if (imgs.length) {
    e.preventDefault();
    handleFiles(imgs);
  }
});

$('#go').addEventListener('click', async () => {
  const request = $('#request').value.trim();
  if (!request) { $('#request').focus(); return; }
  if (!SELECTED_CLI) {
    $('#status').textContent = 'select a local CLI first';
    openCliDrawer();
    return;
  }

  const baseImage = BASE_IMAGE || null;

  // Taste fusion is gated: ONLY active if Extract Taste succeeded AND the image hasn't changed since.
  const tasteActive = !!(TASTE_EXTRACTED && TASTE_EXTRACTED.image === TASTE_IMAGE);

  const btn = $('#go');
  btn.disabled = true;
  $('#status').textContent = tasteActive ? 'forging with fused taste… (20-60s)' : 'forging… (this can take 20-60s)';

  try {
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request,
        mode: MODE === 'modify' ? 'image' : MODE,
        workflowMode: WORKFLOW_MODE,
        baseImage,
        cliId: SELECTED_CLI,
        taste: tasteActive ? TASTE_EXTRACTED.taste : null,
        tasteImage: tasteActive ? TASTE_IMAGE : null,
        mcpTargetId: WORKFLOW_MODE === 'generate' ? SELECTED_MCP : null,
      }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'unknown error');
    render(data);
    // Reflect taste fusion in the output.
    const badge = $('#fused-badge');
    if (tasteActive) { LAST_TASTE = TASTE_EXTRACTED.taste; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
    $('#status').textContent = tasteActive ? 'done · taste fused' : 'done';
  } catch (e) {
    $('#status').textContent = 'error: ' + e.message;
    console.error(e);
  } finally {
    btn.disabled = false;
  }
});

// "view taste" link inside the fused badge opens the popup.
$('#fused-view').addEventListener('click', () => openTasteModal());

const PLATFORM_LABELS = {
  midjourney: 'Midjourney v6/v7',
  runway: 'Runway Gen-3 / Gen-4',
  sora: 'Sora',
  flux: 'Flux / Flux Pro',
  nano_banana: 'Nano Banana / Flux Kontext (edit)',
  kling: 'Kling 1.6',
  luma: 'Luma Dream Machine',
};

function render(d) {
  $('#result').classList.remove('hidden');
  $('#neg-text').textContent = d.negative_prompt || '';
  $('#audio-text').textContent = d.audio_suggestion || '';

  // Image analysis (only if returned)
  const anaCard = $('#analysis-card');
  if (d.analysis) {
    anaCard.classList.remove('hidden');
    $('#analysis-subject').innerHTML = d.analysis.subject ? `<span class="ana-label">subject</span> ${escapeHtml(d.analysis.subject)}` : '';
    $('#analysis-lighting').innerHTML = d.analysis.lighting ? `<span class="ana-label">lighting</span> ${escapeHtml(d.analysis.lighting)}` : '';
    $('#analysis-composition').innerHTML = d.analysis.composition ? `<span class="ana-label">composition</span> ${escapeHtml(d.analysis.composition)}` : '';

    // Color grade with gradient bar
    const grade = d.analysis.color_grade || {};
    $('#grade-name').textContent = grade.name || '';
    $('#grade-notes').textContent = grade.notes || '';
    const stops = Array.isArray(grade.stops) ? grade.stops : [];
    const bar = $('#grade-bar');
    if (stops.length) {
      bar.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
      bar.style.display = 'block';
    } else { bar.style.display = 'none'; }
    const stopsEl = $('#grade-stops');
    stopsEl.innerHTML = stops.map(s => `<span class="stop" style="background:${escapeAttr(s)}" title="${escapeAttr(s)}"><span>${escapeHtml(s)}</span></span>`).join('');

    // Film stock / sensor
    const stock = d.analysis.film_stock || {};
    $('#stock-name').innerHTML = stock.name ? `${escapeHtml(stock.name)} <span class="conf conf-${escapeAttr(stock.confidence || '')}">${escapeHtml(stock.confidence || '')}</span>` : '';
    $('#stock-tells').textContent = stock.tells || '';

    // Grain
    const grain = d.analysis.grain || {};
    $('#grain-type').innerHTML = grain.type ? `${escapeHtml(grain.type)} <span class="chip">${escapeHtml(grain.intensity || '')}</span>` : '';
    $('#grain-meta').textContent = grain.characteristics || '';
    const pal = $('#palette');
    pal.innerHTML = '';
    for (const sw of (d.analysis.palette || [])) {
      const c = document.createElement('div');
      c.className = 'swatch';
      c.innerHTML = `<div class="swatch-chip" style="background:${escapeAttr(sw.hex)}"></div><div class="swatch-hex">${escapeHtml(sw.hex)}</div><div class="swatch-role">${escapeHtml(sw.role || '')}</div>`;
      c.addEventListener('click', () => navigator.clipboard.writeText(sw.hex));
      c.title = 'click to copy hex';
      pal.appendChild(c);
    }
    const mood = $('#analysis-mood');
    mood.innerHTML = '';
    for (const m of (d.analysis.mood_keywords || [])) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = m;
      mood.appendChild(chip);
    }
  } else {
    anaCard.classList.add('hidden');
  }

  // Designer breakdown
  const bd = $('#breakdown');
  bd.innerHTML = '';
  if (d.breakdown) {
    for (const [k, v] of Object.entries(d.breakdown)) {
      if (!v) continue;
      const row = document.createElement('div');
      row.className = 'bd-row';
      row.innerHTML = `<div class="bd-key">${escapeHtml(k.replace(/_/g, ' '))}</div><div class="bd-val">${escapeHtml(v)}</div>`;
      bd.appendChild(row);
    }
  }

  // Style references
  const sr = $('#style-refs');
  sr.innerHTML = '';
  if (d.style_references) {
    for (const [k, arr] of Object.entries(d.style_references)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      const group = document.createElement('div');
      group.className = 'sr-group';
      group.innerHTML = `<div class="sr-label">${escapeHtml(k.replace(/_/g, ' '))}</div><div class="sr-items">${arr.map(x => `<span class="chip">${escapeHtml(x)}</span>`).join('')}</div>`;
      sr.appendChild(group);
    }
  }

  // Per-platform prompts
  const pc = $('#prompts-container');
  pc.innerHTML = '';

  // Flagship master prompt (blends every layer) — rendered first, highlighted
  if (d.master_prompt) {
    const mcard = document.createElement('div');
    mcard.className = 'card master-card';
    mcard.innerHTML = `
      <div class="card-head">
        <h2>★ master prompt <span class="dim">— every layer blended</span></h2>
        <button class="copy-btn" data-target="master-prompt">copy</button>
      </div>
      <pre id="master-prompt">${escapeHtml(d.master_prompt)}</pre>
    `;
    pc.appendChild(mcard);
  }

  if (d.prompts) {
    for (const [platform, text] of Object.entries(d.prompts)) {
      if (!text) continue;
      const label = PLATFORM_LABELS[platform] || platform;
      const card = document.createElement('div');
      card.className = 'card';
      const id = 'prompt-' + platform;
      card.innerHTML = `
        <div class="card-head">
          <h2>${escapeHtml(label)}</h2>
          <button class="copy-btn" data-target="${id}">copy</button>
        </div>
        <pre id="${id}">${escapeHtml(text)}</pre>
      `;
      pc.appendChild(card);
    }
  }
  // Wire copy buttons (covers master card + every platform card)
  pc.querySelectorAll('.copy-btn').forEach(b => b.addEventListener('click', async () => {
    const t = document.getElementById(b.dataset.target).textContent;
    await navigator.clipboard.writeText(t);
    b.classList.add('copied'); b.textContent = 'copied';
    setTimeout(() => { b.classList.remove('copied'); b.textContent = 'copy'; }, 1200);
  }));

  // Library references
  const refs = $('#refs');
  refs.innerHTML = '';
  for (const ref of (d.references || [])) {
    const p = ref.path.replace(/^images\//, '');
    const div = document.createElement('div');
    div.className = 'ref';
    div.innerHTML = `<img src="/images/${p}" alt=""><div class="why">${escapeHtml(ref.why || '')}</div>`;
    refs.appendChild(div);
  }

  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

// --- History ---
async function openHistory() {
  $('#history-drawer').classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
  const r = await fetch('/api/history');
  const { items } = await r.json();
  const list = $('#history-list');
  if (!items.length) {
    list.innerHTML = '<div class="hist-empty">no history yet — your forged prompts will appear here</div>';
    return;
  }
  list.innerHTML = '';
  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'hist-item';
    const date = new Date(it.ts);
    const when = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const thumb = it.baseImage
      ? `<img class="hist-thumb" src="/images/${it.baseImage}" alt="">`
      : `<div class="hist-thumb hist-thumb-none">${it.mode === 'video' ? '🎬' : '🖼'}</div>`;
    div.innerHTML = `
      ${thumb}
      <div class="hist-body">
        <div class="hist-meta">
          <span class="chip">${it.mode}${it.baseImage ? ' · edit' : ''}</span>
          <span class="chip cli-chip">${escapeHtml(it.cliId || it.engine || 'cli')}</span>
          <span class="hist-when">${when}</span>
        </div>
        <div class="hist-req">${escapeHtml(it.request)}</div>
      </div>
      <button class="hist-del" title="delete">×</button>
    `;
    div.querySelector('.hist-body').addEventListener('click', () => loadHistory(it.id));
    div.querySelector('.hist-thumb').addEventListener('click', () => loadHistory(it.id));
    div.querySelector('.hist-del').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('delete this history entry?')) return;
      await fetch('/api/history/' + it.id, { method: 'DELETE' });
      openHistory();
    });
    list.appendChild(div);
  }
}

function closeHistory() {
  $('#history-drawer').classList.add('hidden');
  if ($('#cli-drawer').classList.contains('hidden')) {
    $('#drawer-backdrop').classList.add('hidden');
  }
}

async function loadHistory(id) {
  const r = await fetch('/api/history/' + id);
  const data = await r.json();
  if (!data.ok) return;
  // Restore the input fields
  $('#request').value = data.request || '';
  setMode(data.mode === 'video' ? 'video' : 'image');
  setWorkflowMode(data.workflowMode === 'generate' ? 'generate' : 'prompt');
  if (data.baseImage) selectBase(data.baseImage); else selectBase(null);
  SELECTED_CLI = data.cliId || data.engine || SELECTED_CLI;
  renderCliState();
  // Render the result
  render(data.result);
  // Reflect any fused taste from this history entry.
  const badge = $('#fused-badge');
  if (data.taste) { LAST_TASTE = data.taste; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
  closeHistory();
}

$('#history-btn').addEventListener('click', openHistory);
$('#history-close').addEventListener('click', closeHistory);
$('#drawer-backdrop').addEventListener('click', () => {
  closeHistory();
  closeCliDrawer();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

$$('.copy-btn').forEach(b => b.addEventListener('click', async () => {
  const t = $('#' + b.dataset.target).textContent;
  await navigator.clipboard.writeText(t);
  b.classList.add('copied');
  b.textContent = 'copied';
  setTimeout(() => { b.classList.remove('copied'); b.textContent = 'copy'; }, 1200);
}));

loadCliOptions();
loadImages();
setWorkflowMode(WORKFLOW_MODE);
