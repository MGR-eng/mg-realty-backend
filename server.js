import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Google OAuth token — set GOOGLE_ACCESS_TOKEN in Render env vars.
// To get one: https://developers.google.com/oauthplayground
// Scopes needed: Gmail send, Calendar, Drive/Sheets
const googleToken = () => process.env.GOOGLE_ACCESS_TOKEN || '';

const GMAIL_MCP   = () => ({ type: 'url', url: 'https://gmailmcp.googleapis.com/mcp/v1',    name: 'gmail',  authorization_token: googleToken() });
const GCAL_MCP    = () => ({ type: 'url', url: 'https://calendarmcp.googleapis.com/mcp/v1',  name: 'gcal',   authorization_token: googleToken() });
const GDRIVE_MCP  = () => ({ type: 'url', url: 'https://drivemcp.googleapis.com/mcp/v1',     name: 'gdrive', authorization_token: googleToken() });

async function callClaude(prompt, mcpServers = []) {
  const params = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  };
  if (mcpServers.length) params.mcp_servers = mcpServers;
  const resp = await anthropic.messages.create(params);
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

// ── Gmail: send digest ────────────────────────────────────────
app.post('/gmail/digest', async (req, res) => {
  try {
    const { to, subject, overdue, dueToday, dueWeek, appointments, recentActivity } = req.body;
    const fmt = l => `• ${l.first} ${l.last} | ${l.phone || '—'} | ${l.temp.toUpperCase()} | Follow-up: ${l.method} on ${l.followup || 'not set'} | Notes: ${(l.notes || '').substring(0, 80)}`;
    const apptFmt = a => `• ${a.leadName} | ${a.type} | ${a.date} ${a.time} | ${a.address || 'TBD'}`;
    const actFmt  = a => `• ${a.leadName} | ${a.type} | ${a.outcome} | ${a.date}`;

    const prompt = `Send an HTML email to ${to} with subject: "${subject}"

Create a clean professional HTML email with dark header #1A1914, white title, colored sections.

OVERDUE (${overdue.length}):
${overdue.length ? overdue.map(fmt).join('\n') : 'None'}

DUE TODAY (${dueToday.length}):
${dueToday.length ? dueToday.map(fmt).join('\n') : 'None'}

DUE THIS WEEK (${dueWeek.length}):
${dueWeek.length ? dueWeek.map(fmt).join('\n') : 'None'}

UPCOMING APPOINTMENTS:
${appointments.length ? appointments.map(apptFmt).join('\n') : 'None'}

RECENT ACTIVITY (last 5):
${recentActivity.length ? recentActivity.map(actFmt).join('\n') : 'None'}

End with: "Open your MG Realty CRM to take action."
Return only: {"ok":true}`;

    const result = await callClaude(prompt, [GMAIL_MCP()]);
    res.json({ ok: result.includes('ok'), raw: result });
  } catch (e) {
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
