import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { GoogleAuth } from 'google-auth-library';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: '*' }));
app.options('*', cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// ── Supabase helpers ──────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;

async function readCRM() {
  const r = await fetch(`${SB_URL}/rest/v1/crm_state?id=eq.main&select=*`, {
    headers: { 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY }
  });
  const rows = await r.json();
  const row = rows[0] || {};
  return {
    leads:        row.leads        || [],
    activities:   row.activities   || [],
    appointments: row.appointments || [],
    tasks:        row.tasks        || [],
    properties:   row.properties   || [],
    deals:        row.deals        || [],
    agents:       row.agents       || [],
    sequences:    row.sequences    || []
  };
}

async function writeCRM(data) {
  const r = await fetch(`${SB_URL}/rest/v1/crm_state`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SB_KEY}`,
      'apikey': SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ id: 'main', ...data, updated_at: new Date().toISOString() })
  });
  if (!r.ok) throw new Error(`Supabase write failed: ${r.status} ${await r.text()}`);
}

// Google OAuth — auto-refresh using refresh token
let cachedToken = null;
let tokenExpiry = 0;

async function googleToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token'
    })
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  console.log('Google token refreshed');
  return cachedToken;
}

const GMAIL_MCP  = async () => ({ type: 'url', url: 'https://gmailmcp.googleapis.com/mcp/v1',   name: 'gmail',  authorization_token: await googleToken() });
const GCAL_MCP   = async () => ({ type: 'url', url: 'https://calendarmcp.googleapis.com/mcp/v1', name: 'gcal',   authorization_token: await googleToken() });
const GDRIVE_MCP = async () => ({ type: 'url', url: 'https://drivemcp.googleapis.com/mcp/v1',    name: 'gdrive', authorization_token: await googleToken() });

// ── Service Account token for Google Sheets (never expires) ──
const sheetsAuth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

async function serviceAccountToken() {
  const client = await sheetsAuth.getClient();
  const token  = await client.getAccessToken();
  console.log('Service account token refreshed');
  return token.token;
}

async function callClaude(prompt, mcpServers = []) {
  const params = {
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  };
  const options = {};
  if (mcpServers.length) {
    params.mcp_servers = mcpServers;
    options.headers = { 'anthropic-beta': 'mcp-client-2025-04-04' };
  }
  const resp = await anthropic.messages.create(params, options);
  return resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, service: 'MG Realty CRM Backend' }));

// ── CRM sync ──────────────────────────────────────────────────
app.get('/crm/pull', async (req, res) => {
  try {
    const data = await readCRM();
    res.json({ ok: true, data });
  } catch(e) {
    console.error('CRM PULL ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/crm/push', async (req, res) => {
  try {
    const { leads, activities, appointments, tasks, properties, deals, agents } = req.body;
    await writeCRM({ leads, activities, appointments, tasks, properties, deals, agents });
    res.json({ ok: true });
  } catch(e) {
    console.error('CRM PUSH ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Privacy Policy ────────────────────────────────────────────
app.get('/privacy', (req, res) => res.send(`<!DOCTYPE html><html><head><title>MG Realty Privacy Policy</title></head><body style="font-family:Arial,sans-serif;max-width:700px;margin:40px auto;padding:0 20px">
<h1>Privacy Policy</h1><p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>
<p>MG Realty ("we") operates an internal CRM assistant accessible via SMS. This policy describes how we handle information.</p>
<h2>Information We Collect</h2><p>We collect SMS messages sent to our business number for the purpose of managing real estate client relationships.</p>
<h2>How We Use Information</h2><p>Messages are processed by an AI assistant to help manage leads, appointments, and follow-ups. No data is sold or shared with third parties.</p>
<h2>Contact</h2><p>Matt Golden · goldenmb@gmail.com</p>
</body></html>`));

// ── Terms of Service ──────────────────────────────────────────
app.get('/terms', (req, res) => res.send(`<!DOCTYPE html><html><head><title>MG Realty Terms of Service</title></head><body style="font-family:Arial,sans-serif;max-width:700px;margin:40px auto;padding:0 20px">
<h1>Terms of Service</h1><p><strong>Last updated:</strong> ${new Date().toLocaleDateString()}</p>
<p>By texting MG Realty's SMS number, you agree to receive automated responses from our AI CRM assistant.</p>
<h2>Use</h2><p>This service is for internal business use by MG Realty staff only. Messages are processed to assist with real estate client management.</p>
<h2>Opt-Out</h2><p>Reply STOP at any time to opt out of messages.</p>
<h2>Contact</h2><p>Matt Golden · goldenmb@gmail.com</p>
</body></html>`));

// ── Calendar: create event ────────────────────────────────────
app.post('/calendar/create', async (req, res) => {
  try {
    const { title, start, end, location, description, duration } = req.body;
    const prompt = `Create a Google Calendar event:
Title: "${title}"
Start: ${start} America/Los_Angeles
End: ${end} America/Los_Angeles
Location: ${location || 'TBD'}
Description: ${description || ''}
Add reminders: popup 30 minutes before, email 60 minutes before.
Return only: {"ok":true}`;
    const result = await callClaude(prompt, [GCAL_MCP()]);
    res.json({ ok: result.includes('ok'), raw: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Gmail: send digest (nodemailer) ──────────────────────────
app.post('/gmail/digest', async (req, res) => {
  try {
    const { to, subject, overdue, dueToday, dueWeek, appointments, recentActivity } = req.body;

    const fmt = l => `<tr><td>${l.first} ${l.last}</td><td>${l.phone || '—'}</td><td>${l.temp.toUpperCase()}</td><td>${l.followup || 'not set'}</td><td>${(l.notes || '').substring(0, 80)}</td></tr>`;
    const apptFmt = a => `<tr><td>${a.leadName}</td><td>${a.type}</td><td>${a.date} ${a.time}</td><td>${a.address || 'TBD'}</td></tr>`;
    const actFmt  = a => `<tr><td>${a.leadName}</td><td>${a.type}</td><td>${a.outcome}</td><td>${a.date}</td></tr>`;

    const tableStyle = `width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;`;
    const thStyle = `background:#333;color:#fff;padding:8px;text-align:left;`;
    const tdStyle = `padding:8px;border-bottom:1px solid #eee;`;

    const section = (title, color, rows, headers) => rows.length === 0 ? '' : `
      <h3 style="color:${color};margin:24px 0 8px">${title} (${rows.length})</h3>
      <table style="${tableStyle}">
        <thead><tr>${headers.map(h => `<th style="${thStyle}">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
        <div style="background:#1A1914;padding:20px 24px;border-radius:8px 8px 0 0;text-align:center">
          <img src="https://mgr-eng.github.io/mg-realty-backend/mg-logo.jpg" alt="MG Realty" style="max-height:64px;max-width:200px;object-fit:contain;display:block;margin:0 auto 12px">
          <h1 style="color:#fff;margin:0;font-size:18px">Daily Digest</h1>
          <p style="color:#aaa;margin:4px 0 0;font-size:13px">${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
        </div>
        <div style="padding:24px;background:#fff;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
          ${section('🔴 Overdue','#c0392b', overdue.map(fmt).join(''), ['Name','Phone','Temp','Follow-up','Notes'])}
          ${section('🟡 Due Today','#e67e22', dueToday.map(fmt).join(''), ['Name','Phone','Temp','Follow-up','Notes'])}
          ${section('🟢 Due This Week','#27ae60', dueWeek.map(fmt).join(''), ['Name','Phone','Temp','Follow-up','Notes'])}
          ${section('📅 Upcoming Appointments','#2980b9', appointments.map(apptFmt).join(''), ['Lead','Type','Date & Time','Address'])}
          ${section('📋 Recent Activity','#8e44ad', recentActivity.slice(0,5).map(actFmt).join(''), ['Lead','Type','Outcome','Date'])}
          <p style="margin-top:32px;color:#666;font-size:13px">Open your MG Realty CRM to take action.</p>
        </div>
      </div>`;

    // Send via Resend
    const { error: resendErr } = await resend.emails.send({
      from: 'MG Realty <onboarding@resend.dev>',
      to, subject, html
    });
    if (resendErr) throw new Error('Resend: ' + resendErr.message);

    console.log(`Digest sent to ${to}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('DIGEST ERROR:', e.message, e.stack);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Email: send template ─────────────────────────────────────
app.post('/email/send', async (req, res) => {
  try {
    const { to, subject, html } = req.body;
    if (!to) throw new Error('No recipient email address');
    const { error: resendErr } = await resend.emails.send({
      from: 'MG Realty <onboarding@resend.dev>',
      to, subject, html
    });
    if (resendErr) throw new Error('Resend: ' + resendErr.message);
    console.log(`Email sent to ${to}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('EMAIL ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Google Sheets: backup leads + activity ───────────────────
app.post('/drive/backup', async (req, res) => {
  try {
    const { sheetId, leadsCsv, activityCsv, tasksCsv, propsCsv, dealsCsv, agentsCsv } = req.body;
    const token = await serviceAccountToken();

    const csvToRows = csv => {
      const rows = [];
      let row = [], cell = '', inQ = false;
      for (let i = 0; i < csv.length; i++) {
        const ch = csv[i];
        if (ch === '"' && !inQ) { inQ = true; }
        else if (ch === '"' && inQ && csv[i+1] === '"') { cell += '"'; i++; }
        else if (ch === '"' && inQ) { inQ = false; }
        else if (ch === ',' && !inQ) { row.push(cell); cell = ''; }
        else if ((ch === '\n' || ch === '\r') && !inQ) { if(ch==='\r'&&csv[i+1]==='\n')i++; row.push(cell); rows.push(row); row=[]; cell=''; }
        else { cell += ch; }
      }
      if (cell || row.length) { row.push(cell); rows.push(row); }
      return rows;
    };

    const writeSheet = async (range, values) => {
      const r = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values })
        }
      );
      if (!r.ok) throw new Error(`Sheets API: ${r.status} ${await r.text()}`);
    };

    const writes = [
      writeSheet('Leads!A1',        csvToRows(leadsCsv)),
      writeSheet('Activity Log!A1', csvToRows(activityCsv)),
    ];
    if (tasksCsv)  writes.push(writeSheet('Tasks!A1',      csvToRows(tasksCsv)));
    if (propsCsv)  writes.push(writeSheet('Properties!A1', csvToRows(propsCsv)));
    if (dealsCsv)  writes.push(writeSheet('Deals!A1',      csvToRows(dealsCsv)));
    if (agentsCsv) writes.push(writeSheet('Agents!A1',     csvToRows(agentsCsv)));

    await Promise.all(writes);
    console.log(`Backup complete (6 sheets) for ${sheetId}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('BACKUP ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SMS action executor ───────────────────────────────────────
function findLead(crm, name) {
  if (!name) return null;
  const parts = name.toLowerCase().split(' ').filter(Boolean);
  return crm.leads.find(l =>
    parts.every(p => (l.first + ' ' + l.last).toLowerCase().includes(p))
  ) || crm.leads.find(l =>
    parts.some(p => l.first.toLowerCase().includes(p) || l.last.toLowerCase().includes(p))
  );
}

async function executeSmsAction(action, crm) {
  let modified = false;
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  if (action.action === 'log_activity') {
    const lead = findLead(crm, action.lead);
    if (lead) {
      const act = {
        id: 'a' + Date.now(),
        leadId: lead.id,
        leadName: `${lead.first} ${lead.last}`,
        date: today,
        time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        type: action.type || 'call',
        direction: 'outbound',
        outcome: action.outcome || 'connected',
        notes: action.notes || '',
        fuDate: action.followupDate || '',
        fuMethod: action.followupMethod || ''
      };
      crm.activities.push(act);
      crm.leads = crm.leads.map(l => l.id !== lead.id ? l : {
        ...l,
        lastcontact: today,
        lcmethod: act.type,
        ...(act.fuDate ? { followup: act.fuDate, method: act.fuMethod || l.method } : {})
      });
      modified = true;
    }
  } else if (action.action === 'update_stage') {
    const lead = findLead(crm, action.lead);
    if (lead && action.stage) {
      crm.leads = crm.leads.map(l => l.id === lead.id ? { ...l, stage: action.stage } : l);
      modified = true;
    }
  } else if (action.action === 'update_temp') {
    const lead = findLead(crm, action.lead);
    if (lead && action.temp) {
      crm.leads = crm.leads.map(l => l.id === lead.id ? { ...l, temp: action.temp } : l);
      modified = true;
    }
  } else if (action.action === 'update_followup') {
    const lead = findLead(crm, action.lead);
    if (lead && action.date) {
      crm.leads = crm.leads.map(l => l.id === lead.id ? {
        ...l, followup: action.date,
        ...(action.method ? { method: action.method } : {})
      } : l);
      modified = true;
    }
  } else if (action.action === 'add_note') {
    const lead = findLead(crm, action.lead);
    if (lead && action.note) {
      crm.leads = crm.leads.map(l => l.id === lead.id ? {
        ...l, notes: (l.notes ? l.notes + '\n' : '') + action.note
      } : l);
      modified = true;
    }
  } else if (action.action === 'add_lead') {
    const lead = {
      id: 'l' + Date.now(),
      first: action.first || '',
      last: action.last || '',
      phone: action.phone || '',
      email: action.email || '',
      temp: action.temp || 'warm',
      source: action.source || '',
      notes: action.notes || '',
      stage: 'new',
      added: today,
      followup: action.followupDate || '',
      method: action.followupMethod || 'call'
    };
    crm.leads.push(lead);
    modified = true;
  } else if (action.action === 'create_task') {
    const lead = action.leadName ? findLead(crm, action.leadName) : null;
    crm.tasks.push({
      id: 't' + Date.now(),
      title: action.title || 'Task',
      leadId: lead?.id || '',
      leadName: lead ? `${lead.first} ${lead.last}` : (action.leadName || ''),
      due: action.due || today,
      status: 'open',
      notes: action.notes || '',
      created: today
    });
    modified = true;
  } else if (action.action === 'create_appointment') {
    const lead = action.leadName ? findLead(crm, action.leadName) : null;
    crm.appointments.push({
      id: 'ap' + Date.now(),
      leadId: lead?.id || '',
      leadName: lead ? `${lead.first} ${lead.last}` : (action.leadName || ''),
      type: action.type || 'showing',
      date: action.date || today,
      time: action.time || '',
      address: action.address || '',
      notes: action.notes || '',
      status: 'scheduled'
    });
    modified = true;
  } else if (action.action === 'create_calendar_event') {
    try {
      const token = await googleToken();
      const calMcp = { type: 'url', url: 'https://calendarmcp.googleapis.com/mcp/v1', name: 'gcal', authorization_token: token };
      await callClaude(`Create a Google Calendar event:
Title: "${action.title}"
Start: ${action.start} America/Los_Angeles
End: ${action.end || action.start} America/Los_Angeles
Location: ${action.location || 'TBD'}
Description: ${action.description || ''}
Add popup reminder 30 minutes before.
Return only: {"ok":true}`, [calMcp]);
      console.log('Calendar event created:', action.title);
    } catch(e) {
      console.error('Calendar creation failed:', e.message);
    }
    // Also log in CRM appointments
    if (action.leadName || action.title) {
      const lead = action.leadName ? findLead(crm, action.leadName) : null;
      crm.appointments.push({
        id: 'ap' + Date.now(),
        leadId: lead?.id || '',
        leadName: lead ? `${lead.first} ${lead.last}` : (action.leadName || ''),
        type: action.apptType || 'showing',
        date: (action.start || '').split('T')[0] || today,
        time: (action.start || '').split('T')[1]?.substring(0, 5) || '',
        address: action.location || '',
        notes: action.description || '',
        status: 'scheduled'
      });
      modified = true;
    }
  } else if (action.action === 'send_email_template') {
    const lead = action.leadName ? findLead(crm, action.leadName) : null;
    const toEmail = action.email || lead?.email;
    if (toEmail) {
      await resend.emails.send({
        from: 'MG Realty <onboarding@resend.dev>',
        to: toEmail,
        subject: action.subject || 'Message from MG Realty',
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1A1914;padding:20px;text-align:center;border-radius:8px 8px 0 0">
            <img src="https://mgr-eng.github.io/mg-realty-backend/mg-logo.jpg" alt="MG Realty" style="max-height:56px;object-fit:contain">
          </div>
          <div style="padding:24px;background:#fff;border:1px solid #eee;border-radius:0 0 8px 8px">
            <p>${(action.body || '').replace(/\n/g, '<br>')}</p>
            <p style="margin-top:24px;color:#666;font-size:12px">Matt Golden · MG Realty · goldenmb@gmail.com</p>
          </div>
        </div>`
      });
    }
  }

  if (modified) await writeCRM(crm);
  return modified;
}

// ── Twilio: send outbound SMS ─────────────────────────────────
async function sendSMS(to, body) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM;
  if (!sid || !token || !from) throw new Error('Twilio env vars not set');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Body: body })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Twilio send failed: ${data.message || r.status}`);
  return data.sid;
}

// ── AI Nudge: proactive follow-up reminders ───────────────────
app.post('/ai/nudge', async (req, res) => {
  // Protect with a secret key
  if (req.headers['x-api-key'] !== process.env.NUDGE_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const crm  = await readCRM();
    const now  = new Date();
    const today = now.toISOString().split('T')[0];
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

    // Build lead analysis
    const activeLeads = crm.leads
      .filter(l => l.temp !== 'done')
      .map(l => {
        const daysSince = l.lastcontact
          ? Math.floor((now - new Date(l.lastcontact)) / 86400000)
          : 999;
        return {
          name: `${l.first} ${l.last}`,
          temp: l.temp,
          stage: l.stage || 'new',
          daysSinceContact: daysSince,
          followupDate: l.followup || null,
          overdue: !!(l.followup && l.followup < today)
        };
      });

    const todayAppts = crm.appointments.filter(a => a.date === today)
      .map(a => `${a.leadName} — ${a.type} at ${a.time}${a.address ? ' @ ' + a.address : ''}`);
    const todayTasks = crm.tasks.filter(t => t.due === today && t.status !== 'done')
      .map(t => t.title + (t.leadName ? ` (${t.leadName})` : ''));

    const prompt = `You are the AI assistant for Matt Golden, a real estate agent in Los Angeles at MG Realty.
Analyze his CRM data and write a punchy morning briefing as 1–3 SMS messages (each under 155 chars).

ACTIVE LEADS:
${JSON.stringify(activeLeads)}

TODAY'S APPOINTMENTS: ${JSON.stringify(todayAppts)}
TODAY'S TASKS: ${JSON.stringify(todayTasks)}
TODAY'S DATE: ${today}

Rules:
- Lead first message with the most urgent item
- Flag HOT leads with no contact in 3+ days as top priority
- Call out overdue follow-ups by name
- Mention today's appointments if any
- If everything looks good, say so and give one proactive tip
- Sign off each message with nothing (Matt knows it's his assistant)
- Be direct, no fluff — Matt is a busy agent

Return ONLY a JSON array of strings, no other text:
["message 1", "message 2"]`;

    const raw = await callClaude(prompt);
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Claude returned unexpected format: ' + raw);
    const messages = JSON.parse(match[0]);

    const ownerPhone = process.env.OWNER_PHONE;
    if (!ownerPhone) throw new Error('OWNER_PHONE env var not set');

    const sent = [];
    for (const msg of messages) {
      const sid = await sendSMS(ownerPhone, msg);
      sent.push({ sid, msg });
      console.log(`Nudge sent: ${msg}`);
    }

    res.json({ ok: true, sent: sent.length, messages });
  } catch (e) {
    console.error('NUDGE ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Follow-up sequences ───────────────────────────────────────
const SEQUENCE_TOUCHES = [
  { day: 0,  key: 'intro',    subject: 'Great connecting with you — Matt Golden, MG Realty',
    body: (name) => `<p>Hi ${name},</p><p>It was great connecting! I'm excited to help you navigate the LA real estate market.</p><p>I'll be reaching out shortly, but feel free to reply here or call/text me anytime with questions.</p><p>Looking forward to working together!</p>` },
  { day: 3,  key: 'checkin',  subject: 'Checking in — any questions?',
    body: (name) => `<p>Hi ${name},</p><p>Just checking in to see if you had any questions or if anything has come up since we last spoke.</p><p>The LA market moves fast — I want to make sure you're in the best position possible when the right property comes along.</p><p>Let me know when you're free to chat!</p>` },
  { day: 7,  key: 'value',    subject: "A few listings I thought you'd like",
    body: (name) => `<p>Hi ${name},</p><p>I've been keeping an eye on the market and wanted to share that things are moving. The best opportunities go quickly, so staying ready is key.</p><p>Would love to set up a quick call this week to talk through what's out there and what fits your criteria. Reply or text me anytime!</p>` },
  { day: 14, key: 'final',    subject: 'Still here when you\'re ready',
    body: (name) => `<p>Hi ${name},</p><p>I just wanted to touch base one more time. Whether you're ready to move forward now or just planning ahead, I'm here to help whenever the time is right.</p><p>No pressure at all — just want you to know you've got a trusted resource in your corner.</p><p>Talk soon!</p>` },
];

// Start a sequence for a lead
app.post('/sequences/start', async (req, res) => {
  try {
    const { leadId } = req.body;
    const crm = await readCRM();
    const lead = crm.leads.find(l => l.id === leadId);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
    if (!lead.email) return res.status(400).json({ ok: false, error: 'Lead has no email address' });

    // Cancel any existing active sequence for this lead
    crm.sequences = (crm.sequences || []).map(s =>
      s.leadId === leadId && s.status === 'active' ? { ...s, status: 'cancelled' } : s
    );

    const startDate = new Date();
    const seq = {
      id: 'seq' + Date.now(),
      leadId,
      leadName: `${lead.first} ${lead.last}`,
      leadEmail: lead.email,
      startedAt: startDate.toISOString().split('T')[0],
      status: 'active',
      touches: SEQUENCE_TOUCHES.map(t => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + t.day);
        return { day: t.day, key: t.key, subject: t.subject, scheduledDate: d.toISOString().split('T')[0], sent: false };
      })
    };

    crm.sequences.push(seq);
    await writeCRM(crm);
    console.log(`Sequence started for ${lead.first} ${lead.last}`);
    res.json({ ok: true, sequenceId: seq.id, touches: seq.touches.length });
  } catch(e) {
    console.error('SEQUENCE START ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Cancel a sequence
app.post('/sequences/cancel', async (req, res) => {
  try {
    const { sequenceId, leadId } = req.body;
    const crm = await readCRM();
    crm.sequences = (crm.sequences || []).map(s => {
      if ((sequenceId && s.id === sequenceId) || (leadId && s.leadId === leadId && s.status === 'active')) {
        return { ...s, status: 'cancelled' };
      }
      return s;
    });
    await writeCRM(crm);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Process due sequence emails — call this daily (UptimeRobot or cron)
// Accepts GET or POST, key in header OR query param
app.all('/sequences/process', async (req, res) => {
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== process.env.NUDGE_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const crm = await readCRM();
    const today = new Date().toISOString().split('T')[0];
    let sent = 0;

    for (const seq of (crm.sequences || [])) {
      if (seq.status !== 'active') continue;
      for (const touch of seq.touches) {
        if (touch.sent || touch.scheduledDate > today) continue;
        const tpl = SEQUENCE_TOUCHES.find(t => t.key === touch.key);
        if (!tpl) continue;

        const firstName = seq.leadName.split(' ')[0];
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#1A1914;padding:20px 24px;border-radius:8px 8px 0 0;text-align:center">
              <img src="https://mgr-eng.github.io/mg-realty-backend/mg-logo.jpg" alt="MG Realty" style="max-height:56px;object-fit:contain;display:block;margin:0 auto">
            </div>
            <div style="padding:24px;background:#fff;border:1px solid #eee;border-radius:0 0 8px 8px">
              ${tpl.body(firstName)}
              <p style="margin-top:28px;color:#333;font-size:13px">— Matt Golden<br><span style="color:#888">MG Realty · Los Angeles<br>goldenmb@gmail.com</span></p>
            </div>
          </div>`;

        const { error } = await resend.emails.send({
          from: 'Matt Golden <onboarding@resend.dev>',
          to: seq.leadEmail,
          subject: touch.subject,
          html
        });

        if (!error) {
          touch.sent = true;
          touch.sentAt = today;
          sent++;
          console.log(`Sequence email sent: ${touch.key} → ${seq.leadEmail}`);
        } else {
          console.error(`Sequence email failed: ${error.message}`);
        }
      }

      // Mark complete if all touches sent
      if (seq.touches.every(t => t.sent)) seq.status = 'completed';
    }

    await writeCRM(crm);
    res.json({ ok: true, sent });
  } catch(e) {
    console.error('SEQUENCE PROCESS ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Get sequence status for a lead
app.get('/sequences/status/:leadId', async (req, res) => {
  try {
    const crm = await readCRM();
    const seqs = (crm.sequences || []).filter(s => s.leadId === req.params.leadId);
    const active = seqs.find(s => s.status === 'active');
    res.json({ ok: true, active: active || null, all: seqs });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Static page routes ────────────────────────────────────────
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));
app.get('/open-house', (req, res) => res.sendFile(path.join(__dirname, 'public', 'open-house-sign.html')));

// ── Lead capture form ─────────────────────────────────────────
app.post('/leads/capture', async (req, res) => {
  try {
    const { first, last, phone, email, intent, budget, timeline, neighborhood, source, notes, notify } = req.body;
    if (!first || !last || !phone) return res.status(400).json({ ok: false, error: 'Missing required fields' });

    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const leadNotes = [
      intent      ? `Looking to: ${intent}`         : '',
      budget      ? `Budget: ${budget}`              : '',
      timeline    ? `Timeline: ${timeline}`          : '',
      neighborhood? `Area: ${neighborhood}`          : '',
      notes       ? `Notes: ${notes}`                : ''
    ].filter(Boolean).join('\n');

    const lead = {
      id:          'l' + Date.now(),
      first:       first.trim(),
      last:        last.trim(),
      phone:       phone.trim(),
      email:       (email || '').trim(),
      temp:        'warm',
      source:      source || '',
      stage:       'new',
      notes:       leadNotes,
      added:       today,
      followup:    tomorrow,
      method:      'call',
      intent:      intent || '',
      budget:      budget || '',
      timeline:    timeline || '',
      neighborhood: neighborhood || ''
    };

    const crm = await readCRM();
    crm.leads.push(lead);
    await writeCRM(crm);
    console.log(`New lead captured: ${first} ${last} (${source || 'unknown source'})`);

    // Respond immediately — notification is fire-and-forget
    res.json({ ok: true });

    // Notify Matt in the background (won't affect form response)
    const ownerPhone = process.env.OWNER_PHONE;
    const twilioReady = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM && ownerPhone;
    const notifyMsg = `🏡 New lead!\n${first} ${last}\n${phone}${email ? '\n' + email : ''}\n${intent || 'inquiry'} | ${budget || 'budget TBD'} | ${timeline || ''}\n${neighborhood || ''}\nSource: ${source || 'unknown'}`;

    // Extra email to notify (e.g. from ?notify= param on open house sign)
    const notifyEmail = (notify || '').trim() || null;

    if (twilioReady) {
      sendSMS(ownerPhone, notifyMsg)
        .then(() => console.log('Lead notification sent via SMS'))
        .catch(e => {
          console.error('SMS failed, trying email:', e.message);
          sendLeadEmail(first, last, phone, email, intent, budget, timeline, neighborhood, source, notes, notifyEmail)
            .catch(e2 => console.error('Email notification also failed:', e2.message));
        });
    } else {
      sendLeadEmail(first, last, phone, email, intent, budget, timeline, neighborhood, source, notes, notifyEmail)
        .catch(e => console.error('Lead email notification failed:', e.message));
    }

    // If notifyEmail set, always send there regardless of SMS path
    if (notifyEmail) {
      sendLeadEmail(first, last, phone, email, intent, budget, timeline, neighborhood, source, notes, notifyEmail)
        .catch(e => console.error('Notify email failed:', e.message));
    }
  } catch(e) {
    console.error('LEAD CAPTURE ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

async function sendLeadEmail(first, last, phone, email, intent, budget, timeline, neighborhood, source, notes, notifyEmail = null) {
  const row = (label, val) => val ? `<tr><td style="padding:6px 0;color:#888;font-size:13px;width:120px">${label}</td><td style="padding:6px 0;font-size:13px;font-weight:500">${val}</td></tr>` : '';
  const toAddresses = ['goldenmb@gmail.com'];
  if (notifyEmail && notifyEmail !== 'goldenmb@gmail.com') toAddresses.push(notifyEmail);
  await resend.emails.send({
    from: 'MG Realty <onboarding@resend.dev>',
    to: toAddresses,
    subject: `🏡 New Lead: ${first} ${last}`,
    html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1A1914;padding:20px 24px;border-radius:8px 8px 0 0;text-align:center">
        <img src="https://mgr-eng.github.io/mg-realty-backend/mg-logo.jpg" alt="MG Realty" style="max-height:56px;object-fit:contain;display:block;margin:0 auto 10px">
        <h2 style="color:#fff;margin:0;font-size:18px">New Lead from Contact Form</h2>
      </div>
      <div style="padding:24px;background:#fff;border:1px solid #eee;border-radius:0 0 8px 8px">
        <h3 style="margin:0 0 16px;font-size:20px">${first} ${last}</h3>
        <table style="width:100%;border-collapse:collapse">
          ${row('Phone', phone)}
          ${row('Email', email)}
          ${row('Looking to', intent)}
          ${row('Budget', budget)}
          ${row('Timeline', timeline)}
          ${row('Area', neighborhood)}
          ${row('Source', source)}
          ${row('Notes', notes)}
        </table>
        <div style="margin-top:20px;padding:14px;background:#FFF3ED;border-radius:8px;border-left:3px solid #E8681A">
          <p style="margin:0;font-size:13px;color:#E8681A;font-weight:600">Follow up tomorrow — they're warm!</p>
        </div>
      </div>
    </div>`
  });
}

// ── Twilio Voice screening ────────────────────────────────────
const twimlVoice = xml => `<?xml version="1.0" encoding="UTF-8"?><Response>${xml}</Response>`;
const say = (text, voice='Polly.Joanna') => `<Say voice="${voice}">${text}</Say>`;

// Step 1: Incoming call — greet and gather caller info
app.post('/voice', (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.send(twimlVoice(`
    <Gather input="speech" action="/voice/screen" method="POST" timeout="8" speechTimeout="auto" language="en-US">
      ${say("Hi, you've reached MG Realty. I'm Matt's assistant — can I get your name and the reason for your call?")}
    </Gather>
    ${say("I didn't catch that. Please call back and I'll make sure Matt gets your message.")}
  `));
});

// Step 2: Screen the caller with Claude
app.post('/voice/screen', async (req, res) => {
  res.set('Content-Type', 'text/xml');
  const speechResult = (req.body.SpeechResult || '').trim();
  const callerNumber = req.body.From || 'Unknown';
  console.log(`Voice call from ${callerNumber}: "${speechResult}"`);

  try {
    const ownerPhone = process.env.OWNER_PHONE;
    const twilioFrom = process.env.TWILIO_FROM;

    if (!speechResult) {
      res.send(twimlVoice(`
        ${say("I didn't catch that. Please leave a message after the tone and Matt will call you back.")}
        <Record maxLength="60" action="/voice/message" transcribe="true" transcribeCallback="/voice/transcription"/>
      `));
      return;
    }

    // Claude screens the caller
    const screening = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: `A caller just called Matt Golden's real estate business (MG Realty, Los Angeles).
Caller's number: ${callerNumber}
Caller said: "${speechResult}"

Classify this call and respond with JSON only:
{"route":"connect|message|decline","callerName":"first name or Unknown","summary":"one sentence reason"}

Route guide:
- connect: motivated buyer, seller, or professional contact worth Matt's time
- message: unclear intent, general inquiry, wants callback
- decline: spam, robocall, solicitation, wrong number` }]
    });

    let route = 'message', callerName = 'Someone', summary = speechResult;
    try {
      const parsed = JSON.parse(screening.content[0].text);
      route = parsed.route || 'message';
      callerName = parsed.callerName || 'Someone';
      summary = parsed.summary || speechResult;
    } catch(e) { console.error('Voice screen parse error:', e.message); }

    console.log(`Voice screen result: ${route} — ${callerName} — ${summary}`);

    // Notify Matt via SMS regardless of route
    if (ownerPhone) {
      const emoji = route === 'connect' ? '📞' : route === 'decline' ? '🚫' : '📋';
      sendSMS(ownerPhone, `${emoji} Incoming call\n${callerName} (${callerNumber})\n${summary}\nAction: ${route}`)
        .catch(e => console.error('Voice SMS notify failed:', e.message));
    }

    if (route === 'decline') {
      res.send(twimlVoice(
        say("Thanks for calling MG Realty. We're not able to help with that, but we wish you a great day. Goodbye!")
      ));
      return;
    }

    if (route === 'connect' && ownerPhone) {
      res.send(twimlVoice(`
        ${say(`Thanks ${callerName}. One moment while I connect you with Matt.`)}
        <Play>https://demo.twilio.com/docs/classic.mp3</Play>
        <Dial callerId="${twilioFrom}" action="/voice/dial-status" timeout="20">
          <Number>${ownerPhone}</Number>
        </Dial>
        ${say("Matt's unavailable right now. Please leave a message after the tone and he'll call you back shortly.")}
        <Record maxLength="90" action="/voice/message" transcribe="true" transcribeCallback="/voice/transcription"/>
      `));
      return;
    }

    // Default: take a message
    res.send(twimlVoice(`
      ${say(`Thanks ${callerName}. Matt's with a client right now. Please leave a message after the tone and he'll get back to you shortly.`)}
      <Record maxLength="90" action="/voice/message" transcribe="true" transcribeCallback="/voice/transcription"/>
    `));

  } catch(e) {
    console.error('VOICE SCREEN ERROR:', e.message);
    res.send(twimlVoice(`
      ${say("Thanks for calling MG Realty. Please leave a message after the tone.")}
      <Record maxLength="90" action="/voice/message" transcribe="true" transcribeCallback="/voice/transcription"/>
    `));
  }
});

// Step 3: After recording — confirm and hang up
app.post('/voice/message', (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.send(twimlVoice(
    say("Got it — Matt will receive your message and get back to you soon. Have a great day!")
  ));
});

// Step 4: Transcription callback — SMS Matt the voicemail text
app.post('/voice/transcription', async (req, res) => {
  res.sendStatus(200);
  const text = req.body.TranscriptionText || '';
  const from = req.body.From || 'Unknown';
  const ownerPhone = process.env.OWNER_PHONE;
  if (text && ownerPhone) {
    sendSMS(ownerPhone, `🎙 Voicemail from ${from}:\n"${text}"`)
      .catch(e => console.error('Voicemail SMS failed:', e.message));
  }
});

// Dial status — if Matt didn't answer, message already recorded via fallback
app.post('/voice/dial-status', (req, res) => {
  res.set('Content-Type', 'text/xml');
  const status = req.body.DialCallStatus;
  if (status === 'completed') {
    res.send(twimlVoice(say("Thank you for calling MG Realty. Have a great day!")));
  } else {
    res.send(twimlVoice(`
      ${say("Matt stepped away. Please leave a message after the tone and he'll call you back shortly.")}
      <Record maxLength="90" action="/voice/message" transcribe="true" transcribeCallback="/voice/transcription"/>
    `));
  }
});

// ── Twilio SMS webhook ────────────────────────────────────────
app.post('/sms', async (req, res) => {
  const twiml = msg => {
    const safe = msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  };
  try {
    const inboundMsg = (req.body.Body || '').trim();
    const from = req.body.From || '';
    console.log(`SMS from ${from}: ${inboundMsg}`);

    // Load live CRM data
    const crm = await readCRM();
    const now2 = new Date();
    const today2 = now2.toISOString().split('T')[0];

    const leadSummary = crm.leads.map(l => ({
      name: `${l.first} ${l.last}`,
      phone: l.phone || '',
      email: l.email || '',
      temp: l.temp,
      stage: l.stage || 'new',
      followup: l.followup || '',
      method: l.method || '',
      lastContact: l.lastcontact || '',
      overdue: !!(l.followup && l.followup < today2 && l.temp !== 'done'),
      notes: (l.notes || '').substring(0, 120),
      prop: l.prop || ''
    }));

    const recentActs = crm.activities
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
      .map(a => ({ lead: a.leadName, type: a.type, outcome: a.outcome, date: a.date, notes: a.notes }));

    const upcomingAppts = crm.appointments
      .filter(a => a.date >= today2 && a.status !== 'cancelled')
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5)
      .map(a => ({ lead: a.leadName, type: a.type, date: a.date, time: a.time, address: a.address }));

    const openTasks = crm.tasks
      .filter(t => t.status !== 'done')
      .sort((a, b) => (a.due || '').localeCompare(b.due || ''))
      .slice(0, 5)
      .map(t => ({ title: t.title, lead: t.leadName, due: t.due }));

    const systemPrompt = `You are Matt Golden's AI assistant for MG Realty in Los Angeles. Matt texts you to manage his real estate business — you're his right hand.

TODAY: ${today2} (${now2.toLocaleDateString('en-US', { weekday: 'long' })})

=== LEADS (${crm.leads.filter(l => l.temp !== 'done').length} active) ===
${JSON.stringify(leadSummary)}

=== RECENT ACTIVITY ===
${JSON.stringify(recentActs)}

=== UPCOMING APPOINTMENTS ===
${JSON.stringify(upcomingAppts)}

=== OPEN TASKS ===
${JSON.stringify(openTasks)}

=== YOUR CAPABILITIES ===
You can do anything Matt asks. Always pick the right action:

- Log activity: {"action":"log_activity","lead":"Name","type":"call|text|email|showing|offer","outcome":"...","notes":"...","followupDate":"YYYY-MM-DD","followupMethod":"call|text|email"}
- Update stage: {"action":"update_stage","lead":"Name","stage":"new|contacted|showing|offer|closed"}
- Update temp: {"action":"update_temp","lead":"Name","temp":"hot|warm|cold|done"}
- Set follow-up: {"action":"update_followup","lead":"Name","date":"YYYY-MM-DD","method":"call|text|email"}
- Add note: {"action":"add_note","lead":"Name","note":"..."}
- Add new lead: {"action":"add_lead","first":"...","last":"...","phone":"...","email":"...","temp":"warm","source":"...","notes":"..."}
- Create task: {"action":"create_task","title":"...","leadName":"...","due":"YYYY-MM-DD","notes":"..."}
- Schedule appointment (CRM only): {"action":"create_appointment","leadName":"...","type":"showing|call|meeting|offer","date":"YYYY-MM-DD","time":"HH:MM","address":"..."}
- Schedule on Google Calendar: {"action":"create_calendar_event","title":"...","start":"YYYY-MM-DDTHH:MM:SS","end":"YYYY-MM-DDTHH:MM:SS","location":"...","description":"...","leadName":"...","apptType":"showing"}
- Send email to lead: {"action":"send_email_template","leadName":"...","email":"...","subject":"...","body":"..."}
- Send digest email: {"action":"send_digest"}
- No action needed: {"action":"none"}

=== RESPONSE RULES ===
1. First line: JSON action (always required, even if {"action":"none"})
2. Remaining lines: your conversational reply to Matt
3. Be direct and brief — Matt is busy. Under 300 chars for routine tasks, more detail only when he asks.
4. For questions about leads/pipeline, give real answers from the data above.
5. If a lead name is ambiguous, ask which one.
6. Always confirm what you did.
7. Don't use command syntax — talk naturally.`;

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: inboundMsg }],
    });

    const raw = result.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    let reply = raw;
    try {
      const jsonLine = lines.find(l => l.startsWith('{'));
      if (jsonLine) {
        const action = JSON.parse(jsonLine);
        console.log('SMS action:', JSON.stringify(action));
        reply = lines.filter(l => !l.startsWith('{')).join('\n').trim() || raw;

        if (action.action === 'send_digest') {
          const overdue = crm.leads.filter(l => l.temp !== 'done' && l.followup && l.followup < today2);
          const dueToday = crm.leads.filter(l => l.temp !== 'done' && l.followup === today2);
          await resend.emails.send({
            from: 'MG Realty <onboarding@resend.dev>',
            to: 'goldenmb@gmail.com',
            subject: `🏡 MG Realty Digest — ${new Date().toLocaleDateString()}`,
            html: `<p>Overdue: ${overdue.map(l=>`${l.first} ${l.last}`).join(', ')||'none'}</p><p>Due today: ${dueToday.map(l=>`${l.first} ${l.last}`).join(', ')||'none'}</p>`
          });
          reply = `Digest sent — ${overdue.length} overdue, ${dueToday.length} due today.`;
        } else if (action.action !== 'none') {
          const ok = await executeSmsAction(action, crm);
          if (!ok && action.lead) reply = `Couldn't find "${action.lead}" — check the name and try again.`;
        }
      }
    } catch(e) {
      console.error('SMS action parse error:', e.message, '\nRaw:', raw);
    }

    if (reply.length > 320) reply = reply.substring(0, 317) + '…';
    res.set('Content-Type', 'text/xml');
    res.send(twiml(reply));
  } catch (e) {
    console.error('SMS ERROR:', e.message);
    res.set('Content-Type', 'text/xml');
    res.send(twiml('Error: ' + e.message));
  }
});

// ── Instagram Content Engine ──────────────────────────────────
app.post('/api/generate-content', async (req, res) => {
  try {
    const { contentType, address, price, beds, baths, sqft, features, notes, tone = 'casual' } = req.body;

    const typeLabels = {
      new_listing:  'New Listing',
      price_drop:   'Price Drop / Price Reduction',
      open_house:   'Open House Announcement',
      just_sold:    'Just Sold',
      neighborhood: 'Neighborhood Spotlight',
      testimonial:  'Client Testimonial',
      market_tip:   'LA Market Tip',
      buyer_tip:    'Buyer Tip',
      seller_tip:   'Seller Tip',
    };

    const toneGuide = tone === 'professional'
      ? 'Tone: Professional and polished. Confident, articulate, no slang — elevated but still warm and approachable.'
      : 'Tone: Casual and direct. How Matt would actually talk on camera — natural, real-talk energy, no corporate speak.';

    const listingContext = address ? `
Property details:
- Address/Area: ${address}
- Price: ${price || 'Contact for price'}
- Beds/Baths: ${beds || '?'}
- Sqft: ${sqft || 'N/A'}
- Key features/angle: ${features || 'N/A'}
- Additional notes: ${notes || 'N/A'}
` : `Additional context: ${notes || 'General real estate content for LA market'}`;

    const prompt = `You are a real estate social media expert for MG Realty, a boutique real estate business in Los Angeles run by Matt Golden. He helps buyers and sellers of single-family homes and income properties in the LA area.

${toneGuide}

Generate Instagram content for a "${typeLabels[contentType] || contentType}" post.
${listingContext}

Return a JSON object with exactly these three keys:
{
  "caption": "Full Instagram caption, 150-220 words. Start with a hook (no generic openers). Use line breaks for readability. Include a clear CTA at the end (DM, link in bio, or call). Sign off as Matt Golden · MG Realty. Use 2-3 relevant emojis naturally placed, not spammy.",
  "reelsScript": "A Reels/TikTok script, 45-60 seconds spoken. Format as: [HOOK] (first 3 seconds to stop the scroll), [BODY] (main content, 3-4 punchy points), [CTA] (last 5 seconds). Write it as natural spoken words Matt would say on camera. No stage directions, just the words.",
  "hashtags": "30 relevant hashtags as a single string separated by spaces. Mix: broad real estate tags, LA-specific tags, niche buyer/seller tags, and 2-3 unique MG Realty brand tags. No # symbol, just the words separated by spaces."
}

Return only valid JSON, no markdown code blocks, no extra text.`;

    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    let result;
    try {
      result = JSON.parse(raw);
    } catch (e) {
      // Try to extract JSON if wrapped in markdown
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
      else throw new Error('Claude returned non-JSON: ' + raw.substring(0, 200));
    }

    console.log(`Content generated: ${contentType}${address ? ' · ' + address : ''}`);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('CONTENT ENGINE ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AI Lead Prioritizer ───────────────────────────────────────
app.post('/api/prioritize-leads', async (req, res) => {
  try {
    const { leads } = req.body;
    if (!leads || !leads.length) return res.json({ ok: true, prioritized: [] });

    const today = new Date().toISOString().split('T')[0];
    const active = leads
      .filter(l => l.temp !== 'done')
      .slice(0, 40); // cap to keep prompt manageable

    if (!active.length) return res.json({ ok: true, prioritized: [] });

    const leadSummaries = active.map(l => ({
      id: l.id,
      name: `${l.first || ''} ${l.last || ''}`.trim(),
      temp: l.temp || 'cold',
      type: l.type || 'Buyer',
      stage: l.stage || 'New',
      followup: l.followup || null,
      lastContact: l.lastContact || null,
      notes: (l.notes || '').substring(0, 120),
      phone: l.phone || null,
    }));

    const prompt = `You are a real estate sales coach for MG Realty in Los Angeles. Today is ${today}.

Here are Matt's active leads (JSON):
${JSON.stringify(leadSummaries, null, 2)}

Your job: Pick the top 6 leads Matt should call or text TODAY. Prioritize by:
1. Overdue follow-ups (followup date before today)
2. Hot temperature
3. Active pipeline stages (Offer, Showing — close to closing)
4. Leads with no recent contact
5. Warm leads with upcoming follow-up dates

Ignore any lead with temp "done".

Return ONLY a valid JSON array (no markdown, no explanation) with exactly this shape:
[{"id":"<lead_id>","reason":"<1 short sentence, max 10 words, why call them today>"},...]

Return 6 leads maximum. If fewer than 6 active leads exist, return all of them.`;

    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    let prioritized;
    try {
      prioritized = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) prioritized = JSON.parse(match[0]);
      else throw new Error('AI returned non-JSON: ' + raw.substring(0, 200));
    }

    res.json({ ok: true, prioritized });
  } catch (e) {
    console.error('PRIORITIZE ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MG Realty backend running on port ${PORT}`));
