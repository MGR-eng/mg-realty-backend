# 🏠 RE News Shortcut — Setup Guide

## Step 1: Push the server update

In your terminal:
```
cd ~/Desktop/mg-realty && git commit -m "Add /api/re-news — Claude-curated morning news brief" && git push origin main
```

Wait ~2 minutes for Render to deploy. Then test in your browser:
```
https://mg-realty.onrender.com/api/re-news
```
You should see a formatted news digest. If you get a slow response the first time, that's the server waking up — totally normal.

---

## Step 2: Build the Shortcut (2 minutes)

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** (top right) to create a new shortcut
3. Tap the shortcut name at the top → rename it **"🏠 RE News"**

**Add Action 1:**
- Tap **Add Action**
- Search: `Get Contents of URL`
- Tap it to add
- In the URL field, paste:
  ```
  https://mg-realty-backend.onrender.com/api/re-news
  ```

**Add Action 2:**
- Tap **+** below the first action
- Search: `Show Result`
- Tap it to add

4. Tap **Done** ✓

**Test it:** Tap the shortcut — after a few seconds you'll see today's news brief with tappable links.

**Add to Home Screen:**
- Open the shortcut → tap the **⋯** menu (top right)
- Tap **Add to Home Screen**
- Place it on your main screen for one-tap access

---

## Step 3: Set Up the Morning Automation

This makes the brief arrive automatically at 6:30am.

1. Open **Shortcuts** → tap **Automation** (bottom nav)
2. Tap **+** → **New Automation**
3. Tap **Time of Day**
   - Set time: **6:30 AM**
   - Repeat: **Daily**
   - Tap **Next**
4. Tap **Add Action**
   - Search: `Run Shortcut`
   - Tap it → choose **🏠 RE News**
5. **Turn off "Ask Before Running"** (toggle it off so it runs silently)
6. Tap **Done** ✓

The brief will now show up as a notification at 6:30am every morning. Tap it to read.

---

## How it works

- **6:25am** — Cowork wakes your Render server automatically
- **6:30am** — iOS runs the shortcut, fetches the brief
- **~5 seconds** — Claude reads headlines from 4 sources (Real Deal LA, Inman, HousingWire, Bisnow LA), picks the 7-9 most relevant stories, adds a one-liner on why each matters
- **Result** — A scrollable digest lands on your screen, organized into LA and National sections, with tappable links to full articles

---

## Sources

| Source | Focus |
|---|---|
| The Real Deal LA | LA deals, development, market |
| Inman News | Industry news, agent trends |
| HousingWire | Rates, lending, national market data |
| Bisnow LA | LA commercial + residential development |
