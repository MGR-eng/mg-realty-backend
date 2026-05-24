# MG Realty CRM Backend

## Deploy to Render (free)

1. Push this folder to a GitHub repo
2. Go to render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - Build command: `npm install`
   - Start command: `node server.js`
5. Add environment variable: `ANTHROPIC_API_KEY` = your key from console.anthropic.com
6. Click Deploy
7. Copy your Render URL (looks like https://mg-realty-backend.onrender.com)
8. Paste it into mg-realty-crm.html where it says PASTE_YOUR_BACKEND_URL_HERE

## Endpoints
- GET  /                  → health check
- POST /calendar/create   → create Google Calendar event
- POST /gmail/digest      → send daily digest email
- POST /drive/backup      → backup to Google Sheets
- POST /sms               → Twilio webhook for SMS commands
