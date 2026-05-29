import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { GoogleAuth } from 'google-auth-library';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: '*' }));
app.options('*', cors({ origin: '*' }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
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
    sequences:    row.sequences    || [],
    leases:       row.leases       || []
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
let cachedTokenCompass = null;
let tokenExpiryCompass = 0;

async function refreshGoogleToken(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token'
    })
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  return { token: data.access_token, expiry: Date.now() + (data.expires_in || 3600) * 1000 };
}

// Encode email subject for RFC 2047 (handles emojis, em dash, etc.)
function encodeSubject(str) {
  return `=?UTF-8?B?${Buffer.from(str).toString('base64')}?=`;
}

async function googleToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const { token, expiry } = await refreshGoogleToken(process.env.GOOGLE_REFRESH_TOKEN);
  cachedToken = token; tokenExpiry = expiry;
  console.log('Google token refreshed');
  return cachedToken;
}

async function googleTokenCompass() {
  if (!process.env.GOOGLE_REFRESH_TOKEN_COMPASS) return null;
  if (cachedTokenCompass && Date.now() < tokenExpiryCompass - 60000) return cachedTokenCompass;
  const { token, expiry } = await refreshGoogleToken(process.env.GOOGLE_REFRESH_TOKEN_COMPASS);
  cachedTokenCompass = token; tokenExpiryCompass = expiry;
  console.log('Compass token refreshed');
  return cachedTokenCompass;
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

// ── Google OAuth re-authorization ─────────────────────────────
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
].join(' ');

app.get('/auth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `https://mg-realty-backend.onrender.com/auth/google/callback`,
    response_type: 'code',
    scope:         GOOGLE_SCOPES,
    access_type:   'offline',
    prompt:        'consent',  // force consent screen to get refresh token
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send(`<h2>Auth error: ${error}</h2>`);
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  `https://mg-realty-backend.onrender.com/auth/google/callback`,
        grant_type:    'authorization_code',
      })
    });
    const data = await r.json();
    if (!data.refresh_token) {
      return res.send(`<h2 style="color:red">No refresh token returned.</h2><pre>${JSON.stringify(data,null,2)}</pre><p>Make sure you included <code>prompt=consent</code> and try again.</p>`);
    }
    console.log('NEW REFRESH TOKEN:', data.refresh_token);
    res.send(`
      <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:60px auto;padding:20px">
        <h2 style="color:#27ae60">✅ Authorization successful!</h2>
        <p>Copy this refresh token and paste it into Render as <strong>GOOGLE_REFRESH_TOKEN</strong>:</p>
        <textarea style="width:100%;height:80px;font-family:monospace;font-size:13px;padding:10px;border:2px solid #27ae60;border-radius:6px">${data.refresh_token}</textarea>
        <p style="margin-top:16px;color:#666;font-size:13px">
          1. Go to <a href="https://render.com" target="_blank">render.com</a> → your service → Environment<br>
          2. Update <strong>GOOGLE_REFRESH_TOKEN</strong> with the value above<br>
          3. Save — Render redeploys automatically
        </p>
      </body></html>
    `);
  } catch(e) {
    res.send(`<h2 style="color:red">Error: ${e.message}</h2>`);
  }
});

// Compass account auth flow (separate redirect URI)
app.get('/auth/google/compass', (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `https://mg-realty-backend.onrender.com/auth/google/compass/callback`,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/gmail.modify',
    access_type:   'offline',
    prompt:        'consent',
    login_hint:    'matthewgolden@compass.com',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/compass/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send(`<h2>Auth error: ${error}</h2>`);
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  `https://mg-realty-backend.onrender.com/auth/google/compass/callback`,
        grant_type:    'authorization_code',
      })
    });
    const data = await r.json();
    if (!data.refresh_token) {
      return res.send(`<h2 style="color:red">No refresh token returned.</h2><pre>${JSON.stringify(data,null,2)}</pre>`);
    }
    res.send(`
      <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:60px auto;padding:20px">
        <h2 style="color:#27ae60">✅ Compass account authorized!</h2>
        <p>Copy this and add it to Render as <strong>GOOGLE_REFRESH_TOKEN_COMPASS</strong>:</p>
        <textarea style="width:100%;height:80px;font-family:monospace;font-size:13px;padding:10px;border:2px solid #27ae60;border-radius:6px">${data.refresh_token}</textarea>
        <p style="margin-top:16px;color:#666;font-size:13px">
          1. Go to <a href="https://render.com" target="_blank">render.com</a> → your service → Environment<br>
          2. Add new variable: <strong>GOOGLE_REFRESH_TOKEN_COMPASS</strong><br>
          3. Save — Render redeploys automatically
        </p>
      </body></html>
    `);
  } catch(e) {
    res.send(`<h2 style="color:red">Error: ${e.message}</h2>`);
  }
});

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
// ── Google Calendar — direct REST API ────────────────────────
const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';
const GCAL_ID   = 'primary';

app.post('/calendar/create', async (req, res) => {
  try {
    const { title, start, end, location, description, apptId } = req.body;
    const token = await googleToken();

    // Build ISO8601 with LA timezone offset
    const toCalDT = (dt) => {
      // dt is like "2026-05-28T14:00:00" (no tz) — treat as LA time
      if (dt.includes('Z') || dt.includes('+')) return { dateTime: dt };
      return { dateTime: dt, timeZone: 'America/Los_Angeles' };
    };

    const event = {
      summary: title,
      location: location || '',
      description: (description || '') + (apptId ? `\n\n[mgr_appt_id:${apptId}]` : ''),
      start: toCalDT(start),
      end:   toCalDT(end),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'email', minutes: 60 }
        ]
      },
      colorId: '11' // tomato red — stands out
    };

    const r = await fetch(`${GCAL_BASE}/calendars/${GCAL_ID}/events`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data));

    console.log(`Calendar event created: ${title} (${data.id})`);
    res.json({ ok: true, eventId: data.id, htmlLink: data.htmlLink });
  } catch (e) {
    console.error('CALENDAR CREATE ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// List upcoming events (next 14 days)
app.get('/calendar/list', async (req, res) => {
  try {
    const token = await googleToken();
    const days  = parseInt(req.query.days) || 14;
    const now   = new Date();
    const later = new Date(now); later.setDate(later.getDate() + days);

    const params = new URLSearchParams({
      timeMin:      now.toISOString(),
      timeMax:      later.toISOString(),
      singleEvents: 'true',
      orderBy:      'startTime',
      maxResults:   '50',
      timeZone:     'America/Los_Angeles'
    });

    const r = await fetch(`${GCAL_BASE}/calendars/${GCAL_ID}/events?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data));

    const events = (data.items || []).map(e => ({
      id:          e.id,
      title:       e.summary || '(no title)',
      start:       e.start?.dateTime || e.start?.date,
      end:         e.end?.dateTime   || e.end?.date,
      location:    e.location || '',
      description: e.description || '',
      htmlLink:    e.htmlLink || '',
      allDay:      !!e.start?.date
    }));

    res.json({ ok: true, events });
  } catch (e) {
    console.error('CALENDAR LIST ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Delete a calendar event
app.delete('/calendar/event/:eventId', async (req, res) => {
  try {
    const token = await googleToken();
    const r = await fetch(`${GCAL_BASE}/calendars/${GCAL_ID}/events/${req.params.eventId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok && r.status !== 404 && r.status !== 410) {
      const data = await r.json().catch(()=>({}));
      throw new Error(data.error?.message || `HTTP ${r.status}`);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('CALENDAR DELETE ERROR:', e.message);
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
    const { to, subject, html, from = 'personal' } = req.body;
    if (!to) throw new Error('No recipient email address');

    const fromAddress = from === 'compass'
      ? 'Matt Golden | MG Realty <matthewgolden@compass.com>'
      : 'Matt Golden | MG Realty <goldenmb@gmail.com>';

    // Build RFC 2822 raw email message
    const boundary = `boundary_${Date.now()}`;
    const rawMessage = [
      `From: ${fromAddress}`,
      `To: ${to}`,
      `Subject: ${encodeSubject(subject || '(no subject)')}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      html || '',
    ].join('\r\n');

    // Base64url encode for Gmail API
    const encoded = Buffer.from(rawMessage).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const token = await googleToken();
    const gmailRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded })
      }
    );
    const gmailData = await gmailRes.json();
    if (gmailData.error) throw new Error('Gmail API: ' + gmailData.error.message);

    console.log(`Email sent via Gmail API from ${from} to ${to}`);
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

    const postCloseSent = await processPostCloseEmails(crm, today);
    const leaseSent = await processLeaseReminders(crm, today);
    await writeCRM(crm);
    res.json({ ok: true, sent: sent + postCloseSent + leaseSent, followUp: sent, postClose: postCloseSent, leaseReminders: leaseSent });
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

// ── Post-Close Check-in Sequences ────────────────────────────
const POST_CLOSE_TOUCHES = [
  { day: 30, key: 'pc_30', label: '30-Day Check-in' },
  { day: 60, key: 'pc_60', label: '60-Day Market Update' },
  { day: 90, key: 'pc_90', label: '90-Day Referral Ask' },
];

async function generatePostCloseEmail(touchKey, lead) {
  const name = lead.first || lead.name?.split(' ')[0] || 'there';
  const prop = lead.prop || lead.address || 'your new home';
  const hood = lead.neighborhood || 'your neighborhood';

  const prompts = {
    pc_30: `Write a warm, casual 3-sentence check-in email from real estate agent Matt Golden to client ${name} who closed on ${prop} about 30 days ago. Ask how they're settling in, mention you loved working with them, and subtly open the door for referrals without being pushy. Sign off as Matt. No subject line, just the email body in plain HTML paragraphs.`,
    pc_60: `Write a value-add 3-sentence email from Matt Golden (LA real estate agent) to past client ${name} who bought/sold ${prop} 60 days ago. Share that you've been watching ${hood} and wanted to give them a quick market pulse. Keep it conversational and end with an offer to chat. No subject line, just HTML paragraphs.`,
    pc_90: `Write a friendly 3-sentence email from Matt Golden (LA real estate agent) to past client ${name} who closed on ${prop} 90 days ago. Congratulate them on 3 months in their new situation, ask if they know anyone who could use help buying or selling in LA, and make it feel natural not salesy. No subject line, just HTML paragraphs.`
  };

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompts[touchKey] }]
  });
  return msg.content[0].text.trim();
}

app.post('/api/post-close/start', async (req, res) => {
  try {
    const { leadId } = req.body;
    const crm = await readCRM();
    const lead = crm.leads.find(l => l.id === leadId);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
    if (!lead.email) return res.status(400).json({ ok: false, error: 'Lead has no email — add one first' });

    // Cancel any existing post-close sequence for this lead
    crm.sequences = (crm.sequences || []).map(s =>
      s.leadId === leadId && s.type === 'post_close' && s.status === 'active'
        ? { ...s, status: 'cancelled' }
        : s
    );

    const startDate = new Date();
    const seq = {
      id: 'pc_' + Date.now(),
      type: 'post_close',
      leadId,
      leadName: `${lead.first} ${lead.last}`,
      leadEmail: lead.email,
      property: lead.prop || '',
      neighborhood: lead.neighborhood || '',
      startedAt: startDate.toISOString().split('T')[0],
      status: 'active',
      touches: POST_CLOSE_TOUCHES.map(t => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + t.day);
        return { day: t.day, key: t.key, label: t.label, scheduledDate: d.toISOString().split('T')[0], sent: false };
      })
    };

    crm.sequences.push(seq);
    await writeCRM(crm);
    console.log(`Post-close sequence started for ${lead.first} ${lead.last}`);
    res.json({ ok: true, sequenceId: seq.id });
  } catch(e) {
    console.error('post-close start error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/post-close/cancel', async (req, res) => {
  try {
    const { leadId } = req.body;
    const crm = await readCRM();
    crm.sequences = (crm.sequences || []).map(s =>
      s.leadId === leadId && s.type === 'post_close' && s.status === 'active'
        ? { ...s, status: 'cancelled' } : s
    );
    await writeCRM(crm);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/post-close/active', async (req, res) => {
  try {
    const crm = await readCRM();
    const active = (crm.sequences || [])
      .filter(s => s.type === 'post_close' && s.status === 'active')
      .map(s => ({
        id: s.id, leadId: s.leadId, leadName: s.leadName,
        property: s.property, startedAt: s.startedAt,
        nextTouch: s.touches.find(t => !t.sent) || null,
        sentCount: s.touches.filter(t => t.sent).length,
        totalTouches: s.touches.length
      }))
      .sort((a, b) => (a.nextTouch?.scheduledDate || '') < (b.nextTouch?.scheduledDate || '') ? -1 : 1);
    res.json({ ok: true, sequences: active });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Hook post-close sending into the existing /sequences/process scheduler
// This runs daily alongside regular follow-up sequences
async function processPostCloseEmails(crm, today) {
  let sent = 0;
  for (const seq of (crm.sequences || [])) {
    if (seq.type !== 'post_close' || seq.status !== 'active') continue;
    for (const touch of seq.touches) {
      if (touch.sent || touch.scheduledDate > today) continue;
      try {
        const lead = crm.leads.find(l => l.id === seq.leadId) || {
          first: seq.leadName.split(' ')[0], last: seq.leadName.split(' ')[1] || '',
          prop: seq.property, neighborhood: seq.neighborhood
        };
        const bodyHtml = await generatePostCloseEmail(touch.key, lead);
        const subjects = {
          pc_30: `Checking in — how's ${seq.property || 'the new place'}?`,
          pc_60: `Quick market update for ${seq.neighborhood || 'your area'}`,
          pc_90: `3 months in — congrats! 🏡`
        };
        const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1A1914;padding:20px 24px;border-radius:8px 8px 0 0;text-align:center">
            <img src="https://mgr-eng.github.io/mg-realty-backend/mg-logo.jpg" alt="MG Realty" style="max-height:56px;object-fit:contain;display:block;margin:0 auto">
          </div>
          <div style="padding:28px;background:#fff;border:1px solid #eee;border-radius:0 0 8px 8px">
            ${bodyHtml}
            <p style="margin-top:28px;color:#333;font-size:13px">— Matt Golden<br>
            <span style="color:#888">MG Realty · Los Angeles · (323) 555-0100<br>goldenmb@gmail.com · DRE #02130422</span></p>
          </div>
        </div>`;

        const { error } = await resend.emails.send({
          from: 'Matt Golden <onboarding@resend.dev>',
          to: seq.leadEmail,
          subject: encodeSubject(subjects[touch.key] || touch.label),
          html
        });

        if (!error) {
          touch.sent = true;
          touch.sentAt = today;
          sent++;
          console.log(`Post-close email sent: ${touch.key} → ${seq.leadEmail}`);
          // Notify Matt
          try {
            const token = await googleToken();
            const notifSubject = encodeSubject(`📬 Post-close sent: ${touch.label} → ${seq.leadName}`);
            const raw = Buffer.from(
              `From: MG Realty CRM <goldenmb@gmail.com>\r\nTo: goldenmb@gmail.com\r\nSubject: ${notifSubject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nAuto-sent "${touch.label}" to ${seq.leadName} (${seq.leadEmail}) re: ${seq.property || 'their property'}.\n\n— MG Realty CRM`
            ).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
            await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
              method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw })
            });
          } catch(e) { console.error('Post-close notify failed:', e.message); }
        }
      } catch(e) {
        console.error(`Post-close email failed (${touch.key}):`, e.message);
      }
    }
    if (seq.touches.every(t => t.sent)) seq.status = 'completed';
  }
  return sent;
}

// ── Static page routes ────────────────────────────────────────
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));
app.get('/open-house', (req, res) => res.sendFile(path.join(__dirname, 'public', 'open-house-sign.html')));
app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal.html')));

// ── Client Portal: OTP + data ────────────────────────────────
const portalOTPs   = new Map(); // phone → { code, expires, leadId }
const portalTokens = new Map(); // token → { leadId, expires }

app.post('/portal/request-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok: false, error: 'Phone required' });
    const crm = await readCRM();
    const normalised = phone.replace(/\D/g, '');
    const lead = crm.leads.find(l => l.phone && l.phone.replace(/\D/g, '') === normalised);
    if (!lead) return res.json({ ok: false, error: 'No client record found for that number. Contact Matt directly.' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    portalOTPs.set(normalised, { code, expires: Date.now() + 10 * 60 * 1000, leadId: lead.id });
    await sendSMS(phone, `Your MG Realty portal code is: ${code}\n\nExpires in 10 minutes.`);
    res.json({ ok: true });
  } catch(e) {
    console.error('PORTAL OTP ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/portal/verify', async (req, res) => {
  try {
    const { phone, code } = req.body;
    const normalised = phone.replace(/\D/g, '');
    const entry = portalOTPs.get(normalised);
    if (!entry || Date.now() > entry.expires) return res.json({ ok: false, error: 'Code expired. Request a new one.' });
    if (entry.code !== code.trim()) return res.json({ ok: false, error: 'Incorrect code.' });
    portalOTPs.delete(normalised);
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    portalTokens.set(token, { leadId: entry.leadId, expires: Date.now() + 24 * 60 * 60 * 1000 });
    res.json({ ok: true, token });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/portal/data', async (req, res) => {
  try {
    const { token } = req.query;
    const session = portalTokens.get(token);
    if (!session || Date.now() > session.expires) return res.status(401).json({ ok: false, error: 'Session expired. Please log in again.' });
    const crm = await readCRM();
    const lead = crm.leads.find(l => l.id === session.leadId);
    if (!lead) return res.status(404).json({ ok: false, error: 'Record not found.' });
    const activities = (crm.activities || []).filter(a => a.leadId === lead.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
    const appointments = (crm.appointments || []).filter(a => a.leadId === lead.id);
    const deals = (crm.deals || []).filter(d => d.leadId === lead.id);
    // Scrub internal-only fields
    const { notes, temp, stage, source, ...publicLead } = lead;
    res.json({ ok: true, lead: { ...publicLead, stage, notes }, activities, appointments, deals });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Instagram Bio Link Page ───────────────────────────────────
app.get('/link', async (req, res) => {
  let properties = [];
  try {
    const crm = await readCRM();
    properties = (crm.properties || [])
      .filter(p => p.status === 'active' || p.status === 'Active' || !p.status)
      .slice(0, 4);
  } catch(e) { /* serve page even if CRM fails */ }

  const formatPrice = p => {
    if (!p) return '';
    const n = parseFloat(String(p).replace(/[^0-9.]/g, ''));
    if (!n) return p;
    return n >= 1000000 ? `$${(n/1000000).toFixed(2)}M` : `$${Math.round(n/1000)}K`;
  };


  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>Matt Golden · MG Realty · Los Angeles</title>
<meta name="description" content="LA real estate with Matt Golden. Helping buyers and sellers find the best move in Los Angeles.">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{--gold:#C8973A;--gold-lt:#F5C97A;--dark:#0D0D0D;--surface:#1A1A1A;--surface2:#242424;--border:#2E2E2E;--text:#F5F5F5;--text2:#A8A8A8;--text3:#6B6B6B;--r:10px;--rl:14px}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--dark);color:var(--text);min-height:100vh;padding-bottom:40px}
  a{color:inherit;text-decoration:none}

  /* Header */
  .header{padding:36px 24px 28px;text-align:center;position:relative}
  .header::after{content:'';display:block;height:1px;background:linear-gradient(90deg,transparent,var(--border),transparent);margin-top:28px}
  .avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--gold),#8B6520);margin:0 auto 14px;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#fff;border:2px solid var(--gold)}
  .name{font-size:22px;font-weight:700;letter-spacing:-0.02em;margin-bottom:4px}
  .title{font-size:13px;color:var(--text2);font-weight:500;margin-bottom:6px}
  .location{font-size:12px;color:var(--text3);display:flex;align-items:center;justify-content:center;gap:4px}

  /* Social proof */
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);margin:24px 20px;border-radius:var(--rl);overflow:hidden}
  .stat{background:var(--surface);padding:16px 8px;text-align:center}
  .stat-val{font-size:20px;font-weight:800;color:var(--gold);letter-spacing:-0.02em}
  .stat-label{font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-top:3px}

  /* About */
  .about{margin:0 20px 24px;background:var(--surface);border:1px solid var(--border);border-radius:var(--rl);padding:18px}
  .about-text{font-size:14px;line-height:1.65;color:var(--text2)}
  .about-text strong{color:var(--text)}

  /* Compass button */
  .compass-btn{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 20px 24px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--rl);font-size:14px;font-weight:600;color:var(--text);text-decoration:none;transition:border-color 0.15s,background 0.15s}
  .compass-btn:active{background:var(--surface2)}
  .compass-btn svg{flex-shrink:0}

  /* Form */
  .form-wrap{margin:0 20px;background:var(--surface);border:1px solid var(--border);border-radius:var(--rl);overflow:hidden}
  .form-hd{background:linear-gradient(135deg,var(--gold),#8B6520);padding:18px 20px}
  .form-hd-title{font-size:16px;font-weight:700;color:#fff;margin-bottom:3px}
  .form-hd-sub{font-size:12px;color:rgba(255,255,255,0.75)}
  .form-body{padding:20px}
  .form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
  .form-row.full{grid-template-columns:1fr}
  .form-group{display:flex;flex-direction:column;gap:5px}
  label{font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em}
  input,select,textarea{background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:inherit;font-size:14px;padding:11px 13px;width:100%;outline:none;-webkit-appearance:none;transition:border-color 0.15s}
  input:focus,select:focus,textarea:focus{border-color:var(--gold)}
  input::placeholder{color:var(--text3)}
  select option{background:var(--surface2)}
  textarea{resize:none;height:72px;line-height:1.5}
  .submit-btn{width:100%;margin-top:14px;padding:15px;background:linear-gradient(135deg,var(--gold),#8B6520);border:none;border-radius:var(--r);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.01em;transition:opacity 0.15s}
  .submit-btn:active{opacity:0.85}
  .submit-btn:disabled{opacity:0.6;cursor:not-allowed}
  .success-msg{display:none;text-align:center;padding:28px 20px}
  .success-icon{font-size:44px;margin-bottom:12px}
  .success-title{font-size:18px;font-weight:700;margin-bottom:6px;color:var(--gold)}
  .success-sub{font-size:13px;color:var(--text2);line-height:1.6}

  /* Tour button */
  .tour-btn{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 20px 24px;padding:16px;background:linear-gradient(135deg,var(--gold),#8B6520);border-radius:var(--rl);font-size:15px;font-weight:700;color:#fff;cursor:pointer;border:none;width:calc(100% - 40px);font-family:inherit;letter-spacing:0.01em;transition:opacity 0.15s}
  .tour-btn:active{opacity:0.85}

  /* Tour modal */
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:100;display:flex;align-items:flex-end;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.2s}
  .modal-overlay.open{opacity:1;pointer-events:all}
  .modal-sheet{background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:540px;max-height:90vh;overflow-y:auto;transform:translateY(100%);transition:transform 0.3s cubic-bezier(.4,0,.2,1);padding-bottom:env(safe-area-inset-bottom)}
  .modal-overlay.open .modal-sheet{transform:translateY(0)}
  .modal-hd{background:linear-gradient(135deg,var(--gold),#8B6520);padding:20px 20px 18px;border-radius:20px 20px 0 0;position:sticky;top:0}
  .modal-hd-title{font-size:17px;font-weight:700;color:#fff;margin-bottom:2px}
  .modal-hd-sub{font-size:12px;color:rgba(255,255,255,0.75)}
  .modal-close{position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.2);border:none;border-radius:50%;width:28px;height:28px;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit}
  .modal-body{padding:20px}

  /* Footer */
  .footer{text-align:center;margin-top:32px;font-size:11px;color:var(--text3);padding:0 20px}
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div class="avatar">M</div>
  <div class="name">Matt Golden</div>
  <div class="title">Real Estate Agent · MG Realty</div>
  <div class="location">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
    Los Angeles, CA
  </div>
</div>

<!-- Social proof -->
<div class="stats">
  <div class="stat"><div class="stat-val">5+</div><div class="stat-label">Years in LA</div></div>
  <div class="stat"><div class="stat-val">20+</div><div class="stat-label">Deals Closed</div></div>
  <div class="stat"><div class="stat-val">LA</div><div class="stat-label">Based & Local</div></div>
</div>

<!-- About -->
<div class="about">
  <div class="about-text">
    I help <strong>buyers and sellers</strong> navigate the LA market — from first-time buyers to income property investors. My focus is finding you the <strong>best possible situation</strong>, not just any deal. Based in Los Angeles, available 7 days a week.
  </div>
</div>

<!-- Compass listings button -->
<a href="https://www.compass.com/agents/matthew-golden/" target="_blank" class="compass-btn">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
  View My Listings on Compass
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
</a>

<!-- Book a Tour button -->
<button class="tour-btn" onclick="openTourModal()">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  Schedule a Property Tour
</button>

<!-- Tour booking modal -->
<div class="modal-overlay" id="tourModal" onclick="closeTourOnBackdrop(event)">
  <div class="modal-sheet">
    <div class="modal-hd" style="position:relative">
      <div class="modal-hd-title">📅 Schedule a Tour</div>
      <div class="modal-hd-sub">Pick a property, date, and time that works for you</div>
      <button class="modal-close" onclick="closeTourModal()">✕</button>
    </div>
    <div class="modal-body" id="tourFormBody">
      <form id="tourForm" onsubmit="submitTour(event)">
        <div class="form-row">
          <div class="form-group"><label>First name *</label><input type="text" name="first" placeholder="Jane" required></div>
          <div class="form-group"><label>Last name</label><input type="text" name="last" placeholder="Smith"></div>
        </div>
        <div class="form-row full">
          <div class="form-group"><label>Phone *</label><input type="tel" name="phone" placeholder="(323) 555-0100" required></div>
        </div>
        <div class="form-row full">
          <div class="form-group"><label>Email</label><input type="email" name="email" placeholder="jane@email.com"></div>
        </div>
        <div class="form-row full">
          <div class="form-group"><label>Property address *</label><input type="text" name="address" placeholder="123 Sunset Blvd, Los Angeles, CA" required></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Preferred date *</label><input type="date" name="date" required></div>
          <div class="form-group"><label>Preferred time *</label><input type="time" name="time" required></div>
        </div>
        <div class="form-row full">
          <div class="form-group"><label>Notes</label><textarea name="notes" placeholder="Anything I should know ahead of time…"></textarea></div>
        </div>
        <button type="submit" class="submit-btn" id="tourSubmitBtn">Book Tour →</button>
      </form>
      <div class="success-msg" id="tourSuccessMsg">
        <div class="success-icon">🗓️</div>
        <div class="success-title">Tour Scheduled!</div>
        <div class="success-sub">I'll confirm via text shortly. See you there!</div>
      </div>
    </div>
  </div>
</div>

<!-- Lead capture form -->
<div class="form-wrap">
  <div class="form-hd">
    <div class="form-hd-title">Let's talk about your move</div>
    <div class="form-hd-sub">I'll reach out within a few hours</div>
  </div>
  <div class="form-body" id="formBody">
    <form id="leadForm" onsubmit="submitForm(event)">
      <div class="form-row">
        <div class="form-group"><label>First name *</label><input type="text" name="first" placeholder="Jane" required></div>
        <div class="form-group"><label>Last name *</label><input type="text" name="last" placeholder="Smith" required></div>
      </div>
      <div class="form-row full">
        <div class="form-group"><label>Phone *</label><input type="tel" name="phone" placeholder="(323) 555-0100" required></div>
      </div>
      <div class="form-row full">
        <div class="form-group"><label>Email</label><input type="email" name="email" placeholder="jane@email.com"></div>
      </div>
      <div class="form-row full">
        <div class="form-group">
          <label>I'm looking to…</label>
          <select name="intent">
            <option value="">Select one</option>
            <option value="buy">Buy a home</option>
            <option value="sell">Sell my home</option>
            <option value="both">Buy and sell</option>
            <option value="invest">Invest in property</option>
            <option value="rent">Find a rental</option>
          </select>
        </div>
      </div>
      <div class="form-row full">
        <div class="form-group">
          <label>Budget range</label>
          <select name="budget">
            <option value="">Not sure yet</option>
            <option value="Under $500K">Under $500K</option>
            <option value="$500K – $800K">$500K – $800K</option>
            <option value="$800K – $1.2M">$800K – $1.2M</option>
            <option value="$1.2M – $2M">$1.2M – $2M</option>
            <option value="$2M+">$2M+</option>
          </select>
        </div>
      </div>
      <div class="form-row full">
        <div class="form-group">
          <label>Neighborhood / area of interest</label>
          <input type="text" name="neighborhood" placeholder="e.g. Silver Lake, Culver City, Venice…">
        </div>
      </div>
      <div class="form-row full">
        <div class="form-group">
          <label>Anything else?</label>
          <textarea name="notes" placeholder="Timeline, questions, specific needs…"></textarea>
        </div>
      </div>
      <button type="submit" class="submit-btn" id="submitBtn">Send Message →</button>
    </form>
    <div class="success-msg" id="successMsg">
      <div class="success-icon">🏡</div>
      <div class="success-title">Got it! I'll be in touch soon.</div>
      <div class="success-sub">Thanks for reaching out. I typically respond within a few hours — talk soon.</div>
    </div>
  </div>
</div>

<div class="footer">Matt Golden · MG Realty · Los Angeles<br>DRE #02130422 · goldenmb@gmail.com</div>

<script>
// Tour modal
function openTourModal() {
  // Set min date to today
  const today = new Date().toISOString().split('T')[0];
  document.querySelector('#tourForm [name="date"]').min = today;
  document.getElementById('tourModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeTourModal() {
  document.getElementById('tourModal').classList.remove('open');
  document.body.style.overflow = '';
}
function closeTourOnBackdrop(e) {
  if (e.target === document.getElementById('tourModal')) closeTourModal();
}
async function submitTour(e) {
  e.preventDefault();
  const btn = document.getElementById('tourSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Booking…';
  const form = e.target;
  const data = {
    first: form.first.value.trim(),
    last: form.last.value.trim(),
    phone: form.phone.value.trim(),
    email: form.email.value.trim(),
    address: form.address.value.trim(),
    date: form.date.value,
    time: form.time.value,
    notes: form.notes.value.trim()
  };
  try {
    const res = await fetch('/api/book-tour', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || 'Something went wrong');
    document.getElementById('tourForm').style.display = 'none';
    document.getElementById('tourSuccessMsg').style.display = 'block';
    document.body.style.overflow = '';
  } catch(err) {
    btn.disabled = false;
    btn.textContent = 'Book Tour →';
    alert('Something went wrong — please try again or text me directly.');
  }
}

async function submitForm(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const form = e.target;
  const data = {
    first: form.first.value.trim(),
    last: form.last.value.trim(),
    phone: form.phone.value.trim(),
    email: form.email.value.trim(),
    intent: form.intent.value,
    budget: form.budget.value,
    neighborhood: form.neighborhood.value.trim(),
    notes: form.notes.value.trim(),
    source: 'Instagram',
    notify: true
  };
  try {
    const res = await fetch('/leads/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || 'Something went wrong');
    document.getElementById('leadForm').style.display = 'none';
    document.getElementById('successMsg').style.display = 'block';
  } catch(err) {
    btn.disabled = false;
    btn.textContent = 'Send Message →';
    alert('Something went wrong — please try again or text me directly.');
  }
}
</script>
</body>
</html>`;

  res.send(html);
});

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

Return a JSON object with exactly these four keys:
{
  "caption": "Full Instagram caption, 150-220 words. Start with a strong hook (no generic openers like 'Exciting news'). Use line breaks for readability. Include a clear CTA at the end (DM, link in bio, or call). Sign off as Matt Golden · MG Realty. Use 2-3 relevant emojis naturally placed, not spammy.",
  "reelsScript": "A Reels/TikTok script, 45-60 seconds spoken. Format as: [HOOK] (first 3 seconds to stop the scroll), [BODY] (main content, 3-4 punchy points), [CTA] (last 5 seconds). Write it as natural spoken words Matt would say on camera. No stage directions, just the words.",
  "hashtags": "30 hashtags as a single space-separated string (no # symbol). Strategic mix for maximum reach.",
  "hashtagGroups": {
    "broad": ["6-7 high-volume real estate hashtags, 1M+ posts each, e.g. realestate realtor homesearch"],
    "local": ["6-7 LA-specific tags that local buyers/sellers actually search, e.g. losangelesrealestate larealestate"],
    "niche": ["6-7 targeted tags for this specific post type/audience, e.g. incomeproperty firsttimebuyer"],
    "brand": ["3-4 MG Realty brand tags, e.g. mgrealty mattgoldenrealtor mgrealtylosangeles"]
  }
}

For hashtagGroups: return actual hashtag strings (no # symbol) in each array, not descriptions. Total across all groups should be ~25-28 tags.

Return only valid JSON, no markdown code blocks, no extra text.`;

    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2500,
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

// ── Gmail Inbox: lead email threads ──────────────────────────
const MATT_EMAILS = ['goldenmb@gmail.com', 'matthewgolden@compass.com'];

const getHeader = (msg, name) => {
  const h = (msg?.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
};
const extractEmail = (str) => {
  const m = (str||'').match(/<([^>]+)>/);
  return m ? m[1].toLowerCase() : (str||'').toLowerCase().trim();
};

async function fetchThreadsForAccount(token, validEmails, accountEmail) {
  const headers = { Authorization: `Bearer ${token}` };
  const orClause = validEmails.map(e => `(from:${e} OR to:${e})`).join(' OR ');
  const q = encodeURIComponent(`(${orClause}) newer_than:60d -in:drafts`);

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${q}&maxResults=20`,
    { headers }
  );
  const listData = await listRes.json();
  if (!listData.threads?.length) return [];

  const threadDetails = await Promise.all(
    listData.threads.slice(0, 15).map(async t => {
      try {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=Subject,From,To,Date`,
          { headers }
        );
        return await r.json();
      } catch(e) { return null; }
    })
  );

  return threadDetails.filter(Boolean).map(thread => {
    const messages = thread.messages || [];
    if (!messages.length) return null;
    const firstMsg = messages[0];
    const lastMsg  = messages[messages.length - 1];
    const subject  = getHeader(firstMsg, 'Subject') || '(no subject)';
    const lastFrom = extractEmail(getHeader(lastMsg, 'From') || '');
    const dateStr  = getHeader(lastMsg, 'Date') || '';
    const isUnread = messages.some(m => (m.labelIds || []).includes('UNREAD'));
    const needsReply = !MATT_EMAILS.includes(lastFrom) && validEmails.some(e => e.toLowerCase() === lastFrom);
    const snippet  = (lastMsg.snippet || '').substring(0, 160);
    const matchedEmail = validEmails.find(e => {
      const from = extractEmail(getHeader(lastMsg, 'From') || '');
      const to   = getHeader(lastMsg, 'To') || '';
      return e.toLowerCase() === from || to.toLowerCase().includes(e.toLowerCase());
    }) || validEmails.find(e =>
      messages.some(m => (getHeader(m, 'From') || '').toLowerCase().includes(e.toLowerCase()))
    ) || '';
    return { threadId: thread.id, subject, snippet, lastFrom, date: dateStr,
             messageCount: messages.length, isUnread, needsReply, leadEmail: matchedEmail,
             account: accountEmail };
  }).filter(Boolean);
}

app.post('/api/inbox', async (req, res) => {
  try {
    const { emails } = req.body;
    if (!emails?.length) return res.json({ ok: true, threads: [] });
    const validEmails = emails.filter(e => e && e.includes('@')).slice(0, 30);
    if (!validEmails.length) return res.json({ ok: true, threads: [] });

    // Fetch from both accounts in parallel
    const promises = [fetchThreadsForAccount(await googleToken(), validEmails, 'goldenmb@gmail.com')];
    const compassToken = await googleTokenCompass().catch(() => null);
    if (compassToken) promises.push(fetchThreadsForAccount(compassToken, validEmails, 'matthewgolden@compass.com'));

    const results = await Promise.allSettled(promises);
    const allThreads = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    // Deduplicate by subject+leadEmail (same conversation may appear in both inboxes)
    const seen = new Set();
    const threads = allThreads
      .filter(t => { const key = `${t.subject}|${t.leadEmail}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => {
        if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1;
        if (a.isUnread   !== b.isUnread)   return a.isUnread   ? -1 : 1;
        return new Date(b.date) - new Date(a.date);
      });

    res.json({ ok: true, threads });
  } catch (e) {
    console.error('INBOX ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SMS Inbox ─────────────────────────────────────────────────
app.get('/api/sms-inbox', async (req, res) => {
  try {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from  = process.env.TWILIO_FROM;
    if (!sid || !token || !from) return res.json({ ok: true, threads: [] });

    const auth = Buffer.from(`${sid}:${token}`).toString('base64');

    // Fetch last 200 messages (inbound + outbound) involving our Twilio number
    const [inRes, outRes] = await Promise.all([
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?To=${encodeURIComponent(from)}&PageSize=100`, { headers: { Authorization: `Basic ${auth}` } }),
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?From=${encodeURIComponent(from)}&PageSize=100`, { headers: { Authorization: `Basic ${auth}` } }),
    ]);
    const [inData, outData] = await Promise.all([inRes.json(), outRes.json()]);

    const allMessages = [
      ...(inData.messages  || []),
      ...(outData.messages || []),
    ].map(m => ({
      sid:       m.sid,
      body:      m.body,
      direction: m.direction, // inbound / outbound-api
      from:      m.from,
      to:        m.to,
      date:      m.date_sent || m.date_created,
      otherParty: m.direction === 'inbound' ? m.from : m.to,
    }));

    // Group by other party number
    const byNumber = {};
    for (const msg of allMessages) {
      const num = msg.otherParty;
      if (!num) continue;
      if (!byNumber[num]) byNumber[num] = [];
      byNumber[num].push(msg);
    }

    // Build threads sorted newest first
    const threads = Object.entries(byNumber).map(([number, msgs]) => {
      const sorted = msgs.sort((a, b) => new Date(a.date) - new Date(b.date));
      const last   = sorted[sorted.length - 1];
      const needsReply = last.direction === 'inbound';
      return {
        number,
        messages: sorted,
        lastMessage:  last.body,
        lastDate:     last.date,
        lastDirection: last.direction,
        needsReply,
        messageCount: sorted.length,
      };
    }).sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));

    res.json({ ok: true, threads });
  } catch (e) {
    console.error('SMS INBOX ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sms-reply', async (req, res) => {
  try {
    const { to, body } = req.body;
    if (!to || !body) return res.status(400).json({ ok: false, error: 'Missing to or body' });
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from  = process.env.TWILIO_FROM;
    const auth  = Buffer.from(`${sid}:${token}`).toString('base64');
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: from, To: to, Body: body })
    });
    const data = await r.json();
    if (data.error_code) throw new Error(data.error_message || 'Twilio error');
    res.json({ ok: true, sid: data.sid });
  } catch (e) {
    console.error('SMS REPLY ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AI Email Draft ────────────────────────────────────────────
app.post('/api/draft-email', async (req, res) => {
  try {
    const { leadName, temp, type, stage, lastActivity, notes, templateType, subject, fromAccount } = req.body;

    const templateGuides = {
      openhouse:  'A warm thank-you for attending the open house. Reference the property if known. Ask if they have questions or want to schedule a follow-up showing.',
      followup:   'A friendly check-in. Keep it short and low pressure. Ask where they are in their search/sale and offer to help.',
      showing:    'Follow up after a showing. Ask for honest feedback on the property. Gauge interest level and next steps.',
      pricedrop:  'Alert about a price reduction on a property they may be interested in. Create urgency without being pushy.',
      listing:    'Request to schedule a listing presentation. Highlight value prop briefly. Suggest a few times to meet.',
      custom:     'A professional, personalized email based on the lead context provided.',
    };

    const guide = templateGuides[templateType] || templateGuides.custom;
    const fromLabel = fromAccount === 'compass' ? 'matthewgolden@compass.com (Compass)' : 'goldenmb@gmail.com (personal)';

    const prompt = `You are Matt Golden, a real estate agent at MG Realty in Los Angeles. Write a personalized email to a lead.

Lead context:
- Name: ${leadName || 'the lead'}
- Temperature: ${temp || 'unknown'}
- Type: ${type || 'Buyer'}
- Pipeline stage: ${stage || 'New'}
- Last activity: ${lastActivity || 'none on record'}
- Notes: ${notes || 'none'}
- Sending from: ${fromLabel}

Email purpose: ${guide}
${subject ? `Subject line context: ${subject}` : ''}

Rules:
- Write ONLY the email body — no subject line, no "Subject:", no headers
- Use Matt's casual-professional tone: direct, warm, real — not corporate
- Use the lead's first name if available
- Keep it under 150 words
- End with a clear, low-pressure call to action
- Sign off as: Matt Golden | MG Realty

Write the email body now:`;

    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    });

    const draft = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    res.json({ ok: true, draft });
  } catch (e) {
    console.error('DRAFT EMAIL ERROR:', e.message);
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

// ── Morning Briefing ─────────────────────────────────────────
app.post('/api/morning-briefing', async (req, res) => {
  try {
    const crm   = await readCRM();
    const now   = new Date();
    const today = now.toISOString().split('T')[0];
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // ── Prioritized call list ──────────────────────────────
    const activeLeads = crm.leads.filter(l => l.temp !== 'done');
    const overdue = activeLeads
      .filter(l => l.followup && l.followup <= today)
      .sort((a, b) => {
        const urgency = t => ({ hot: 3, warm: 2, cool: 1, cold: 0 }[t] || 0);
        if (a.followup !== b.followup) return a.followup < b.followup ? -1 : 1;
        return urgency(b.temp) - urgency(a.temp);
      })
      .slice(0, 6);

    const hotNoContact = activeLeads
      .filter(l => l.temp === 'hot' && (!l.lastcontact || (now - new Date(l.lastcontact)) > 3 * 86400000))
      .filter(l => !overdue.find(o => o.id === l.id))
      .slice(0, 3);

    const callList = [...overdue, ...hotNoContact].slice(0, 6);

    // ── Today's appointments ───────────────────────────────
    const appts = (crm.appointments || []).filter(a => a.date === today);

    // ── Pipeline snapshot ──────────────────────────────────
    const stages = { new: 0, contacted: 0, showing: 0, offer: 0, closed: 0 };
    activeLeads.forEach(l => { const s = l.stage || 'new'; if (stages[s] !== undefined) stages[s]++; });
    const totalActive = activeLeads.length;
    const totalOverdue = activeLeads.filter(l => l.followup && l.followup < today).length;
    const hotCount = activeLeads.filter(l => l.temp === 'hot').length;

    // ── AI-written summary paragraph ──────────────────────
    const aiPrompt = `You are Matt Golden's AI assistant at MG Realty, Los Angeles.
Write a 2–3 sentence punchy morning summary for his daily briefing email. Be direct, no fluff.
Focus on the most important thing he needs to act on today.

Data:
- ${callList.length} leads need calls (${overdue.length} overdue follow-ups, ${hotNoContact.length} hot with no recent contact)
- ${hotCount} hot leads total, ${totalActive} active leads
- ${appts.length} appointment(s) today${appts.length ? ': ' + appts.map(a => a.type + ' with ' + a.leadName + ' at ' + a.time).join(', ') : ''}
- ${totalOverdue} follow-ups overdue total
- Pipeline: ${stages.new} new, ${stages.contacted} contacted, ${stages.showing} showing, ${stages.offer} offer, ${stages.closed} closed this period

Write the summary in 2nd person ("You have…", "Your top priority…"). Sound like a sharp assistant, not a robot. No greeting needed.`;

    let aiSummary = `You have ${callList.length} calls to make today and ${totalOverdue} overdue follow-ups. Focus on your hottest leads first.`;
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: aiPrompt }] })
      });
      const aiData = await aiRes.json();
      if (aiData.content?.[0]?.text) aiSummary = aiData.content[0].text.trim();
    } catch (e) { console.warn('AI summary failed, using fallback:', e.message); }

    // ── Build HTML email ───────────────────────────────────
    const tempBadge = t => {
      const map = { hot: '#dc2626', warm: '#f59e0b', cool: '#3b82f6', cold: '#6b7280' };
      return `<span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;color:white;background:${map[t]||'#6b7280'};text-transform:uppercase;letter-spacing:0.04em">${t||'?'}</span>`;
    };
    const daysSince = l => l.lastcontact
      ? Math.floor((now - new Date(l.lastcontact)) / 86400000)
      : null;
    const overdueStr = l => {
      if (!l.followup) return 'No follow-up set';
      const d = Math.floor((now - new Date(l.followup)) / 86400000);
      return d >= 0 ? `${d === 0 ? 'Due today' : d + 'd overdue'}` : `Due in ${Math.abs(d)}d`;
    };

    const callRows = callList.length
      ? callList.map(l => `
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #f0ede6">
              <div style="font-weight:600;font-size:14px">${l.first} ${l.last} ${tempBadge(l.temp)}</div>
              <div style="color:#6b7280;font-size:12px;margin-top:3px">${l.prop || l.type || ''}${l.phone ? ' · ' + l.phone : ''}</div>
            </td>
            <td style="padding:10px 14px;border-bottom:1px solid #f0ede6;color:#dc2626;font-size:12px;font-weight:600;white-space:nowrap">${overdueStr(l)}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #f0ede6;color:#9ca3af;font-size:12px;white-space:nowrap">${daysSince(l) !== null ? daysSince(l) + 'd ago' : 'Never'}</td>
          </tr>`).join('')
      : `<tr><td colspan="3" style="padding:14px;color:#9ca3af;text-align:center;font-size:13px">No urgent calls — you're all caught up 🎉</td></tr>`;

    const apptRows = appts.length
      ? appts.map(a => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f0ede6">
            <div style="background:#1A1914;color:white;border-radius:8px;padding:8px 12px;text-align:center;min-width:48px">
              <div style="font-size:16px;font-weight:700;line-height:1">${a.time.split(':')[0]}</div>
              <div style="font-size:9px;text-transform:uppercase;opacity:0.7">${a.time.includes('PM') ? 'PM' : 'AM'}</div>
            </div>
            <div>
              <div style="font-weight:600;font-size:14px">${a.leadName}</div>
              <div style="color:#6b7280;font-size:12px">${a.type}${a.address ? ' · ' + a.address : ''}</div>
            </div>
          </div>`).join('')
      : '<div style="color:#9ca3af;font-size:13px;padding:10px 0">No appointments today</div>';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f6f2;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">

    <!-- Header -->
    <div style="background:#1A1914;border-radius:12px 12px 0 0;padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="color:#C9A84C;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Morning Briefing</div>
        <div style="color:white;font-size:20px;font-weight:700;margin-top:2px">${dayName}, ${dateStr}</div>
      </div>
      <img src="https://mgr-eng.github.io/mg-realty-backend/mg-logo.jpg" alt="MG Realty" style="height:40px;width:auto;object-fit:contain">
    </div>

    <!-- AI Summary -->
    <div style="background:#fff;padding:18px 24px;border-left:1px solid #e5e1d8;border-right:1px solid #e5e1d8;border-top:3px solid #C9A84C">
      <p style="margin:0;font-size:14px;line-height:1.7;color:#374151">${aiSummary}</p>
    </div>

    <!-- Stats row -->
    <div style="background:#fff;padding:14px 24px;border-left:1px solid #e5e1d8;border-right:1px solid #e5e1d8;border-bottom:1px solid #e5e1d8;display:flex;gap:0">
      ${[
        ['Calls Today', callList.length, '#C9A84C'],
        ['Hot Leads', hotCount, '#dc2626'],
        ['Overdue', totalOverdue, totalOverdue > 0 ? '#dc2626' : '#10b981'],
        ['Active', totalActive, '#374151']
      ].map(([label, val, color]) => `
        <div style="flex:1;text-align:center;padding:10px 8px;border-right:1px solid #f0ede6">
          <div style="font-size:24px;font-weight:700;color:${color}">${val}</div>
          <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">${label}</div>
        </div>`).join('')}
      <div style="flex:1;text-align:center;padding:10px 8px">
        <div style="font-size:24px;font-weight:700;color:#374151">${appts.length}</div>
        <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">Appts</div>
      </div>
    </div>

    <!-- Priority Calls -->
    <div style="background:#fff;margin-top:12px;border-radius:8px;border:1px solid #e5e1d8;overflow:hidden">
      <div style="padding:12px 16px;background:#fafaf8;border-bottom:1px solid #e5e1d8">
        <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em">📞 Priority Calls</div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#fafaf8">
            <th style="padding:8px 14px;text-align:left;font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Lead</th>
            <th style="padding:8px 14px;text-align:left;font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Follow-up</th>
            <th style="padding:8px 14px;text-align:left;font-size:10px;color:#9ca3af;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Last Contact</th>
          </tr>
        </thead>
        <tbody>${callRows}</tbody>
      </table>
    </div>

    <!-- Appointments -->
    <div style="background:#fff;margin-top:12px;border-radius:8px;border:1px solid #e5e1d8;overflow:hidden">
      <div style="padding:12px 16px;background:#fafaf8;border-bottom:1px solid #e5e1d8">
        <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em">📅 Today's Schedule</div>
      </div>
      <div style="padding:4px 16px 10px">${apptRows}</div>
    </div>

    <!-- Pipeline -->
    <div style="background:#fff;margin-top:12px;border-radius:8px;border:1px solid #e5e1d8;overflow:hidden">
      <div style="padding:12px 16px;background:#fafaf8;border-bottom:1px solid #e5e1d8">
        <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.07em">🏡 Pipeline Snapshot</div>
      </div>
      <div style="padding:14px 24px;display:flex;justify-content:space-between">
        ${Object.entries(stages).map(([stage, count]) => `
          <div style="text-align:center">
            <div style="font-size:20px;font-weight:700;color:#1A1914">${count}</div>
            <div style="font-size:10px;color:#9ca3af;text-transform:capitalize;margin-top:2px">${stage}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Footer -->
    <div style="margin-top:16px;text-align:center;padding:12px">
      <a href="https://mg-realty-backend.onrender.com" style="display:inline-block;background:#C9A84C;color:white;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:600">Open CRM →</a>
      <div style="margin-top:12px;font-size:11px;color:#9ca3af">MG Realty · Los Angeles · Sent by your AI assistant</div>
    </div>

  </div>
</body>
</html>`;

    // ── Send via Gmail API ─────────────────────────────────
    const subject = `☀️ Morning Briefing — ${dayName}, ${dateStr}`;
    const rawMessage = [
      `From: Matt Golden | MG Realty <goldenmb@gmail.com>`,
      `To: goldenmb@gmail.com`,
      `Subject: ${encodeSubject(subject)}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      html,
    ].join('\r\n');

    const encoded = Buffer.from(rawMessage).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const token = await googleToken();
    const gmailRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded })
      }
    );
    const gmailData = await gmailRes.json();
    if (gmailData.error) throw new Error('Gmail API: ' + gmailData.error.message);

    console.log(`Morning briefing sent for ${today}`);
    res.json({ ok: true, callCount: callList.length, apptCount: appts.length });

  } catch (e) {
    console.error('BRIEFING ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Weekly Pipeline Digest ────────────────────────────────────
app.post('/api/weekly-digest', async (req, res) => {
  try {
    const crm  = await readCRM();
    const now  = new Date();
    const toLA = d => new Date(d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const la   = toLA(now);

    // Week window: last 7 days
    const weekAgo = new Date(la); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = [weekAgo.getFullYear(), String(weekAgo.getMonth()+1).padStart(2,'0'), String(weekAgo.getDate()).padStart(2,'0')].join('-');
    const todayStr   = [la.getFullYear(), String(la.getMonth()+1).padStart(2,'0'), String(la.getDate()).padStart(2,'0')].join('-');

    const activeLeads  = crm.leads.filter(l => l.temp !== 'done');
    const activities   = crm.activities || [];

    // ── Stage counts ──────────────────────────────────────────
    const stages = { new: 0, contacted: 0, showing: 0, offer: 0, closed: 0 };
    activeLeads.forEach(l => { const s = l.stage || 'new'; if (stages[s] !== undefined) stages[s]++; });

    // ── Estimate pipeline value ───────────────────────────────
    const stageWeight = { new: 0.05, contacted: 0.15, showing: 0.35, offer: 0.70, closed: 1.0 };
    let pipelineValue = 0;
    activeLeads.forEach(l => {
      const budget = parseFloat((l.budget || '').toString().replace(/[^0-9.]/g, '')) || 800000;
      const commission = budget * 0.025; // 2.5% avg
      pipelineValue += commission * (stageWeight[l.stage || 'new'] || 0.05);
    });

    // ── This week's activity ──────────────────────────────────
    const weekActs = activities.filter(a => a.date >= weekAgoStr && a.date <= todayStr);
    const actByType = {};
    weekActs.forEach(a => { actByType[a.type] = (actByType[a.type] || 0) + 1; });
    const actSummary = Object.entries(actByType).map(([t, c]) => `${c} ${t}${c > 1 ? 's' : ''}`).join(', ') || 'none';

    // ── Leads active this week ────────────────────────────────
    const activeThisWeek = [...new Set(weekActs.map(a => a.leadId))]
      .map(id => crm.leads.find(l => l.id === id))
      .filter(Boolean);

    // ── Stalled leads (no contact in 7+ days, not done) ───────
    const stalled = activeLeads
      .filter(l => {
        if (!l.lastcontact) return true;
        const d = new Date(l.lastcontact.split('-').map((v,i)=>i===1?Number(v)-1:Number(v)));
        return (la - d) > 7 * 86400000;
      })
      .filter(l => l.temp === 'hot' || l.temp === 'warm')
      .sort((a, b) => (a.lastcontact || '') < (b.lastcontact || '') ? -1 : 1)
      .slice(0, 4);

    // ── Overdue follow-ups ────────────────────────────────────
    const overdue = activeLeads
      .filter(l => l.followup && l.followup < todayStr)
      .sort((a, b) => a.followup < b.followup ? -1 : 1)
      .slice(0, 5);

    // ── Next week's appointments ──────────────────────────────
    const nextWeek = new Date(la); nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = [nextWeek.getFullYear(), String(nextWeek.getMonth()+1).padStart(2,'0'), String(nextWeek.getDate()).padStart(2,'0')].join('-');
    const upcomingAppts = (crm.appointments || [])
      .filter(a => a.date > todayStr && a.date <= nextWeekStr)
      .sort((a, b) => a.date < b.date ? -1 : 1)
      .slice(0, 5);

    // ── AI strategic summary ──────────────────────────────────
    const aiPrompt = `You are Matt Golden's AI assistant at MG Realty, Los Angeles.
Write a 3–4 sentence strategic weekly summary for his pipeline digest. Be direct, specific, actionable.
Data:
- Active leads: ${activeLeads.length} (${stages.hot || 0} hot, ${stages.warm || 0} warm)
- Pipeline est. value: $${Math.round(pipelineValue).toLocaleString()} in weighted commissions
- This week's activity: ${actSummary}
- Leads touched this week: ${activeThisWeek.length}
- Stalled hot/warm leads: ${stalled.length}
- Overdue follow-ups: ${overdue.length}
- Upcoming appts next 7 days: ${upcomingAppts.length}
Top stalled: ${stalled.slice(0,2).map(l=>`${l.first} ${l.last} (${l.temp}, last contact: ${l.lastcontact||'never'})`).join(', ')||'none'}
Focus on what needs attention this week. No bullet points, just 3-4 tight sentences.`;

    const aiMsg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: aiPrompt }]
    });
    const aiSummary = aiMsg.content[0].text.trim();

    // ── Format helpers ────────────────────────────────────────
    const weekLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
    const fmt = s => s ? new Date(s+'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    const tempBadge = t => ({ hot: '#dc2626', warm: '#d97706', cold: '#6b7280', cool: '#6b7280' }[t] || '#6b7280');
    const stageLabel = { new: 'New', contacted: 'Contacted', showing: 'Showing', offer: 'Offer', closed: 'Closed' };

    const fmtMoney = n => n >= 1000000 ? `$${(n/1000000).toFixed(2)}M` : `$${Math.round(n/1000)}K`;

    // ── Build email HTML ──────────────────────────────────────
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;margin:0;padding:20px}
  .wrap{max-width:600px;margin:0 auto}
  .card{background:#fff;border-radius:12px;overflow:hidden;margin-bottom:16px;border:1px solid #e4e4e7}
  .header{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:28px 28px 24px;color:#fff}
  .header-eyebrow{font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#fbbf24;margin-bottom:6px}
  .header-title{font-size:22px;font-weight:700;margin:0 0 4px}
  .header-date{font-size:13px;color:rgba(255,255,255,0.6)}
  .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:0}
  .stat{padding:16px;text-align:center;border-right:1px solid #e4e4e7}
  .stat:last-child{border-right:none}
  .stat-val{font-size:22px;font-weight:800;color:#111}
  .stat-label{font-size:10px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px}
  .stat-val.gold{color:#d97706}
  .stat-val.green{color:#059669}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#71717a;padding:14px 20px 0}
  .ai-box{margin:12px 20px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;font-size:13px;line-height:1.6;color:#1c1917}
  .ai-box-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#d97706;margin-bottom:6px;display:flex;align-items:center;gap:4px}
  table{width:100%;border-collapse:collapse}
  td,th{padding:10px 20px;font-size:12px;text-align:left;border-bottom:1px solid #f4f4f5}
  th{font-size:10px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;background:#fafafa}
  tr:last-child td{border-bottom:none}
  .name{font-weight:600;font-size:13px;color:#111}
  .sub{font-size:11px;color:#71717a;margin-top:1px}
  .badge{display:inline-block;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:700;color:#fff}
  .stage{font-size:11px;color:#71717a;text-transform:capitalize}
  .pipeline-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;margin:12px 20px 16px}
  .footer{text-align:center;padding:16px;font-size:11px;color:#a1a1aa}
  .week-activity{padding:12px 20px 16px;display:flex;gap:16px;flex-wrap:wrap}
  .act-chip{background:#f4f4f5;border-radius:6px;padding:8px 14px;font-size:12px;font-weight:500;color:#374151}
  .act-chip span{font-weight:800;color:#111;margin-right:4px}
  .empty-note{padding:12px 20px;font-size:12px;color:#a1a1aa;font-style:italic}
</style></head><body><div class="wrap">

<div class="card">
  <div class="header">
    <div class="header-eyebrow">📊 Weekly Digest</div>
    <div class="header-title">MG Realty Pipeline Review</div>
    <div class="header-date">Week of ${weekLabel}</div>
  </div>
  <div class="stats-row">
    <div class="stat"><div class="stat-val">${activeLeads.length}</div><div class="stat-label">Active Leads</div></div>
    <div class="stat"><div class="stat-val gold">${activeLeads.filter(l=>l.temp==='hot').length}</div><div class="stat-label">Hot Leads</div></div>
    <div class="stat"><div class="stat-val">${weekActs.length}</div><div class="stat-label">Actions This Week</div></div>
    <div class="stat"><div class="stat-val green">${fmtMoney(pipelineValue)}</div><div class="stat-label">Est. Pipeline</div></div>
  </div>
</div>

<div class="card">
  <div class="section-title">⚡ AI Weekly Take</div>
  <div class="ai-box"><div class="ai-box-label">✦ AI Analysis</div>${aiSummary}</div>
</div>

${stalled.length > 0 ? `
<div class="card">
  <div class="section-title">🔴 Stalled — Needs Attention</div>
  <table>
    <tr><th>Lead</th><th>Temp</th><th>Stage</th><th>Last Contact</th></tr>
    ${stalled.map(l => `<tr>
      <td><div class="name">${l.first} ${l.last}</div><div class="sub">${l.prop || l.type || ''}</div></td>
      <td><span class="badge" style="background:${tempBadge(l.temp)}">${l.temp}</span></td>
      <td class="stage">${stageLabel[l.stage||'new']||'New'}</td>
      <td style="font-size:12px;color:#71717a">${l.lastcontact ? fmt(l.lastcontact) : 'Never'}</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

${overdue.length > 0 ? `
<div class="card">
  <div class="section-title">📅 Overdue Follow-ups</div>
  <table>
    <tr><th>Lead</th><th>Temp</th><th>Follow-up Was Due</th></tr>
    ${overdue.map(l => `<tr>
      <td><div class="name">${l.first} ${l.last}</div><div class="sub">${l.phone||l.email||''}</div></td>
      <td><span class="badge" style="background:${tempBadge(l.temp)}">${l.temp}</span></td>
      <td style="font-size:12px;color:#dc2626;font-weight:600">${fmt(l.followup)}</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

<div class="card">
  <div class="section-title">📈 Pipeline Stage Breakdown</div>
  <div class="pipeline-bar">
    ${[['new','#94a3b8'],['contacted','#60a5fa'],['showing','#f97316'],['offer','#a855f7'],['closed','#22c55e']].map(([s,c])=>{
      const pct = activeLeads.length ? Math.round((stages[s]||0)/activeLeads.length*100) : 0;
      return pct > 0 ? `<div style="width:${pct}%;background:${c}" title="${stageLabel[s]}: ${stages[s]||0}"></div>` : '';
    }).join('')}
  </div>
  <table>
    <tr><th>Stage</th><th>Count</th><th>% of Pipeline</th></tr>
    ${[['new','#94a3b8'],['contacted','#60a5fa'],['showing','#f97316'],['offer','#a855f7'],['closed','#22c55e']].map(([s,c])=>{
      const cnt = stages[s]||0;
      const pct = activeLeads.length ? Math.round(cnt/activeLeads.length*100) : 0;
      return cnt > 0 ? `<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:6px"></span>${stageLabel[s]}</td><td style="font-weight:700">${cnt}</td><td style="color:#71717a">${pct}%</td></tr>` : '';
    }).join('')}
  </table>
</div>

<div class="card">
  <div class="section-title">🗓️ This Week's Activity</div>
  ${Object.keys(actByType).length > 0
    ? `<div class="week-activity">${Object.entries(actByType).map(([t,c])=>`<div class="act-chip"><span>${c}</span>${t}${c>1?'s':''}</div>`).join('')}</div>`
    : '<div class="empty-note">No activity logged this week.</div>'}
</div>

${upcomingAppts.length > 0 ? `
<div class="card">
  <div class="section-title">📋 Coming Up Next Week</div>
  <table>
    <tr><th>Date</th><th>Type</th><th>Lead / Notes</th></tr>
    ${upcomingAppts.map(a => {
      const lead = crm.leads.find(l => l.id === a.leadId);
      return `<tr>
        <td style="font-weight:600;white-space:nowrap">${fmt(a.date)}</td>
        <td style="text-transform:capitalize;color:#71717a">${a.type||'Appointment'}</td>
        <td>${lead ? `${lead.first} ${lead.last}` : ''}${a.notes ? `<div class="sub">${a.notes}</div>` : ''}</td>
      </tr>`;
    }).join('')}
  </table>
</div>` : ''}

${(() => {
      const withRef = crm.leads.filter(l => l.referredBy && l.referredBy.trim());
      if (!withRef.length) return '';
      const counts = {}; const closed = {};
      withRef.forEach(l => {
        const r = l.referredBy.trim();
        counts[r] = (counts[r] || 0) + 1;
        if (l.stage === 'closed' || l.stage === 'Closed') closed[r] = (closed[r] || 0) + 1;
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return `<div class="card">
  <div class="section-title">🤝 Top Referrers</div>
  <table>
    <tr><th>Name</th><th>Leads Sent</th><th>Closed</th></tr>
    ${sorted.map(([name, count], i) => {
      const medals = ['🥇','🥈','🥉'];
      const cl = closed[name] || 0;
      return `<tr>
        <td><div class="name">${medals[i] || ''}${medals[i] ? ' ' : ''}${name}</div></td>
        <td style="font-weight:700;color:#111">${count}</td>
        <td style="color:${cl ? '#059669' : '#a1a1aa'};font-weight:${cl ? '700' : '400'}">${cl || '—'}</td>
      </tr>`;
    }).join('')}
  </table>
</div>`;
    })()}

<div class="footer">MG Realty · Matt Golden · goldenmb@gmail.com<br>Weekly digest sent every Sunday evening</div>
</div></body></html>`;

    // ── Send via Gmail API ─────────────────────────────────────
    const subject = `📊 Weekly Digest — Week of ${weekLabel}`;
    const rawMessage = [
      `From: MG Realty <goldenmb@gmail.com>`,
      `To: goldenmb@gmail.com`,
      `Subject: ${encodeSubject(subject)}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      html
    ].join('\r\n');
    const encoded = Buffer.from(rawMessage).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const token = await googleToken();
    const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded })
    });
    const gmailData = await gmailRes.json();
    if (gmailData.error) throw new Error('Gmail API: ' + gmailData.error.message);

    res.json({ ok: true });
  } catch (e) {
    console.error('WEEKLY DIGEST ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AI Follow-up Suggestion ───────────────────────────────────
app.post('/api/ai-suggestion', async (req, res) => {
  try {
    const { lead, activities = [] } = req.body;
    if (!lead) return res.status(400).json({ ok: false, error: 'No lead provided' });

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const daysSinceContact = (() => {
      const dates = activities.map(a => a.date).filter(Boolean).sort().reverse();
      if (!dates.length) return null;
      const last = new Date(dates[0].split('-').map(Number).reduce((acc, v, i) => { acc.push(v); return acc; }, []));
      const d = new Date(...dates[0].split('-').map((v,i) => i===1 ? Number(v)-1 : Number(v)));
      return Math.round((now - d) / 86400000);
    })();

    const actSummary = activities.slice(0, 8).map(a =>
      `- ${a.date}: ${a.type} (${a.direction||''}) — ${a.outcome||''} ${a.notes ? '| '+a.notes : ''}`
    ).join('\n') || 'No activity recorded yet.';

    const prompt = `You are a real estate assistant for Matt Golden at MG Realty in Los Angeles.

Lead profile:
- Name: ${lead.first} ${lead.last}
- Status: ${lead.status || 'unknown'}
- Type: ${lead.type || 'buyer/seller unknown'}
- Budget: ${lead.budget || 'not specified'}
- Timeline: ${lead.timeline || 'not specified'}
- Source: ${lead.source || 'unknown'}
- Last follow-up date: ${lead.followup || 'none set'}
- Days since last activity: ${daysSinceContact !== null ? daysSinceContact : 'unknown'}
- Today: ${todayStr}

Recent activity (newest first):
${actSummary}

Based on this lead's history and current status, suggest the single best next action Matt should take TODAY to move this deal forward or keep the relationship warm. Be specific — reference their situation.

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "action": "one clear sentence — what to do (e.g. 'Call Sarah to follow up on the Culver City showing from 3 days ago')",
  "reason": "1-2 sentences explaining why this is the right move right now",
  "type": "call|email|text|snooze|wait"
}`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    let suggestion;
    try {
      suggestion = JSON.parse(msg.content[0].text.trim());
    } catch {
      const match = msg.content[0].text.match(/\{[\s\S]*\}/);
      suggestion = match ? JSON.parse(match[0]) : { action: msg.content[0].text, reason: '', type: 'call' };
    }

    res.json({ ok: true, suggestion });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── RLA Parser (from stored property doc — no re-upload needed) ──
app.post('/api/parse-rla-stored', async (req, res) => {
  try {
    const { propId, docId } = req.body;
    if (!propId || !docId) return res.status(400).json({ ok: false, error: 'propId and docId required' });

    const crm = await readCRM();
    const prop = (crm.properties || []).find(p => p.id === propId);
    if (!prop) return res.status(404).json({ ok: false, error: 'Property not found' });
    const doc = (prop.docs || []).find(d => d.id === docId);
    if (!doc) return res.status(404).json({ ok: false, error: 'Document not found' });
    if (!doc.data) return res.status(400).json({ ok: false, error: 'Document has no data' });

    // Strip data URL prefix if present
    const base64 = doc.data.includes(',') ? doc.data.split(',')[1] : doc.data;

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: `You are parsing a California Residential Listing Agreement (RLA) or similar real estate contract. Extract these fields and return ONLY valid JSON, no explanation:\n\n{"listPrice":<number or null>,"commissionPct":<number or null>,"side":<"buyer"|"seller"|"both"|null>,"compassSplit":<number or null>,"notes":<string or null>}\n\nlistPrice = raw number (no $ or commas). commissionPct = number only (e.g. 2.5 not "2.5%"). Use null for any field not found.` }
        ]
      }]
    });

    const raw = msg.content[0].text.trim();
    let parsed;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : raw);
    } catch {
      return res.status(422).json({ ok: false, error: 'Could not parse AI response', raw });
    }
    res.json({ ok: true, fields: parsed, docName: doc.name });
  } catch (e) {
    console.error('parse-rla-stored error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── RLA Parser ───────────────────────────────────────────────
app.post('/api/parse-rla', async (req, res) => {
  try {
    const { pdfBase64, filename } = req.body;
    if (!pdfBase64) return res.status(400).json({ ok: false, error: 'No PDF data provided' });

    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
          },
          {
            type: 'text',
            text: `You are parsing a California Residential Listing Agreement (RLA) or similar real estate contract. Extract these fields and return ONLY valid JSON, no explanation:

{
  "listPrice": <number or null — the listing/sale price in dollars>,
  "commissionPct": <number or null — the total commission percentage, e.g. 2.5>,
  "side": <"buyer" | "seller" | "both" | null — which side this agent represents>,
  "compassSplit": <number or null — Compass brokerage split percentage if mentioned, else null>,
  "notes": <string — any other relevant commission terms in one sentence, or null>
}

If a field is not found in the document, use null. For listPrice, return the raw number without commas or $ sign. For commissionPct, return just the number (e.g. 2.5 not "2.5%").`
          }
        ]
      }]
    });

    const raw = msg.content[0].text.trim();
    let parsed;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : raw);
    } catch {
      return res.status(422).json({ ok: false, error: 'Could not parse AI response', raw });
    }

    res.json({ ok: true, fields: parsed });
  } catch (e) {
    console.error('parse-rla error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Property Tour Scheduler ───────────────────────────────────
app.post('/api/book-tour', async (req, res) => {
  try {
    const { first, last, phone, email, address, date, time, notes } = req.body;
    if (!first || !phone || !date || !time) return res.status(400).json({ ok: false, error: 'Missing required fields' });

    const crm = await readCRM();

    // Create or find lead
    const existingLead = crm.leads.find(l => l.phone === phone);
    let leadId = existingLead?.id;
    if (!existingLead) {
      leadId = `lead_${Date.now()}`;
      const newLead = {
        id: leadId,
        name: `${first} ${last || ''}`.trim(),
        phone, email: email || '',
        status: 'New',
        source: 'Tour Request',
        notes: `Tour request: ${address || 'Address TBD'}\n${notes || ''}`.trim(),
        createdAt: new Date().toISOString(),
        followUpDate: date
      };
      crm.leads.push(newLead);
    }

    // Add activity
    const activityId = `act_${Date.now()}`;
    crm.activities.push({
      id: activityId, leadId,
      type: 'tour_booked',
      note: `Tour booked: ${address || 'TBD'} on ${date} at ${time}`,
      createdAt: new Date().toISOString()
    });

    // Create task for Matt
    const taskId = `task_${Date.now()}`;
    crm.tasks.push({
      id: taskId, leadId,
      title: `🏠 Tour: ${address || 'TBD'} — ${first} ${last || ''}`.trim(),
      dueDate: date, dueTime: time,
      status: 'pending', priority: 'high',
      type: 'tour',
      notes: `Phone: ${phone}${email ? ' | Email: ' + email : ''}${notes ? '\nNotes: ' + notes : ''}`,
      createdAt: new Date().toISOString()
    });

    // Save tour request record
    const tours = crm.tours || [];
    tours.push({
      id: `tour_${Date.now()}`,
      leadId, leadName: `${first} ${last || ''}`.trim(),
      phone, email: email || '',
      address: address || 'TBD',
      date, time,
      notes: notes || '',
      status: 'scheduled',
      createdAt: new Date().toISOString()
    });
    crm.tours = tours;

    await writeCRM(crm);

    // Send confirmation email to lead
    if (email) {
      const tourDate = new Date(`${date}T${time}`);
      const friendly = tourDate.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
      try {
        await resend.emails.send({
          from: 'Matt Golden <matt@mg-realty.co>',
          to: email,
          subject: `Tour confirmed: ${address || 'Property Tour'} — ${friendly}`,
          html: `
<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;background:#fff;padding:32px 24px">
  <h2 style="margin:0 0 6px;font-size:22px;color:#0D0D0D">Your tour is confirmed! 🏡</h2>
  <p style="margin:0 0 24px;color:#666;font-size:14px">Here's what you need to know:</p>
  <div style="background:#F9F7F3;border-radius:10px;padding:20px;margin-bottom:24px">
    <div style="margin-bottom:12px"><strong style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999">Property</strong><div style="font-size:16px;font-weight:700;color:#0D0D0D;margin-top:3px">${address || 'Address to be confirmed'}</div></div>
    <div style="margin-bottom:12px"><strong style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999">Date & Time</strong><div style="font-size:16px;font-weight:700;color:#C8973A;margin-top:3px">${friendly} PT</div></div>
    <div><strong style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#999">Your Agent</strong><div style="font-size:15px;font-weight:600;color:#0D0D0D;margin-top:3px">Matt Golden · (323) 555-0100</div></div>
  </div>
  <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 16px">I'll meet you at the property. If anything comes up or you need to reschedule, just text or call me directly.</p>
  <p style="font-size:13px;color:#999;margin:0">Matt Golden · MG Realty · DRE #02130422</p>
</div>`
        });
      } catch(emailErr) { console.error('Tour confirmation email failed:', emailErr.message); }
    }

    // Notify Matt
    try {
      const token = await googleToken();
      const tourDate = new Date(`${date}T${time}`);
      const friendly = tourDate.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
      const subject = encodeSubject(`🏠 New Tour Request — ${first} ${last || ''} · ${date}`);
      const body = `New tour booked via your bio link:\n\nName: ${first} ${last || ''}\nPhone: ${phone}\nEmail: ${email || 'N/A'}\nAddress: ${address || 'TBD'}\nDate/Time: ${friendly} PT\nNotes: ${notes || 'None'}\n\n— MG Realty CRM`;
      const raw = btoa(unescape(encodeURIComponent(
        `From: MG Realty CRM <goldenmb@gmail.com>\r\nTo: goldenmb@gmail.com\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`
      ))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw })
      });
    } catch(notifyErr) { console.error('Tour notify email failed:', notifyErr.message); }

    res.json({ ok: true, leadId, taskId });
  } catch (e) {
    console.error('book-tour error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Get upcoming tours ────────────────────────────────────────
app.get('/api/tours', async (req, res) => {
  try {
    const crm = await readCRM();
    const today = new Date().toISOString().split('T')[0];
    const tours = (crm.tours || [])
      .filter(t => t.date >= today)
      .sort((a, b) => `${a.date}${a.time}` < `${b.date}${b.time}` ? -1 : 1);
    res.json({ ok: true, tours });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Lease Renewal Reminders ───────────────────────────────────
// Called by /sequences/process daily scheduler to send renewal nudges
async function processLeaseReminders(crm, today) {
  const leases = crm.leases || [];
  let sent = 0;
  for (const lease of leases) {
    if (!lease.endDate || !lease.email) continue;
    const daysLeft = Math.round((new Date(lease.endDate+'T12:00:00') - new Date(today)) / 86400000);
    // Send at 90, 60, 30, 14 days before expiry
    const triggerDays = [90, 60, 30, 14];
    if (!triggerDays.includes(daysLeft)) continue;

    // Check if we already sent this reminder
    const sentKey = `renewal_${daysLeft}`;
    if ((lease.remindersSent||[]).includes(sentKey)) continue;

    const name = `${lease.first||''} ${lease.last||''}`.trim();
    const fmtDate = d => new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

    const subject = daysLeft <= 14
      ? `⚠️ Lease expires in ${daysLeft} days — ${lease.address}`
      : `Lease renewal coming up — ${lease.address}`;

    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1A1914;padding:20px 24px;border-radius:8px 8px 0 0;text-align:center">
        <img src="https://mgr-eng.github.io/mg-realty-backend/mg-logo.jpg" alt="MG Realty" style="max-height:56px;object-fit:contain;display:block;margin:0 auto">
      </div>
      <div style="padding:28px;background:#fff;border:1px solid #eee;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 12px;font-size:18px">Hi ${name},</h2>
        <p style="color:#333;font-size:14px;line-height:1.6">Just a heads-up — your lease at <strong>${lease.address}</strong> expires on <strong>${fmtDate(lease.endDate)}</strong>, which is <strong>${daysLeft} days away</strong>.</p>
        <p style="color:#333;font-size:14px;line-height:1.6">If you'd like to renew or discuss your options, I'm here to help. Let's connect before the deadline approaches.</p>
        <p style="margin-top:24px;color:#333;font-size:13px">— Matt Golden<br>
        <span style="color:#888">MG Realty · Los Angeles · (323) 555-0100<br>goldenmb@gmail.com · DRE #02130422</span></p>
      </div>
    </div>`;

    try {
      const { error } = await resend.emails.send({
        from: 'Matt Golden <onboarding@resend.dev>',
        to: lease.email,
        subject: encodeSubject(subject),
        html
      });
      if (!error) {
        if (!lease.remindersSent) lease.remindersSent = [];
        lease.remindersSent.push(sentKey);
        sent++;
        console.log(`Lease reminder sent: ${sentKey} → ${lease.email}`);
      }
    } catch(e) { console.error('Lease reminder email failed:', e.message); }
  }
  return sent;
}

app.get('/api/lease-reminders', async (req, res) => {
  try {
    const crm = await readCRM();
    const today = new Date().toISOString().split('T')[0];
    const exp90 = new Date(); exp90.setDate(exp90.getDate()+90);
    const exp90str = exp90.toISOString().split('T')[0];
    const expiring = (crm.leases||[])
      .filter(l => l.endDate && l.endDate >= today && l.endDate <= exp90str)
      .map(l => {
        const days = Math.round((new Date(l.endDate+'T12:00:00') - new Date(today)) / 86400000);
        return { id:l.id, tenant:`${l.first||''} ${l.last||''}`.trim(), address:l.address, endDate:l.endDate, daysLeft:days };
      })
      .sort((a,b) => a.daysLeft - b.daysLeft);
    res.json({ ok:true, expiring });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ── Neighborhood Market Report ────────────────────────────────
app.post('/api/market-report', async (req, res) => {
  try {
    const { neighborhood, minPrice, maxPrice, propType = 'Single Family' } = req.body;
    if (!neighborhood) return res.status(400).json({ ok: false, error: 'Neighborhood required' });

    const today = new Date();
    const monthYear = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const priceRange = minPrice && maxPrice
      ? `$${Number(minPrice).toLocaleString()} – $${Number(maxPrice).toLocaleString()}`
      : minPrice ? `$${Number(minPrice).toLocaleString()}+` : maxPrice ? `Under $${Number(maxPrice).toLocaleString()}` : 'All price ranges';

    // Ask Claude to generate realistic market data + analysis
    const dataPrompt = `You are a Los Angeles real estate market analyst. Generate a realistic, data-driven neighborhood market report for ${neighborhood}, LA.

Property type: ${propType}
Price range: ${priceRange}
Report date: ${monthYear}

Return ONLY valid JSON (no markdown, no explanation):
{
  "medianPrice": <number — median sale price in dollars>,
  "medianPriceChange": <number — % change vs 6 months ago, can be negative>,
  "pricePerSqft": <number — median $/sqft>,
  "pricePerSqftChange": <number — % change vs 6 months ago>,
  "daysOnMarket": <number — median days on market>,
  "domChange": <number — change in days vs 6 months ago>,
  "homesForSale": <number — active listings>,
  "homesSold": <number — sold last 30 days>,
  "listToSaleRatio": <number — avg list-to-sale price ratio, e.g. 1.03 = 3% over ask>,
  "monthsOfInventory": <number — months of inventory>,
  "marketTrend": <"hot" | "balanced" | "cool">,
  "trendLabel": <string — one phrase like "Strong Seller's Market">,
  "recentSales": [
    { "address": <string>, "beds": <number>, "baths": <number>, "sqft": <number>, "price": <number>, "daysOnMarket": <number> },
    { "address": <string>, "beds": <number>, "baths": <number>, "sqft": <number>, "price": <number>, "daysOnMarket": <number> },
    { "address": <string>, "beds": <number>, "baths": <number>, "sqft": <number>, "price": <number>, "daysOnMarket": <number> }
  ],
  "insights": [
    <string — key insight 1, 1-2 sentences, specific to this neighborhood>,
    <string — key insight 2, 1-2 sentences>,
    <string — key insight 3, 1-2 sentences>
  ],
  "summary": <string — 2-3 sentence executive summary of this market>
}

Make the data realistic for ${neighborhood}, Los Angeles in ${monthYear}. Use actual neighborhood characteristics (price range, density, demographics, trends) to inform the numbers.`;

    const aiMsg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: dataPrompt }]
    });

    const raw = aiMsg.content[0].text.trim();
    let data;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      data = JSON.parse(match ? match[0] : raw);
    } catch {
      return res.status(422).json({ ok: false, error: 'AI parse failed', raw });
    }

    // ── Build PDF with pdfkit ─────────────────────────────────
    const chunks = [];
    const doc = new PDFDocument({ size: 'LETTER', margin: 0, info: {
      Title: `${neighborhood} Market Report — ${monthYear}`,
      Author: 'MG Realty · Matt Golden',
      Subject: 'Neighborhood Real Estate Market Report'
    }});
    doc.on('data', c => chunks.push(c));

    const pdfBase64 = await new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      doc.on('error', reject);

      const W = 612, H = 792;
      const GOLD = '#C8973A';
      const DARK = '#1A1914';
      const LIGHT = '#F5F5F0';
      const GRAY = '#888880';
      const RED = '#dc2626';
      const GREEN = '#16a34a';

      const fmtPrice = n => n >= 1000000 ? `$${(n/1000000).toFixed(2)}M` : `$${Math.round(n/1000)}K`;
      const fmtChange = n => (n >= 0 ? '▲ ' : '▼ ') + Math.abs(n).toFixed(1) + '%';
      const changeColor = n => n >= 0 ? GREEN : RED;

      // ── Header band ───────────────────────────────────────────
      doc.rect(0, 0, W, 110).fill(DARK);
      doc.rect(0, 108, W, 3).fill(GOLD);

      // Logo text (no image dependency)
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(22).text('MG REALTY', 40, 28);
      doc.fillColor('#AAAAAA').font('Helvetica').fontSize(9).text('MATT GOLDEN · DRE #02130422 · LOS ANGELES', 40, 54);

      // Report title right side
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15)
        .text(`${neighborhood.toUpperCase()}`, W - 280, 22, { width: 240, align: 'right' });
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10)
        .text('MARKET REPORT', W - 280, 42, { width: 240, align: 'right' });
      doc.fillColor('#AAAAAA').font('Helvetica').fontSize(9)
        .text(`${propType} · ${monthYear}`, W - 280, 57, { width: 240, align: 'right' });
      doc.fillColor('#AAAAAA').font('Helvetica').fontSize(9)
        .text(`Price Range: ${priceRange}`, W - 280, 70, { width: 240, align: 'right' });

      // Trend badge
      const trendColors = { hot: '#dc2626', balanced: '#d97706', cool: '#2563eb' };
      const trendBg = trendColors[data.marketTrend] || '#888';
      doc.roundedRect(40, 75, 130, 22, 4).fill(trendBg);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
        .text((data.trendLabel || 'Market Update').toUpperCase(), 40, 81, { width: 130, align: 'center' });

      // ── Stats row ─────────────────────────────────────────────
      const statY = 125;
      const stats = [
        { label: 'MEDIAN PRICE', value: fmtPrice(data.medianPrice), change: data.medianPriceChange, sub: 'vs 6 months ago' },
        { label: 'PRICE / SQFT', value: `$${Math.round(data.pricePerSqft)}`, change: data.pricePerSqftChange, sub: 'vs 6 months ago' },
        { label: 'DAYS ON MARKET', value: `${data.daysOnMarket}`, change: null, sub: `${data.domChange >= 0 ? '+' : ''}${data.domChange} days vs prior` },
        { label: 'HOMES SOLD', value: `${data.homesSold}`, change: null, sub: 'last 30 days' },
      ];

      const statW = W / 4;
      stats.forEach((s, i) => {
        const x = i * statW;
        // Divider
        if (i > 0) doc.rect(x, statY, 1, 90).fill('#E0E0D8');
        doc.rect(x, statY, statW, 90).fill(i % 2 === 0 ? LIGHT : '#FAFAF5');
        doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(7)
          .text(s.label, x + 10, statY + 12, { width: statW - 20, align: 'center' });
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(22)
          .text(s.value, x + 10, statY + 24, { width: statW - 20, align: 'center' });
        if (s.change !== null && s.change !== undefined) {
          doc.fillColor(changeColor(s.change)).font('Helvetica-Bold').fontSize(10)
            .text(fmtChange(s.change), x + 10, statY + 52, { width: statW - 20, align: 'center' });
        }
        doc.fillColor(GRAY).font('Helvetica').fontSize(7)
          .text(s.sub, x + 10, s.change !== null && s.change !== undefined ? statY + 66 : statY + 52, { width: statW - 20, align: 'center' });
      });

      // ── Secondary stats ───────────────────────────────────────
      const sec2Y = statY + 92;
      doc.rect(0, sec2Y, W, 36).fill('#F0EFE8');
      const secStats = [
        { label: 'Active Listings', value: `${data.homesForSale}` },
        { label: 'Months of Inventory', value: `${data.monthsOfInventory}` },
        { label: 'List-to-Sale Ratio', value: `${(data.listToSaleRatio * 100).toFixed(1)}%` },
        { label: 'Report Generated', value: today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
      ];
      secStats.forEach((s, i) => {
        const x = (W / 4) * i;
        if (i > 0) doc.rect(x, sec2Y + 4, 1, 28).fill('#D0CFC8');
        doc.fillColor(GRAY).font('Helvetica').fontSize(7).text(s.label, x + 8, sec2Y + 8, { width: W/4 - 16, align: 'center' });
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(12).text(s.value, x + 8, sec2Y + 18, { width: W/4 - 16, align: 'center' });
      });

      // ── Summary ───────────────────────────────────────────────
      const sumY = sec2Y + 48;
      doc.rect(40, sumY, W - 80, 2).fill(GOLD);
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text('MARKET SUMMARY', 40, sumY + 10);
      doc.fillColor('#333333').font('Helvetica').fontSize(9.5).leading(5)
        .text(data.summary || '', 40, sumY + 26, { width: W - 80 });

      // ── Insights ─────────────────────────────────────────────
      const insY = sumY + 80;
      doc.rect(40, insY, W - 80, 2).fill(GOLD);
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text('KEY INSIGHTS', 40, insY + 10);

      const insights = data.insights || [];
      insights.slice(0, 3).forEach((insight, i) => {
        const iy = insY + 30 + i * 42;
        doc.rect(40, iy, 4, 30).fill(GOLD);
        doc.fillColor('#555').font('Helvetica-Bold').fontSize(8).text(`INSIGHT ${i + 1}`, 52, iy + 2);
        doc.fillColor(DARK).font('Helvetica').fontSize(9).leading(4)
          .text(insight, 52, iy + 13, { width: W - 100 });
      });

      // ── Recent Sales ──────────────────────────────────────────
      const salesY = insY + 170;
      doc.rect(40, salesY, W - 80, 2).fill(GOLD);
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11).text('RECENT COMPARABLE SALES', 40, salesY + 10);

      // Table header
      const tY = salesY + 28;
      doc.rect(40, tY, W - 80, 18).fill(DARK);
      const cols = [{ label: 'ADDRESS', x: 48, w: 180 }, { label: 'BED/BATH', x: 235, w: 70 }, { label: 'SQFT', x: 310, w: 60 }, { label: 'PRICE', x: 375, w: 90 }, { label: 'DOM', x: 468, w: 50 }];
      cols.forEach(c => {
        doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(7).text(c.label, c.x, tY + 5, { width: c.w });
      });

      (data.recentSales || []).slice(0, 3).forEach((sale, i) => {
        const ry = tY + 18 + i * 22;
        doc.rect(40, ry, W - 80, 22).fill(i % 2 === 0 ? LIGHT : '#FAFAF5');
        doc.fillColor(DARK).font('Helvetica').fontSize(8.5).text(sale.address || '—', 48, ry + 6, { width: 180 });
        doc.fillColor(DARK).font('Helvetica').fontSize(8.5).text(`${sale.beds}bd/${sale.baths}ba`, 235, ry + 6, { width: 70 });
        doc.fillColor(DARK).font('Helvetica').fontSize(8.5).text(sale.sqft ? sale.sqft.toLocaleString() : '—', 310, ry + 6, { width: 60 });
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8.5).text(fmtPrice(sale.price), 375, ry + 6, { width: 90 });
        doc.fillColor(GRAY).font('Helvetica').fontSize(8.5).text(`${sale.daysOnMarket || '—'} days`, 468, ry + 6, { width: 50 });
      });

      // ── Footer ────────────────────────────────────────────────
      doc.rect(0, H - 52, W, 52).fill(DARK);
      doc.rect(0, H - 52, W, 2).fill(GOLD);
      doc.fillColor('#AAAAAA').font('Helvetica').fontSize(7.5)
        .text('Matt Golden · MG Realty · Los Angeles · goldenmb@gmail.com · (323) 555-0100 · DRE #02130422', 40, H - 38, { width: W - 80, align: 'center' });
      doc.fillColor('#555').font('Helvetica').fontSize(6.5)
        .text('This report is generated for informational purposes and reflects AI-synthesized market estimates. Data should be verified with MLS sources before making real estate decisions.', 40, H - 22, { width: W - 80, align: 'center' });

      doc.end();
    });

    res.json({
      ok: true,
      pdfBase64,
      filename: `MG-Realty-${neighborhood.replace(/\s+/g, '-')}-Market-Report-${today.toISOString().split('T')[0]}.pdf`,
      data
    });
  } catch (e) {
    console.error('MARKET REPORT ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Text Blast ────────────────────────────────────────────────
app.post('/api/text-blast', async (req, res) => {
  try {
    const { message, leads } = req.body;
    if (!message || !leads || !leads.length) return res.status(400).json({ ok: false, error: 'Message and leads required' });

    const results = [];
    for (const lead of leads) {
      if (!lead.phone) { results.push({ id: lead.id, name: `${lead.first} ${lead.last}`, ok: false, error: 'No phone' }); continue; }
      try {
        // Personalise: swap {first} token
        const body = message.replace(/\{first\}/gi, lead.first || 'there');
        const sid = await sendSMS(lead.phone, body);
        results.push({ id: lead.id, name: `${lead.first} ${lead.last}`, ok: true, sid });
      } catch(e) {
        results.push({ id: lead.id, name: `${lead.first} ${lead.last}`, ok: false, error: e.message });
      }
      // 300ms between sends to stay well under Twilio rate limits
      await new Promise(r => setTimeout(r, 300));
    }

    const sent = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    res.json({ ok: true, sent, failed, results });
  } catch(e) {
    console.error('TEXT BLAST ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AI Deal Analyzer ──────────────────────────────────────────
app.post('/api/deal-analyze', async (req, res) => {
  try {
    const { listing, buyers } = req.body;
    if (!listing) return res.status(400).json({ ok: false, error: 'Listing text required' });

    const buyerContext = buyers && buyers.length
      ? buyers.map((b, i) => `Buyer ${i+1}: ${b.first} ${b.last} | Budget: ${b.prop || 'unspecified'} | Temp: ${b.temp} | Notes: ${b.notes || 'none'}`).join('\n')
      : 'No active buyers provided.';

    const prompt = `You are a sharp real estate analyst helping agent Matt Golden (MG Realty, Los Angeles) evaluate a listing.

LISTING:
${listing}

ACTIVE BUYERS:
${buyerContext}

Analyze this listing and respond with valid JSON only (no markdown, no commentary):
{
  "verdict": "BUY" or "PASS",
  "score": number 1-10,
  "headline": "one punchy sentence summarizing the deal",
  "pros": ["pro1", "pro2", "pro3"],
  "cons": ["con1", "con2"],
  "matchedBuyers": [{"name": "First Last", "reason": "why they'd want this"}],
  "priceRead": "your read on whether the asking price is fair, high, or a steal based on LA market knowledge",
  "agentNote": "one tactical tip for Matt on how to approach this deal"
}`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    let raw = msg.content[0].text.trim();
    if (raw.startsWith('```')) raw = raw.replace(/```json\n?|```\n?/g, '').trim();
    const analysis = JSON.parse(raw);
    res.json({ ok: true, analysis });
  } catch (e) {
    console.error('DEAL ANALYZE ERROR:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MG Realty backend running on port ${PORT}`));
