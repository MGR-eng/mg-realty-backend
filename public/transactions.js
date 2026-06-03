// ── Dashboard Transactions ────────────────────────────────────
function renderDashTransactions() {
  var grid = document.getElementById('dash-tx-grid');
  var countEl = document.getElementById('dash-tx-count');
  if (!grid) return;
  var active = (deals||[]).filter(function(d) { return d.txStage && d.txStage !== 'Closed'; });
  if (countEl) countEl.textContent = '· ' + active.length + ' active';
  if (!active.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No active transactions.</div>'; return; }
  grid.innerHTML = active.map(function(d) {
    var lead = leads.find(function(l) { return l.id === d.leadId; });
    var daysToClose = d.closeDate ? Math.ceil((new Date(d.closeDate) - new Date()) / 86400000) : null;
    var price = d.salePrice ? '$' + Number(d.salePrice).toLocaleString() : '—';
    var stage = d.txStage || 'Offer Submitted';
    var bg = TX_COLORS[stage] || 'var(--surface)';
    var border = TX_BORDER[stage] || 'var(--border)';
    var closeTxt = daysToClose !== null ? (daysToClose <= 0 ? '<span style="color:var(--red)">Past close</span>' : '<span style="color:' + (daysToClose<=7?'var(--amber)':'var(--text2)') + '">'+daysToClose+'d to close</span>') : '';
    return '<div data-txid="' + d.id + '" onclick="openEditTx(this.dataset.txid);showPane(\'transactions\',document.querySelector(\'[onclick*=transactions]\'))" style="background:'+bg+';border:1px solid '+border+';border-radius:var(--rl);padding:14px;cursor:pointer">'
      + '<div style="font-size:13px;font-weight:700;margin-bottom:6px">' + (d.address||'No address') + '</div>'
      + '<div style="font-size:11px;color:var(--text2);margin-bottom:4px">' + (lead?lead.first+' '+lead.last:'') + (d.side?' · '+d.side:'') + '</div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<span style="font-size:13px;font-weight:600">' + price + '</span>'
      + '<span style="font-size:10px;font-weight:600;background:var(--surface2);padding:2px 8px;border-radius:99px">' + stage + '</span>'
      + '</div>'
      + (closeTxt ? '<div style="font-size:11px;margin-top:4px">' + closeTxt + '</div>' : '')
      + '</div>';
  }).join('');
}

// ── Transactions Pipeline ─────────────────────────────────────
var TX_STAGES = ['Offer Submitted','Under Contract','Inspection','Appraisal','Loan Approval','Clear to Close','Closed'];
var TX_COLORS = {'Offer Submitted':'rgba(96,165,250,0.15)','Under Contract':'rgba(167,139,250,0.15)','Inspection':'rgba(251,191,36,0.15)','Appraisal':'rgba(232,104,26,0.15)','Loan Approval':'rgba(248,113,113,0.15)','Clear to Close':'rgba(74,222,128,0.15)','Closed':'rgba(74,222,128,0.25)'};
var TX_BORDER = {'Offer Submitted':'rgba(96,165,250,0.4)','Under Contract':'rgba(167,139,250,0.4)','Inspection':'rgba(251,191,36,0.4)','Appraisal':'rgba(232,104,26,0.4)','Loan Approval':'rgba(248,113,113,0.4)','Clear to Close':'rgba(74,222,128,0.4)','Closed':'rgba(74,222,128,0.6)'};
var TX_DOCS = ['Purchase Agreement','Seller Disclosures','Buyer Pre-Approval','Inspection Report','Inspection Contingency Removal','Appraisal','Loan Contingency Removal','Final Walk-Through','Grant Deed','Closing Statement'];
var editTxId = null;

function renderTransactions() {
  var board = document.getElementById('transactions-pipeline');
  if (!board) return;
  var badge = document.getElementById('nb-transactions');
  var active = deals.filter(function(d) { return d.txStage && d.txStage !== 'Closed'; }).length;
  if (badge) { badge.textContent = active; badge.style.display = active ? '' : 'none'; }
  if (!deals.length) {
    board.innerHTML = '<div class="empty">No transactions yet. Click "New Transaction" to start tracking a deal.</div>';
    return;
  }
  var html = '<div style="display:flex;gap:16px;min-width:max-content;padding:4px 0">';
  TX_STAGES.forEach(function(stage) {
    var stageTxs = deals.filter(function(d) { return (d.txStage || 'Offer Submitted') === stage; });
    html += '<div style="width:280px;flex-shrink:0">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;display:flex;justify-content:space-between"><span>' + stage + '</span><span style="color:var(--text3)">' + stageTxs.length + '</span></div>';
    stageTxs.forEach(function(d) { html += renderTxCard(d); });
    html += '<button class="btn btn-sm" data-stage="' + stage + '" onclick="openNewTx(this.dataset.stage)" style="width:100%;margin-top:8px;background:var(--surface2);color:var(--text3);border:1px dashed var(--border);font-size:11px">+ Add deal</button>';
    html += '</div>';
  });
  html += '</div>';
  board.innerHTML = html;
}

function renderTxCard(d) {
  var lead = leads.find(function(l) { return l.id === d.leadId; });
  var daysToClose = d.closeDate ? Math.ceil((new Date(d.closeDate) - new Date()) / 86400000) : null;
  var checklist = d.checklist || {};
  var checkCount = TX_DOCS.filter(function(doc) { return checklist[doc]; }).length;
  var price = d.salePrice ? '$' + Number(d.salePrice).toLocaleString() : '—';
  var stage = d.txStage || 'Offer Submitted';
  var bg = TX_COLORS[stage] || 'var(--surface)';
  var border = TX_BORDER[stage] || 'var(--border)';
  var closeTxt = '';
  if (daysToClose !== null) {
    if (daysToClose < 0) closeTxt = '<span style="color:var(--red)">Closed ' + Math.abs(daysToClose) + 'd ago</span>';
    else if (daysToClose === 0) closeTxt = '<span style="color:var(--amber)">Closes TODAY</span>';
    else closeTxt = '<span style="color:' + (daysToClose <= 7 ? 'var(--amber)' : 'var(--text2)') + '">Closes in ' + daysToClose + 'd</span>';
  }
  var html = '<div data-txid="' + d.id + '" onclick="openEditTx(this.dataset.txid)" style="background:' + bg + ';border:1px solid ' + border + ';border-radius:var(--rl);padding:14px;margin-bottom:10px;cursor:pointer">';
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px"><div style="font-size:13px;font-weight:700;line-height:1.3">' + (d.address || 'No address') + '</div><span style="font-size:11px;font-weight:600;color:var(--accent)">' + (d.side || '') + '</span></div>';
  if (lead) html += '<div style="font-size:11px;color:var(--text2);margin-bottom:6px">&#128100; ' + lead.first + ' ' + lead.last + '</div>';
  html += '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px">' + price + '</div>';
  if (d.closeDate) html += '<div style="font-size:11px;margin-bottom:6px">' + closeTxt + ' &middot; ' + d.closeDate + '</div>';
  if (d.coopAgent) html += '<div style="font-size:11px;color:var(--text2);margin-bottom:6px">&#129309; ' + d.coopAgent + (d.coopBrokerage ? ' &middot; ' + d.coopBrokerage : '') + '</div>';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><div style="font-size:10px;color:var(--text3)">Docs: ' + checkCount + '/' + TX_DOCS.length + '</div>';
  html += '<div style="width:80px;height:4px;background:var(--border);border-radius:99px;overflow:hidden"><div style="width:' + Math.round(checkCount/TX_DOCS.length*100) + '%;height:100%;background:var(--accent);border-radius:99px"></div></div></div>';
  html += '</div>';
  return html;
}

function populateTxAgentDropdown(selectedName) {
  var el = document.getElementById('tx-coop-agent'); if(!el) return;
  el.innerHTML = '<option value="">— none —</option>' + (agents||[]).map(function(a) {
    var name = a.first + ' ' + a.last;
    return '<option value="' + name + '"' + (name===selectedName?' selected':'') + '>' + name + (a.brokerage?' ('+a.brokerage+')':'') + '</option>';
  }).join('');
}

function openNewTx(stage) {
  editTxId = null;
  document.getElementById('tx-modal-title').textContent = 'New Transaction';
  ['tx-address','tx-price','tx-commission','tx-closingdate','tx-offer-date','tx-inspection-date','tx-contingency-date','tx-loan-date','tx-coop-brokerage','tx-notes'].forEach(function(id) {
    var el = document.getElementById(id); if(el) el.value = '';
  });
  var stageEl = document.getElementById('tx-stage'); if(stageEl) stageEl.value = stage || 'Offer Submitted';
  var sideEl = document.getElementById('tx-side'); if(sideEl) sideEl.value = 'Buyer side';
  populateTxLeadDropdown('');
  populateTxAgentDropdown('');
  renderTxChecklist({});
  document.getElementById('tx-delete-btn').style.display = 'none';
  document.getElementById('mTransaction').style.display = 'flex';
}

function openEditTx(id) {
  editTxId = id;
  var d = deals.find(function(x) { return x.id === id; });
  if (!d) return;
  document.getElementById('tx-modal-title').textContent = 'Edit Transaction';
  var fmap = {'tx-address':d.address,'tx-price':d.salePrice?'$'+Number(d.salePrice).toLocaleString():'','tx-commission':d.commissionPct,'tx-closingdate':d.closeDate,'tx-offer-date':d.offerDate,'tx-inspection-date':d.inspectionDeadline,'tx-contingency-date':d.contingencyRemoval,'tx-loan-date':d.loanApprovalDeadline,'tx-coop-brokerage':d.coopBrokerage,'tx-notes':d.notes};
  Object.keys(fmap).forEach(function(k) { var el=document.getElementById(k); if(el) el.value=fmap[k]||''; });
  var stageEl = document.getElementById('tx-stage'); if(stageEl) stageEl.value = d.txStage||'Offer Submitted';
  var sideEl = document.getElementById('tx-side'); if(sideEl) sideEl.value = d.side||'Buyer side';
  populateTxLeadDropdown(d.leadId||'');
  populateTxAgentDropdown(d.coopAgent||'');
  renderTxChecklist(d.checklist||{});
  document.getElementById('tx-delete-btn').style.display = '';
  document.getElementById('mTransaction').style.display = 'flex';
}

function populateTxLeadDropdown(selectedId) {
  var el = document.getElementById('tx-lead'); if(!el) return;
  el.innerHTML = '<option value="">— none —</option>' + leads.map(function(l) {
    return '<option value="' + l.id + '"' + (l.id===selectedId?' selected':'') + '>' + l.first + ' ' + l.last + '</option>';
  }).join('');
}

function renderTxChecklist(checked) {
  var el = document.getElementById('tx-checklist'); if(!el) return;
  el.innerHTML = TX_DOCS.map(function(doc) {
    var safeId = 'chk_' + doc.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
    return '<label style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;cursor:pointer"><input type="checkbox" id="' + safeId + '" ' + (checked[doc]?'checked':'') + ' style="accent-color:var(--accent);width:14px;height:14px"><span>' + doc + '</span></label>';
  }).join('');
}

function saveTx() {
  var g = function(id) { var el=document.getElementById(id); return el?el.value.trim():''; };
  if (!g('tx-address')) { toast('Address required'); return; }
  var checklist = {};
  TX_DOCS.forEach(function(doc) {
    var safeId = 'chk_' + doc.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
    var el = document.getElementById(safeId);
    if (el) checklist[doc] = el.checked;
  });
  var tx = {id:editTxId||'tx_'+Date.now(),address:g('tx-address'),salePrice:g('tx-price').replace(/[^0-9.]/g,''),commissionPct:g('tx-commission'),closeDate:g('tx-closingdate'),offerDate:g('tx-offer-date'),inspectionDeadline:g('tx-inspection-date'),contingencyRemoval:g('tx-contingency-date'),loanApprovalDeadline:g('tx-loan-date'),coopAgent:g('tx-coop-agent'),coopBrokerage:g('tx-coop-brokerage'),notes:g('tx-notes'),txStage:document.getElementById('tx-stage')?.value||'Offer Submitted',side:document.getElementById('tx-side')?.value||'Buyer side',leadId:document.getElementById('tx-lead')?.value||'',checklist:checklist};
  if (editTxId) { deals = deals.map(function(d) { return d.id===editTxId?tx:d; }); }
  else { deals.push(tx); }
  persist(); renderAll();
  document.getElementById('mTransaction').style.display = 'none';
  toast('Transaction saved');
}

function deleteTx() {
  if (!editTxId || !confirm('Delete this transaction?')) return;
  deals = deals.filter(function(d) { return d.id !== editTxId; });
  persist(); renderAll();
  document.getElementById('mTransaction').style.display = 'none';
}
