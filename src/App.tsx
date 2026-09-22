import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, CircleAlert, FileText, LayoutPanelLeft, List, LockKeyhole, Maximize2, Minimize2, Plus, Search, Settings2, Square, X } from 'lucide-react';
import type { Runtime, Settings, Source, Task } from './types';

type View = 'home' | 'tasks' | 'settings' | 'task';
const recipes = [
  { id: 'investigate', label: 'Investigate a number', prompt: 'Explain this period’s revenue and identify the records or missing information that matter.' },
  { id: 'readiness', label: 'Review period-end readiness', prompt: 'Explain the current ORR close checks and what remains unresolved for this period.' },
  { id: 'support', label: 'Find missing support', prompt: 'Identify current ORR judgment-support exceptions and what evidence is missing.' },
  { id: 'memo', label: 'Draft an accounting memo', prompt: 'Draft a concise memo from the selected ORR facts, distinguishing facts, assumptions, and judgments.' },
];
const date = new Date();
const currentPeriod = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

function money(value: unknown, currency = 'USD') {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(number) : String(value ?? '—');
}
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase()); }
function statusLabel(value: string) { return label(value.replaceAll('-', ' ')); }
function shortPath(value: string) { return value.length > 48 ? `…${value.slice(-47)}` : value; }
function dateLabel(value: string) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)); }

export function App() {
  const [view, setView] = useState<View>('home');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runtime, setRuntime] = useState<Runtime>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState(currentPeriod);
  const [scenario, setScenario] = useState('main');
  const [recordQuery, setRecordQuery] = useState('');
  const [records, setRecords] = useState<any[]>([]);
  const [recordId, setRecordId] = useState('');
  const [recordName, setRecordName] = useState('');
  const [recipe, setRecipe] = useState(recipes[0].id);
  const [prompt, setPrompt] = useState(recipes[0].prompt);
  const [source, setSource] = useState<Source | null>(null);
  const [allowNebius, setAllowNebius] = useState(false);
  const [state, setState] = useState<any>(null);
  const [page, setPage] = useState(0);
  const [proposalMode, setProposalMode] = useState(false);
  const [billing, setBilling] = useState({ amount: '', effective_date: '', reference: '', rationale: '' });
  const task = useMemo(() => tasks.find(item => item.id === selectedId) || null, [tasks, selectedId]);

  useEffect(() => {
    window.clerk.bootstrap().then(data => { setSettings(data.settings); setRuntime(data.runtime); setTasks(data.tasks); setExpanded(data.expanded); }).catch(event => setError(event.message));
    return window.clerk.onTask(updated => setTasks(previous => [updated, ...previous.filter(item => item.id !== updated.id)]));
  }, []);

  useEffect(() => {
    if (!runtime) { setState(null); return; }
    window.clerk.state({ scenario, period }).then(setState).catch(() => { setState(null); setRuntime(null); });
  }, [runtime, scenario, period]);

  async function act<T>(action: () => Promise<T>, next?: (result: T) => void) {
    setError(''); setBusy(true);
    try { const result = await action(); next?.(result); return result; }
    catch (event) { setError(event instanceof Error ? event.message : String(event)); return null; }
    finally { setBusy(false); }
  }
  function selectRecipe(id: string) {
    setRecipe(id); setPrompt(recipes.find(item => item.id === id)?.prompt || '');
  }
  async function searchRecords(value: string) {
    setRecordQuery(value);
    if (!runtime || value.trim().length < 2) { setRecords([]); return; }
    try { const result = await window.clerk.search({ query: value, scenario, period }); setRecords(result.results.filter(item => item.type === 'contract').slice(0, 8)); }
    catch { setRecords([]); }
  }
  async function create(run: boolean) {
    const created = await act(() => window.clerk.createTask({ title: prompt.trim().slice(0, 60), prompt, recipe, period, scenario, recordId: recordId || null, source, allowNebius }), value => {
      setTasks(previous => [value, ...previous.filter(item => item.id !== value.id)]);
      setSelectedId(value.id); setView('task');
    });
    if (created?.source && !expanded) await act(() => window.clerk.setExpanded(true), setExpanded);
    if (created && run) await act(() => window.clerk.runTask(created.id));
  }
  async function toggleExpanded() { await act(() => window.clerk.setExpanded(!expanded), setExpanded); }
  function openTask(item: Task) { setSelectedId(item.id); setView('task'); setPage(0); setProposalMode(false); if (item.source && !expanded) window.clerk.setExpanded(true).then(setExpanded); }

  if (!settings) return <div className="loading">Opening Clerk…</div>;
  return <div className={`app ${expanded ? 'expanded' : 'compact'}`}>
    <header className="app-header">
      <div className="brand-row"><button className="brand" onClick={() => setView('home')} aria-label="Clerk home"><span className="brand-mark">C</span><span>Clerk</span></button><div className="header-actions"><button className="icon-button" title={expanded ? 'Compact view' : 'Expand Clerk'} aria-label={expanded ? 'Compact view' : 'Expand Clerk'} onClick={toggleExpanded}>{expanded ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button><button className="icon-button" title="Settings" aria-label="Settings" onClick={() => setView('settings')}><Settings2 size={18}/></button></div></div>
      <button className="workspace-strip" onClick={() => setView('settings')}><span className={`connection-dot ${runtime ? 'connected' : ''}`}/><span className="workspace-text"><strong>{runtime?.name || settings.connection?.workspaceName || 'No workspace connected'}</strong><small>{runtime ? `${scenario === 'main' ? 'Main' : scenario} · ${period} · Engine connected` : settings.connection ? 'Engine unavailable · Saved work available' : 'Select an ORR runtime or work with a source'}</small></span><ChevronDown size={16}/></button>
    </header>
    <div className="nav"><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Plus size={16}/> New task</button><button className={view === 'tasks' || view === 'task' ? 'active' : ''} onClick={() => setView('tasks')}><List size={16}/> Tasks <span className="nav-count">{tasks.length}</span></button></div>
    {error && <div className="global-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
    <main>
      {view === 'home' && <div className="home-view">
        <div className="view-heading"><span className="eyebrow">Workspace assistant</span><h1>What needs attention?</h1><p>Investigate accounting work, review source material, and prepare a clear next step.</p></div>
        <div className="scope-card"><div className="card-heading"><span>Task context</span><span className="caption">Selected in Clerk</span></div><div className="scope-grid"><label>Scenario<select value={scenario} onChange={event => setScenario(event.target.value)}><option value="main">Main</option>{state?.scenarios?.filter((item: any) => item.id !== 'main').map((item: any) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Period<input type="month" value={period} onChange={event => setPeriod(event.target.value)}/></label></div>
          <label className="field-label">Contract <span>optional</span><div className="search-field"><Search size={16}/><input value={recordQuery} onChange={event => searchRecords(event.target.value)} placeholder="Search ORR contracts" disabled={!runtime}/>{recordId && <button onClick={() => { setRecordId(''); setRecordName(''); setRecordQuery(''); }} aria-label="Clear contract"><X size={14}/></button>}</div></label>{recordId && <div className="selected-record"><Check size={14}/> {recordName} <span>{recordId}</span></div>}{records.length > 0 && !recordId && <div className="search-results">{records.map(item => <button key={item.id} onClick={() => { setRecordId(item.id); setRecordName(item.name); setRecordQuery(item.name); setRecords([]); }}>{item.name}<small>{item.id}</small></button>)}</div>}
          <button className="source-button" onClick={() => act(() => window.clerk.selectSource(), value => { if (value) setSource(value); })}><FileText size={16}/>{source ? source.name : 'Add a source document'}<span>{source ? 'Change' : 'PDF, DOCX, text'}</span></button>{source && <p className="small-note">Staged locally. {source.coverage}. No provider request has been sent.</p>}
        </div>
        <div className="recipe-section"><div className="section-heading">Start with</div><div className="recipe-list">{recipes.map(item => <button className={`recipe ${recipe === item.id ? 'selected' : ''}`} key={item.id} onClick={() => selectRecipe(item.id)}><span>{item.label}</span><ArrowRight size={15}/></button>)}</div></div>
        <div className="composer"><label htmlFor="task-prompt">Your task</label><textarea id="task-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} rows={expanded ? 3 : 4} placeholder="Ask about the selected work…"/><label className="check-line"><input type="checkbox" checked={allowNebius} onChange={event => setAllowNebius(event.target.checked)} disabled={!settings.hasNebKey || settings.externalInferenceBlocked}/><span>Send selected ORR facts to Nebius for an explanation</span></label><div className="composer-bottom"><span>{allowNebius ? 'External inference · selected facts' : 'ORR facts only · no external inference'}</span><div><button className="secondary-button" disabled={busy || !prompt.trim()} onClick={() => create(false)}>Save draft</button><button className="primary-button" disabled={busy || !prompt.trim() || !runtime} onClick={() => create(true)}>Investigate <ArrowRight size={15}/></button></div></div></div>
      </div>}
      {view === 'tasks' && <div className="tasks-view"><div className="view-heading"><span className="eyebrow">Local work</span><h1>Tasks</h1><p>Work stays here until you explicitly apply a reviewed action in ORR.</p></div>{tasks.length === 0 ? <div className="empty-state"><BookOpen size={24}/><h2>No tasks yet</h2><p>Start an investigation or stage a source document.</p><button className="primary-button" onClick={() => setView('home')}>New task</button></div> : <div className="task-list">{tasks.map(item => <button className="task-row" key={item.id} onClick={() => openTask(item)}><span className={`status-mark ${item.status}`}/><span className="task-row-main"><strong>{item.title}</strong><small>{item.workspaceName || 'Unassigned source'} · {item.scenario} · {item.period}</small></span><span className="task-row-side"><small>{dateLabel(item.updatedAt)}</small><em>{statusLabel(item.status)}</em></span></button>)}</div>}</div>}
      {view === 'settings' && <SettingsView settings={settings} runtime={runtime} onChange={setSettings} onRuntime={setRuntime} act={act}/>}
      {view === 'task' && task && <div className="task-view"><div className="task-top"><button className="back-button" onClick={() => setView('tasks')}><ArrowLeft size={16}/> Tasks</button><span className={`status-pill ${task.status}`}>{statusLabel(task.status)}</span></div><div className="task-title"><span className="eyebrow">{task.recipe.replaceAll('-', ' ')} · {task.period}</span><h1>{task.title}</h1><p>{task.workspaceName || 'Unassigned source'} · {task.scenario === 'main' ? 'Main' : task.scenario}{task.recordId ? ` · ${task.recordId}` : ''}</p></div>
        {task.source && <div className="source-review"><div className="section-heading">Source review <span>Local draft</span></div><div className="review-layout"><div className="source-pane"><div className="pane-title"><FileText size={15}/>{task.source.name}</div><div className="source-text"><div className="source-location">{task.source.locations[page]?.page ? `Page ${task.source.locations[page].page}` : 'Text'}</div>{task.source.locations[page]?.text || 'No selectable text on this page.'}</div><div className="page-nav"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>{page + 1} / {task.source.locations.length}</span><button disabled={page >= task.source.locations.length - 1} onClick={() => setPage(page + 1)}>Next</button></div></div><div className="work-pane"><strong>Parsing coverage</strong><p>{task.source.coverage}</p><strong>Review notes</strong><textarea value={task.notes || ''} onChange={event => setTasks(previous => previous.map(item => item.id === task.id ? { ...item, notes: event.target.value } : item))} placeholder="Record facts, gaps, or questions…" rows={6}/><button className="secondary-button" onClick={() => act(() => window.clerk.saveTask({ id: task.id, notes: task.notes || '' }))}>Save notes</button><p className="small-note">The source is staged locally. Extraction and classification are not available in this build.</p></div></div></div>}
        <div className="task-content"><div className="card-heading">Task <span className="caption">{task.stage || statusLabel(task.status)}</span></div><p className="task-prompt">{task.prompt}</p>{task.error && <div className="inline-alert" role="alert"><CircleAlert size={16}/>{task.error}</div>}
          {task.facts && <div className="result-card"><div className="result-title"><span>ORR result</span><small>{task.facts.scenario} · {task.facts.period}</small></div><div className="metric-grid">{Object.entries(task.facts.reportSummary || {}).slice(0, expanded ? 8 : 4).map(([key, value]) => <div className="metric" key={key}><small>{label(key)}</small><strong>{money(value, state?.workspace?.currency || 'USD')}</strong></div>)}</div><p className="coverage">Coverage: {task.facts.coverage?.contractCount ?? 0} contracts in ORR. {task.facts.coverage?.selectedContractFound ? '' : 'Selected contract was not found.'}</p>{task.facts.closeChecks && <div className="check-list">{task.facts.closeChecks.map((check: any) => <div key={check.id}><span>{check.label || label(check.id)}</span><strong>{check.status}</strong></div>)}</div>}</div>}
          {task.facts?.previousPeriod && <div className="result-card"><div className="result-title"><span>Revenue movement</span><small>{task.facts.previousPeriod} → {task.facts.period}</small></div><div className="variance-summary"><span>Prior {money(task.facts.previousRevenue)}</span><ArrowRight size={14}/><span>Current {money(task.facts.reportSummary?.revenue)}</span><strong>Change {money(task.facts.revenueChange)}</strong></div><div className="comparison"><div><span>Contract</span><span>Prior</span><span>Current</span></div>{task.facts.changedContracts?.map((item: any) => <div key={item.id}><span>{item.name}<small> · {item.id}</small></span><strong>{money(item.before)}</strong><strong>{money(item.after)}</strong></div>)}</div><p className="coverage">Largest changes shown from {task.facts.coverage?.contractCount} contracts. Values came from ORR reports; change uses exact decimal subtraction.</p></div>}
          {task.answer && <div className="answer-card"><div className="result-title"><span>Clerk explanation</span><small>Nebius · {task.inference?.modelReturned || task.inference?.modelRequested}</small></div><p>{task.answer}</p><details><summary>Data access and usage</summary><p>Sent: {task.inference?.sent.join(', ')}. Token usage: {task.inference?.usage ? JSON.stringify(task.inference.usage) : 'Not reported'}.</p></details></div>}
          {!task.facts && task.status === 'draft' && <p className="quiet">No current ORR facts have been read for this task.</p>}
          <div className="task-actions">{task.status === 'running' ? <button className="secondary-button" onClick={() => act(() => window.clerk.stopTask(task.id))}><Square size={14}/> Stop</button> : ['draft', 'interrupted', 'canceled', 'stale'].includes(task.status) && task.workspacePath && <button className="primary-button" disabled={busy || !runtime} onClick={() => act(() => window.clerk.runTask(task.id))}>Investigate again <ArrowRight size={15}/></button>}{task.status === 'completed' && task.workspacePath && task.recordId && !task.proposal && <button className="secondary-button" onClick={() => setProposalMode(true)}>Prepare billing preview</button>}</div>
          {task.status === 'needs-verification' && <button className="secondary-button" disabled={busy || !runtime} onClick={() => act(() => window.clerk.verifyOutcome(task.id))}>Check ORR for this operation</button>}
        </div>
        {(proposalMode || task.proposal) && <div className="proposal-card"><div className="section-heading">Billing proposal <span>{task.proposal ? statusLabel(task.status) : 'Draft'}</span></div>{!task.proposal || proposalMode ? <div className="proposal-form"><p>Prepare one billing entry for the selected contract. ORR validates the fields and calculates the preview.</p><label>Contract ID<input value={task.recordId || ''} readOnly/></label><div className="scope-grid"><label>Effective date<input type="date" value={billing.effective_date} onChange={event => setBilling({ ...billing, effective_date: event.target.value })}/></label><label>Amount<input type="number" step="0.01" value={billing.amount} onChange={event => setBilling({ ...billing, amount: event.target.value })}/></label></div><label>Reference<input value={billing.reference} onChange={event => setBilling({ ...billing, reference: event.target.value })} placeholder="Invoice reference"/></label><label>Rationale<input value={billing.rationale} onChange={event => setBilling({ ...billing, rationale: event.target.value })} placeholder="Why this entry is needed"/></label><button className="primary-button" disabled={busy || !task.recordId || !billing.amount || !billing.effective_date} onClick={() => act(() => window.clerk.preview({ id: task.id, command: 'record_billing', payload: { contract_id: task.recordId, effective_date: billing.effective_date, amount: billing.amount, reference: billing.reference, rationale: billing.rationale } }), () => setProposalMode(false))}>Prepare ORR preview</button></div> : null}
          {task.proposal && <div className="preview-detail"><p><strong>Target:</strong> {task.workspaceName} · {task.proposal.envelope.scenario_id} · {task.proposal.envelope.period}</p><p><strong>What changes:</strong> {label(task.proposal.envelope.command)} · {money(task.proposal.envelope.payload.amount, state?.workspace?.currency || 'USD')} · {task.proposal.envelope.payload.effective_date}</p><div className="comparison"><div><span>ORR report</span><span>Before</span><span>After</span></div>{Object.keys(task.proposal.preview?.before?.summary || {}).slice(0, 6).map(key => <div key={key}><span>{label(key)}</span><strong>{money(task.proposal?.preview?.before?.summary?.[key], state?.workspace?.currency || 'USD')}</strong><strong>{money(task.proposal?.preview?.state?.report?.summary?.[key], state?.workspace?.currency || 'USD')}</strong></div>)}</div>{task.proposal.receipt ? <div className="receipt"><Check size={16}/> Accepted by ORR · change {task.proposal.receipt.result?.change_set_id || 'recorded'}</div> : <div className="proposal-actions"><button className="secondary-button" onClick={() => setProposalMode(true)}>Revise</button><button className="primary-button" disabled={busy || task.status !== 'ready-for-review'} onClick={() => act(() => window.clerk.apply(task.id))}>Approve and apply to {task.scenario === 'main' ? 'Main' : task.scenario}</button></div>}</div>}
        </div>}
        <div className="task-footer"><button onClick={() => act(() => window.clerk.deleteTask(task.id), value => { setTasks(value); setView('tasks'); setSelectedId(null); })}>Remove local task</button><span>Accepted ORR evidence and changes remain in ORR.</span></div>
      </div>}
    </main>
    <footer className="app-footer"><span><LockKeyhole size={13}/> Accounting stays in ORR</span><span>Inference uses external APIs when allowed</span></footer>
  </div>;
}

function SettingsView({ settings, runtime, onChange, onRuntime, act }: { settings: Settings; runtime: Runtime; onChange: (value: Settings) => void; onRuntime: (value: Runtime) => void; act: <T>(action: () => Promise<T>, next?: (result: T) => void) => Promise<T | null> }) {
  const [origin, setOrigin] = useState(settings.connection?.origin || 'http://127.0.0.1:4318');
  const [token, setToken] = useState('');
  const [expectedPath, setExpectedPath] = useState(settings.connection?.workspacePath || '');
  const [model, setModel] = useState(settings.model);
  const [key, setKey] = useState('');
  const [testResult, setTestResult] = useState('');
  return <div className="settings-view"><div className="view-heading"><span className="eyebrow">Clerk preferences</span><h1>Settings</h1><p>Connections and task history belong to Clerk, separate from the ORR window.</p></div>
    <section className="settings-section"><div className="section-heading">Accounting runtime <span>{runtime ? 'Connected' : 'Disconnected'}</span></div><p>Connect to an ORR runtime you started or explicitly trust. Its workspace path is verified before every accounting request.</p><label>Loopback URL<input value={origin} onChange={event => setOrigin(event.target.value)} placeholder="http://127.0.0.1:4318"/></label><label>Session token<input type="password" value={token} onChange={event => setToken(event.target.value)} placeholder={settings.hasOrrToken ? 'Saved in device credential encryption' : 'Token from ORR serve'}/></label><label>Expected .orr path <small>optional on first connection</small><input value={expectedPath} onChange={event => setExpectedPath(event.target.value)} placeholder="/path/to/Company.orr"/></label>{settings.connection && <div className="connection-detail">{settings.connection.workspaceName}<small>{shortPath(settings.connection.workspacePath)}</small></div>}<div className="setting-actions"><button className="primary-button" onClick={() => act(() => window.clerk.connect({ origin, token, expectedPath }), result => { onChange(result.settings); onRuntime(result.runtime); setExpectedPath(result.runtime?.path || expectedPath); setToken(''); })}>Connect to ORR</button>{settings.connection && <button className="secondary-button" onClick={() => act(() => window.clerk.disconnect(), value => { onChange(value); onRuntime(null); })}>Disconnect</button>}</div><p className="small-note">Clerk attaches to the specified runtime. It does not launch a second service against a workspace already in use.</p></section>
    <section className="settings-section"><div className="section-heading">Reasoning and tools <span>Nebius Token Factory</span></div><p>Selected task facts are sent to Nebius only when you enable inference for that task. Your provider account is billed directly.</p><label>API key<input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder={settings.hasNebKey ? 'Key saved on this device' : 'Add Nebius API key'}/></label><label>Model ID<input value={model} onChange={event => setModel(event.target.value)} placeholder="Enter an account-accessible model ID"/></label><div className="setting-actions"><button className="primary-button" onClick={() => act(() => window.clerk.settings({ model, nebKey: key }), value => { onChange(value); setKey(''); })}>Save connection</button><button className="secondary-button" onClick={() => act(() => window.clerk.testNebius(), value => setTestResult(`Connected: ${value.model}`))}>Test with sample data</button></div>{testResult && <div className="success-note"><Check size={15}/>{testResult}</div>}</section>
    <section className="settings-section"><div className="section-heading">Data and window</div><label className="switch-line"><input type="checkbox" checked={settings.externalInferenceBlocked} onChange={event => act(() => window.clerk.settings({ externalInferenceBlocked: event.target.checked }), onChange)}/><span><strong>Block external inference</strong><small>Saved tasks and ORR reads remain available.</small></span></label><label className="switch-line"><input type="checkbox" checked={settings.keepOnTop} onChange={event => act(() => window.clerk.settings({ keepOnTop: event.target.checked }), onChange)}/><span><strong>Keep Clerk on top</strong><small>Off by default. Affects only this window.</small></span></label><p className="small-note">Removing a local task does not remove accounting history or accepted evidence in ORR.</p></section>
  </div>;
}
