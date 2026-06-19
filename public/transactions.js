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

// ── CA Escrow Milestones (client-facing progress tracker) ─────
var TX_MILESTONES = [
  { key:'offer_submitted',    name:'Offer Submitted',                      cat:'Contract',
    emailMsg:'Your offer has been submitted to the seller on {ADDRESS}. We\'re waiting to hear back and I\'ll keep you updated every step of the way.',
    nextStep:'We expect to hear back within 24–48 hours. I\'ll contact you the moment we get a response.',
    sms:'Your offer on {ADDRESS} has been submitted! I\'ll let you know as soon as we hear back 🙌' },
  { key:'offer_accepted',     name:'Offer Accepted — Under Contract! 🎉',   cat:'Contract',
    emailMsg:'Your offer has been accepted on {ADDRESS}! You are now officially under contract. This is a big moment — congratulations!',
    nextStep:'Your earnest money deposit is typically due within 3 business days. I\'ll send wiring instructions from escrow shortly.',
    sms:'GREAT NEWS! Your offer on {ADDRESS} was ACCEPTED! 🎉 You\'re under contract. Earnest money instructions coming shortly.' },
  { key:'earnest_money',      name:'Earnest Money Deposited',               cat:'Contract',
    emailMsg:'Your earnest money deposit has been confirmed received by escrow on {ADDRESS}.',
    nextStep:'We\'re officially rolling. Next up are inspections and seller disclosures.',
    sms:'Earnest money confirmed on {ADDRESS} ✅ Moving forward with inspections and disclosures!' },
  { key:'escrow_opened',      name:'Escrow Opened',                         cat:'Contract',
    emailMsg:'Escrow has been officially opened on {ADDRESS}. You\'ll hear from the escrow officer soon with instructions for signing initial documents.',
    nextStep:'Look out for an email from the escrow company with your login/document instructions.',
    sms:'Escrow is open on {ADDRESS} ✅ The escrow officer will reach out to you with next steps.' },
  { key:'tds_spq',            name:'Seller Disclosures Delivered (TDS/SPQ)', cat:'Disclosure',
    emailMsg:'The seller\'s disclosure documents — the Transfer Disclosure Statement (TDS) and Seller Property Questionnaire (SPQ) — have been delivered for your review on {ADDRESS}.',
    nextStep:'Please review these carefully. These are important legal documents about the property\'s condition. Let me know if anything stands out.',
    sms:'Seller disclosures for {ADDRESS} are ready for your review. Take a look and let me know if you have questions!' },
  { key:'nhd',                name:'Natural Hazard Disclosure (NHD) Received', cat:'Disclosure',
    emailMsg:'The Natural Hazard Disclosure (NHD) report for {ADDRESS} has been received. This discloses any natural hazard zones the property may be in — earthquake, flood, fire, etc.',
    nextStep:'I\'ll walk you through any relevant items. Most properties have some NHD disclosures — we can discuss what applies.',
    sms:'NHD report received for {ADDRESS} ✅ I\'ll go over the highlights with you.' },
  { key:'home_inspection',    name:'Home Inspection Completed',              cat:'Inspection',
    emailMsg:'The home inspection on {ADDRESS} has been completed. I\'ll share the full report with you shortly so we can review the findings together.',
    nextStep:'Once we\'ve reviewed the report, we\'ll decide if we want to request repairs or credits from the seller.',
    sms:'Home inspection done on {ADDRESS} ✅ Report coming your way so we can review together.' },
  { key:'pest_inspection',    name:'Pest Inspection Completed',              cat:'Inspection',
    emailMsg:'The pest (termite) inspection on {ADDRESS} has been completed.',
    nextStep:'I\'ll share the pest report. If any treatment is needed, we\'ll address it with the seller.',
    sms:'Pest inspection complete on {ADDRESS} ✅ Report on the way.' },
  { key:'inspection_cr',      name:'Inspection Contingency Removed',         cat:'Contingency',
    emailMsg:'The inspection contingency on {ADDRESS} has been officially removed. We\'re satisfied with the condition of the property and moving forward.',
    nextStep:'Up next: appraisal and loan approval. We\'re making great progress.',
    sms:'Inspection contingency removed on {ADDRESS} ✅ Moving forward with confidence!' },
  { key:'title_report',       name:'Preliminary Title Report Received',      cat:'Title',
    emailMsg:'The preliminary title report for {ADDRESS} has been received. This confirms the ownership history and any liens or encumbrances on the property.',
    nextStep:'The title looks clean. Any exceptions will need to be cleared before closing — I\'ll flag anything that needs attention.',
    sms:'Title report received on {ADDRESS} ✅ Looking clean — I\'ll flag anything to review.' },
  { key:'hoa_docs',           name:'HOA Documents Received',                 cat:'HOA',
    emailMsg:'The HOA documents for {ADDRESS} have been received, including the CC&Rs, bylaws, financials, and meeting minutes.',
    nextStep:'Please review the HOA rules and financials. Look at any pending special assessments or restrictions that might affect you.',
    sms:'HOA docs received for {ADDRESS} ✅ Worth a read on the CC&Rs and financials. Let me know your thoughts!' },
  { key:'appraisal_ordered',  name:'Appraisal Ordered',                      cat:'Appraisal',
    emailMsg:'The appraisal for {ADDRESS} has been ordered by the lender. An appraiser will schedule a visit to the property.',
    nextStep:'Appraisal results typically take 1–2 weeks. I\'ll update you as soon as we have the value.',
    sms:'Appraisal ordered on {ADDRESS} ✅ Should have results in 1-2 weeks.' },
  { key:'appraisal_complete', name:'Appraisal Completed — Value Confirmed',  cat:'Appraisal',
    emailMsg:'The appraisal on {ADDRESS} has come back and the value has been confirmed. This is great news for your financing.',
    nextStep:'With the appraisal clear, the lender can finalize your loan. We\'re getting close.',
    sms:'Appraisal on {ADDRESS} is in and looking good ✅ Value confirmed — we\'re on track!' },
  { key:'appraisal_cr',       name:'Appraisal Contingency Removed',          cat:'Contingency',
    emailMsg:'The appraisal contingency on {ADDRESS} has been officially removed.',
    nextStep:'Loan approval is the next major hurdle — and we\'re nearly there.',
    sms:'Appraisal contingency removed on {ADDRESS} ✅ Almost at the finish line!' },
  { key:'loan_approval',      name:'Loan Approval Received',                 cat:'Loan',
    emailMsg:'Your lender has issued a formal loan approval for the purchase of {ADDRESS}. This is one of the biggest milestones in the process — congratulations!',
    nextStep:'The escrow team will schedule your signing appointment. We\'re in the final stretch.',
    sms:'LOAN APPROVED on {ADDRESS}! 🎉 This is huge — almost done. Signing appointment coming soon!' },
  { key:'loan_cr',            name:'Loan Contingency Removed',               cat:'Contingency',
    emailMsg:'The loan contingency on {ADDRESS} has been officially removed. We are fully committed to this purchase.',
    nextStep:'Final steps are ahead — grant deed recording and key delivery. You\'re almost a homeowner!',
    sms:'Loan contingency removed on {ADDRESS} ✅ Fully committed and on track to close!' },
  { key:'demand_ordered',     name:'Demand / Payoff Ordered',                cat:'Closing',
    emailMsg:'The payoff demand has been ordered from the seller\'s current lender on {ADDRESS}. This allows escrow to calculate the final closing figures.',
    nextStep:'Once the demand is received, escrow will prepare the final closing statement for both sides to review.',
    sms:'Demand/payoff ordered on {ADDRESS} ✅ Closing figures being finalized — almost there!' },
  { key:'final_walkthrough',  name:'Final Walk-Through Completed',           cat:'Closing',
    emailMsg:'The final walk-through of {ADDRESS} has been completed and everything looks great.',
    nextStep:'Signing and funding are the last steps. You are almost a homeowner!',
    sms:'Final walk-through done on {ADDRESS} ✅ Everything looks great. Signing is next!' },
  { key:'deed_recorded',      name:'Grant Deed Recorded',                    cat:'Closing',
    emailMsg:'The grant deed for {ADDRESS} has been officially recorded with the county. The property is now legally yours!',
    nextStep:'Keys will be exchanged shortly. Welcome to your new home!',
    sms:'Deed recorded on {ADDRESS}! 🎉 It\'s officially yours! Keys coming very soon.' },
  { key:'keys_delivered',     name:'Keys Delivered — CLOSED! 🎉🏡',          cat:'Closing',
    emailMsg:'Congratulations — the transaction on {ADDRESS} is officially CLOSED! It has been an absolute pleasure working with you through this process. Welcome home!',
    nextStep:'Please don\'t hesitate to reach out any time if you need a referral, have a real estate question, or just want to say hello. I\'m always here.',
    sms:'🎉🏡 CONGRATULATIONS! {ADDRESS} is YOURS! Keys in hand, deal done. It was a true pleasure working with you. Welcome home!' }
];

var TX_MS_CAT_COLOR = { Contract:'#60A5FA', Disclosure:'#FBBF24', Inspection:'#F97316', Contingency:'#FB923C', Title:'#C084FC', HOA:'#94A3B8', Appraisal:'#E8681A', Loan:'#4ADE80', Closing:'#34D399' };

var editTxId = null;
var _txCurrentChecklist = {}; // live checklist during modal session
var _txCurrentMilestones = {}; // live milestone states during modal session
var _txCurrentToken = null;   // tracker token for shareable client link

function generateTrackerToken() {
  return Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,10);
}

// ── Render escrow milestone checklist ─────────────────────────
function renderTxMilestones(milestones) {
  var el = document.getElementById('tx-milestones'); if(!el) return;
  _txCurrentMilestones = JSON.parse(JSON.stringify(milestones || {}));
  var cats = {};
  TX_MILESTONES.forEach(function(m) { if(!cats[m.cat]) cats[m.cat]=[]; cats[m.cat].push(m); });
  var html = '';
  Object.keys(cats).forEach(function(cat) {
    var color = TX_MS_CAT_COLOR[cat] || 'var(--text3)';
    html += '<div style="margin-bottom:10px">';
    html += '<div style="font-size:10px;font-weight:700;color:'+color+';text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid var(--border)">'+cat+'</div>';
    cats[cat].forEach(function(m) {
      var state = milestones[m.key] || {};
      var done = !!state.done;
      var doneAt = state.doneAt ? new Date(state.doneAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
      html += '<div id="msrow_'+m.key+'" style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,0.04)">';
      html += '<input type="checkbox" id="ms_'+m.key+'" '+(done?'checked':'')+' onchange="txMilestoneToggle(\''+m.key+'\')" style="accent-color:var(--accent);width:15px;height:15px;flex-shrink:0;cursor:pointer">';
      html += '<span style="flex:1;font-size:12px;color:'+(done?'var(--green)':'var(--text2)')+';line-height:1.4">'+m.name+'</span>';
      if (doneAt) html += '<span style="font-size:10px;color:var(--text3);white-space:nowrap">'+doneAt+'</span>';
      if (done) {
        html += '<button onclick="event.stopPropagation();openNotifyModal(\''+m.key+'\')" style="flex-shrink:0;background:rgba(232,104,26,0.12);border:1px solid rgba(232,104,26,0.3);color:var(--accent);border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer;white-space:nowrap">📣 Notify</button>';
      }
      html += '</div>';
    });
    html += '</div>';
  });
  el.innerHTML = html;
}

function txMilestoneToggle(key) {
  var el = document.getElementById('ms_'+key); if(!el) return;
  if(!_txCurrentMilestones[key]) _txCurrentMilestones[key] = {};
  _txCurrentMilestones[key].done = el.checked;
  if(el.checked) _txCurrentMilestones[key].doneAt = new Date().toISOString();
  else delete _txCurrentMilestones[key].doneAt;
  renderTxMilestones(_txCurrentMilestones);
}

// ── Notify Client modal ───────────────────────────────────────
function openNotifyModal(key) {
  var ms = TX_MILESTONES.find(function(m){ return m.key===key; }); if(!ms) return;
  var address = (document.getElementById('tx-address')||{}).value || 'your property';
  var leadId = (document.getElementById('tx-lead')||{}).value;
  var lead = (leads||[]).find(function(l){ return l.id===leadId; });
  var clientName = lead ? lead.first : 'there';

  var emailBody = 'Hi '+clientName+',\n\n'
    + ms.emailMsg.replace(/{ADDRESS}/g, address) + '\n\n'
    + '📌 What\'s next: ' + ms.nextStep.replace(/{ADDRESS}/g, address) + '\n\n'
    + 'Questions? Reply to this email or call/text me at (323) 688-3855 — I\'m always available.\n\n'
    + 'Talk soon,\nMatt Golden\n'
    + 'Estates Director · Rare Properties Inc.\n'
    + '(323) 688-3855 | matt@mgoldenrealty.com\n'
    + 'mgoldenrealty.com | DRE #02130422';

  var smsBody = ms.sms.replace(/{ADDRESS}/g, address).replace(/{CLIENT}/g, clientName);

  var el = document.getElementById('mNotifyClient'); if(!el) return;
  var t = document.getElementById('notify-modal-title'); if(t) t.textContent = '📣 Notify Client: '+ms.name;
  var subj = document.getElementById('notify-email-subject'); if(subj) subj.value = 'Update on '+address+': '+ms.name;
  var body = document.getElementById('notify-email-body'); if(body) body.value = emailBody;
  var sms = document.getElementById('notify-sms-body'); if(sms) sms.value = smsBody;
  el.style.display = 'flex';
}

function copyNotifyText(type) {
  var id = type==='email' ? 'notify-email-body' : 'notify-sms-body';
  var subId = 'notify-email-subject';
  var el = document.getElementById(id); if(!el) return;
  var text = type==='email'
    ? 'Subject: ' + (document.getElementById(subId)||{}).value + '\n\n' + el.value
    : el.value;
  navigator.clipboard.writeText(text).then(function(){
    if(typeof toast==='function') toast((type==='email'?'📧 Email':'📱 SMS')+' copied!');
  }).catch(function(){
    el.select(); document.execCommand('copy');
    if(typeof toast==='function') toast('Copied!');
  });
}

function copyTrackerLink() {
  var el = document.getElementById('tx-tracker-url'); if(!el) return;
  navigator.clipboard.writeText(el.value||el.textContent).then(function(){
    if(typeof toast==='function') toast('🔗 Client tracker link copied!');
  }).catch(function(){
    if(el.select) el.select(); document.execCommand('copy');
    if(typeof toast==='function') toast('🔗 Copied!');
  });
}

// ── Show tracker link in modal ────────────────────────────────
function renderTrackerLink(token) {
  var box = document.getElementById('tx-tracker-box'); if(!box) return;
  var urlEl = document.getElementById('tx-tracker-url'); if(!urlEl) return;
  var BACKEND = window.BACKEND || 'https://mg-realty-backend.onrender.com';
  var url = BACKEND + '/tracker/' + token;
  urlEl.value = url;
  box.style.display = '';
}

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

  return '<div data-txid="' + d.id + '" onclick="openEditTx(this.dataset.txid)" style="background:' + bg + ';border:1px solid ' + border + ';border-radius:var(--rl);padding:' + (compact?'14px':'16px') + ';margin-bottom:10px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s" onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 6px 16px rgba(0,0,0,0.10)\'" onmouseout="this.style.transform=\'\';this.style.boxShadow=\'\'">'
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
  _txCurrentMilestones = {};
  _txCurrentToken = generateTrackerToken();
  document.getElementById('tx-modal-title').textContent = 'New Transaction';
  txClearAllFields();
  var stageEl = document.getElementById('tx-stage'); if(stageEl) stageEl.value = stage || 'Offer Submitted';
  var sideEl = document.getElementById('tx-side'); if(sideEl) sideEl.value = 'Seller side';
  populateTxLeadDropdown('');
  populateTxAgentDropdown('');
  renderTxChecklist({});
  renderTxMilestones({});
  renderTrackerLink(_txCurrentToken);
  txRenderContacts([]);
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
  _txCurrentMilestones = {};
  _txCurrentToken = generateTrackerToken();
  document.getElementById('tx-modal-title').textContent = 'New Transaction — ' + lead.first + ' ' + lead.last;
  txClearAllFields();
  // Pre-fill from seller lead
  var addrEl = document.getElementById('tx-address'); if(addrEl) addrEl.value = lead.prop || '';
  var priceEl = document.getElementById('tx-price'); if(priceEl) priceEl.value = lead.askingPrice || '';
  var stageEl = document.getElementById('tx-stage'); if(stageEl) stageEl.value = 'Offer Submitted';
  var sideEl = document.getElementById('tx-side'); if(sideEl) sideEl.value = 'Seller side';
  populateTxLeadDropdown(leadId);
  populateTxAgentDropdown('');
  renderTxChecklist({});
  renderTxMilestones({});
  renderTrackerLink(_txCurrentToken);
  txRenderContacts([]);
  document.getElementById('tx-delete-btn').style.display = 'none';
  document.getElementById('mTransaction').style.display = 'flex';
}

// ── Open modal: edit existing ─────────────────────────────────
function openEditTx(id) {
  editTxId = id;
  var d = (deals||[]).find(function(x) { return x.id === id; });
  if (!d) return;
  _txCurrentChecklist = JSON.parse(JSON.stringify(d.checklist || {}));
  _txCurrentMilestones = JSON.parse(JSON.stringify(d.milestones || {}));
  _txCurrentToken = d.trackerToken || generateTrackerToken();
  document.getElementById('tx-modal-title').textContent = 'Transaction — ' + (d.address || '');
  var fmap = {
    'tx-address':d.address,'tx-price':d.salePrice?'$'+Number(d.salePrice).toLocaleString():'',
    'tx-commission':d.commissionPct,'tx-closingdate':d.closeDate,'tx-offer-date':d.offerDate,
    'tx-inspection-date':d.inspectionDeadline,'tx-contingency-date':d.contingencyRemoval,
    'tx-loan-date':d.loanApprovalDeadline,'tx-coop-brokerage':d.coopBrokerage,'tx-notes':d.notes,
    'tx-escrow-name':d.escrowName,'tx-escrow-company':d.escrowCompany,
    'tx-escrow-phone':d.escrowPhone,'tx-escrow-email':d.escrowEmail,'tx-escrow-num':d.escrowNum,
    'tx-tc-name':d.tcName,'tx-tc-company':d.tcCompany,'tx-tc-phone':d.tcPhone,'tx-tc-email':d.tcEmail,
    'tx-lender-name':d.lenderName,'tx-lender-company':d.lenderCompany,
    'tx-lender-phone':d.lenderPhone,'tx-lender-email':d.lenderEmail
  };
  Object.keys(fmap).forEach(function(k) { var el=document.getElementById(k); if(el) el.value=fmap[k]||''; });
  var stageEl = document.getElementById('tx-stage'); if(stageEl) stageEl.value = d.txStage||'Offer Submitted';
  var sideEl = document.getElementById('tx-side'); if(sideEl) sideEl.value = d.side||'Seller side';
  populateTxLeadDropdown(d.leadId||'');
  populateTxAgentDropdown(d.coopAgent||'');
  renderTxChecklist(_txCurrentChecklist);
  renderTxMilestones(_txCurrentMilestones);
  renderTrackerLink(_txCurrentToken);
  txRenderContacts(d.contacts || []);
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
  var txContacts = txReadContacts();
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
    // Escrow
    escrowName:        g('tx-escrow-name'),
    escrowCompany:     g('tx-escrow-company'),
    escrowPhone:       g('tx-escrow-phone'),
    escrowEmail:       g('tx-escrow-email'),
    escrowNum:         g('tx-escrow-num'),
    // TC
    tcName:            g('tx-tc-name'),
    tcCompany:         g('tx-tc-company'),
    tcPhone:           g('tx-tc-phone'),
    tcEmail:           g('tx-tc-email'),
    // Lender
    lenderName:        g('tx-lender-name'),
    lenderCompany:     g('tx-lender-company'),
    lenderPhone:       g('tx-lender-phone'),
    lenderEmail:       g('tx-lender-email'),
    // Additional contacts
    contacts:          txContacts,
    txStage:           document.getElementById('tx-stage')?.value || 'Offer Submitted',
    side:              document.getElementById('tx-side')?.value || 'Seller side',
    leadId:            document.getElementById('tx-lead')?.value || '',
    checklist:         _txCurrentChecklist,
    milestones:        _txCurrentMilestones,
    trackerToken:      _txCurrentToken
  };

  // Auto-save additional contacts to vendors list (no duplicates by name+phone)
  if (typeof vendors !== 'undefined' && Array.isArray(vendors)) {
    var vendorTypes = { escrow: g('tx-escrow-name') ? { name: g('tx-escrow-name'), company: g('tx-escrow-company'), phone: g('tx-escrow-phone'), email: g('tx-escrow-email'), type: 'Escrow' } : null,
                        tc:     g('tx-tc-name')     ? { name: g('tx-tc-name'),     company: g('tx-tc-company'),     phone: g('tx-tc-phone'),     email: g('tx-tc-email'),     type: 'Transaction Coordinator' } : null,
                        lender: g('tx-lender-name') ? { name: g('tx-lender-name'), company: g('tx-lender-company'), phone: g('tx-lender-phone'), email: g('tx-lender-email'), type: 'Lender' } : null };
    [vendorTypes.escrow, vendorTypes.tc, vendorTypes.lender].concat(txContacts).forEach(function(c) {
      if (!c || !c.name) return;
      var exists = vendors.find(function(v) { return (v.name||'').toLowerCase() === (c.name||'').toLowerCase(); });
      if (!exists) {
        vendors.push({ id: 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2,5), name: c.name, company: c.company || '', phone: c.phone || '', email: c.email || '', type: c.type || c.role || 'Other', notes: 'Added from transaction: ' + g('tx-address'), createdAt: new Date().toISOString() });
      }
    });
    if (typeof persist === 'function') persist();
  }

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

// ── Transaction contact helpers ───────────────────────────────
var TX_CONTACT_ROLES = ['Inspector','Contractor','Handyman','Pest Inspector','Appraiser','Title Rep','Attorney','HOA Manager','Stager','Photographer','Other'];

function txClearAllFields() {
  ['tx-address','tx-price','tx-commission','tx-closingdate','tx-offer-date','tx-inspection-date',
   'tx-contingency-date','tx-loan-date','tx-coop-brokerage','tx-notes',
   'tx-escrow-name','tx-escrow-company','tx-escrow-phone','tx-escrow-email','tx-escrow-num',
   'tx-tc-name','tx-tc-company','tx-tc-phone','tx-tc-email',
   'tx-lender-name','tx-lender-company','tx-lender-phone','tx-lender-email'
  ].forEach(function(id) { var el=document.getElementById(id); if(el) el.value=''; });
}

function txRenderContacts(list) {
  var el = document.getElementById('tx-contacts-list'); if(!el) return;
  if (!list || !list.length) { el.innerHTML = ''; return; }
  el.innerHTML = list.map(function(c, i) { return txContactRow(c, i); }).join('');
}

function txContactRow(c, i) {
  var roleOpts = TX_CONTACT_ROLES.map(function(r) {
    return '<option value="'+r+'"'+(c.role===r?' selected':'')+'>'+r+'</option>';
  }).join('');
  return '<div class="tx-contact-row" id="txcr_'+i+'" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:6px;margin-bottom:6px;align-items:center">' +
    '<select class="txc-role" style="font-size:12px;padding:5px 6px;border-radius:6px;border:1px solid var(--border);background:var(--surface2);color:var(--text)">'+roleOpts+'</select>' +
    '<input class="txc-name" placeholder="Name" value="'+(c.name||'')+'" style="font-size:12px">' +
    '<input class="txc-phone" placeholder="Phone" value="'+(c.phone||'')+'" style="font-size:12px">' +
    '<input class="txc-email" placeholder="Email" value="'+(c.email||'')+'" style="font-size:12px">' +
    '<button onclick="txRemoveContact('+i+')" style="background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0 4px" title="Remove">✕</button>' +
  '</div>';
}

function txAddContact() {
  var el = document.getElementById('tx-contacts-list'); if(!el) return;
  var existing = txReadContacts();
  existing.push({ role:'Inspector', name:'', phone:'', email:'' });
  txRenderContacts(existing);
}

function txRemoveContact(i) {
  var existing = txReadContacts();
  existing.splice(i, 1);
  txRenderContacts(existing);
}

function txReadContacts() {
  var rows = document.querySelectorAll('.tx-contact-row');
  var out = [];
  rows.forEach(function(row) {
    var role  = (row.querySelector('.txc-role')?.value  || '').trim();
    var name  = (row.querySelector('.txc-name')?.value  || '').trim();
    var phone = (row.querySelector('.txc-phone')?.value || '').trim();
    var email = (row.querySelector('.txc-email')?.value || '').trim();
    if (name || phone || email) out.push({ role, name, phone, email });
  });
  return out;
}

// ── AI Scan & Auto-fill ───────────────────────────────────────
function triggerTxScan() {
  var inp = document.getElementById('tx-scan-file');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'tx-scan-file';
    inp.accept = '.pdf,.jpg,.jpeg,.png';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = function() { if(this.files[0]) scanTxDoc(this.files[0]); };
  }
  inp.value = '';
  inp.click();
}

async function scanTxDoc(file) {
  var statusEl = document.getElementById('tx-scan-status');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = 'var(--amber)'; statusEl.textContent = '✦ Scanning document...'; }
  var btnEl = document.getElementById('tx-scan-btn');
  if (btnEl) btnEl.disabled = true;
  try {
    var b64 = await new Promise(function(res, rej) {
      var r = new FileReader();
      r.onload = function(e) { res(e.target.result.split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    var BACKEND = window.BACKEND || '';
    var resp = await fetch(BACKEND + '/api/scan-tx-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: b64, mimeType: file.type, filename: file.name })
    });
    var d = await resp.json();
    if (!d.ok || !d.fields) throw new Error(d.error || 'Could not extract fields');
    var f = d.fields;

    // Auto-fill form fields
    var setVal = function(id, val) { if (val !== undefined && val !== null && val !== '') { var el = document.getElementById(id); if(el) el.value = val; } };
    setVal('tx-address', f.address);
    setVal('tx-price', f.salePrice ? '$' + Number(f.salePrice).toLocaleString() : null);
    setVal('tx-commission', f.commissionPct);
    setVal('tx-closingdate', f.closeDate);
    setVal('tx-offer-date', f.offerDate);
    setVal('tx-inspection-date', f.inspectionDeadline);
    setVal('tx-contingency-date', f.contingencyRemoval);
    setVal('tx-loan-date', f.loanApprovalDeadline);
    setVal('tx-coop-brokerage', f.coopBrokerage);
    if (f.notes) {
      var notesEl = document.getElementById('tx-notes');
      if (notesEl) notesEl.value = (notesEl.value ? notesEl.value + '\n' : '') + f.notes;
    }

    // Try to match buyer/seller to a lead
    if (f.buyerName || f.sellerName) {
      var nameToSearch = f.buyerName || f.sellerName;
      var parts = nameToSearch.split(' ');
      var matched = (leads||[]).find(function(l) {
        return parts.some(function(p) { return p.length > 2 && (l.first+' '+l.last).toLowerCase().includes(p.toLowerCase()); });
      });
      if (matched) {
        var ldEl = document.getElementById('tx-lead');
        if (ldEl) ldEl.value = matched.id;
      }
    }

    if (statusEl) { statusEl.style.color = 'var(--green)'; statusEl.textContent = '✓ Fields auto-filled from ' + file.name; }
    if (typeof toast === 'function') toast('✓ Document scanned — fields auto-filled!');
  } catch(e) {
    if (statusEl) { statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Scan failed: ' + e.message; }
    if (typeof toast === 'function') toast('Scan failed: ' + e.message, 'err');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
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
