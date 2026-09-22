const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store } = require('../core/store.cjs');
const { OrrAdapter, stateFingerprint, findOperation } = require('../core/orr.cjs');
const { reason } = require('../core/neb.cjs');
const { stageDocument } = require('../core/documents.cjs');
const { cents, difference, previousPeriod } = require('../core/amounts.cjs');

if (process.env.CLERK_USER_DATA) app.setPath('userData', path.resolve(process.env.CLERK_USER_DATA));
const developmentUrl = process.env.CLERK_DEV_URL;
const uiFile = path.join(__dirname, '..', 'dist', 'index.html');
let window;
let store;
let connection = null;
let nebKey = '';
const runs = new Map();
let expanded = false;

function secretFile() { return path.join(app.getPath('userData'), 'secrets.bin'); }
function saveSecrets() {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('System credential encryption is unavailable on this device.');
  fs.writeFileSync(secretFile(), safeStorage.encryptString(JSON.stringify({ orrToken: connection?.token || '', nebKey })), { mode: 0o600 });
}
function loadSecrets() {
  try {
    const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(secretFile())).toString());
    nebKey = value.nebKey || '';
    return value;
  } catch { return {}; }
}
function publicSettings() {
  const settings = store.settings();
  return { ...settings, hasNebKey: Boolean(nebKey), hasOrrToken: Boolean(connection?.token) };
}
function emitTask(task) { window?.webContents.send('clerk:task-update', task); }
function saveTask(task) { const saved = store.saveTask(task); emitTask(saved); return saved; }

function withinDisplay(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return null;
  const area = screen.getDisplayMatching(bounds).workArea;
  return { x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - 250)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - 120)), width: Math.min(bounds.width, area.width), height: Math.min(bounds.height, area.height) };
}
function persistBounds() {
  if (!window || window.isMinimized() || window.isMaximized()) return;
  const settings = store.settings();
  settings[expanded ? 'expandedBounds' : 'compactBounds'] = window.getBounds();
  store.saveSettings(settings);
}
function setExpanded(value) {
  if (expanded === Boolean(value)) return;
  persistBounds();
  expanded = Boolean(value);
  const settings = store.settings();
  const target = withinDisplay(settings[expanded ? 'expandedBounds' : 'compactBounds']);
  window.setMinimumSize(expanded ? 760 : 380, expanded ? 560 : 560);
  if (target) window.setBounds(target, true);
  else window.setSize(expanded ? 1120 : 440, expanded ? 780 : 760, true);
}
function requireConnection(task) {
  if (!connection) throw new Error('Connect to an ORR runtime to use current accounting facts.');
  if (task && task.workspacePath !== connection.expectedPath) throw new Error('This task belongs to a different workspace. Reconnect to its workspace first.');
  return new OrrAdapter(connection.origin, connection.token, connection.expectedPath);
}
function requireTask(id) { const task = store.getTask(id); if (!task) throw new Error('Task not found.'); return task; }
function taskContext(task, state, reports, previous) {
  const contract = task.recordId ? state.contracts?.find(item => item.id === task.recordId) : null;
  const summary = state.report?.summary || null;
  const oldById = new Map((previous?.report?.contracts || []).map(item => [item.id, item]));
  const changedContracts = (state.report?.contracts || []).map(item => {
    const before = oldById.get(item.id)?.revenue || '0.00';
    return { id: item.id, name: item.name, before, after: item.revenue, change: difference(item.revenue, before) };
  }).filter(item => cents(item.change) !== 0n).sort((a, b) => {
    const delta = (value) => { const number = cents(value); return number < 0n ? -number : number; };
    return delta(a.change) > delta(b.change) ? -1 : delta(a.change) < delta(b.change) ? 1 : 0;
  }).slice(0, 12);
  return {
    workspace: { name: state.workspace?.name || task.workspaceName },
    scenario: task.scenario, period: task.period,
    reportSummary: summary,
    previousPeriod: previous?.report?.period || null,
    previousRevenue: previous?.report?.summary?.revenue || null,
    revenueChange: previous ? difference(summary.revenue, previous.report.summary.revenue) : null,
    changedContracts,
    selectedContract: contract ? { id: contract.id, name: contract.name, customer_id: contract.customer_id, activities: (contract.activities || []).slice(-20), obligations: contract.obligations } : null,
    closeChecks: reports?.checks || null,
    closeExceptions: reports?.exceptions || null,
    coverage: { contractCount: state.contracts?.length || 0, selectedContractFound: !task.recordId || Boolean(contract), reportPeriod: state.report?.period || task.period }
  };
}

async function runTask(id) {
  let task = requireTask(id);
  if (runs.has(id)) throw new Error('This task is already running.');
  const adapter = requireConnection(task);
  const controller = new AbortController();
  runs.set(id, controller);
  task = saveTask({ ...task, status: 'running', error: null, stage: 'Reading ORR results' });
  try {
    const state = await adapter.state(task.scenario, task.period, controller.signal);
    const reports = task.recipe === 'readiness' || task.recipe === 'support' ? await adapter.reports(task.scenario, task.period, controller.signal) : null;
    const previous = task.recipe === 'investigate' ? await adapter.state(task.scenario, previousPeriod(task.period), controller.signal) : null;
    const context = taskContext(task, state, reports, previous);
    task = saveTask({ ...task, facts: context, stage: 'Preparing result' });
    let answer = null;
    let inference = null;
    if (task.allowNebius) {
      if (store.settings().externalInferenceBlocked) throw new Error('External inference is blocked for this Clerk workspace connection.');
      task = saveTask({ ...task, stage: 'Requesting Nebius explanation' });
      inference = await reason({ key: nebKey, model: store.settings().model, instruction: task.prompt, context, signal: controller.signal });
      answer = inference.answer;
    }
    if (controller.signal.aborted) throw new Error('Stopped by user.');
    return saveTask({ ...task, status: 'completed', stage: null, answer, inference: inference ? { modelRequested: inference.modelRequested, modelReturned: inference.modelReturned, usage: inference.usage, sent: ['ORR report summary', ...(context.selectedContract ? ['selected contract'] : []), ...(reports ? ['close checks and exceptions'] : [])] } : null });
  } catch (error) {
    return saveTask({ ...task, status: controller.signal.aborted ? 'canceled' : 'interrupted', stage: null, error: error.message });
  } finally { runs.delete(id); }
}

function register(name, handler) {
  ipcMain.handle(`clerk:${name}`, async (event, value) => {
    const frameUrl = event.senderFrame.url;
    if (developmentUrl ? new URL(frameUrl).origin !== developmentUrl : frameUrl !== `file://${uiFile}`) throw new Error('Unrecognized Clerk window.');
    return handler(value);
  });
}

function registerHandlers() {
  register('bootstrap', async () => {
    let runtime = null;
    if (connection) try { runtime = await requireConnection().verify(); } catch { /* Saved work remains readable. */ }
    return { settings: publicSettings(), runtime, tasks: store.tasks(), expanded };
  });
  register('connect', async input => {
    const reused = connection && input.origin === connection.origin && (!input.expectedPath || input.expectedPath === connection.expectedPath) ? connection.token : '';
    const token = String(input.token || reused);
    if (!token) throw new Error('Enter the ORR session token for this runtime.');
    const candidate = new OrrAdapter(input.origin, token, String(input.expectedPath || ''));
    const runtime = await candidate.verify();
    connection = { origin: candidate.origin, token: candidate.token, expectedPath: candidate.expectedPath };
    const settings = store.settings();
    settings.connection = { origin: candidate.origin, workspacePath: candidate.expectedPath, workspaceName: runtime.name || path.basename(candidate.expectedPath) };
    store.saveSettings(settings);
    saveSecrets();
    return { runtime, settings: publicSettings() };
  });
  register('disconnect', () => { connection = null; const settings = store.settings(); settings.connection = null; store.saveSettings(settings); saveSecrets(); return publicSettings(); });
  register('settings', input => {
    const settings = store.settings();
    if (typeof input.model === 'string') settings.model = input.model.trim();
    if (typeof input.externalInferenceBlocked === 'boolean') settings.externalInferenceBlocked = input.externalInferenceBlocked;
    if (typeof input.keepOnTop === 'boolean') { settings.keepOnTop = input.keepOnTop; window.setAlwaysOnTop(input.keepOnTop); }
    if (typeof input.nebKey === 'string' && input.nebKey) nebKey = input.nebKey.trim();
    if (input.clearNebKey) nebKey = '';
    store.saveSettings(settings);
    saveSecrets();
    return publicSettings();
  });
  register('test-nebius', async () => { const result = await reason({ key: nebKey, model: store.settings().model, instruction: 'Reply with the word connected.', context: { sample: true } }); return { model: result.modelReturned || result.modelRequested }; });
  register('select-source', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Readable sources', extensions: ['txt', 'md', 'docx', 'pdf'] }] });
    return result.canceled ? null : stageDocument(result.filePaths[0], store.root);
  });
  register('search', async input => requireConnection().search(input.query, input.scenario, input.period));
  register('state', async input => requireConnection().state(input.scenario, input.period));
  register('reports', async input => requireConnection().reports(input.scenario, input.period));
  register('create-task', input => {
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('Describe the task.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error('Select a valid month.');
    const task = {
      id: randomUUID(), title: input.title || input.prompt.slice(0, 70), prompt: input.prompt.trim(), recipe: input.recipe || 'investigate',
      workspacePath: connection?.expectedPath || null, workspaceName: store.settings().connection?.workspaceName || null,
      scenario: input.scenario || 'main', period: input.period, recordId: input.recordId || null, source: input.source || null,
      allowNebius: Boolean(input.allowNebius), status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), answer: null, facts: null, proposal: null
    };
    return saveTask(task);
  });
  register('save-task', input => {
    const task = requireTask(input.id);
    const allowed = {};
    if (typeof input.title === 'string') allowed.title = input.title.slice(0, 120);
    if (typeof input.notes === 'string') allowed.notes = input.notes.slice(0, 10000);
    return saveTask({ ...task, ...allowed });
  });
  register('delete-task', id => { if (runs.has(id)) throw new Error('Stop this task before deleting it.'); store.deleteTask(id); return store.tasks(); });
  register('run-task', id => { runTask(id); return requireTask(id); });
  register('stop-task', id => { runs.get(id)?.abort(); return true; });
  register('preview', async input => {
    let task = requireTask(input.id);
    const adapter = requireConnection(task);
    if (!['record_billing', 'record_usage', 'record_progress', 'record_milestone', 'record_adjustment', 'add_note'].includes(input.command)) throw new Error('This action is not supported in Clerk yet.');
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('Provide the proposed fields.');
    const current = await adapter.state(task.scenario, task.period);
    const envelope = { command: input.command, payload: input.payload, scenario_id: task.scenario, period: task.period, idempotency_key: randomUUID() };
    const rawPreview = await adapter.preview(envelope);
    const preview = { before: { summary: rawPreview.before?.summary }, state: { report: { summary: rawPreview.state?.report?.summary } }, comparison: rawPreview.comparison };
    if (!preview.before.summary || !preview.state.report.summary) throw new Error('This ORR version did not return a usable financial preview.');
    task = saveTask({ ...task, status: 'ready-for-review', proposal: { envelope, preview, baseline: stateFingerprint(current), workspacePath: task.workspacePath, idempotencyKey: envelope.idempotency_key, previewedAt: new Date().toISOString(), receipt: null } });
    return task;
  });
  register('apply', async id => {
    let task = requireTask(id);
    const proposal = task.proposal;
    if (!proposal || task.status !== 'ready-for-review') throw new Error('Prepare and review a current proposal first.');
    const adapter = requireConnection(task);
    if (proposal.workspacePath !== task.workspacePath || proposal.envelope.scenario_id !== task.scenario || proposal.envelope.period !== task.period) throw new Error('Proposal target changed. Prepare a new preview.');
    const current = await adapter.state(task.scenario, task.period);
    if (stateFingerprint(current) !== proposal.baseline) {
      task = saveTask({ ...task, status: 'stale', error: 'ORR state changed since this preview. Prepare a new preview and review it again.' });
      return task;
    }
    task = saveTask({ ...task, status: 'applying', error: null });
    try {
      const response = await adapter.command(proposal.envelope);
      const receipt = { result: response.result, stateSummary: response.state?.report?.summary };
      return saveTask({ ...task, status: 'completed', proposal: { ...proposal, receipt, appliedAt: new Date().toISOString() } });
    } catch (error) {
      return saveTask({ ...task, status: 'needs-verification', error: `Outcome needs verification: ${error.message}` });
    }
  });
  register('verify-outcome', async id => {
    let task = requireTask(id);
    if (task.status !== 'needs-verification' || !task.proposal?.idempotencyKey) throw new Error('No uncertain operation is recorded for this task.');
    const adapter = requireConnection(task);
    const state = await adapter.state(task.scenario, task.period);
    const accepted = findOperation(state, task.proposal.idempotencyKey);
    if (!accepted) return saveTask({ ...task, error: 'No matching ORR change was found. The outcome remains uncertain; no write was retried.' });
    const receipt = { result: { change_set_id: accepted.id, id: accepted.entity_id, version: accepted.version, command: accepted.command }, stateSummary: state.report?.summary, reconciled: true };
    return saveTask({ ...task, status: 'completed', error: null, proposal: { ...task.proposal, receipt, appliedAt: accepted.recorded_at } });
  });
  register('set-expanded', value => { setExpanded(value); return expanded; });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    const secrets = loadSecrets();
    const saved = store.settings().connection;
    if (saved && secrets.orrToken) connection = { origin: saved.origin, token: secrets.orrToken, expectedPath: saved.workspacePath };
    registerHandlers();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [{ role: 'quit' }] }, { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }, { role: 'windowMenu' }
    ]));
    const bounds = withinDisplay(store.settings().compactBounds);
    window = new BrowserWindow({ width: 440, height: 760, ...(bounds || {}), minWidth: 380, minHeight: 560, show: false, title: 'Clerk', backgroundColor: '#f7f7f5', alwaysOnTop: store.settings().keepOnTop, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== (developmentUrl || `file://${uiFile}`)) event.preventDefault(); });
    window.on('resize', persistBounds);
    window.on('move', persistBounds);
    window.once('ready-to-show', () => window.show());
    window.loadURL(developmentUrl || `file://${uiFile}`);
  }).catch(error => { dialog.showErrorBox('Clerk could not start', error.message); app.quit(); });
  app.on('before-quit', () => { for (const controller of runs.values()) controller.abort(); });
  app.on('window-all-closed', () => { app.quit(); });
}
