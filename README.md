# kaix fr — reel prompt forge

`kaix fr` is a **local prompt workflow** for turning a request, base image, and taste reference into structured AI prompts. It runs on your machine, uses whatever local CLI you have installed, and keeps your library/settings/history local.

> **One line:** local prompt forge + style extraction + provider-neutral CLI execution + optional MCP generation hooks.

---

## What it does

- Runs entirely on your machine as a single local app at **`http://localhost:5174`**.
- You write a request and can attach a **base image** for content and a separate **taste image** for style.
- Press **Extract Taste** and the app reads the taste image's pixels, then pulls out only its aesthetic: lighting, blur, color hexes, grain, shadows, highlights, contrast, mood, framing, and camera feel.
- On generate, that taste is fused into the prompt: the base image keeps its subject, identity, and pose, while the taste image contributes only its look.
- It outputs a structured prompt pack with a master prompt plus platform variants like Midjourney, Runway, Flux, Sora, and image-edit prompts.
- It can run through **Claude Code, Codex, OpenCode, or a custom CLI** selected on the local machine.
- History, uploads, and settings are stored locally as plain files.

## Two-source fusion

The core idea: keep the *what*, borrow the *look*.

| Source | Role | What it contributes |
| --- | --- | --- |
| **Base image** (main attachment) | Content source | subject, person, object, scene, pose, identity |
| **Taste image** (taste reference) | Style source | light, blur, color, grain, mood, camera vibe — **never** the subject |

Fusion is **gated**: it only activates when you press **Extract Taste**. Generate without extracting and the taste image is ignored entirely — you just get a normal prompt.

## Modes

- **Prompt mode** — builds structured prompts only.
- **Generate mode** — keeps the same prompt workflow, then prepares for downstream generation targets.
- **Image vs Video** — generate a still prompt or a motion prompt (Runway/Sora-style with explicit camera moves and timing).
- **Generate / Edit / Animate** — with no base image it generates from scratch; with a base image it either edits it (image-to-image, preserving the original grade/lighting/grain) or animates it (image-to-video).

## Engines (CLI-agnostic)

The app drives whatever local AI CLI you've installed, auto-detected on `PATH`. Built-in support:

| CLI | Image input |
| --- | --- |
| **Claude Code** (`claude`) | ✅ |
| **Codex** (`codex`) | ✅ |
| **OpenCode** (`opencode`) | — |

You can also register **custom CLIs** in local settings (command + args + whether it supports images). Prompts are piped via **stdin** so they never hit the Windows command-line length limit; images are passed to the CLI natively where supported.

## Run it

```bash
npm install
npm start          # → http://localhost:5174
# file-watch reload during development:
npm run dev
```

Then open **http://localhost:5174** and pick an installed CLI from the app.

## How it's built

- **Backend:** Node.js + Express (ES modules). `child_process` drives the selected CLI via a small registry/runner.
- **Frontend:** vanilla HTML/CSS/JS — no framework.
- **Storage (all local files):**
  - `images/` — your reference library (uploads land in `images/uploads/`)
  - `analysis/` — your taste profile (markdown moodboards the prompt is grounded in)
  - `history/` — one JSON file per generation
  - `.kaix-fr/settings.local.json` — selected CLI + custom CLIs + MCP targets

### Project layout

```
server.js              Express server + prompt builders (port 5174)
lib/
  cli-registry.js      detect/define local CLIs (built-in + custom)
  cli-runner.js        spawn the CLI, pipe prompt via stdin
  json-response.js     extract/repair JSON from CLI output
  settings-store.js    read/write .kaix-fr/settings.local.json
public/                index.html, app.js, style.css (the UI)
images/                reference library + uploads/
analysis/              taste-profile markdown (grounds every prompt)
history/               saved generations
.kaix-fr/            local ignored settings
```

### API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/generate` | build the structured prompt pack (optionally with base image + fused taste) |
| `POST` | `/api/extract-taste` | read a taste image and return its aesthetic as JSON |
| `POST` | `/api/upload` | save base64 images into `images/uploads/` |
| `GET` / `DELETE` | `/api/images` | list / delete library images (delete is path-validated) |
| `GET` / `DELETE` | `/api/history`, `/api/history/:id` | list, fetch, delete generations |
| `GET` / `PUT` | `/api/settings` | read / update settings |
| `GET` | `/api/cli` | list detected CLIs + the selected one |

## Roadmap

- **First-screen chooser:** Prompt Generation vs Video Generation, routing into distinct workflows.
- **MCP generation support** — the generate flow already carries `mcpTargetId` / `promptKey` hooks for it.
