import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { GoogleAuth } from 'google-auth-library';

const app = express();
app.use(cors({ origin: '*' }));
app.options('*', cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

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
app.get('/', (req, res) => res.json({ ok: true, service: 'MG Realty CRM Backend' }));

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

// ── Twilio SMS webhook ────────────────────────────────────────
app.post('/sms', async (req, res) => {
  try {
    const inboundMsg = (req.body.Body || '').trim();
    const from       = req.body.From || '';
    console.log(`SMS from ${from}: ${inboundMsg}`);

    const systemPrompt = `You are Matt Golden's real estate AI assistant for MG Realty (Los Angeles).
Matt texts you commands to manage his CRM. Reply under 160 chars when possible. Be direct and confirm what you did.

COMMAND FORMATS Matt uses:
• "log call [name] [outcome]" — e.g. "log call Sarah Chen no answer"
• "log text [name] [outcome]" — e.g. "log text Marcus Webb interested, follow up Friday"
• "log showing [name] [address]" — e.g. "log showing Linda Torres 123 Main St"
• "log offer [name] [outcome]" — e.g. "log offer Kevin Park accepted"
• "followup [name] [date] [method]" — e.g. "followup Sarah Chen tomorrow call"
• "stage [name] [stage]" — e.g. "stage Marcus Webb offer" (stages: new/contacted/showing/offer/closed)
• "temp [name] [temp]" — e.g. "temp Linda Torres hot"
• "note [name] [text]" — e.g. "note Kevin Park pre-approval came through 480k"
• "digest" — send the daily digest email
• "status [name]" — get a quick summary of a lead
• "overdue" — list overdue follow-ups
• "today" — list leads due today
• "help" — list commands

When Matt logs an activity or asks for lead info, respond with a JSON action block AND a human confirmation.
Format: {"action":"log_activity","lead":"Sarah Chen","type":"call","outcome":"no answer","followup":"2026-05-28","method":"call"}
Or: {"action":"update_stage","lead":"Marcus Webb","stage":"offer"}
Or: {"action":"update_temp","lead":"Linda Torres","temp":"hot"}
Or: {"action":"add_note","lead":"Kevin Park","note":"pre-approval 480k"}
Or: {"action":"send_digest"}
Or: {"action":"none"} for info-only replies.

Always include the JSON block first on its own line, then your human reply on the next line.
If you can't find a lead by name, say so and ask Matt to check the spelling.`;

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: inboundMsg }],
    });

    const raw = result.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

    // Parse action JSON if present
    let reply = raw;
    try {
      const jsonMatch = raw.match(/^\{.*\}/m);
      if (jsonMatch) {
        const action = JSON.parse(jsonMatch[0]);
        reply = raw.replace(jsonMatch[0], '').trim();
        // Fire action to CRM via a side-channel URL if configured
        // (CRM is localStorage-based so actions are advisory — logged for future webhook)
        console.log('SMS action:', JSON.stringify(action));
      }
    } catch(e) { /* no action block, plain reply */ }

    reply = reply || raw;
    if (reply.length > 320) reply = reply.substring(0, 317) + '…';

    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Message>
</Response>`);
  } catch (e) {
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error: ${e.message}</Message></Response>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MG Realty backend running on port ${PORT}`));
