// ── Budget Tracker ────────────────────────────────────────────────────────────

const BUDGET_WORK_CATS = [
  { name: 'Marketing',           default: 500,  color: '#2a78d6' },
  { name: 'Technology',          default: 150,  color: '#4a3aa7' },
  { name: 'Office Supplies',     default: 75,   color: '#eda100' },
  { name: 'Mileage / Gas',       default: 200,  color: '#eb6834' },
  { name: 'Client Entertainment',default: 300,  color: '#e34948' },
  { name: 'Photography / Media', default: 200,  color: '#e87ba4' },
  { name: 'Professional Dev',    default: 100,  color: '#1baf7a' },
  { name: 'Signs / Lockboxes',   default: 100,  color: '#008300' },
  { name: 'MLS / Dues',          default: 150,  color: '#898781' },
  { name: 'Other',               default: 100,  color: '#b4b2a9' },
];

const BUDGET_PERSONAL_CATS = [
  { name: 'Rent',           default: 2600, color: '#2a78d6' },
  { name: 'Groceries',      default: 400,  color: '#1baf7a' },
  { name: 'Dining',         default: 400,  color: '#e34948' },
  { name: 'Transportation', default: 150,  color: '#4a3aa7' },
  { name: 'Phone',          default: 100,  color: '#eda100' },
  { name: 'Fitness',        default: 70,   color: '#eb6834' },
  { name: 'Subscriptions',  default: 150,  color: '#e87ba4' },
  { name: 'Personal Care',  default: 100,  color: '#008300' },
  { name: 'Entertainment',  default: 150,  color: '#4a3aa7' },
  { name: 'Other',          default: 100,  color: '#b4b2a9' },
];

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let budgetState = {
  bucket: 'work',      // 'work' | 'personal'
  view: 'overview',    // 'overview' | 'transactions' | 'chart'
  curM: new Date().getMonth(),
  curY: new Date().getFullYear(),
  expenses: [],
  settings: {},
  chart: null,
  editingBudget: false,
  expandedCat: null,   // currently open accordion category
};

function budgetMonth() {
  const mm = String(budgetState.curM + 1).padStart(2,'0');
  return `${budgetState.curY}-${mm}`;
}

function budgetCats() {
  const key = `${budgetState.bucket}_categories`;
  if (budgetState.settings[key]) {
    try { return JSON.parse(budgetState.settings[key]); } catch(e) {}
  }
  return budgetState.bucket === 'work' ? BUDGET_WORK_CATS : BUDGET_PERSONAL_CATS;
}

function budgetTarget(catName) {
  const key = `${budgetState.bucket}_${catName}`;
  if (budgetState.settings[key] !== undefined) return parseFloat(budgetState.settings[key]);
  const cat = budgetCats().find(c => c.name === catName);
  return cat ? cat.default : 0;
}

function budgetFmt(n) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function budgetFmtFull(n) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function initBudget() {
  await loadBudgetData();
  renderBudget();
  autoArchiveCheck();
}

// ── Auto-archive: export previous month's budget if not yet done ──
async function autoArchiveCheck() {
  try {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`;
    const archived = JSON.parse(budgetState.settings.archived_months || '[]');
    const newArchived = [...archived];
    let didExport = false;

    for (const bucket of ['work', 'personal']) {
      const key = `${prevMonth}-${bucket}`;
      if (archived.includes(key)) continue;
      // Check if there's data
      const r = await fetch(`/api/budget-data?month=${prevMonth}&bucket=${bucket}`);
      const d = await r.json();
      if (d.expenses && d.expenses.length > 0) {
        await exportBudgetMonth(prevMonth, bucket);
        didExport = true;
      }
      newArchived.push(key);
    }

    if (newArchived.length !== archived.length) {
      budgetState.settings.archived_months = JSON.stringify(newArchived);
      fetch('/api/budget-settings', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ archived_months: JSON.stringify(newArchived) })
      }).catch(() => {});
    }
    if (didExport) {
      const label = prev.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      setTimeout(() => alert(`📁 ${label} is over — your budget was automatically exported and downloaded as CSV.`), 800);
    }
  } catch(e) { console.warn('Auto-archive check failed', e); }
}

async function exportBudgetMonth(month, bucket) {
  const url = `/api/budget-export?month=${encodeURIComponent(month)}&bucket=${encodeURIComponent(bucket)}`;
  const r = await fetch(url);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `budget-${bucket}-${month}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

async function loadBudgetData() {
  try {
    const [expRes, setRes] = await Promise.all([
      fetch(`/api/budget-data?month=${budgetMonth()}&bucket=${budgetState.bucket}`),
      fetch('/api/budget-settings')
    ]);
    const expData = await expRes.json();
    const setData = await setRes.json();
    budgetState.expenses = expData.expenses || [];
    budgetState.settings = setData.settings || {};
  } catch (e) {
    console.error('Budget load error', e);
  }
}

function renderBudget() {
  const el = document.getElementById('budget-pane-inner');
  if (!el) return;

  const cats = budgetCats();
  const totalBudget = cats.reduce((s, c) => s + budgetTarget(c.name), 0);

  // Group expenses by category
  const bycat = {};
  budgetState.expenses.forEach(e => {
    const cat = e.category || 'Other';
    bycat[cat] = (bycat[cat] || 0) + parseFloat(e.amt || 0);
  });
  const totalSpent = Object.values(bycat).reduce((a, b) => a + b, 0);
  const totalLeft = totalBudget - totalSpent;
  const pctUsed = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  el.innerHTML = `
    <!-- Top bar -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:8px">
        <button onclick="budgetChMonth(-1)" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer;font-size:15px;color:var(--text)">&#8249;</button>
        <span style="font-size:17px;font-weight:500;color:var(--text)">${MONTHS_FULL[budgetState.curM]} ${budgetState.curY}</span>
        <button onclick="budgetChMonth(1)" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer;font-size:15px;color:var(--text)">&#8250;</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="setBudgetBucket('work',this)" class="budget-bucket-btn ${budgetState.bucket==='work'?'on':''}" style="padding:4px 14px;border-radius:20px;border:1px solid ${budgetState.bucket==='work'?'#2a78d6':'var(--border)'};background:${budgetState.bucket==='work'?'#2a78d620':'none'};color:${budgetState.bucket==='work'?'#60A5FA':'var(--text2)'};font-size:13px;cursor:pointer;font-weight:${budgetState.bucket==='work'?'500':'400'}">Business</button>
        <button onclick="setBudgetBucket('personal',this)" class="budget-bucket-btn ${budgetState.bucket==='personal'?'on':''}" style="padding:4px 14px;border-radius:20px;border:1px solid ${budgetState.bucket==='personal'?'#2a78d6':'var(--border)'};background:${budgetState.bucket==='personal'?'#2a78d620':'none'};color:${budgetState.bucket==='personal'?'#60A5FA':'var(--text2)'};font-size:13px;cursor:pointer;font-weight:${budgetState.bucket==='personal'?'500':'400'}">Personal</button>
        <button onclick="triggerCsvImport()" title="Import transactions from bank CSV" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer;font-size:12px;color:var(--text2)">📥 Import CSV</button>
        <button onclick="exportBudgetMonth('${budgetMonth()}','${budgetState.bucket}')" title="Export this month as CSV" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer;font-size:12px;color:var(--text2)">📤 Export</button>
        <input type="file" id="budget-csv-input" accept=".csv" style="display:none" onchange="handleBudgetCsv(event)">
      </div>
    </div>

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
      ${[
        { label: 'Budgeted', val: budgetFmt(totalBudget), color: 'var(--text)' },
        { label: 'Spent', val: budgetFmt(totalSpent), color: totalSpent > totalBudget ? '#e34948' : 'var(--text)' },
        { label: 'Remaining', val: (totalLeft < 0 ? '-' : '') + budgetFmt(totalLeft), color: totalLeft < 0 ? '#e34948' : totalLeft < totalBudget * 0.15 ? '#eda100' : '#4ADE80' },
        { label: '% Used', val: pctUsed + '%', color: pctUsed >= 100 ? '#e34948' : pctUsed >= 85 ? '#eda100' : 'var(--text)' },
      ].map(k => `
        <div style="background:#2C2C30;border:1px solid #383840;border-radius:8px;padding:12px 14px">
          <div style="font-size:11px;color:#9090A0;margin-bottom:4px">${k.label}</div>
          <div style="font-size:20px;font-weight:500;color:${k.color}">${k.val}</div>
        </div>
      `).join('')}
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:4px;margin-bottom:14px">
      ${['overview','transactions','chart'].map(t => `
        <button onclick="setBudgetView('${t}',this)" style="padding:5px 14px;border-radius:6px;border:1px solid ${budgetState.view===t?'var(--border)':'var(--border)'};background:${budgetState.view===t?'var(--surface2)':'none'};font-size:13px;font-weight:${budgetState.view===t?'500':'400'};color:${budgetState.view===t?'var(--text)':'var(--text2)'};cursor:pointer">${t.charAt(0).toUpperCase()+t.slice(1)}</button>
      `).join('')}
      <button onclick="toggleBudgetEdit()" style="margin-left:auto;padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:none;font-size:12px;color:var(--text2);cursor:pointer">✏️ Edit Budgets</button>
      <button onclick="openManageCategories()" style="padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:none;font-size:12px;color:var(--text2);cursor:pointer">🏷️ Categories</button>
    </div>

    <!-- Views -->
    <div id="budget-view-overview" style="display:${budgetState.view==='overview'?'block':'none'}">
      ${renderBudgetOverview(cats, bycat)}
    </div>
    <div id="budget-view-transactions" style="display:${budgetState.view==='transactions'?'block':'none'}">
      ${renderBudgetTransactions(cats)}
    </div>
    <div id="budget-view-chart" style="display:${budgetState.view==='chart'?'block':'none'}">
      <div style="position:relative;height:280px;margin-top:8px">
        <canvas id="budgetChartCanvas"></canvas>
      </div>
    </div>
  `;

  if (budgetState.view === 'chart') {
    setTimeout(() => renderBudgetChart(cats, bycat), 50);
  }
}

function renderBudgetOverview(cats, bycat) {
  // Group expenses by category for quick lookup
  const expByCat = {};
  budgetState.expenses.forEach(e => {
    const cat = e.category || 'Other';
    if (!expByCat[cat]) expByCat[cat] = [];
    expByCat[cat].push(e);
  });

  return `
    <div style="display:grid;grid-template-columns:1fr 80px 80px 80px 64px;gap:6px;padding:6px 12px 8px;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);margin-bottom:6px">
      <div>Category</div><div style="text-align:right">Budget</div><div style="text-align:right">Spent</div><div style="text-align:right">Left</div><div></div>
    </div>
    ${cats.map(c => {
      const budget = budgetTarget(c.name);
      const spent = bycat[c.name] || 0;
      const left = budget - spent;
      const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
      const barColor = pct >= 100 ? '#e34948' : pct >= 80 ? '#eda100' : c.color;
      const leftColor = left < 0 ? '#e34948' : left < budget * 0.2 ? '#eda100' : '#4ADE80';
      const isOpen = budgetState.expandedCat === c.name;
      const catTxns = (expByCat[c.name] || []).sort((a,b) => (b.date||'').localeCompare(a.date||''));
      const hasSpend = catTxns.length > 0;

      return `
        <div style="margin-bottom:5px">
          <div onclick="toggleBudgetCat('${c.name.replace(/'/g,"\\'")}')"
               style="display:grid;grid-template-columns:1fr 80px 80px 80px 64px;align-items:center;gap:6px;background:var(--surface2);border:1px solid ${isOpen ? '#60A5FA' : 'var(--border)'};border-radius:${isOpen ? '8px 8px 0 0' : '8px'};padding:9px 12px;cursor:${hasSpend ? 'pointer' : 'default'};user-select:none">
            <div style="display:flex;align-items:center;gap:8px;font-size:14px">
              <span style="width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0;display:inline-block"></span>
              ${c.name}
              ${hasSpend ? `<span style="font-size:10px;color:var(--text2)">${isOpen ? '▲' : '▼'}</span>` : ''}
            </div>
            <div style="font-size:13px;text-align:right;color:var(--text)">${budgetFmt(budget)}</div>
            <div style="font-size:13px;text-align:right;font-weight:500;color:var(--text)">${spent > 0 ? budgetFmt(spent) : '—'}</div>
            <div style="font-size:13px;text-align:right;color:${leftColor}">${(left < 0 ? '-' : '') + budgetFmt(Math.abs(left))}</div>
            <div>
              <div style="width:52px;height:4px;background:var(--border);border-radius:2px;margin-left:auto">
                <div style="width:${pct}%;height:100%;border-radius:2px;background:${barColor}"></div>
              </div>
              <div style="font-size:10px;color:var(--text2);text-align:right;margin-top:2px">${pct}%</div>
            </div>
          </div>
          ${isOpen && catTxns.length ? `
            <div style="background:var(--surface);border:1px solid #60A5FA;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
              <div style="display:grid;grid-template-columns:90px 1fr auto;gap:8px;padding:6px 14px;font-size:10px;color:var(--text2);border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:.05em">
                <div>Date</div><div>Description</div><div>Amount</div>
              </div>
              ${catTxns.map(t => `
                <div style="display:grid;grid-template-columns:90px 1fr auto;gap:8px;padding:7px 14px;font-size:13px;border-bottom:1px solid var(--border);align-items:center">
                  <div style="color:var(--text2);white-space:nowrap">${t.date || '—'}</div>
                  <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)" title="${(t.desc||t.vendor||'').replace(/"/g,'')}">${t.desc || t.vendor || '—'}</div>
                  <div style="font-weight:500;color:#F87171;white-space:nowrap">-${budgetFmtFull(t.amt)}</div>
                </div>
              `).join('')}
              <div style="padding:6px 14px;font-size:12px;color:var(--text2);text-align:right">
                ${catTxns.length} transaction${catTxns.length !== 1 ? 's' : ''} · Total: <strong style="color:var(--text)">-${budgetFmtFull(spent)}</strong>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('')}
  `;
}

function renderBudgetTransactions(cats) {
  const catNames = cats.map(c => c.name);
  const sorted = [...budgetState.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const addForm = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Add Transaction</div>
      <div style="display:grid;grid-template-columns:1fr 100px 160px 90px;gap:8px;align-items:end">
        <div>
          <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Description</label>
          <input id="bt-desc" type="text" placeholder="e.g. Staples" style="width:100%;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Amount</label>
          <input id="bt-amt" type="number" placeholder="0.00" min="0" step="0.01" style="width:100%;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
        </div>
        <div>
          <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">Category</label>
          <select id="bt-cat" style="width:100%;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
            ${catNames.map(n => `<option>${n}</option>`).join('')}
          </select>
        </div>
        <div>
          <button onclick="addBudgetTransaction()" style="width:100%;background:#2a78d6;color:#fff;border:none;border-radius:6px;height:34px;font-size:13px;cursor:pointer">Add</button>
        </div>
      </div>
    </div>
  `;

  if (!sorted.length) return addForm + '<div style="text-align:center;padding:2rem;color:var(--text2);font-size:14px">No transactions this month</div>';

  return addForm + sorted.map(e => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;margin-bottom:4px">
      <div>
        <div style="font-size:14px;color:var(--text)">${e.desc || e.vendor || '—'}</div>
        <div style="font-size:11px;color:var(--text2)">${e.category || 'Other'} · ${e.date || ''} ${e.source === 'plaid' ? '· 🏦' : e.source === 'mms_scan' ? '· 📱' : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:14px;font-weight:500;color:#F87171">-${budgetFmtFull(e.amt)}</div>
        <button onclick="deleteBudgetTransaction('${e.id}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:15px;padding:0 2px" title="Delete">✕</button>
      </div>
    </div>
  `).join('');
}

function renderBudgetChart(cats, bycat) {
  const canvas = document.getElementById('budgetChartCanvas');
  if (!canvas) return;
  if (budgetState.chart) { budgetState.chart.destroy(); budgetState.chart = null; }
  if (typeof Chart === 'undefined') return;

  budgetState.chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: cats.map(c => c.name),
      datasets: [
        {
          label: 'Budget',
          data: cats.map(c => budgetTarget(c.name)),
          backgroundColor: '#2a78d620',
          borderColor: '#2a78d6',
          borderWidth: 1.5,
          borderRadius: 3,
        },
        {
          label: 'Spent',
          data: cats.map(c => bycat[c.name] || 0),
          backgroundColor: cats.map(c => {
            const spent = bycat[c.name] || 0;
            const budget = budgetTarget(c.name);
            const pct = budget > 0 ? (spent / budget) * 100 : 0;
            return pct >= 100 ? '#e3494890' : pct >= 80 ? '#eda10090' : c.color + '90';
          }),
          borderRadius: 3,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + budgetFmtFull(ctx.raw) } }
      },
      scales: {
        x: { ticks: { font: { size: 10 }, color: '#9090A0', maxRotation: 35 }, grid: { display: false } },
        y: { ticks: { callback: v => '$' + v, font: { size: 11 }, color: '#9090A0' }, grid: { color: '#383840' } }
      }
    }
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

function toggleBudgetCat(name) {
  budgetState.expandedCat = budgetState.expandedCat === name ? null : name;
  // Re-render just the overview without a full data reload
  const el = document.getElementById('budget-view-overview');
  if (el) {
    const cats = budgetCats();
    const bycat = {};
    budgetState.expenses.forEach(e => { const c = e.category||'Other'; bycat[c]=(bycat[c]||0)+parseFloat(e.amt||0); });
    el.innerHTML = renderBudgetOverview(cats, bycat);
  }
}

function budgetChMonth(d) {
  budgetState.curM += d;
  if (budgetState.curM > 11) { budgetState.curM = 0; budgetState.curY++; }
  if (budgetState.curM < 0) { budgetState.curM = 11; budgetState.curY--; }
  loadBudgetData().then(renderBudget);
}

function setBudgetBucket(b) {
  budgetState.bucket = b;
  loadBudgetData().then(renderBudget);
}

function setBudgetView(v) {
  budgetState.view = v;
  renderBudget();
}

async function addBudgetTransaction() {
  const desc = document.getElementById('bt-desc')?.value.trim();
  const amt = parseFloat(document.getElementById('bt-amt')?.value);
  const cat = document.getElementById('bt-cat')?.value;
  if (!desc || isNaN(amt) || amt <= 0) return;

  try {
    const r = await fetch('/api/budget-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desc, amount: amt, category: cat, bucket: budgetState.bucket, date: new Date().toISOString().slice(0,10) })
    });
    const data = await r.json();
    if (data.ok) {
      await loadBudgetData();
      renderBudget();
    }
  } catch (e) { console.error(e); }
}

async function deleteBudgetTransaction(id) {
  try {
    await fetch(`/api/budget-transaction/${id}`, { method: 'DELETE' });
    await loadBudgetData();
    renderBudget();
  } catch (e) { console.error(e); }
}

const CAT_COLORS = ['#2a78d6','#e34948','#1baf7a','#eda100','#4a3aa7','#eb6834','#e87ba4','#008300','#898781','#b4b2a9','#00a8cc','#7b4f8e'];

function openManageCategories() {
  const cats = budgetCats();
  const modal = document.createElement('div');
  modal.id = 'budget-cat-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:#00000040;z-index:9999;display:flex;align-items:center;justify-content:center';

  const renderRows = (list) => list.map((c, i) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px" data-idx="${i}">
      <select class="cat-color-pick" data-idx="${i}" style="width:32px;height:32px;border:1px solid var(--border);border-radius:6px;padding:0 2px;cursor:pointer;font-size:16px;background:var(--surface)">
        ${CAT_COLORS.map(col => `<option value="${col}" ${c.color===col?'selected':''} style="background:${col}">■</option>`).join('')}
      </select>
      <span style="width:12px;height:12px;border-radius:50%;background:${c.color};display:inline-block;flex-shrink:0"></span>
      <input class="cat-name-input" data-idx="${i}" value="${c.name}" style="flex:1;font-size:14px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
      <input class="cat-budget-input" data-idx="${i}" type="number" value="${budgetTarget(c.name)}" min="0" step="10" style="width:80px;font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;text-align:right;background:var(--surface);color:var(--text)">
      <button onclick="removeCatRow(${i})" style="background:none;border:none;color:var(--text3);font-size:16px;cursor:pointer;padding:0 4px" title="Remove">✕</button>
    </div>
  `).join('');

  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:12px;padding:24px;width:460px;max-height:82vh;overflow-y:auto;box-shadow:var(--shadow-lg);border:1px solid var(--border)">
      <div style="font-size:16px;font-weight:500;margin-bottom:4px;color:var(--text)">Manage ${budgetState.bucket === 'work' ? 'Business' : 'Personal'} Categories</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:16px">Rename, reorder, add, or remove categories. Budget amounts are per month.</div>
      <div id="cat-rows-list">${renderRows(cats)}</div>
      <button onclick="addCatRow()" style="width:100%;padding:8px;border:1px dashed var(--border);border-radius:6px;background:none;font-size:13px;color:var(--text2);cursor:pointer;margin-top:4px">+ Add category</button>
      <div style="display:flex;gap:8px;margin-top:18px">
        <button onclick="saveCategories()" style="flex:1;background:#2a78d6;color:#fff;border:none;border-radius:6px;padding:9px;font-size:14px;cursor:pointer">Save</button>
        <button onclick="document.getElementById('budget-cat-modal').remove()" style="flex:1;background:none;border:1px solid var(--border);border-radius:6px;padding:9px;font-size:14px;cursor:pointer;color:var(--text)">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Update color swatch when color picker changes
  modal.querySelectorAll('.cat-color-pick').forEach(sel => {
    sel.addEventListener('change', () => {
      const swatch = sel.nextElementSibling;
      if (swatch) swatch.style.background = sel.value;
    });
  });
}

function addCatRow() {
  const list = document.getElementById('cat-rows-list');
  const idx = list.children.length;
  const color = CAT_COLORS[idx % CAT_COLORS.length];
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
  div.setAttribute('data-idx', idx);
  div.innerHTML = `
    <select class="cat-color-pick" data-idx="${idx}" style="width:32px;height:32px;border:1px solid var(--border);border-radius:6px;padding:0 2px;cursor:pointer;font-size:16px;background:var(--surface)">
      ${CAT_COLORS.map(col => `<option value="${col}" ${col===color?'selected':''} style="background:${col}">■</option>`).join('')}
    </select>
    <span style="width:12px;height:12px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
    <input class="cat-name-input" data-idx="${idx}" value="New Category" style="flex:1;font-size:14px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
    <input class="cat-budget-input" data-idx="${idx}" type="number" value="0" min="0" step="10" style="width:80px;font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;text-align:right;background:var(--surface);color:var(--text)">
    <button onclick="removeCatRow(this)" style="background:none;border:none;color:var(--text3);font-size:16px;cursor:pointer;padding:0 4px" title="Remove">✕</button>
  `;
  div.querySelector('.cat-color-pick').addEventListener('change', function() {
    this.nextElementSibling.style.background = this.value;
  });
  list.appendChild(div);
}

function removeCatRow(idxOrBtn) {
  const list = document.getElementById('cat-rows-list');
  if (typeof idxOrBtn === 'number') {
    list.children[idxOrBtn]?.remove();
  } else {
    idxOrBtn.closest('[data-idx]')?.remove();
  }
}

async function saveCategories() {
  const rows = document.querySelectorAll('#cat-rows-list [data-idx]');
  const newCats = [];
  rows.forEach(row => {
    const name = row.querySelector('.cat-name-input')?.value.trim();
    const color = row.querySelector('.cat-color-pick')?.value || '#898781';
    const budget = parseFloat(row.querySelector('.cat-budget-input')?.value) || 0;
    if (name) newCats.push({ name, color, default: budget });
  });
  if (!newCats.length) return;

  const catKey = `${budgetState.bucket}_categories`;
  const budgetUpdates = {};
  newCats.forEach(c => { budgetUpdates[`${budgetState.bucket}_${c.name}`] = c.default; });
  budgetUpdates[catKey] = JSON.stringify(newCats);

  try {
    await fetch('/api/budget-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(budgetUpdates)
    });
    budgetState.settings = { ...budgetState.settings, ...budgetUpdates };
    document.getElementById('budget-cat-modal')?.remove();
    renderBudget();
  } catch(e) { alert('Save failed: ' + e.message); }
}

function toggleBudgetEdit() {
  const cats = budgetCats();
  const modal = document.createElement('div');
  modal.id = 'budget-edit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:#00000040;z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:12px;padding:24px;width:380px;max-height:80vh;overflow-y:auto;box-shadow:var(--shadow-lg);border:1px solid var(--border)">
      <div style="font-size:16px;font-weight:500;margin-bottom:16px;color:var(--text)">Edit Monthly Budgets</div>
      ${cats.map(c => `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--text)">
            <span style="width:8px;height:8px;border-radius:50%;background:${c.color};display:inline-block"></span>${c.name}
          </div>
          <input type="number" data-cat="${c.name}" value="${budgetTarget(c.name)}" min="0" step="10"
            style="width:90px;font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;text-align:right;background:var(--surface2);color:var(--text)">
        </div>
      `).join('')}
      <div style="display:flex;gap:8px;margin-top:18px">
        <button onclick="saveBudgetSettings()" style="flex:1;background:#2a78d6;color:#fff;border:none;border-radius:6px;padding:8px;font-size:14px;cursor:pointer">Save</button>
        <button onclick="document.getElementById('budget-edit-modal').remove()" style="flex:1;background:none;border:1px solid var(--border);border-radius:6px;padding:8px;font-size:14px;cursor:pointer;color:var(--text)">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveBudgetSettings() {
  const inputs = document.querySelectorAll('#budget-edit-modal input[data-cat]');
  const updates = {};
  inputs.forEach(inp => {
    const key = `${budgetState.bucket}_${inp.dataset.cat}`;
    updates[key] = parseFloat(inp.value) || 0;
  });
  try {
    await fetch('/api/budget-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    budgetState.settings = { ...budgetState.settings, ...updates };
    document.getElementById('budget-edit-modal')?.remove();
    renderBudget();
  } catch (e) { console.error(e); }
}

async function openPlaidConnect() {
  try {
    const r = await fetch('/api/plaid/link-token', { method: 'POST' });
    const data = await r.json();
    if (!data.ok) {
      alert('Bank connection not set up yet.\n\nTo connect your bank:\n1. Go to plaid.com and create a free developer account\n2. Get your Client ID and Secret\n3. Add PLAID_CLIENT_ID and PLAID_SECRET to your Render environment variables\n4. Set PLAID_ENV=development\n\nOnce configured, click this button again!');
      return;
    }
    // Load Plaid Link SDK if not already loaded
    if (!window.Plaid) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const handler = window.Plaid.create({
      token: data.link_token,
      onSuccess: async (public_token, metadata) => {
        const exR = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token, institution_name: metadata?.institution?.name })
        });
        const exData = await exR.json();
        if (!exData.ok) {
          alert('❌ Failed to save bank connection: ' + (exData.error || 'Unknown error'));
          return;
        }
        // Immediately sync transactions
        const syncR = await fetch('/api/plaid/sync-transactions', { method: 'POST' });
        const syncData = await syncR.json();
        if (syncData.ok) {
          alert(`✅ Bank connected! Imported ${syncData.imported || 0} transactions.`);
          await loadBudgetData();
          renderBudget();
        } else {
          alert('✅ Bank connected, but sync failed: ' + (syncData.error || 'Unknown error') + '\nTry the Sync button.');
        }
      },
      onExit: () => {}
    });
    handler.open();
  } catch (e) {
    console.error('Plaid error', e);
  }
}

async function syncPlaidNow() {
  const btn = document.querySelector('button[onclick="syncPlaidNow()"]');
  if (btn) { btn.textContent = '↻ Syncing...'; btn.disabled = true; }
  try {
    const r = await fetch('/api/plaid/sync-transactions', { method: 'POST' });
    const data = await r.json();
    if (btn) { btn.textContent = '↻ Sync'; btn.disabled = false; }
    if (data.ok) {
      await loadBudgetData();
      renderBudget();
      alert(data.imported > 0 ? `✅ Imported ${data.imported} new transactions.` : 'Already up to date — no new transactions found.');
    } else {
      alert('Sync error: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    if (btn) { btn.textContent = '↻ Sync'; btn.disabled = false; }
    alert('Sync failed: ' + e.message);
  }
}

async function syncPlaidTransactions() {
  await syncPlaidNow();
}

// ── CSV Import ────────────────────────────────────────────────────────────────

function triggerCsvImport() {
  document.getElementById('budget-csv-input')?.click();
}

async function handleBudgetCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = ''; // reset so same file can be re-imported if needed

  const text = await file.text();
  const rows = parseBankCsv(text);
  if (!rows.length) { alert('No transactions found in CSV. Make sure you exported from PNC as CSV.'); return; }

  const confirmed = confirm(`Found ${rows.length} transactions in the CSV.\n\nImport to ${budgetState.bucket === 'work' ? 'Business' : 'Personal'} budget?\n\nDuplicates already logged via Ace will be skipped automatically.`);
  if (!confirmed) return;

  try {
    const r = await fetch('/api/budget-import-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, bucket: budgetState.bucket })
    });
    const data = await r.json();
    if (data.ok) {
      await loadBudgetData();
      renderBudget();
      alert(`✅ Done!\n• ${data.imported} new transactions imported\n• ${data.skipped} duplicates skipped (already in CRM)`);
    } else {
      alert('Import failed: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Import failed: ' + e.message);
  }
}

function parseBankCsv(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const cols = splitCsvLine(lines[0]).map(c => c.replace(/"/g, '').trim().toLowerCase());
  const dateIdx = cols.findIndex(c => c.includes('date'));
  const descIdx = cols.findIndex(c => c.includes('description') || c.includes('memo') || c.includes('payee') || c.includes('name'));
  const amtIdx  = cols.findIndex(c => c === 'amount' || c === 'transaction amount');
  const catIdx  = cols.findIndex(c => c === 'category');

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i]);
    if (!parts.length) continue;

    const rawDate = (parts[dateIdx >= 0 ? dateIdx : 0] || '').replace(/"/g, '').trim();
    const rawDesc = (parts[descIdx >= 0 ? descIdx : 1] || '').replace(/"/g, '').trim();
    const rawAmt  = (parts[amtIdx  >= 0 ? amtIdx  : 2] || '').replace(/"/g, '').trim();
    const rawCat  = catIdx >= 0 ? (parts[catIdx] || '').replace(/"/g, '').trim() : '';

    // Skip pending rows
    if (rawDate.toUpperCase().includes('PENDING')) continue;

    // PNC amount format: "- $2591.42" or "+ $10517.1"
    const isCredit = rawAmt.startsWith('+');
    const numericAmt = parseFloat(rawAmt.replace(/[^0-9.]/g, ''));
    if (isNaN(numericAmt) || numericAmt <= 0) continue;
    if (isCredit) continue; // skip deposits/income

    // Skip pure transfers (internal moves, not real spending)
    const descLower = rawDesc.toLowerCase();
    const catLower = rawCat.toLowerCase();
    if (catLower === 'transfers' || descLower.includes('online transfer') || descLower.includes('jpmorgan chase ext') || descLower.includes('zelle') && descLower.includes('transfer')) continue;

    // Normalize date to YYYY-MM-DD
    let date = rawDate;
    try {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    } catch(e) {}

    rows.push({ date, description: rawDesc, amount: numericAmt, pncCategory: rawCat });
  }

  return rows;
}

function splitCsvLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}
