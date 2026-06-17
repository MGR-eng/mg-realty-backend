# Setting Up Ace — Your AI Phone Assistant
**Time needed: ~20 minutes**

---

## How It Works

```
Someone calls (323) 919-7539
        │
        ▼
Your iPhone rings (3–4 times, totally normal)
        │
   You answer? ──── YES ──→ Normal call, done.
        │
       NO
        │
        ▼
Ace picks up automatically
"Hey, thanks for calling MG Realty! This is Ace —
Matt's assistant. Looks like he just stepped away.
Can I take a message and make sure he gets back to you?"
        │
   Collects: name, buying/selling, neighborhood, timeline, callback #
        │
        ▼
You instantly get a text like:

  📞 Missed call — Ace took a message
  👤 Sarah Hernandez
  📱 (310) 555-0192
  🏷️ Seller
  📍 Silver Lake — 2347 Micheltorena St
  ⏱️ 60–90 days
  💬 "Wants to list her Silver Lake home, ready in 60-90 days."
  Lead saved in CRM ✓
        │
        ▼
Lead automatically appears in your MG Realty CRM
```

---

## Step 1 — Create Your Vapi Account

1. Go to **[vapi.ai](https://vapi.ai)** and sign up
2. Add a credit card — you'll pay about **$0.05–0.10/minute** of call time
   - For ~50 missed calls/month averaging 90 seconds each: **~$5–8/month**
3. You'll land on the Vapi dashboard

---

## Step 2 — Get a Vapi Phone Number

This is the number Ace "lives on" — calls forward here when you don't answer.

1. In the Vapi sidebar, click **Phone Numbers**
2. Click **Buy Number**
3. Search area code **323**
4. Buy any number (~$2/month)
5. **Save this number** — you'll need it in Step 4

---

## Step 3 — Create the Ace Assistant

1. In Vapi, click **Assistants** → **Create Assistant**
2. In the top-right corner, click the **`{ }` JSON** toggle to switch to JSON mode
3. Open the file **`ace-vapi-config.json`** from your Desktop mg-realty folder
4. Copy the entire contents and paste it into Vapi's editor
5. Click **Save**

> This loads Ace's full personality, screening script, and the webhook that auto-saves leads to your CRM.

---

## Step 4 — Assign Ace to Your Vapi Number

1. In Vapi, go back to **Phone Numbers**
2. Click on the number you just bought
3. Under **Inbound**, select **Ace — MG Realty** from the assistant dropdown
4. Click **Save**

**Test it:** Call your new Vapi number from another phone. Ace should pick up immediately. ✓

---

## Step 5 — Set Up Call Forwarding on Your iPhone

This is the magic step — when you don't answer (323) 919-7539, it automatically forwards to Ace.

**Find out your carrier first** (Settings → General → About → Carrier)

---

### T-Mobile / Metro
Open your **Phone app** and dial exactly:
```
**61*+1[YOUR VAPI NUMBER]**20#
```
Example: `**61*+13235550198**20#`

Then tap **Call**. You'll hear a confirmation tone.

---

### AT&T
Open your **Phone app** and dial:
```
*61*+1[YOUR VAPI NUMBER]#
```
Example: `*61*+13235550198#`

Then tap **Call**.

---

### Verizon
1. Open the **My Verizon app**
2. Go to Account → Manage Features → Call Forwarding
3. Set "Forward When Unanswered" to your Vapi number

---

### Google Fi
1. Open the **Google Fi app**
2. Phone Settings → Call Forwarding
3. Set "Forward When Unanswered" to your Vapi number

---

### To turn it OFF later
Dial `##61#` and tap Call. (Works on all carriers.)

---

## Step 6 — Test the Full Flow

1. Call (323) 919-7539 from another phone
2. Let it ring 3–4 times without answering
3. Ace should pick up with: *"Hey, thanks for calling MG Realty! This is Ace — Matt's assistant..."*
4. Leave a fake message as a "client"
5. Check your texts — you should get the summary SMS within 30 seconds
6. Open your MG Realty CRM → Leads — the fake lead should be there ✓

---

## What You'll See on Your iPhone

| Situation | What you see |
|-----------|-------------|
| You miss a call | Missed call notification (caller's real number) |
| Ace picks up | Nothing — it's handled |
| After Ace hangs up | Text from your Twilio number with the summary |
| In CRM | New lead under Leads, source: "Phone — Ace Screener" |

> Your missed calls still show up normally in your iPhone recents. The caller's number appears, not Ace's number.

---

## Ace's Exact Script

**Opening:**
> *"Hey, thanks for calling MG Realty! This is Ace — Matt's assistant. Looks like he just stepped away. Can I take a message and make sure he gets back to you?"*

**Getting info (natural conversation):**
- Name → What it's about (buy/sell) → Neighborhood/address → Timeline → Best callback number

**Close:**
> *"Perfect — Matt's going to have everything he needs. Talk soon!"*

**After hours (after 6pm / weekends):**
> Same script, but ends with: *"Matt will reach out first thing tomorrow morning."*

---

## Pricing Summary

| Item | Monthly cost |
|------|-------------|
| Vapi phone number | ~$2 |
| AI call time (50 calls × 90 sec avg) | ~$6 |
| **Total** | **~$8/month** |

---

## Need to Update Ace's Script?

Log into **vapi.ai** → Assistants → Ace → JSON editor → edit the `systemPrompt` field.
Changes go live immediately on the next call.

---

*Ace is part of the MG Realty team · Built on vapi.ai · Webhook: mg-realty-backend.onrender.com/api/vapi-webhook*
*MG Realty · Matt Golden · DRE #02130422 · (323) 919-7539 · matt@mgoldenrealty.com*
