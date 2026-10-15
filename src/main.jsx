import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    activity: <><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></>,
    database: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0"/></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    left: <><path d="m15 18-6-6 6-6"/></>,
    right: <><path d="m9 18 6-6-6-6"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6.5L20 12M4 12l2 5.5A7 7 0 0 0 18.4 15"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function formatNumber(value = 0) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatMs(value = 0) {
  return `${Number(value).toFixed(value < 10 ? 1 : 0)} ms`;
}

function App() {
  const [view, setView] = useState('overview');
  const [metrics, setMetrics] = useState(null);
  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState({ users: [], total: 0, page: 1, pages: 1, pageSize: 10 });
  const [search, setSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '' });
  const [busy, setBusy] = useState('');
  const [retiredAck, setRetiredAck] = useState(false);
  const [contractWord, setContractWord] = useState('');

  async function refreshMetrics() {
    try {
      const [nextMetrics, nextHealth] = await Promise.all([api('/api/metrics'), api('/api/health')]);
      setMetrics(nextMetrics);
      setHealth(nextHealth);
      setError('');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshUsers(page = userPage, term = search) {
    setUsersLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: '10', search: term });
      setUsers(await api(`/api/users?${query}`));
      setError('');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    refreshMetrics();
    const timer = window.setInterval(refreshMetrics, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => refreshUsers(userPage, search), 180);
    return () => window.clearTimeout(timer);
  }, [userPage, search]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const simulated = metrics?.simulated ?? true;
  const migration = metrics?.migration || { phase: 'legacy', status: 'idle', processed: 0, total: 100000, missing: 100000, mismatches: 0, message: 'Loading migration status.' };
  const progress = migration.total ? Math.min(100, Math.round((migration.processed / migration.total) * 100)) : migration.status === 'validated' ? 100 : 0;

  async function runMigration() {
    setBusy('migration');
    try {
      const result = await api('/api/migration/run', { method: 'POST', body: '{}' });
      if (!result.started) throw new Error('A migration is already running.');
      setNotice('Expand and batched backfill started. API health will keep refreshing.');
      await refreshMetrics();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }

  async function validateMigration() {
    setBusy('validation');
    try {
      const result = await api('/api/migration/validate', { method: 'POST', body: '{}' });
      setNotice(result.valid ? `Consistency check passed for ${formatNumber(result.total)} records.` : `Validation found ${formatNumber(result.missing)} missing and ${formatNumber(result.mismatches)} mismatched records.`);
      await refreshMetrics();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }

  async function contractMigration() {
    setBusy('contract');
    try {
      await api('/api/migration/contract', { method: 'POST', body: JSON.stringify({ confirmContract: contractWord, legacyClientsRetired: retiredAck }) });
      setNotice('Contract phase completed. The API now uses the new schema.');
      setContractWord('');
      setRetiredAck(false);
      await refreshMetrics();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }

  async function createUser(event) {
    event.preventDefault();
    setBusy('create');
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify(createForm) });
      setNotice('User created.');
      setCreateForm({ name: '', email: '' });
      setCreating(false);
      setUserPage(1);
      await Promise.all([refreshUsers(1, search), refreshMetrics()]);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }

  async function downloadReport() {
    try {
      const report = await api('/api/report');
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'cloudshift-migration-report.json';
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Migration report downloaded.');
    } catch (failure) { setError(failure.message); }
  }

  const comparison = metrics?.comparison || {};
  const chart = metrics?.history || [];
  const linePoints = (key, width = 540, height = 148) => {
    if (chart.length < 2) return '';
    const values = chart.map((entry) => Number(entry[key] || 0));
    const min = Math.min(...values) * 0.75;
    const max = Math.max(...values) * 1.18 || 1;
    return values.map((value, index) => `${(index / (values.length - 1)) * width},${height - ((value - min) / Math.max(1, max - min)) * height}`).join(' ');
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setView('overview'); }}>
        <span className="brand-mark"><span></span><span></span><span></span></span>
        <span>cloudshift<small>DATABASE OPERATIONS</small></span>
      </a>
      <div className="workspace-label">WORKSPACE</div>
      <div className="workspace-select"><span className="workspace-avatar">A</span><span>Acme staging<small>us-east-1</small></span><span className="select-chevron">⌄</span></div>
      <div className="nav-label">MONITOR</div>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}><Icon name="grid"/>Overview</button>
        <button className={view === 'users' ? 'active' : ''} onClick={() => setView('users')}><Icon name="users"/>Users<span className="nav-count">100k</span></button>
        <button className={view === 'activity' ? 'active' : ''} onClick={() => setView('activity')}><Icon name="activity"/>Activity & report</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="connection-card"><span className={`connection-dot ${health?.database?.connected ? 'online' : 'offline'}`}></span><span><strong>{health?.database?.mode === 'postgresql' ? 'RDS PostgreSQL' : 'Demo database'}</strong><small>{health?.database?.connected ? 'Connection healthy' : 'Waiting for API'}</small></span><span className="connection-menu">···</span></div>
        <div className="profile"><div className="profile-avatar">NS</div><span><strong>Nisha Shah</strong><small>Workspace owner</small></span><span className="profile-menu">⌄</span></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="crumb"><span>Acme staging</span><span className="crumb-slash">/</span><strong>{view === 'overview' ? 'Overview' : view === 'users' ? 'Users' : 'Activity & report'}</strong></div><div className="top-actions"><span className="region-chip"><i></i> us-east-1</span><span className="top-divider"></span><span className={`health-chip ${health?.status === 'ok' ? 'healthy' : ''}`}><span className="pulse-dot"></span>{health?.status === 'ok' ? 'All systems operational' : 'Connecting'}</span><button className="icon-button" title="Refresh data" onClick={refreshMetrics}><Icon name="refresh"/></button></div></header>
      <div className="page-content">
        <div className="page-heading"><div><div className="eyebrow">DATABASE MIGRATION OBSERVABILITY</div><h1>{view === 'overview' ? 'Migration overview' : view === 'users' ? 'User directory' : 'Activity & report'}</h1><p>{view === 'overview' ? 'Monitor application health while your schema evolves.' : view === 'users' ? 'Browse and manage records across the active schema.' : 'Review migration events, validation, and measurement context.'}</p></div><div className="heading-actions"><span className={`mode-tag ${simulated ? 'simulated' : 'observed'}`}><span></span>{simulated ? 'SIMULATED DATA' : 'OBSERVED'}</span>{view === 'users' && <button className="button-primary" onClick={() => setCreating(true)}><Icon name="plus"/> Add user</button>}{view === 'activity' && <button className="button-secondary" onClick={downloadReport}><Icon name="download"/> Export report</button>}</div></div>

        {error && <div className="alert alert-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={16}/></button></div>}
        {notice && <div className="alert alert-success" role="status"><Icon name="check" size={16}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notification"><Icon name="close" size={16}/></button></div>}
        {simulated && <div className="simulation-banner"><span className="simulation-icon">i</span><span><strong>Demo mode</strong> · Sample metrics and 100,000 virtual users are simulated. No AWS resources or PostgreSQL database are connected.</span></div>}

        {view === 'overview' && <>
          <section className="metric-grid" aria-label="Application metrics">
            <MetricCard label={simulated ? 'Simulated requests' : 'API requests'} value={formatNumber(metrics?.requests || 0)} change={simulated ? 'sample traffic' : 'since process start'} tone="teal" icon="↗" loading={loading}/>
            <MetricCard label="P95 latency" value={formatMs(metrics?.latency?.p95Ms || 0)} change={simulated ? 'sample measurement' : 'observed API calls'} tone="blue" icon="◷" loading={loading}/>
            <MetricCard label="Error rate" value={`${((metrics?.errorRate || 0) * 100).toFixed(2)}%`} change={simulated ? 'sample measurement' : `${formatNumber(metrics?.errors || 0)} failed requests`} tone="coral" icon="!" loading={loading}/>
            <MetricCard label="Database records" value={formatNumber(health?.database?.userCount || 0)} change={simulated ? 'virtual sample records' : 'RDS PostgreSQL'} tone="gold" icon="▤" loading={loading}/>
          </section>

          <section className="overview-grid">
            <div className="panel performance-panel">
              <div className="panel-header"><div><h2>API performance</h2><p>{simulated ? 'Illustrative sample latency during the migration lifecycle' : 'Latency observed by the Express API process'}</p></div><div className="chart-legend"><span><i className="legend-line latency-line"></i>P95 latency</span></div></div>
              <div className="chart-summary"><strong>{formatMs(metrics?.latency?.p50Ms || 0)}</strong><span>current P50</span><strong>{formatMs(metrics?.latency?.p95Ms || 0)}</strong><span>current P95</span></div>
              <div className="chart-wrap">
                <div className="chart-y-labels"><span>160 ms</span><span>120 ms</span><span>80 ms</span><span>40 ms</span><span>0</span></div>
                <svg className="performance-chart" viewBox="0 0 540 148" preserveAspectRatio="none" role="img" aria-label="API latency trend chart">
                  <defs><linearGradient id="latencyFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#117c6b" stopOpacity=".19"/><stop offset="1" stopColor="#117c6b" stopOpacity="0"/></linearGradient></defs>
                  {[0, 37, 74, 111, 148].map((y) => <line key={y} x1="0" x2="540" y1={y} y2={y} className="chart-gridline"/>)}
                  {simulated && <><polyline points="0,99 78,89 155,104 232,82 310,91 385,68 463,79 540,57" className="chart-area"/><polyline points="0,99 78,89 155,104 232,82 310,91 385,68 463,79 540,57" className="chart-path latency-path"/></>}
                  {!simulated && chart.length > 1 && <><polyline points={linePoints('p95Ms')} className="chart-area"/><polyline points={linePoints('p95Ms')} className="chart-path latency-path"/></>}
                  {!simulated && chart.length < 2 && <text x="270" y="77" textAnchor="middle" className="chart-empty-label">Migration snapshots will appear here</text>}
                </svg>
              </div>
              <div className="chart-x-labels">{simulated ? <><span>Earlier</span><span>Expand</span><span>Backfill</span><span>Validate</span><span>Now</span></> : chart.length > 1 ? chart.map((entry) => <span key={entry.phase}>{entry.phase}</span>) : <><span>Before</span><span>During</span><span>After</span></>}</div>
              <div className="chart-footnote"><span className="live-indicator"></span>{simulated ? 'Sample curve, not a benchmark' : 'Refreshing every 3 seconds · local process observations, not CloudWatch'}</div>
            </div>

            <div className="panel system-panel">
              <div className="panel-header"><div><h2>System status</h2><p>Current application connections</p></div><span className="status-icon"><Icon name="activity" size={17}/></span></div>
              <div className="system-row"><span className="system-symbol app-symbol">A</span><span><strong>Application API</strong><small>Express service · :4000</small></span><span className="status-pill green">Healthy</span></div>
              <div className="system-row"><span className="system-symbol db-symbol"><Icon name="database" size={17}/></span><span><strong>{health?.database?.mode === 'postgresql' ? 'PostgreSQL database' : 'Sample dataset'}</strong><small>{health?.database?.mode === 'postgresql' ? 'Configured connection' : 'Virtual · 100k records'}</small></span><span className={`status-pill ${health?.database?.connected ? 'green' : 'red'}`}>{health?.database?.connected ? (simulated ? 'Simulated' : 'Connected') : 'Offline'}</span></div>
              <div className="system-row"><span className="system-symbol schema-symbol">{migration.phase === 'legacy' ? '01' : migration.phase === 'contracted' ? '03' : '02'}</span><span><strong>Schema phase</strong><small>{migration.phase === 'legacy' ? 'Legacy schema' : migration.phase === 'contracted' ? 'Contracted' : 'Expand & backfill'}</small></span><span className="status-pill amber">{migration.status}</span></div>
              <div className="uptime-block"><div><span>Application uptime</span><strong>{health ? `${Math.floor(health.uptimeSeconds / 60)}m ${health.uptimeSeconds % 60}s` : '—'}</strong></div><div className="uptime-track"><span style={{ width: health?.status === 'ok' ? '100%' : '15%' }}></span></div></div>
            </div>
          </section>

          <section className="panel migration-panel">
            <div className="panel-header migration-header"><div><div className="section-kicker"><span className="section-number">01</span> SCHEMA CHANGE</div><h2>Expand and contract</h2><p>Old and new application versions remain compatible through the expand phase.</p></div><div className="migration-actions"><button className="button-secondary" onClick={validateMigration} disabled={Boolean(busy)}><Icon name="check"/>{busy === 'validation' ? 'Checking…' : 'Validate data'}</button><button className="button-primary" onClick={runMigration} disabled={Boolean(busy) || ['running', 'validating', 'validated', 'contracted'].includes(migration.status)}><Icon name="arrow"/>{busy === 'migration' ? 'Starting…' : migration.status === 'validated' ? 'Backfill complete' : 'Run migration'}</button></div></div>
            <div className="migration-flow">
              <FlowStep number="1" title="Expand" description="Add nullable display_name" state={migration.phase === 'legacy' ? 'next' : 'done'}/><span className="flow-connector"></span>
              <FlowStep number="2" title="Backfill" description="Copy records in batches" state={migration.status === 'running' || migration.status === 'validating' ? 'active' : progress === 100 && migration.phase !== 'legacy' ? 'done' : 'next'}/><span className="flow-connector"></span>
              <FlowStep number="3" title="Validate" description="Check all records match" state={migration.status === 'validated' || migration.phase === 'contracted' ? 'done' : 'next'}/><span className="flow-connector"></span>
              <FlowStep number="4" title="Contract" description="Retire legacy column" state={migration.phase === 'contracted' ? 'done' : 'next'}/>
            </div>
            <div className="migration-progress"><div className="progress-copy"><span>{migration.message || 'Ready to start the migration.'}</span><strong>{formatNumber(migration.processed)} <i>/</i> {formatNumber(migration.total)}</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }}></span></div><div className="progress-foot"><span>{progress}% complete</span><span>Batch size: 1,000 records</span><span>{formatNumber(migration.missing || 0)} missing · {formatNumber(migration.mismatches || 0)} mismatched</span></div></div>
            {migration.phase !== 'legacy' && migration.phase !== 'contracted' && <div className="contract-box"><div><strong>Contract is a separate, guarded action</strong><p>Only proceed after every old application client has been retired. This operation drops the legacy <code>name</code> column.</p></div><div className="contract-controls"><label className="check-label"><input type="checkbox" checked={retiredAck} onChange={(event) => setRetiredAck(event.target.checked)}/> I have retired all legacy clients</label><div className="contract-input-row"><input aria-label="Type contract confirmation" value={contractWord} onChange={(event) => setContractWord(event.target.value)} placeholder="Type DROP_LEGACY_NAME"/><button className="button-danger" onClick={contractMigration} disabled={!retiredAck || contractWord !== 'DROP_LEGACY_NAME' || Boolean(busy) || migration.status !== 'validated'}>{busy === 'contract' ? 'Applying…' : 'Contract schema'}</button></div><small>Also requires LEGACY_CLIENTS_RETIRED=true on the server.</small></div></div>}
            <div className="migration-note"><span className="note-check"><Icon name="check" size={13}/></span> Existing values are preserved. Expand only adds a nullable column; contract is blocked until backfill is validated and legacy clients are explicitly retired.</div>
          </section>

          <section className="bottom-grid">
            <div className="panel comparison-panel"><div className="panel-header"><div><h2>Performance comparison</h2><p>{simulated ? 'Simulated reference values' : 'Captured across migration phases'}</p></div><span className="mini-tag">P95 LATENCY</span></div><div className="comparison-row comparison-head"><span>Phase</span><span>Requests</span><span>P95</span><span>Error rate</span></div>{[['before', 'Before'], ['during', 'During'], ['after', 'After']].map(([key, label]) => { const point = comparison[key]; return <div className="comparison-row" key={key}><span className="phase-label"><i className={`phase-dot ${key}`}></i>{label}</span><span>{point ? formatNumber(point.requests) : '—'}</span><span>{point ? formatMs(point.p95Ms) : '—'}</span><span>{point ? `${(point.errorRate * 100).toFixed(2)}%` : '—'}</span></div>; })}<div className="comparison-caption">{simulated ? 'Illustrative values only. Start a local PostgreSQL run to capture observed measurements.' : 'API process measurements; CloudWatch integration is not configured.'}</div></div>
            <div className="panel validation-panel"><div className="panel-header"><div><h2>Data consistency</h2><p>Full-table migration check</p></div><span className={`validation-mark ${migration.status === 'validated' ? 'passed' : ''}`}><Icon name={migration.status === 'validated' ? 'check' : 'database'} size={17}/></span></div><div className="validation-stat"><div><span>Records checked</span><strong>{formatNumber(migration.processed || 0)} <small>/ {formatNumber(migration.total || 0)}</small></strong></div><div><span>Missing values</span><strong className={migration.missing ? 'text-warning' : ''}>{formatNumber(migration.missing || 0)}</strong></div><div><span>Mismatched values</span><strong className={migration.mismatches ? 'text-warning' : ''}>{formatNumber(migration.mismatches || 0)}</strong></div></div><div className={`validation-result ${migration.status === 'validated' ? 'passed' : ''}`}><span>{migration.status === 'validated' ? '✓' : '·'}</span>{migration.status === 'validated' ? 'All records are consistent' : migration.phase === 'legacy' ? 'Run the migration to validate' : 'Awaiting full backfill validation'}</div></div>
          </section>
        </>}

        {view === 'users' && <section className="panel users-panel"><div className="users-toolbar"><div className="search-box"><Icon name="search" size={17}/><input aria-label="Search users" placeholder="Search name or email…" value={search} onChange={(event) => { setSearch(event.target.value); setUserPage(1); }}/>{search && <button onClick={() => setSearch('')} aria-label="Clear search"><Icon name="close" size={15}/></button>}</div><div className="table-meta">{usersLoading ? 'Searching…' : `${formatNumber(users.total)} records`}<span className="table-dot"></span>10 per page</div></div><div className="table-scroll"><table><thead><tr><th>USER</th><th>EMAIL ADDRESS</th><th>DISPLAY NAME</th><th>CREATED</th><th>ID</th></tr></thead><tbody>{usersLoading && !users.users.length ? <tr><td colSpan="5" className="table-state"><span className="spinner"></span>Loading records…</td></tr> : users.users.length ? users.users.map((user) => <tr key={user.id}><td><span className="user-name-cell"><span className="user-avatar">{user.name?.slice(0, 1)?.toUpperCase() || 'U'}</span><strong>{user.name}</strong></span></td><td>{user.email}</td><td>{user.displayName || <span className="muted-cell">Not backfilled</span>}</td><td>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</td><td className="id-cell">{user.id}</td></tr>) : <tr><td colSpan="5" className="table-state">No users match that search.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing {users.total ? (userPage - 1) * 10 + 1 : 0}–{Math.min(userPage * 10, users.total)} of {formatNumber(users.total)}</span><div className="pagination"><button title="Previous page" aria-label="Previous page" disabled={userPage <= 1 || usersLoading} onClick={() => setUserPage((page) => Math.max(1, page - 1))}><Icon name="left" size={16}/></button><span>Page <strong>{userPage}</strong> of {Math.max(1, users.pages)}</span><button title="Next page" aria-label="Next page" disabled={userPage >= users.pages || usersLoading} onClick={() => setUserPage((page) => Math.min(users.pages, page + 1))}><Icon name="right" size={16}/></button></div></div><div className="table-footnote">{users.simulated ? 'Virtual sample records · clearly simulated' : 'Records served from PostgreSQL'}</div></section>}

        {view === 'activity' && <div className="activity-layout"><section className="panel activity-panel"><div className="panel-header"><div><h2>Migration activity</h2><p>Chronological events from this application session</p></div><button className="button-secondary small-button" onClick={refreshMetrics}><Icon name="refresh"/> Refresh</button></div><div className="activity-list">{metrics?.activity?.length ? metrics.activity.map((item) => <div className="activity-item" key={item.id}><span className={`activity-marker ${item.level}`}>{item.level === 'success' ? <Icon name="check" size={13}/> : item.level === 'error' ? '!' : '·'}</span><div><strong>{item.message}</strong><small>{new Date(item.at).toLocaleString()}</small></div><span className={`activity-level ${item.level}`}>{item.level}</span></div>) : <div className="empty-state"><span className="empty-icon"><Icon name="activity" size={24}/></span><strong>No migration events yet</strong><p>Expand the schema to begin the migration walkthrough.</p><button className="button-primary" onClick={() => setView('overview')}>Go to migration</button></div>}</div></section><section className="panel report-panel"><div className="report-top"><span className="report-icon"><Icon name="database" size={20}/></span><span className={`mode-tag ${simulated ? 'simulated' : 'observed'}`}><span></span>{simulated ? 'SIMULATED' : 'OBSERVED'}</span></div><h2>Migration report</h2><p>A point-in-time record of migration phase, validation results, API observations, and data source.</p><dl><div><dt>Data source</dt><dd>{metrics?.databaseMode || 'Loading…'}</dd></div><div><dt>Schema phase</dt><dd>{migration.phase}</dd></div><div><dt>Validation</dt><dd>{migration.status === 'validated' || migration.phase === 'contracted' ? 'Passed' : 'Pending'}</dd></div><div><dt>API observations</dt><dd>{simulated ? 'Sample data' : 'Local measurements'}</dd></div></dl><button className="button-primary report-button" onClick={downloadReport}><Icon name="download"/> Download JSON report</button><div className="report-caveat">This is not a production SLO report. CloudWatch is not connected in this demo.</div></section></div>}
      </div>
      <footer className="app-footer"><span><span className="footer-mark">●</span> CloudShift <span className="footer-separator">/</span> Migration Lab</span><span>API polling active <i></i> 3 sec</span></footer>
    </main>

    {creating && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="modal-heading"><div><div className="eyebrow">USER MANAGEMENT</div><h2 id="create-title">Add a user</h2></div><button className="icon-button" onClick={() => setCreating(false)} aria-label="Close dialog"><Icon name="close"/></button></div><form onSubmit={createUser}><label>Full name<input autoFocus minLength="2" maxLength="120" required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="e.g. Maya Chen"/></label><label>Email address<input type="email" maxLength="254" required value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} placeholder="maya@company.com"/></label><div className="modal-actions"><button type="button" className="button-secondary" onClick={() => setCreating(false)}>Cancel</button><button className="button-primary" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : <><Icon name="plus"/> Create user</>}</button></div></form><p className="modal-note">{simulated ? 'This record will be stored in the in-memory demo session.' : 'This record will be written to PostgreSQL.'}</p></section></div>}
  </div>;
}

function MetricCard({ label, value, change, tone, icon, loading }) {
  return <article className={`metric-card tone-${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{loading ? <span className="skeleton"/> : value}</div><div className="metric-change"><span className={`metric-trend trend-${tone}`}>{tone === 'coral' ? '↘' : '↗'}</span>{change}</div><div className="metric-mini-track"><span></span></div></article>;
}

function FlowStep({ number, title, description, state }) {
  return <div className={`flow-step ${state}`}><span className="flow-number">{state === 'done' ? <Icon name="check" size={15}/> : number}</span><span><strong>{title}</strong><small>{description}</small></span></div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
