// ── Transaction Tracker ───────────────────────────────────────
var TX_STAGES = ['Offer Submitted','Under Contract','Inspection','Appraisal','Loan Approval','Clear to Close','Closed'];
var TX_COLORS  = {'Offer Submitted':'rgba(96,165,250,0.12)','Under Contract':'rgba(167,139,250,0.12)','Inspection':'rgba(251,191,36,0.12)','Appraisal':'rgba(232,104,26,0.12)','Loan Approval':'rgba(248,113,113,0.12)','Clear to Close':'rgba(74,222,128,0.12)','Closed':'rgba(74,222,128,0.20)'};
var TX_BORDER  = {'Offer Submitted':'rgba(96,165,250,0.4)','Under Contract':'rgba(167,139,250,0.4)','Inspection':'rgba(251,191,36,0.4)','Appraisal':'rgba(232,104,26,0.4)','Loan Approval':'rgba(248,113,113,0.4)','Clear to Close':'rgba(74,222,128,0.4)','Closed':'rgba(74,222,128,0.6)'};

// ── Comprehensive CA real estate transaction checklist ────────
var TX_DOCS = [
  { name: 'Listing Agreement',                cat: 'Listing'    },
  { name: 'Purchase Agreement (RPA-CA)',       cat: 'Contract'   },
  { name: 'Counter Offer',                    cat: 'Contract'   },
  { name: 'Seller Disclosures (TDS / SPQ)',   cat: 'Disclosure' },
  { name: 'Natural Hazard Disclosure (NHD)',  cat: 'Disclosure' },
  { name: 'Buyer Pre-Approval Letter',        cat: 'Buyer'      },
  { name: 'Home Inspection Report',           cat: 'Inspection' },
  { name: 'Pest Inspection Report',           cat: 'Inspection' },
  { name: 'Inspection Contingency Removal',   cat: 'Contingency'},
  { name: 'Appraisal Report',                 cat: 'Appraisal'  },
  { name: 'Appraisal Contingency Removal',    cat: 'Contingency'},
  { name: 'Loan Contingency Removal',         cat: 'Contingency'},
  { name: 'HOA Documents',                    cat: 'HOA'        },
  { name: 'Preliminary Title Report',         cat: 'Title'      },
  { name: 'Final Walk-Through Verification',  cat: 'Closing'    },
  { name: 'Grant Deed',                       cat: 'Closing'    },
  { name: 'Closing / Settlement Statement',   cat: 'Closing'    },
  { name: 'Commission Disbursement (CDA)',    cat: 'Closing'    }
];

var TX_CAT_COLORS = { Listing:'#60A5FA', Contract:'#A78BFA', Disclosure:'#FBBF24', Buyer:'#34D399', Inspection:'#F97316', Contingency:'#FB923C', Appraisal:'#E8681A', HOA:'#94A3B8', Title:'#C084FC', Closing:'#4ADE80' };

var editTxId = null;
var _txCurrentChecklist = {}; // live checklist during modal session

// ── Helper: normalize checklist value ──────────────────────────
function txCheckVal(val) {
  if (!val) return { checked: false };
  if (typeof val === 'boolean') return { checked: val };
  return val;
}

// ── Dashboard grid ─────────────────────────────────────────────
function renderDashTransactions() {
  var grid = document.getElementById('dash-tx-grid');
  var countEl = document.getElementById('dash-tx-count');
  if (!grid) return;
  var active = (deals||[]).filter(function(d) { return d.txStage && d.txStage !== 'Closed'; });
  if (countEl) countEl.textContent = '· ' + active.length + ' active';
  if (!active.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No active transactions.</div>'; return; }
  grid.innerHTML = active.map(function(d) { return renderTxCard(d, false); }).join('');
}

// ── Transactions kanban board ──────────────────────────────────
function renderTransactions() {
  var board = document.getElementById('transactions-pipeline');
  if (!board) return;
  var badge = document.getElementById('nb-transactions');
  var active = (deals||[]).filter(function(d) { return d.txStage && d.txStage !== 'Closed'; }).length;
  if (badge) { badge.textContent = active; badge.style.display = active ? '' : 'none'; }

  if (!(deals||[]).some(function(d){ return d.txStage; })) {
    board.innerHTML = '<div class="empty" style="padding:40px 20px;text-align:center">No transactions yet.<br><br><button class="btn btn-gold" onclick="openNewTx()"><i class="ti ti-plus"></i> Start a Transaction</button></div>';
    return;
  }
  var html = '<div style="display:flex;gap:16px;min-width:max-content;padding:4px 20px 20px">';
  TX_STAGES.forEach(function(stage) {
    var stageTxs = (deals||[]).filter(function(d) { return (d.txStage || 'Offer Submitted') === stage; });
    html += '<div style="width:290px;flex-shrink:0">';
    html += '<div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">'
          + '<span>' + stage + '</span>'
          + '<span style="background:var(--surface2);color:var(--text3);padding:1px 7px;border-radius:99px;font-size:10px">' + stageTxs.length + '</span>'
          + '</div>';
    stageTxs.forEach(function(d) { html += renderTxCard(d, true); });
    html += '<button class="btn btn-sm" data-stage="' + stage + '" onclick="openNewTx(this.dataset.stage)" style="width:100%;margin-top:8px;background:var(--surface2);color:var(--text3);border:1px dashed var(--border);font-size:11px">+ Add</button>';
    html += '</div>';
  });
  html += '</div>';
  board.innerHTML = html;
}

function renderTxCard(d, compact) {
  var lead = (leads||[]).find(function(l) { return l.id === d.leadId; });
  var daysToClose = d.closeDate ? Math.ceil((new Date(d.closeDate+'T00:00:00') - new Date()) / 86400000) : null;
  var checklist = d.checklist || {};
  var checkCount = TX_DOCS.filter(function(doc) {
    var v = txCheckVal(checklist[doc.name]);
    return v.checked;
  }).length;
  var docUploadCount = TX_DOCS.filter(function(doc) {
    var v = txCheckVal(checklist[doc.name]);
    return v.docId;
  }).length;
  var price = d.salePrice ? '$' + Number(d.salePrice).toLocaleString() : '—';
  var stage = d.txStage || 'Offer Submitted';
  var bg = TX_COLORS[stage] || 'var(--surface)';
  var border = TX_BORDER[stage] || 'var(--border)';
  var pct = Math.round(checkCount / TX_DOCS.length * 100);

  var closeTxt = '';
  if (daysToClose !== null) {
    if (daysToClose < 0) closeTxt = '<span style="color:var(--red)">⚠ ' + Math.abs(daysToClose) + 'd past close</span>';
    else if (daysToClose === 0) closeTxt = '<span style="color:var(--amber)">🔥 Closes TODAY</span>';
    else closeTxt = '<span style="color:' + (daysToClose<=7?'var(--amber)':'var(--text2)') + '">📅 ' + daysToClose + 'd to close</span>';
  }

  var stageColor = {'Offer Submitted':'var(--blue)','Under Contract':'var(--purple)','Inspection':'var(--amber)','Appraisal':'var(--accent)','Loan Approval':'var(--red)','Clear to Close':'var(--green)','Closed':'var(--green)'}[stage] || 'var(--text2)';

  return '<div data-txid="' + d.id + '" onclick="openEditTx(this.dataset.txid)" style="background:' + bg + ';border:1px solid ' + border + ';border-radius:var(--rl);padding:' + (compact?'14px':'16px') + ';margin-bottom:10px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s" onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 6px 16px rgba(0,0,0,0.25)\'" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\'">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'
    + '<div style="font-size:' + (compact?'13':'15') + 'px;font-weight:700;line-height:1.3;flex:1">' + (d.address || 'No address') + '</div>'
    + (compact ? '' : '<span style="font-size:10px;font-weight:700;color:'+stageColor+';background:'+stageColor+'1a;padding:2px 10px;border-radius:99px;border:1px solid '+stageColor+'44;white-space:nowrap;margin-left:8px">' + stage + '</span>')
    + '</div>'
    + (lead ? '<div style="font-size:11px;color:var(--text2);margin-bottom:5px">👤 ' + lead.first + ' ' + lead.last + (d.side?' · <span style="color:var(--accent)">' + d.side + '</span>':'') + '</div>' : '')
    + '<div style="font-size:' + (compact?'13':'16') + 'px;font-weight:700;color:var(--accent);margin-bottom:6px">' + price + '</div>'
    + (closeTxt ? '<div style="font-size:11px;margin-bottom:6px">' + closeTxt + (d.closeDate?' · ' + d.closeDate:'') + '</div>' : '')
    + (d.coopAgent ? '<div style="font-size:11px;color:var(--text2);margin-bottom:6px">🤝 ' + d.coopAgent + (d.coopBrokerage?' · '+d.coopBrokerage:'') + '</div>' : '')
    + '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">'
    + '<span style="font-size:10px;color:var(--text3)">✅ ' + checkCount + '/' + TX_DOCS.length + ' · 📎 ' + docUploadCount + ' uploaded</span>'
    + '<div style="width:70px;height:4px;background:var(--border);border-radius:99px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:var(--accent);border-radius:99px;transition:width 0.3s"></div></div>'
    + '</div>'
    + '</div>';
}

// ── Open modal: new transaction ───────────────────────────────
function openNewTx(stage) {
  editTxId = null;
  _txCurrentChecklist = {};
  document.getElementById('tx-modal-title').textContent = 'New Transaction';
  ['tx-address','tx-price','tx-commission','tx-closingdate','tx-offer-date','tx-inspection-date','tx-contingency-date','tx-loan-date','tx-coop-brokerage','tx-notes'].forEach(function(id) {
    var el = document.getElementById(id); if(el) el.value = '';
  });
  var stageEl = document.getElementById('tx-stage'); if(stageEl) stageEl.value = stage || 'Offer Submitted';
  var sideEl = document.getElementById('tx-side'); if(sideEl) sideEl.value = 'Seller side';
  populateTxLeadDropdown('');
  populateTxAgentDropdown('');
  renderTxChecklist({});
  document.getElementById('tx-delete-btn').style.display = 'none';
  document.getElementById('mTransaction').style.display = 'flex';
}

// ── Open modal: from seller card ──────────────────────────────
function openNewTxFromSeller(leadId) {
  var lead = (leads||[]).find(function(l) { return l.id === leadId; });
  if (!lead) return;
  // Check if already has an active transaction
  var existing = (deals||[]).find(function(d) { return d.leadId === leadId && d.txStage && d.txStage !== 'Closed'; });
  if (existing) { openEditTx(existing.id); return; }
  editTxId = null;
  _txCurrentChecklist = {};
  document.getElementById('tx-modal-title').textContent = 'New Transaction — ' + lead.first + ' ' + lead.last;
  ['tx-address','tx-price','tx-commission','tx-closingdate','tx-offer-date','tx-inspection-date','tx-contingency-date','tx-loan-date','tx-coop-brokerage','tx-notes'].forEach(function(id) {
    var el = document.getElementById(id); if(el) el.value = '';
  });
  // Pre-fill from seller lead
  var addrEl = document.getElementById('tx-address'); if(addrEl) addrEl.value = lead.prop || '';
  var priceEl = document.getElementById('tx-price'); if(priceEl) priceEl.value = lead.askingPrice || '';
  var stageEl = document.getElementById('tx-stage'); if(stageEl) stageEl.value = 'Offer Submitted';
  var sideEl = document.getElementById('tx-side'); if(sideEl) sideEl.value = 'Seller side';
  populateTxLeadDropdown(leadId);
  populateTxAgentDropdown('');
  renderTxChecklist({});
  document.getElementById('tx-delete-btn').style.display = 'none';
  document.getElementById('mTransaction').style.display = 'flex';
}

// ── Open modal: edit existing ─────────────────────────────────
function openEditTx(id) {
  editTxId = id;
  var d = (deals||[]).find(function(x) { return x.id === id; });
  if (!d) return;
  _txCurrentChecklist = JSON.parse(JSON.stringify(d.checklist || {}));
  document.getElementById('tx-modal-title').textContent = 'Transaction — ' + (d.address || '');
  var fmap = {'tx-address':d.address,'tx-price':d.salePrice?'$'+Number(d.salePrice).toLocaleString():'','tx-commission':d.commissionPct,'tx-closingdate':d.closeDate,'tx-offer-date':d.offerDate,'tx-inspection-date':d.inspectionDeadline,'tx-contingency-date':d.contingencyRemoval,'tx-loan-date':d.loanApprovalDeadline,'tx-coop-brokerage':d.coopBrokerage,'tx-notes':d.notes};
  Object.keys(fmap).forEach(function(k) { var el=document.getElementById(k); if(el) el.value=fmap[k]||''; });
  var stageEl = document.getElementById('tx-stage'); if(stageEl) stageEl.value = d.txStage||'Offer Submitted';
  var sideEl = document.getElementById('tx-side'); if(sideEl) sideEl.value = d.side||'Seller side';
  populateTxLeadDropdown(d.leadId||'');
  populateTxAgentDropdown(d.coopAgent||'');
  renderTxChecklist(_txCurrentChecklist);
  document.getElementById('tx-delete-btn').style.display = '';
  document.getElementById('mTransaction').style.display = 'flex';
}

// ── Render checklist with upload buttons ──────────────────────
function renderTxChecklist(checklist) {
  var el = document.getElementById('tx-checklist'); if(!el) return;
  _txCurrentChecklist = JSON.parse(JSON.stringify(checklist || {}));

  // Group by category
  var cats = {};
  TX_DOCS.forEach(function(doc) {
    if (!cats[doc.cat]) cats[doc.cat] = [];
    cats[doc.cat].push(doc);
  });

  var html = '';
  Object.keys(cats).forEach(function(cat) {
    var catColor = TX_CAT_COLORS[cat] || 'var(--text3)';
    html += '<div style="margin-bottom:12px">';
    html += '<div style="font-size:10px;font-weight:700;color:' + catColor + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid var(--border)">' + cat + '</div>';
    cats[cat].forEach(function(doc) {
      var val = txCheckVal(checklist[doc.name]);
      var safeId = 'chk_' + doc.name.replace(/[^a-zA-Z0-9]/g,'_');
      var hasDoc = !!val.docId;
      html += '<div id="txrow_' + safeId + '" style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,0.04)">';
      html += '<input type="checkbox" id="' + safeId + '" ' + (val.checked?'checked':'') + ' onchange="txCheckToggle(this,\'' + doc.name.replace(/'/g,"\\'") + '\')" style="accent-color:var(--accent);width:15px;height:15px;flex-shrink:0;cursor:pointer">';
      html += '<span style="flex:1;font-size:12px;color:var(--text1);line-height:1.4">' + doc.name + '</span>';
      if (hasDoc) {
        html += '<a href="' + (val.viewUrl||'#') + '" target="_blank" onclick="event.stopPropagation()" style="font-size:10px;color:var(--accent);text-decoration:none;white-space:nowrap;background:rgba(232,104,26,0.12);padding:2px 7px;border-radius:6px;border:1px solid rgba(232,104,26,0.3)">📎 ' + (val.docName||'View').substring(0,18) + '</a>';
      }
      html += '<button onclick="event.stopPropagation();triggerTxDocUpload(\'' + doc.name.replace(/'/g,"\\'") + '\')" style="flex-shrink:0;background:' + (hasDoc?'rgba(74,222,128,0.1)':'var(--surface2)') + ';border:1px solid ' + (hasDoc?'rgba(74,222,128,0.3)':'var(--border)') + ';color:' + (hasDoc?'var(--green)':'var(--text3)') + ';border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer;white-space:nowrap">' + (hasDoc?'✓ Uploaded':'⬆ Upload') + '</button>';
      html += '<span id="txdoc_status_' + safeId + '" style="font-size:9px;color:var(--text3);display:none;white-space:nowrap">…</span>';
      html += '</div>';
    });
    html += '</div>';
  });

  // Hidden file input
  html += '<input type="file" id="tx-doc-file-input" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style="display:none" onchange="handleTxDocUpload(this)">';
  el.innerHTML = html;
}

function txCheckToggle(cb, docName) {
  if (!_txCurrentChecklist[docName]) _txCurrentChecklist[docName] = {};
  if (typeof _txCurrentChecklist[docName] === 'boolean') _txCurrentChecklist[docName] = { checked: _txCurrentChecklist[docName] };
  _txCurrentChecklist[docName].checked = cb.checked;
}

// ── Doc upload per checklist item ─────────────────────────────
var _txDocUploadTarget = null;

function triggerTxDocUpload(docName) {
  _txDocUploadTarget = docName;
  var input = document.getElementById('tx-doc-file-input');
  if (input) { input.value = ''; input.click(); }
}

async function handleTxDocUpload(input) {
  var docName = _txDocUploadTarget;
  if (!docName || !input.files || !input.files[0]) return;
  var file = input.files[0];
  var safeId = 'chk_' + docName.replace(/[^a-zA-Z0-9]/g,'_');
  var statusEl = document.getElementById('txdoc_status_' + safeId);
  if (statusEl) { statusEl.style.display=''; statusEl.textContent='Uploading…'; statusEl.style.color='var(--amber)'; }

  try {
    var base64 = await new Promise(function(res,rej) {
      var reader = new FileReader();
      reader.onload = function(e) { res(e.target.result); };
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    var BACKEND = window.BACKEND || '';
    var r = await fetch(BACKEND + '/drive/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, fileData: base64, mimeType: file.type, leadName: 'Transaction — ' + docName })
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Upload failed');

    if (!_txCurrentChecklist[docName] || typeof _txCurrentChecklist[docName] === 'boolean') _txCurrentChecklist[docName] = {};
    _txCurrentChecklist[docName] = {
      checked: true,
      docId: d.fileId,
      docName: file.name,
      viewUrl: d.webViewLink || d.viewUrl,
      uploadedAt: new Date().toISOString()
    };

    // Auto-check the checkbox
    var chkEl = document.getElementById(safeId);
    if (chkEl) chkEl.checked = true;

    if (statusEl) { statusEl.style.display='none'; }

    // Re-render just the row
    var rowEl = document.getElementById('txrow_' + safeId);
    if (rowEl) {
      var val = _txCurrentChecklist[docName];
      var inner = rowEl.innerHTML;
      // Replace upload button with "Uploaded" state
      rowEl.querySelector('button').style.background = 'rgba(74,222,128,0.1)';
      rowEl.querySelector('button').style.borderColor = 'rgba(74,222,128,0.3)';
      rowEl.querySelector('button').style.color = 'var(--green)';
      rowEl.querySelector('button').textContent = '✓ Uploaded';
      // Add or update the view link
      var existingLink = rowEl.querySelector('a');
      if (existingLink) {
        existingLink.href = val.viewUrl;
        existingLink.textContent = '📎 ' + (val.docName||'View').substring(0,18);
      } else {
        var link = document.createElement('a');
        link.href = val.viewUrl;
        link.target = '_blank';
        link.onclick = function(e) { e.stopPropagation(); };
        link.style.cssText = 'font-size:10px;color:var(--accent);text-decoration:none;white-space:nowrap;background:rgba(232,104,26,0.12);padding:2px 7px;border-radius:6px;border:1px solid rgba(232,104,26,0.3)';
        link.textContent = '📎 ' + (val.docName||'View').substring(0,18);
        rowEl.insertBefore(link, rowEl.querySelector('button'));
      }
    }
    if (typeof toast === 'function') toast('📎 ' + file.name + ' uploaded');
  } catch(e) {
    if (statusEl) { statusEl.style.color='var(--red)'; statusEl.textContent='Failed: ' + e.message; }
    if (typeof toast === 'function') toast('Upload failed: ' + e.message, 'err');
  }
  input.value = '';
}

// ── Save transaction ──────────────────────────────────────────
function saveTx() {
  var g = function(id) { var el=document.getElementById(id); return el?el.value.trim():''; };
  if (!g('tx-address')) { if(typeof toast==='function') toast('Address required','err'); return; }

  // Read checkbox states into _txCurrentChecklist
  TX_DOCS.forEach(function(doc) {
    var safeId = 'chk_' + doc.name.replace(/[^a-zA-Z0-9]/g,'_');
    var el = document.getElementById(safeId);
    if (el) {
      if (!_txCurrentChecklist[doc.name]) _txCurrentChecklist[doc.name] = {};
      if (typeof _txCurrentChecklist[doc.name] === 'boolean') _txCurrentChecklist[doc.name] = { checked: _txCurrentChecklist[doc.name] };
      _txCurrentChecklist[doc.name].checked = el.checked;
    }
  });

  var rawPrice = g('tx-price').replace(/[^0-9.]/g,'');
  var tx = {
    id:                editTxId || 'tx_' + Date.now(),
    address:           g('tx-address'),
    salePrice:         rawPrice,
    commissionPct:     g('tx-commission'),
    closeDate:         g('tx-closingdate'),
    offerDate:         g('tx-offer-date'),
    inspectionDeadline: g('tx-inspection-date'),
    contingencyRemoval: g('tx-contingency-date'),
    loanApprovalDeadline: g('tx-loan-date'),
    coopAgent:         g('tx-coop-agent'),
    coopBrokerage:     g('tx-coop-brokerage'),
    notes:             g('tx-notes'),
    txStage:           document.getElementById('tx-stage')?.value || 'Offer Submitted',
    side:              document.getElementById('tx-side')?.value || 'Seller side',
    leadId:            document.getElementById('tx-lead')?.value || '',
    checklist:         _txCurrentChecklist
  };

  if (editTxId) {
    deals = deals.map(function(d) { return d.id === editTxId ? tx : d; });
  } else {
    deals.push(tx);
    // Mark the linked lead as in transaction
    if (tx.leadId) {
      leads = leads.map(function(l) {
        if (l.id === tx.leadId) return Object.assign({}, l, { inTransaction: true, txId: tx.id });
        return l;
      });
    }
  }

  document.getElementById('mTransaction').style.display = 'none';
  if (typeof persist === 'function') persist();
  if (typeof renderAll === 'function') renderAll();
  if (typeof toast === 'function') toast('Transaction saved ✓');
}

function deleteTx() {
  if (!editTxId || !confirm('Delete this transaction?')) return;
  var tx = deals.find(function(d) { return d.id === editTxId; });
  deals = deals.filter(function(d) { return d.id !== editTxId; });
  // Clear flag on lead
  if (tx && tx.leadId) {
    leads = leads.map(function(l) {
      if (l.id === tx.leadId) return Object.assign({}, l, { inTransaction: false, txId: null });
      return l;
    });
  }
  if (typeof persist === 'function') persist();
  if (typeof renderAll === 'function') renderAll();
  document.getElementById('mTransaction').style.display = 'none';
}

// ── Dropdowns ─────────────────────────────────────────────────
function populateTxLeadDropdown(selectedId) {
  var el = document.getElementById('tx-lead'); if(!el) return;
  // Show all leads but put sellers first
  var sellers = (leads||[]).filter(function(l){ return l.type==='seller'; });
  var others  = (leads||[]).filter(function(l){ return l.type!=='seller'; });
  var sorted  = sellers.concat(others);
  el.innerHTML = '<option value="">— none —</option>'
    + sorted.map(function(l) {
        var label = l.first + ' ' + (l.last||'') + (l.type===' seller'?' 🏠':'') + (l.prop?' · '+l.prop.substring(0,30):'');
        return '<option value="' + l.id + '"' + (l.id===selectedId?' selected':'') + '>' + label + '</option>';
      }).join('');
}

function populateTxAgentDropdown(selectedName) {
  var el = document.getElementById('tx-coop-agent'); if(!el) return;
  el.innerHTML = '<option value="">— none —</option>' + (agents||[]).map(function(a) {
    var name = a.first + ' ' + a.last;
    return '<option value="' + name + '"' + (name===selectedName?' selected':'') + '>' + name + (a.brokerage?' ('+a.brokerage+')':'') + '</option>';
  }).join('');
}

// ── Run on load ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    renderDashTransactions();
    renderTransactions();
  }, 1200);
});

(function() {
  var origSync = typeof syncFromBackend === 'function' ? syncFromBackend : null;
  if (origSync) {
    syncFromBackend = function() {
      var result = origSync();
      if (result && result.then) {
        result.then(function() { renderDashTransactions(); renderTransactions(); });
      } else {
        setTimeout(function(){ renderDashTransactions(); renderTransactions(); }, 500);
      }
      return result;
    };
  }
})();
