import express from 'express';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCliDefinition, listAvailableClis } from './lib/cli-registry.js';
import { runCli } from './lib/cli-runner.js';
import { extractJson } from './lib/json-response.js';
import { readSettings, writeSettings } from './lib/settings-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 5174;

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/images', express.static(path.join(ROOT, 'images')));

async function walkImages(dir, base = '') {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) out.push(...await walkImages(full, rel));
    else if (/\.(jpe?g|png|webp|gif)$/i.test(e.name)) out.push(rel);
  }
  return out;
}

async function readTasteProfile() {
  const parts = [];
  const analysisDir = path.join(ROOT, 'analysis');
  try {
    const files = await readdir(analysisDir);
    for (const f of files.filter(f => f.endsWith('.md'))) {
      parts.push(`=== ${f} ===\n` + await readFile(path.join(analysisDir, f), 'utf8'));
    }
  } catch {}
  return parts.join('\n\n');
}

app.get('/api/images', async (_req, res) => {
  const files = await walkImages(path.join(ROOT, 'images'));
  res.json({ images: files });
});

// Delete a single library image. Path-validated to stay inside images/.
app.delete('/api/images', async (req, res) => {
  try {
    const rel = (req.body || {}).path;
    if (!rel || typeof rel !== 'string') return res.status(400).json({ ok: false, error: 'path required' });
    if (!/\.(jpe?g|png|webp|gif)$/i.test(rel)) return res.status(400).json({ ok: false, error: 'not an image file' });
    const imagesRoot = path.resolve(ROOT, 'images');
    const target = path.resolve(imagesRoot, rel);
    // Prevent path traversal — target must live under images/
    if (target !== imagesRoot && !target.startsWith(imagesRoot + path.sep)) {
      return res.status(400).json({ ok: false, error: 'invalid path' });
    }
    const { unlink } = await import('node:fs/promises');
    await unlink(target);
    res.json({ ok: true, deleted: rel });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ ok: false, error: 'file not found' });
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/history', async (_req, res) => {
  const dir = path.join(ROOT, 'history');
  try {
    const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
    const items = [];
    for (const f of files) {
      try {
        const j = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
        items.push({
          id: j.id,
          ts: j.ts,
          request: j.request,
          mode: j.mode,
          workflowMode: j.workflowMode || 'prompt',
          baseImage: j.baseImage || null,
          cliId: j.cliId || j.engine || null,
          engine: j.engine || null
        });
      } catch {}
    }
    items.sort((a, b) => b.ts - a.ts);
    res.json({ items });
  } catch {
    res.json({ items: [] });
  }
});

app.get('/api/history/:id', async (req, res) => {
  const id = req.params.id.replace(/[^a-z0-9_]/gi, '');
  try {
    const j = JSON.parse(await readFile(path.join(ROOT, 'history', `${id}.json`), 'utf8'));
    res.json({ ok: true, ...j });
  } catch (e) {
    res.status(404).json({ ok: false, error: 'not found' });
  }
});

app.delete('/api/history/:id', async (req, res) => {
  const id = req.params.id.replace(/[^a-z0-9_]/gi, '');
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(path.join(ROOT, 'history', `${id}.json`));
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ ok: false, error: 'not found' });
  }
});

app.post('/api/upload', async (req, res) => {
  try {
    const { files } = req.body || {};
    if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'files required' });
    const uploadsDir = path.join(ROOT, 'images', 'uploads');
    await mkdir(uploadsDir, { recursive: true });
    const saved = [];
    for (const f of files) {
      const safeName = (f.name || 'upload').replace(/[^a-z0-9._-]/gi, '_');
      const stamp = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const final = `${stamp}_${safeName}`;
      const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(f.data || '');
      if (!m) continue;
      await writeFile(path.join(uploadsDir, final), Buffer.from(m[1], 'base64'));
      saved.push('uploads/' + final);
    }
    res.json({ ok: true, saved });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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

app.get('/api/cli', async (_req, res) => {
  const settings = await readSettings(ROOT);
  const clis = await listAvailableClis(settings);
  res.json({ ok: true, clis, selectedCliId: settings.selectedCliId });
});

// --- Taste Reference: extract ONLY the aesthetic (never the subject) ---
function buildTasteExtractPrompt() {
  return `You are a cinematographer/colorist analyzing a TASTE REFERENCE image. Your ONLY job is to extract its AESTHETIC — the look, not the content. You must IGNORE and never describe the subject, person, object, animal, brand, text, or scene in the image. Two photos of completely different subjects can share this exact taste; that shared look is what you are pulling out.

Look hard at the actual pixels and report:
  • lighting — direction, quality (hard/soft), source, contrast ratio, how shadows fall
  • blur — intentional blur character: motion blur, shallow-DOF bokeh, lens softness, haze, none. Be specific.
  • colors — 4–6 dominant hex codes with a one-word role each (shadow/mid/skin/accent/highlight)
  • grain — grain/noise type + intensity (fine 35mm, chunky pushed, digital noise, none)
  • shadows — how the shadows behave (lifted/crushed, color cast)
  • highlights — how highlights behave (rolled-off/clipped, halation, bloom, color cast)
  • contrast — overall contrast character (low flat, punchy, milky, high-key)
  • mood — one or two emotional adjectives
  • framing — composition feel (tight/wide, symmetry, negative space, angle) WITHOUT naming the subject
  • camera_feel — what device/format it feels shot on (point-and-shoot flash, anamorphic cine, CCD, medium format, phone)
  • aesthetic — one sentence summarizing the overall vibe in colorist terms

OUTPUT JSON ONLY (no markdown, no prose), exactly:
{
  "lighting": "...",
  "blur": "...",
  "colors": ["#xxxxxx — shadow", "#xxxxxx — mid", "#xxxxxx — highlight"],
  "grain": "...",
  "shadows": "...",
  "highlights": "...",
  "contrast": "...",
  "mood": "...",
  "framing": "...",
  "camera_feel": "...",
  "aesthetic": "..."
}

CRITICAL: Describe ZERO subject content. If you mention what the photo is OF, you have failed. JSON HYGIENE: no raw double-quotes inside string values (use single quotes), no literal newlines inside strings, no trailing commas.`;
}

app.post('/api/extract-taste', async (req, res) => {
  try {
    const { tasteImage, cliId = null } = req.body || {};
    if (!tasteImage || typeof tasteImage !== 'string') return res.status(400).json({ error: 'tasteImage is required' });
    const absPath = path.join(ROOT, 'images', tasteImage).replace(/\\/g, '/');
    const system = buildTasteExtractPrompt();
    const intent = `TASTE REFERENCE IMAGE (absolute path — READ this file first and analyze its actual pixels): ${absPath}

Extract ONLY the aesthetic of this image as described. Never name or describe its subject/content. Respond with the JSON object only.`;
    const raw = await callSelectedCli(cliId, system, intent, { imagePath: absPath });
    const taste = extractJson(raw);
    res.json({ ok: true, taste, image: tasteImage });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

async function callSelectedCli(cliId, systemPrompt, userPrompt, opts = {}) {
  const settings = await readSettings(ROOT);
  const selectedCliId = cliId || settings.selectedCliId;
  const cli = getCliDefinition(selectedCliId, settings);
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

function buildSystemPrompt(taste, images) {
  return `You are a senior prompt designer for AI image/video generators, working at the level of the top Instagram AI creators (think @ohenis, @nicolasvalente, @julian.va, @timrodenbroeker — creators who build cohesive moodboards through obsessive specificity). You write prompts the way a cinematographer writes a lookbook brief, not the way a casual user writes a wish.

YOUR DISCIPLINE — prompts MUST be built from these layers, every time:

  SUBJECT       — who/what, with grounding details (age range, wardrobe specifics, posture, gaze direction)
  ACTION        — verb-led, present-continuous, single-beat ("turning her head", "exhaling smoke") not a list
  SETTING       — location + time of day + weather + small environmental detail (wet asphalt, sodium streetlight buzz)
  CAMERA + LENS — exact body and focal length and aperture ("Contax T2, 38mm f/2.8", "Arri Alexa Mini, 50mm anamorphic")
  FILM / SENSOR — specific stock or sensor look ("Cinestill 800T with halation", "Kodak Portra 400 pushed +1", "Sony Venice 2 with FilmConvert Kodak 2383")
  LIGHTING      — direction + quality + named setup ("low-key motivated practical from a single sodium vapor lamp camera-left, no fill, hard shadow falloff")
  COMPOSITION   — framing + angle + depth ("low-angle medium shot, subject at right third, blurred foreground occluder, deep background bokeh")
  COLOR GRADE   — named grade + hex anchors when possible ("teal-and-orange Kodak 2383 emulation: shadows #0d1a24, midtones #c47b3a, highlights #f5e6c8, lifted black point, halation around #ff5a2a practicals")
  TEXTURE       — grain, halation, gate weave, light leaks, compression artifacts, lens defects ("heavy 35mm grain, anamorphic horizontal flare, gate dust, slight haze")
  MOOD          — one or two emotional adjectives, not five ("wistful, unresolved" not "sad lonely melancholic dreamy nostalgic")
  REFERENCES    — explicit name-checks: cinematographer, photographer, filmmaker, film title, decade

USER'S TASTE PROFILE (the visual language to write in):
${taste}

AVAILABLE REFERENCE IMAGES (relative paths under /images/):
${images.map(i => '- ' + i).join('\n')}

PLATFORM SYNTAX YOU MUST USE CORRECTLY:
  • Midjourney v6/v7: prose paragraph + flags at the end. Always include "--ar 9:16 --style raw". Add "--stylize 150–300" for stylized realism, "--chaos 8–15" for variation, "--weird 30–80" only for surreal. If you suggest a style ref code use "--sref <code>" with a 9-digit placeholder. For character ref use "--cref <url>".
  • Runway Gen-3 / Gen-4: natural-language shot description, ALWAYS include explicit camera move ("slow dolly in", "handheld follow with breathing", "static locked-off", "FPV drift") and timing ("4 seconds, slow"). Image-to-video means describe what HAPPENS, not what IS.
  • Sora: cinematic shot descriptions in present tense, camera direction in language ("the camera pushes in slowly as...").
  • Flux / Flux Pro: tag-and-clause hybrid, lens/sensor specs reward heavily, weight syntax "(neon halation:1.3)" works.
  • Nano Banana / Flux Kontext (image EDIT): start with "keeping the original lighting, grain, and color grade, ..." then state the edit precisely. Always say what NOT to change.
  • Kling 1.6 / Luma Dream Machine: same as Runway in spirit, but Kling rewards short prompts.

OUTPUT FORMAT — respond with JSON only (no prose, no markdown fences), exactly this shape:

{
  "analysis": {
    "subject": "what's actually in the reference image (omit this whole 'analysis' key if no reference image is attached)",
    "palette": [
      {"hex": "#1a2a3f", "role": "shadow tone, ~40% of frame"},
      {"hex": "#c47b3a", "role": "midtone warm skin/accent"},
      {"hex": "#f5e6c8", "role": "highlight, blown out"}
    ],
    "color_grade": {
      "name": "named cinematic grade — e.g. 'teal-and-orange Kodak 2383 emulation', 'bleach bypass', 'cross-processed', 'day-for-night', 'sodium-vapor night grade', 'split-toned cyan/magenta', 'milky-pastel lifted blacks'",
      "stops": ["#0d1a24", "#2a3a4a", "#7a6a55", "#c47b3a", "#f5e6c8"],
      "notes": "one sentence on shadow/midtone/highlight behavior — lifted blacks, crushed shadows, rolled-off highlights, color cast direction"
    },
    "film_stock": {
      "name": "specific film/sensor emulation — e.g. 'Cinestill 800T with red halation', 'Kodak Portra 400 pushed +1', 'Fuji 400H', 'Lomochrome Purple', 'Kodak Gold 200', 'CCD camcorder', 'iPhone 3GS sensor', 'VHS Hi8'",
      "confidence": "low | medium | high",
      "tells": "what gives it away — halation around highlights, magenta cast in shadows, soft cyan skies, gate weave, line scanning artifacts, etc."
    },
    "grain": {
      "type": "kind of grain/noise — '35mm film grain (fine, organic)', '800T pushed grain (chunky, color-shifted)', 'digital sensor noise', 'compression macroblocking', 'VHS chroma noise', 'CCD smear', 'added grain overlay'",
      "intensity": "subtle | moderate | heavy | aggressive",
      "characteristics": "monochrome vs chromatic; even vs clumped; static vs dancing if implied by motion"
    },
    "lighting": "named lighting setup observed in the reference",
    "composition": "framing, angle, leading lines, negative space",
    "mood_keywords": ["two", "to", "four", "max"]
  },
  "breakdown": {
    "subject": "...",
    "action": "...",
    "setting": "...",
    "camera_lens": "...",
    "film_sensor": "...",
    "lighting": "...",
    "composition": "...",
    "color_grade": "...",
    "texture": "...",
    "mood": "..."
  },
  "style_references": {
    "cinematographers": ["Christopher Doyle", "Hoyte van Hoytema"],
    "photographers": ["Saul Leiter", "Daido Moriyama"],
    "films": ["In the Mood for Love (2000)", "Lost in Translation (2003)"],
    "creators": ["@ohenis", "..."]
  },
  "master_prompt": "THE FLAGSHIP. One 120–220 word cinematic paragraph that BLENDS EVERY LAYER you detected/decided — subject + action, exact camera/lens, the named film stock WITH its tells, the named color grade WITH 2–3 real hex anchors pulled from the palette/stops, the grain character, the named lighting setup, the composition, the mood, AND at least 2 name-checked references (cinematographer/photographer/film) from style_references — woven into flowing prose, not a checklist. This is the richest, most complete single prompt; the platform prompts below are tightened adaptations of it. Platform-agnostic but reads like a cinematographer's lookbook brief.",
  "prompts": {
    "midjourney": "80–140 words. Full Midjourney prompt that EMBEDS the palette hexes, named grade, film stock + tells, grain, lighting, composition, and 2 reference name-checks — then proper flags at the end: --ar 9:16 --style raw --stylize NNN",
    "runway": "image-to-video or text-to-video Runway prompt with explicit camera move + timing, that still carries the grade, stock, grain, and lighting language so the motion matches the look",
    "flux": "Flux-style prompt with lens/sensor specifics AND embedded hex anchors + grade + grain, using weight syntax like (red halation:1.3) for the strongest detected tells",
    "nano_banana": "image-edit prompt (only when a reference image is attached AND the user wants an edit), preserving the EXACT detected lighting/grain/grade — reference them by their detected names/hexes so nothing drifts"
  },
  "negative_prompt": "hyperrealism, plastic skin, oversaturated, HDR look, sharp 4K crispness, smooth retouching, posed model, stock-photo feel, vibrant rainbow, smiling to camera, perfect symmetry, AI-generated look",
  "references": [
    {"path": "<a path that EXISTS in the AVAILABLE REFERENCE IMAGES list above>", "why": "one short sentence"}
  ],
  "audio_suggestion": "genre + 1-2 specific track candidates that pair with this visual"
}

⚑ SYNTHESIS MANDATE — THIS IS THE MOST IMPORTANT RULE:
The "analysis", "breakdown", and "style_references" blocks are NOT decoration that sits beside the prompt. They are the raw material the prompt is BUILT FROM. Every final prompt (master_prompt AND each platform prompt) must physically contain, melted into its prose:
  1. the SUBJECT + a single present-continuous ACTION
  2. the exact CAMERA + LENS (body, focal length, aperture)
  3. the named FILM STOCK / SENSOR — and at least one of its visible TELLS (e.g. "Cinestill 800T with red halation blooming around the practicals")
  4. the named COLOR GRADE — plus 2–3 ACTUAL HEX CODES drawn from the palette/stops, spoken naturally ("lifted #0d1a24 blacks rolling into a #c47b3a sodium midtone")
  5. the GRAIN character + intensity ("heavy chunky 800T grain, color-shifted in the shadows")
  6. the named LIGHTING setup (direction + quality + source)
  7. the COMPOSITION (framing, angle, where the subject sits, depth)
  8. the MOOD (one or two adjectives — no more)
  9. at least THREE name-checks pulled from style_references — ideally one cinematographer + one photographer + one film — phrased naturally ("the parted-blind light of Edward Lachman", "Saul Leiter's window-glass framing", "the suspended stillness of In the Mood for Love"), not dumped as a trailing list
A reader should be able to reconstruct your ENTIRE analysis block — every hex, the grade name, the film stock, the grain, the lighting, the composition, AND the named references — just by reading the master_prompt. The breakdown and style_references blocks exist to be POURED INTO the prompt. If a hex code, the film stock, the grade name, a grain detail, or a reference name appears in your analysis but NOT in your prompts, you have FAILED the synthesis. Do not summarize the look — encode it.

LENGTH & EFFORT: master_prompt is 120–220 words of dense, specific, flowing prose. Midjourney is 80–140 words before the flags. No filler adjectives, no "beautiful/stunning/cinematic" hand-waving — every clause must carry a concrete spec, a hex, a named tool, or a named reference. Maximum craft, every time.

RULES:
- Be specific, not generic. "Kodak Portra 400 pushed +1 in a Mamiya 7" beats "film camera."
- Name-check at least 2 cinematographers/photographers/films that match the user's taste profile.
- For palette: give 3–5 actual hex codes, with a one-line role per swatch.
- If a reference image is provided, sample its palette and composition honestly. Don't invent.
- TREAT color_grade, film_stock, and grain AS SEPARATE DETECTION TASKS — they are not the same thing:
    • color_grade = the colorist's choice (teal-and-orange, bleach bypass, day-for-night, etc.) + a 5-stop hex gradient from darkest shadow to brightest highlight, showing how tone maps across the image
    • film_stock = the emulated capture medium (Cinestill 800T, Portra 400, VHS, CCD camcorder, etc.) with confidence and visible "tells"
    • grain = the noise/grain pattern character independent of stock (heavy 35mm grain CAN exist on a digitally-graded image — they're not the same)
- The "stops" array in color_grade MUST be 5 hex codes ordered darkest → brightest, suitable for rendering as a left-to-right gradient bar. Sample these from the actual image when a reference is provided.
- For Midjourney, ALWAYS end with "--ar 9:16 --style raw --stylize <number>" (and other flags if relevant).
- ALWAYS produce "master_prompt" — it is the flagship blended prompt and is never omitted. Keep it as ONE continuous line (no literal newlines) even though it is long.
- Only include "nano_banana" in prompts when it's an edit request.
- Only pick "references" paths that appear in the AVAILABLE REFERENCE IMAGES list above. Never invent paths.
- Default to vertical 9:16 (reels) unless the user specifies otherwise.
- Output JSON only. No markdown. No explanation outside JSON.
- CRITICAL JSON HYGIENE: never put a raw double-quote (") inside a string value — use a single quote (') or paraphrase. Never include literal newlines inside strings — write them as one continuous line. No trailing commas. No comments. Validate mentally before responding.`;
}

const TASTE_NEGATIVES = "copying the taste reference's subject, person, object, animal, wardrobe, text or scene; altering the main subject's identity, face, body or pose; clean CGI; flat even lighting; plastic skin texture; over-sharp AI render";

function buildTasteFusionBlock(t) {
  const line = (k, v) => v ? `  • ${k}: ${v}` : '';
  const colors = Array.isArray(t.colors) ? t.colors.join('; ') : (t.colors || '');
  return `
─────────────────────────────────────────────
⧉ TASTE REFERENCE ACTIVE — TWO-SOURCE FUSION:
The CONTENT SOURCE is the main image/request above — preserve its subject, person, object, animal, scene, pose, composition of the subject, and identity EXACTLY. Do not invent a new subject.
The STYLE SOURCE is the extracted taste below — apply ONLY its look. Never import any subject, person, object, wardrobe, text, or scene element from the taste reference; it contributes aesthetic only.

EXTRACTED TASTE (style source — fuse these into every prompt):
${line('lighting', t.lighting)}
${line('intentional blur', t.blur)}
${line('colors', colors)}
${line('grain', t.grain)}
${line('shadows', t.shadows)}
${line('highlights', t.highlights)}
${line('contrast', t.contrast)}
${line('mood', t.mood)}
${line('framing feel', t.framing)}
${line('camera feel', t.camera_feel)}
${line('overall aesthetic', t.aesthetic)}

FUSION RULES:
- master_prompt and every platform prompt must make the CONTENT look as if it were shot, lit, and graded in this taste — its lighting, blur, colors, grain, shadow/highlight behaviour, contrast, mood, framing feel, and camera vibe.
- Keep the main subject's identity and pose intact; only the LOOK changes.
- In the "breakdown", explicitly attribute what comes from CONTENT vs what comes from the TASTE.
- For an image edit (nano_banana), preserve the main subject and apply the taste as a regrade/relight — state what stays (subject) and what shifts (look).
─────────────────────────────────────────────`;
}

app.post('/api/generate', async (req, res) => {
  try {
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
    if (!request || typeof request !== 'string') return res.status(400).json({ error: 'request is required' });
    const tasteActive = extractedTaste && typeof extractedTaste === 'object';

    const [taste, images] = await Promise.all([readTasteProfile(), walkImages(path.join(ROOT, 'images'))]);
    const system = buildSystemPrompt(taste, images);

    let intent;
    const absPath = baseImage ? path.join(ROOT, 'images', baseImage).replace(/\\/g, '/') : null;
    if (baseImage && mode === 'image') {
      intent = `MODE: edit existing image (image-to-image)
BASE IMAGE (absolute path — READ this file first to analyze its pixels): ${absPath}
USER WANTS: ${request}

STEP 1 — READ the base image with the Read tool and analyze its actual pixels: sample the palette as real hex codes, name the color grade + 5 stops, identify the film stock + its tells, the grain, the exact lighting setup, and the composition. Fill the "analysis" field with what you truly saw (do not invent).

STEP 2 — Parse the user's edit precisely. Separate WHAT CHANGES from WHAT IS PRESERVED.
  • WHAT CHANGES = only the elements the user named (e.g. "turn this cat into a dog, add gold grillz on its teeth"). Describe the new element with grounding detail (breed/size/pose) and EXPLICITLY pin it to the original: same position, same scale, same head angle, same gaze direction, same distance to camera, sitting in the same spot with the same contact shadow — so it occupies the cat's exact footprint.
  • WHAT IS PRESERVED = EVERYTHING else, named concretely from your analysis: the exact lighting setup, the named color grade WITH its hex anchors, the film stock + halation, the grain character, the composition/framing, the background, the depth of field. Reference them by name and hex so nothing drifts.

STEP 3 — Write "nano_banana" as the detailed edit instruction: open with "Keeping the original <named grade with hexes>, <named lighting>, <grain>, framing, and background exactly as they are, replace <X> with <Y>..." then the precise change, then restate the preserved attributes and a short "do not change" clause. Also write "master_prompt" as the full edited scene described from scratch (the dog WITH grillz already in place), blending the preserved look + the change into one rich paragraph, so it can be used as a from-scratch generation too. flux is optional; skip runway for an image edit.`;
    } else if (baseImage && mode === 'video') {
      intent = `MODE: animate existing image (image-to-video)
BASE IMAGE (absolute path — READ this file first to analyze its pixels): ${absPath}
USER WANTS: ${request}

STEP 1 — READ the base image and analyze its real pixels: palette hexes, named grade + stops, film stock + tells, grain, lighting, composition. Fill "analysis" honestly.

STEP 2 — Write "runway" for image-to-video: describe what HAPPENS over ~4 seconds (a single motion beat from the user's request) with an explicit camera move and timing, while the still's EXACT lighting, named grade (with hexes), film stock, and grain are preserved across the motion. Restate the preserved look so the animation never drifts off the source frame.

STEP 3 — Write "master_prompt" as the full blended shot: the moving scene with every detected layer (subject+action, camera/lens, film stock+tells, grade+hexes, grain, lighting, composition, mood, and 2 reference name-checks) melted into one rich paragraph.`;
    } else {
      intent = `MODE: generate new ${mode} from scratch
USER WANTS: ${request}

Write a designer-grade prompt in the user's taste. Omit the "analysis" key entirely (no reference image). Fill every other field with concrete, named specifics — film stocks, lenses, cinematographer references, hex palette anchors.`;
    }

    // Taste Reference fusion — ONLY when the user extracted a taste and it is sent with this request.
    if (tasteActive) intent += '\n' + buildTasteFusionBlock(extractedTaste);

    const raw = await callSelectedCli(cliId, system, intent, { imagePath: absPath });
    const parsed = extractJson(raw);

    // When taste is fused, guarantee the required negatives are present.
    if (tasteActive) {
      parsed.negative_prompt = (parsed.negative_prompt ? parsed.negative_prompt + ', ' : '') + TASTE_NEGATIVES;
    }

    // Persist to history
    const ts = Date.now();
    const id = ts + '_' + Math.random().toString(36).slice(2, 8);
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
    const histDir = path.join(ROOT, 'history');
    await mkdir(histDir, { recursive: true });
    await writeFile(path.join(histDir, `${id}.json`), JSON.stringify(entry, null, 2));

    res.json({ ok: true, ...parsed, raw, _id: id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  kaix fr → http://localhost:${PORT}\n`);
});
