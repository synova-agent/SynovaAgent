/**
 * app/js/control-tower.js — 控制塔仪表盘逻辑 (D213)
 *
 * 读取 .codex/signals/ 目录下的组件信号文件，渲染 6 组件健康总览。
 * 复用 D96 shell + D97 skeleton 模式。
 *
 * 依赖: auth.js, shell.js
 */

const TOWER_CONFIG = {
  refreshIntervalMs: 300000,  // 5 分钟
  signalExpiryMs: 600000,     // 10 分钟过期
  components: [
    { id: 'context-injector', label: 'Context Injector', signalPath: '.codex/signals/context-injector.json' },
    { id: 'gatekeeper', label: 'Gatekeeper', signalPath: '.codex/settings/gatekeeper/.dashboard-signal' },
    { id: 'external-auditor', label: 'External Auditor', signalPath: '.codex/audit-reports/latest.json' },
    { id: 'contract-archiver', label: 'Contract Archiver', signalPath: '.codex/signals/contract-archiver.json' },
    { id: 'write-lock', label: 'Write Lock', signalPath: '.codex/signals/write-lock.json' },
  ],
};

let refreshTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  loadTower();
  startAutoRefresh();
});

// ═══ 信号加载 ═══

async function loadTower() {
  const container = document.getElementById('tower-health');
  if (!container) return;
  // Show skeletons
  container.innerHTML = TOWER_CONFIG.components.map(() =>
    '<div class="tower-card skeleton"><div class="skeleton-pulse"></div></div>'
  ).join('');

  try {
    const signals = await loadComponentSignals();
    renderTowerHealth(signals);
    renderActiveBlocks(signals);
    renderAuditSummary();
    updateTimestamp();
  } catch (err) {
    console.error('Tower load failed:', err);
    container.innerHTML = '<div class="error-card"><p>Control tower temporarily unavailable</p><button class="retry-btn" onclick="loadTower()">Retry</button></div>';
  }
}

async function loadComponentSignals() {
  const results = [];

  for (const comp of TOWER_CONFIG.components) {
    try {
      const resp = await fetch('/' + comp.signalPath);
      if (!resp.ok) {
        results.push({ id: comp.id, label: comp.label, status: 'unknown', degraded: true, reason: 'Signal file not found', timestamp: null });
        continue;
      }
      const text = await resp.text();
      const signal = parseSignal(text, comp);
      results.push(signal);
    } catch {
      results.push({ id: comp.id, label: comp.label, status: 'unknown', degraded: true, reason: 'Fetch error', timestamp: null });
    }
  }

  return results;
}

function parseSignal(text, comp) {
  text = text.trim();

  // Try JSON format
  try {
    const data = JSON.parse(text);
    const status = data.status || 'unknown';
    const now = Date.now();
    const ts = data.timestamp ? new Date(data.timestamp).getTime() : now;
    const age = now - ts;
    const expired = age > TOWER_CONFIG.signalExpiryMs;
    return {
      id: comp.id, label: comp.label,
      status: expired ? 'expired' : (status === 'green' ? 'green' : status === 'yellow' ? 'yellow' : status === 'red' ? 'red' : 'unknown'),
      degraded: data.degraded || expired,
      reason: data.reason || '',
      timestamp: data.timestamp,
      p0: data.p0_count || 0,
      p1: data.p1_count || 0,
      p2: data.p2_count || 0,
    };
  } catch { /* not JSON, try pipe format */ }

  // Try pipe format: COLOR|component|timestamp|reason
  const parts = text.split('|');
  if (parts.length >= 3) {
    const color = (parts[0] || '').toLowerCase();
    const ts = parts[2] ? new Date(parts[2]).getTime() : Date.now();
    const age = Date.now() - ts;
    const expired = age > TOWER_CONFIG.signalExpiryMs;
    return {
      id: comp.id, label: comp.label,
      status: expired ? 'expired' : (color === 'green' ? 'green' : color === 'yellow' ? 'yellow' : color === 'red' ? 'red' : 'unknown'),
      degraded: expired,
      reason: parts[3] || text,
      timestamp: parts[2] || null,
      p0: 0, p1: 0, p2: 0,
    };
  }

  return { id: comp.id, label: comp.label, status: 'unknown', degraded: true, reason: text.slice(0, 80), timestamp: null, p0: 0, p1: 0, p2: 0 };
}

// ═══ 渲染 ═══

function renderTowerHealth(signals) {
  const container = document.getElementById('tower-health');
  if (!container) return;

  container.innerHTML = signals.map((s) => {
    const statusClass = s.status === 'expired' ? 'yellow' : s.status;
    const dotClass = s.status === 'green' ? 'green' : s.status === 'expired' ? 'yellow' : s.status === 'yellow' ? 'yellow' : s.status === 'red' ? 'red' : 'gray';
    const labelClass = dotClass;
    const label = s.status === 'green' ? 'Healthy' : s.status === 'expired' ? 'Expired' : s.status === 'yellow' ? 'Warning' : s.status === 'red' ? 'Critical' : 'Unknown';
    const pCounts = (s.p0 || s.p1 || s.p2) ? `
      <div class="card-counts">
        ${s.p0 ? '<span class="count-badge count-p0">P0: ' + s.p0 + '</span>' : ''}
        ${s.p1 ? '<span class="count-badge count-p1">P1: ' + s.p1 + '</span>' : ''}
        ${s.p2 ? '<span class="count-badge count-p2">P2: ' + s.p2 + '</span>' : ''}
      </div>` : '';

    return `<div class="tower-card status-${statusClass}">
      <div class="card-header">
        <h3>${escHtml(s.label)}</h3>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="status-dot ${dotClass}"></span>
          <span class="status-label ${labelClass}">${label}</span>
        </div>
      </div>
      ${s.reason ? '<div class="card-reason">' + escHtml(s.reason) + '</div>' : ''}
      ${pCounts}
      <div class="card-meta">${s.timestamp ? 'Last: ' + new Date(s.timestamp).toLocaleString() : 'No signal data'}</div>
    </div>`;
  }).join('');
}

function renderActiveBlocks(signals) {
  const container = document.getElementById('blocks-list');
  if (!container) return;

  const blocks = [];
  for (const s of signals) {
    if (s.status === 'red') {
      blocks.push({ severity: 'P0', component: s.label, reason: s.reason || 'Critical status', time: s.timestamp });
    } else if (s.status === 'yellow' || s.status === 'expired') {
      blocks.push({ severity: 'P1', component: s.label, reason: s.reason || s.status === 'expired' ? 'Signal expired' : 'Warning', time: s.timestamp });
    }
  }

  if (blocks.length === 0) {
    container.innerHTML = '<div class="blocks-empty">No active blocks — all systems healthy</div>';
    return;
  }

  container.innerHTML = blocks.map((b) => `
    <div class="block-item">
      <span class="block-severity ${b.severity}">${b.severity}</span>
      <span class="block-component">${escHtml(b.component)}</span>
      <span class="block-reason">${escHtml(b.reason)}</span>
      <span class="block-time">${b.time ? new Date(b.time).toLocaleString() : ''}</span>
    </div>
  `).join('');
}

async function renderAuditSummary() {
  const container = document.getElementById('audit-content');
  if (!container) return;

  try {
    // Try to read latest audit report
    const resp = await fetch('/.codex/audit-reports/latest.json');
    if (!resp.ok) { return; }
    const data = await resp.json();
    const audits = data.results || data.audits || [];
    if (audits.length === 0) return;

    container.innerHTML = audits.slice(0, 10).map((a) => {
      const passed = a.passed || !a.failed;
      return `<div class="audit-row">
        <span class="audit-check">${escHtml(a.check || a.name || '')}</span>
        <span class="audit-result ${passed ? 'pass' : 'fail'}">${passed ? 'PASS' : 'FAIL'}</span>
        <span class="audit-detail">${escHtml(a.detail || a.message || '')}</span>
        <span class="audit-time">${a.timestamp ? new Date(a.timestamp).toLocaleString() : ''}</span>
      </div>`;
    }).join('');
  } catch { /* no audit data */ }
}

// ═══ 自动刷新 ═══

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadTower, TOWER_CONFIG.refreshIntervalMs);
}

function updateTimestamp() {
  const el = document.getElementById('tower-last-refresh');
  if (el) el.textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

// ═══ Helpers ═══

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
