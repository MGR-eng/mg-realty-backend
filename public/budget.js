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
};

function budgetMonth() {
  const mm = String(budgetState.curM + 1).padStart(2,'0');
  return `${budgetState.curY}-${mm}`;
}

function budgetCats() {
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
        <button onclick="budgetChMonth(-1)" style="background:none;border:1px solid #ddd;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:15px">&#8249;</button>
        <span style="font-size:17px;font-weight:500">${MONTHS_FULL[budgetState.curM]} ${budgetState.curY}</span>
        <button onclick="budgetChMonth(1)" style="background:none;border:1px solid #ddd;border-radius:6px;padding:3px 9px;cursor:pointer;font-size:15px">&#8250;</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="setBudgetBucket('work',this)" class="budget-bucket-btn ${budgetState.bucket==='work'?'on':''}" style="padding:4px 14px;border-radius:20px;border:1px solid ${budgetState.bucket==='work'?'#2a78d6':'#ddd'};background:${budgetState.bucket==='work'?'#2a78d610':'none'};color:${budgetState.bucket==='work'?'#2a78d6':'#52514e'};font-size:13px;cursor:pointer;font-weight:${budgetState.bucket==='work'?'500':'400'}">Business</button>
        <button onclick="setBudgetBucket('personal',this)" class="budget-bucket-btn ${budgetState.bucket==='personal'?'on':''}" style="padding:4px 14px;border-radius:20px;border:1px solid ${budgetState.bucket==='personal'?'#2a78d6':'#ddd'};background:${budgetState.bucket==='personal'?'#2a78d610':'none'};color:${budgetState.bucket==='personal'?'#2a78d6':'#52514e'};font-size:13px;cursor:pointer;font-weight:${budgetState.bucket==='personal'?'500':'400'}">Personal</button>
        <button onclick="triggerCsvImport()" title="Import transactions from bank CSV" style="padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:none;cursor:pointer;font-size:12px;color:#52514e">📥 Import CSV</button>
        <input type="file" id="budget-csv-input" accept=".csv" style="display:none" onchange="handleBudgetCsv(event)">
      </div>
    </div>

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
      ${[
        { label: 'Budgeted', val: budgetFmt(totalBudget), color: '#0b0b0b' },
        { label: 'Spent', val: budgetFmt(totalSpent), color: totalSpent > totalBudget ? '#e34948' : '#0b0b0b' },
        { label: 'Remaining', val: (totalLeft < 0 ? '-' : '') + budgetFmt(totalLeft), color: totalLeft < 0 ? '#e34948' : totalLeft < totalBudget * 0.15 ? '#eda100' : '#1baf7a' },
        { label: '% Used', val: pctUsed + '%', color: pctUsed >= 100 ? '#e34948' : pctUsed >= 85 ? '#eda100' : '#0b0b0b' },
      ].map(k => `
        <div style="background:#fff;border:1px solid #e5e5e3;border-radius:8px;padding:12px 14px">
          <div style="font-size:11px;color:#898781;margin-bottom:4px">${k.label}</div>
          <div style="font-size:20px;font-weight:500;color:${k.color}">${k.val}</div>
        </div>
      `).join('')}
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:4px;margin-bottom:14px">
      ${['overview','transactions','chart'].map(t => `
        <button onclick="setBudgetView('${t}',this)" style="padding:5px 14px;border-radius:6px;border:1px solid ${budgetState.view===t?'#aaa':'#ddd'};background:${budgetState.view===t?'#fff':'none'};font-size:13px;font-weight:${budgetState.view===t?'500':'400'};color:${budgetState.view===t?'#0b0b0b':'#52514e'};cursor:pointer">${t.charAt(0).toUpperCase()+t.slice(1)}</button>
      `).join('')}
      <button onclick="toggleBudgetEdit()" style="margin-left:auto;padding:5px 12px;border-radius:6px;border:1px solid #ddd;background:none;font-size:12px;color:#52514e;cursor:pointer">✏️ Edit Budgets</button>
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
  return `
    <div style="display:grid;grid-template-columns:1fr 80px 80px 80px 64px;gap:6px;padding:0 12px 6px;font-size:11px;color:#898781">
      <div>Category</div><div style="text-align:right">Budget</div><div style="text-align:right">Spent</div><div style="text-align:right">Left</div><div></div>
    </div>
    ${cats.map(c => {
      const budget = budgetTarget(c.name);
      const spent = bycat[c.name] || 0;
      const left = budget - spent;
      const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
      const barColor = pct >= 100 ? '#e34948' : pct >= 80 ? '#eda100' : c.color;
      const leftColor = left < 0 ? '#e34948' : left < budget * 0.2 ? '#eda100' : '#1baf7a';
      return `
        <div style="display:grid;grid-template-columns:1fr 80px 80px 80px 64px;align-items:center;gap:6px;background:#fff;border:1px solid #e5e5e3;border-radius:8px;padding:9px 12px;margin-bottom:5px">
          <div style="display:flex;align-items:center;gap:8px;font-size:14px">
            <span style="width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0;display:inline-block"></span>${c.name}
          </div>
          <div style="font-size:13px;text-align:right;color:#898781">${budgetFmt(budget)}</div>
          <div style="font-size:13px;text-align:right;font-weight:500">${spent > 0 ? budgetFmt(spent) : '—'}</div>
          <div style="font-size:13px;text-align:right;color:${leftColor}">${(left < 0 ? '-' : '') + budgetFmt(Math.abs(left))}</div>
          <div>
            <div style="width:52px;height:4px;background:#e5e5e3;border-radius:2px;margin-left:auto">
              <div style="width:${pct}%;height:100%;border-radius:2px;background:${barColor}"></div>
            </div>
            <div style="font-size:10px;color:#898781;text-align:right;margin-top:2px">${pct}%</div>
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function renderBudgetTransactions(cats) {
  const catNames = cats.map(c => c.name);
  const sorted = [...budgetState.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const addForm = `
    <div style="background:#fff;border:1px solid #e5e5e3;border-radius:10px;padding:16px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:500;color:#898781;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Add Transaction</div>
      <div style="display:grid;grid-template-columns:1fr 100px 160px 90px;gap:8px;align-items:end">
        <div>
          <label style="font-size:11px;color:#898781;display:block;margin-bottom:3px">Description</label>
          <input id="bt-desc" type="text" placeholder="e.g. Staples" style="width:100%;font-size:13px;padding:6px 8px;border:1px solid #ddd;border-radius:6px">
        </div>
        <div>
          <label style="font-size:11px;color:#898781;display:block;margin-bottom:3px">Amount</label>
          <input id="bt-amt" type="number" placeholder="0.00" min="0" step="0.01" style="width:100%;font-size:13px;padding:6px 8px;border:1px solid #ddd;border-radius:6px">
        </div>
        <div>
          <label style="font-size:11px;color:#898781;display:block;margin-bottom:3px">Category</label>
          <select id="bt-cat" style="width:100%;font-size:13px;padding:6px 8px;border:1px solid #ddd;border-radius:6px">
            ${catNames.map(n => `<option>${n}</option>`).join('')}
          </select>
        </div>
        <div>
          <button onclick="addBudgetTransaction()" style="width:100%;background:#2a78d6;color:#fff;border:none;border-radius:6px;height:34px;font-size:13px;cursor:pointer">Add</button>
        </div>
      </div>
    </div>
  `;

  if (!sorted.length) return addForm + '<div style="text-align:center;padding:2rem;color:#898781;font-size:14px">No transactions this month</div>';

  return addForm + sorted.map(e => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#fff;border:1px solid #e5e5e3;border-radius:8px;margin-bottom:4px">
      <div>
        <div style="font-size:14px">${e.desc || e.vendor || '—'}</div>
        <div style="font-size:11px;color:#898781">${e.category || 'Other'} · ${e.date || ''} ${e.source === 'plaid' ? '· 🏦' : e.source === 'mms_scan' ? '· 📱' : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:14px;font-weight:500;color:#e34948">-${budgetFmtFull(e.amt)}</div>
        <button onclick="deleteBudgetTransaction('${e.id}')" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:15px;padding:0 2px" title="Delete">✕</button>
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
        x: { ticks: { font: { size: 10 }, color: '#898781', maxRotation: 35 }, grid: { display: false } },
        y: { ticks: { callback: v => '$' + v, font: { size: 11 }, color: '#898781' }, grid: { color: '#e1e0d9' } }
      }
    }
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────

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

function toggleBudgetEdit() {
  const cats = budgetCats();
  const modal = document.createElement('div');
  modal.id = 'budget-edit-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:#00000040;z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:380px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px #0002">
      <div style="font-size:16px;font-weight:500;margin-bottom:16px">Edit Monthly Budgets</div>
      ${cats.map(c => `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px;font-size:14px">
            <span style="width:8px;height:8px;border-radius:50%;background:${c.color};display:inline-block"></span>${c.name}
          </div>
          <input type="number" data-cat="${c.name}" value="${budgetTarget(c.name)}" min="0" step="10"
            style="width:90px;font-size:13px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;text-align:right">
        </div>
      `).join('')}
      <div style="display:flex;gap:8px;margin-top:18px">
        <button onclick="saveBudgetSettings()" style="flex:1;background:#2a78d6;color:#fff;border:none;border-radius:6px;padding:8px;font-size:14px;cursor:pointer">Save</button>
        <button onclick="document.getElementById('budget-edit-modal').remove()" style="flex:1;background:none;border:1px solid #ddd;border-radius:6px;padding:8px;font-size:14px;cursor:pointer">Cancel</button>
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

  // Detect header row
  const header = lines[0].toLowerCase();
  const rows = [];

  // PNC format: Date,Description,Withdrawals,Deposits,Running Balance
  const isPNC = header.includes('withdrawal') || header.includes('deposit');
  // Generic format: Date,Description,Amount
  const cols = lines[0].split(',').map(c => c.replace(/"/g, '').trim().toLowerCase());

  const dateIdx = cols.findIndex(c => c.includes('date') || c.includes('posted'));
  const descIdx = cols.findIndex(c => c.includes('description') || c.includes('memo') || c.includes('payee') || c.includes('name'));
  const amtIdx = cols.findIndex(c => c === 'amount' || c === 'debit' || c === 'transaction amount');
  const withdrawIdx = cols.findIndex(c => c.includes('withdrawal') || c.includes('debit'));
  const depositIdx = cols.findIndex(c => c.includes('deposit') || c.includes('credit'));

  for (let i = 1; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i]);
    if (!parts.length) continue;

    const rawDate = parts[dateIdx >= 0 ? dateIdx : 0]?.replace(/"/g, '').trim();
    const rawDesc = parts[descIdx >= 0 ? descIdx : 1]?.replace(/"/g, '').trim();

    let amount = 0;
    if (isPNC && withdrawIdx >= 0) {
      // PNC: withdrawals column (spending)
      const w = parseFloat((parts[withdrawIdx] || '').replace(/[^0-9.-]/g, ''));
      if (!isNaN(w) && w > 0) amount = w;
    } else if (amtIdx >= 0) {
      // Generic: amount column (negative = spending)
      const a = parseFloat((parts[amtIdx] || '').replace(/[^0-9.-]/g, ''));
      if (!isNaN(a)) amount = Math.abs(a); // treat all as expenses; deposits filtered server-side
    }

    if (!rawDate || !rawDesc || amount <= 0) continue;

    // Normalize date to YYYY-MM-DD
    let date = rawDate;
    try {
      const d = new Date(rawDate);
      if (!isNaN(d)) date = d.toISOString().slice(0, 10);
    } catch(e) {}

    rows.push({ date, description: rawDesc, amount });
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
