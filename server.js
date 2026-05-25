import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';

const app = express();
app.use(cors({ origin: '*' }));
app.options('*', cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Google OAuth token — set GOOGLE_ACCESS_TOKEN in Render env vars.
// To get one: https://developers.google.com/oauthplayground
// Scopes needed: Gmail send, Calendar, Drive/Sheets
const googleToken = () => {
  const t = process.env.GOOGLE_ACCESS_TOKEN || '';
  return t.startsWith('Bearer ') ? t : `Bearer ${t}`;
};

const GMAIL_MCP   = () => ({ type: 'url', url: 'https://gmailmcp.googleapis.com/mcp/v1',    name: 'gmail',  authorization_token: googleToken() });
const GCAL_MCP    = () => ({ type: 'url', url: 'https://calendarmcp.googleapis.com/mcp/v1',  name: 'gcal',   authorization_token: googleToken() });
const GDRIVE_MCP  = () => ({ type: 'url', url: 'https://drivemcp.googleapis.com/mcp/v1',     name: 'gdrive', authorization_token: googleToken() });

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
        <div style="background:#1A1914;padding:24px;border-radius:8px 8px 0 0">
          <h1 style="color:#fff;margin:0">MG Realty — Daily Digest</h1>
          <p style="color:#aaa;margin:4px 0 0">${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
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

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: 'goldenmb@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({ from: 'MG Realty <goldenmb@gmail.com>', to, subject, html });
    console.log(`Digest sent to ${to}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('DIGEST ERROR:', e.message, e.stack);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Google Drive: backup leads + activity ─────────────────────
app.post('/drive/backup', async (req, res) => {
  try {
    const { sheetId, leadsCsv, activityCsv } = req.body;
    const prompt = `Update Google Spreadsheet ID "${sheetId}".
Replace "Leads" sheet content with this CSV:
${leadsCsv}

Replace "Activity Log" sheet content with this CSV:
${activityCsv}

Return only: {"ok":true}`;
    const result = await callClaude(prompt, [GDRIVE_MCP()]);
    res.json({ ok: result.includes('ok'), raw: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Twilio SMS webhook ────────────────────────────────────────
app.post('/sms', async (req, res) => {
  try {
    const inboundMsg = req.body.Body || '';
    const from       = req.body.From || '';

    const systemPrompt = `You are Matt Golden's real estate AI assistant for MG Realty.
Matt will text you commands to manage his CRM. Respond concisely (under 160 chars when possible).

You can help with:
- Logging calls, texts, emails, showings, offers
- Scheduling follow-ups
- Answering questions about leads
- Creating calendar appointments
- Sending the daily digest

Always confirm what action you took. Be brief and direct.
If Matt asks something you can't action directly, tell him what to do in the CRM.`;

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: inboundMsg }],
    });

    const reply = result.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

    // Respond with TwiML
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
