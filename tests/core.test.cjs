const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Store } = require('../core/store.cjs');
const { OrrAdapter, validateOrigin, stateFingerprint, findOperation } = require('../core/orr.cjs');
const { difference, previousPeriod } = require('../core/amounts.cjs');
const { parseDocument } = require('../core/documents.cjs');

test('ORR connection accepts only explicit local HTTP origins', () => {
  assert.equal(validateOrigin('http://127.0.0.1:4318'), 'http://127.0.0.1:4318');
  for (const url of ['https://127.0.0.1:4318', 'http://localhost:4318', 'http://example.com', 'http://127.0.0.1:4318/api', 'http://user:secret@127.0.0.1:4318']) {
    assert.throws(() => validateOrigin(url));
  }
});

test('unfinished tasks survive restart with an honest status', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-store-'));
  try {
    const store = new Store(root);
    store.saveTask({ id: 'run', status: 'running' });
    store.saveTask({ id: 'apply', status: 'applying' });
    const restarted = new Store(root);
    assert.equal(restarted.getTask('run').status, 'interrupted');
    assert.equal(restarted.getTask('apply').status, 'needs-verification');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('adapter refuses a different workspace and routes previews without writes', async () => {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.authorization !== 'Bearer test-token') { response.statusCode = 401; response.end('{"error":"auth"}'); return; }
    if (request.url === '/api/health') response.end('{"status":"ok","version":"0.1.0"}');
    else if (request.url === '/api/workspace') response.end('{"path":"/tmp/Example.orr","name":"Example"}');
    else if (request.url?.startsWith('/api/state')) response.end('{"workspace":{"name":"Example"},"scenario_id":"main","contracts":[],"change_sets":[],"closes":[],"evidence":[],"report":{"summary":{"revenue":"10.00"}}}');
    else if (request.url === '/api/preview') response.end('{"before":{"summary":{"revenue":"10.00"}},"state":{"report":{"summary":{"revenue":"12.00"}}}}');
    else { response.statusCode = 404; response.end('{"error":"unknown"}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(new OrrAdapter(origin, 'test-token', '/tmp/Wrong.orr').state('main', '2026-09'), /different workspace/);
    const adapter = new OrrAdapter(origin, 'test-token', '/tmp/Example.orr');
    const state = await adapter.state('main', '2026-09');
    assert.equal(state.report.summary.revenue, '10.00');
    const preview = await adapter.preview({ command: 'record_billing', payload: {} });
    assert.equal(preview.state.report.summary.revenue, '12.00');
    assert.equal(seen.some(value => value.startsWith('POST /api/commands')), false);
  } finally { server.close(); }
});

test('state fingerprint detects accounting changes', () => {
  const initial = { workspace: { id: 'a' }, scenario_id: 'main', contracts: [], change_sets: [], closes: [], policy_versions: [], customers: [], evidence: [] };
  assert.notEqual(stateFingerprint(initial), stateFingerprint({ ...initial, change_sets: [{ id: 'next' }] }));
});

test('uncertain writes reconcile only to the original operation identity', () => {
  const state = { change_sets: [{ id: 'cs-1', idempotency_key: 'op-1', command: 'record_billing' }] };
  assert.equal(findOperation(state, 'op-1').id, 'cs-1');
  assert.equal(findOperation(state, 'op-2'), null);
});

test('period comparisons use exact ORR decimal strings', () => {
  assert.equal(difference('100.01', '99.99'), '0.02');
  assert.equal(difference('0.00', '1.20'), '-1.20');
  assert.equal(previousPeriod('2026-01'), '2025-12');
});

test('local PDF parsing preserves a page-level source location', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-pdf-'));
  const file = path.join(root, 'source.pdf');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 43 >>\nstream\nBT /F1 12 Tf 72 720 Td (Hello Clerk) Tj ET\nendstream'
  ];
  let contents = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(contents)); contents += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(contents);
  contents += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) contents += `${String(offset).padStart(10, '0')} 00000 n \n`;
  contents += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
  fs.writeFileSync(file, contents);
  try {
    const parsed = await parseDocument(file);
    assert.match(parsed.text, /Hello Clerk/);
    assert.equal(parsed.locations[0].page, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
