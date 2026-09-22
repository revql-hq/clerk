# Clerk

Clerk is a standalone desktop companion for an OpenRevRec workspace.

## Current capabilities

- Independent Electron window with compact and expanded presentations, remembered window bounds, task list, and Clerk settings.
- Explicit connection to a compatible loopback ORR runtime. Clerk verifies the reported workspace path before accounting requests. The ORR window is not required; a headless `openrevrec serve` process works.
- ORR-backed period investigations, close-check review, contract search, structured report cards, and optional Nebius explanation with per-task data permission.
- Local task persistence and interruption status after restart; local staging and text review for text, Markdown, DOCX, and text-based PDFs.
- A supported billing-entry proposal: ORR nonpersisting preview, explicit approval, stale-state check, stable idempotency key, and ORR receipt. An uncertain outcome stays in Needs verification and can be reconciled against ORR history without sending a second write.

Clerk does not write the `.orr` database directly. It does not install any UI in OpenRevRec. Source parsing does not include OCR, extraction, clause classification, source anchors, or an automatic route from a source to an accounting proposal. A different ORR version may lack a required capability; Clerk surfaces the failure and keeps the task.

## Development

Requires Node 22+ and an existing OpenRevRec checkout or package that can run its local API.

```sh
npm install
npm run desktop
```

Start a headless ORR runtime separately for the selected workspace:

```sh
cd ../openrevrec
.venv/bin/python -m openrevrec serve --workspace /absolute/path/Company.orr --port 4318 --token YOUR_RANDOM_TOKEN
```

In Clerk Settings, enter `http://127.0.0.1:4318`, the token, and the expected absolute `.orr` path. Use one coordinated ORR runtime for a workspace. This initial build attaches to the runtime you specify; it does not discover ORR's desktop-owned ephemeral token or automatically launch a new runtime. Headless operation is available with the CLI server and the ORR window closed.

```sh
npm test
npm run build
npm run package:dir
```

The desktop uses Electron context isolation and a sandboxed renderer. API keys and the ORR token stay in the main process and are encrypted through Electron `safeStorage` before being saved. Task history and source copies are stored in Clerk's local app data folder, separate from `.orr`. Linux installations without a secure keyring are not supported for saved credentials yet.
