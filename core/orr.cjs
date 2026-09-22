const { createHash } = require('node:crypto');
const fs = require('node:fs');

function validateOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Use an explicit loopback ORR URL such as http://127.0.0.1:4318.');
  }
  return url.origin;
}

function normalizedPath(value) {
  const path = String(value || '').replace(/\\/g, '/').replace(/\/$/, '');
  if (!path) return '';
  try { return fs.realpathSync.native(path).replace(/\\/g, '/'); } catch { return path; }
}

class OrrAdapter {
  constructor(origin, token, expectedPath) {
    this.origin = validateOrigin(origin);
    this.token = token;
    this.expectedPath = normalizedPath(expectedPath);
  }
  async request(route, options = {}) {
    const response = await fetch(`${this.origin}${route}`, {
      ...options,
      headers: { Authorization: `Bearer ${this.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: options.signal || AbortSignal.timeout(20000),
      redirect: 'error'
    });
    let body;
    try { body = await response.json(); } catch { throw new Error(`ORR returned an unreadable response (${response.status}).`); }
    if (!response.ok) throw new Error(body.error || `ORR returned ${response.status}.`);
    return body;
  }
  async verify() {
    const health = await this.request('/api/health');
    if (health.status !== 'ok' || !health.version) throw new Error('The selected runtime is not a compatible OpenRevRec service.');
    const workspace = await this.request('/api/workspace');
    if (!workspace.path) throw new Error('The runtime did not report a workspace identity.');
    if (this.expectedPath && normalizedPath(workspace.path) !== this.expectedPath) throw new Error('This runtime serves a different workspace. Reconnect explicitly.');
    this.expectedPath = normalizedPath(workspace.path);
    return { ...workspace, runtimeVersion: health.version };
  }
  async checked(route, options) { await this.verify(); return this.request(route, options); }
  state(scenario, period, signal) { return this.checked(`/api/state?scenario_id=${encodeURIComponent(scenario)}&period=${encodeURIComponent(period)}`, { signal }); }
  reports(scenario, period, signal) { return this.checked(`/api/reports?scenario_id=${encodeURIComponent(scenario)}&period=${encodeURIComponent(period)}`, { signal }); }
  search(query, scenario, period) { return this.checked(`/api/search?q=${encodeURIComponent(query)}&scenario_id=${encodeURIComponent(scenario)}&period=${encodeURIComponent(period)}`); }
  preview(envelope) { return this.checked('/api/preview', { method: 'POST', body: JSON.stringify(envelope) }); }
  command(envelope) { return this.checked('/api/commands', { method: 'POST', body: JSON.stringify(envelope) }); }
}

function stateFingerprint(state) {
  const stable = { workspace: state.workspace, scenario_id: state.scenario_id, change_sets: state.change_sets, closes: state.closes, policy_versions: state.policy_versions, contracts: state.contracts, customers: state.customers, evidence: state.evidence };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function findOperation(state, idempotencyKey) {
  return state.change_sets?.find(item => item.idempotency_key === idempotencyKey) || null;
}

module.exports = { OrrAdapter, validateOrigin, stateFingerprint, findOperation };
