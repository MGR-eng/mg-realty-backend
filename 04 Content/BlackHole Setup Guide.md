# BlackHole Setup Guide
## Capture Video Call Audio in Meeting Notes

BlackHole is a free virtual audio driver that lets your Mac route meeting audio (Zoom, Google Meet, etc.) into the browser's microphone input — so the Meeting Notes recorder captures everything said on both sides of the call.

---

## Step 1 — Install BlackHole

1. Go to **https://existential.audio/blackhole/**
2. Click **Download** and choose **BlackHole 2ch** (free, no email required)
3. Open the downloaded `.pkg` file and run the installer
4. Restart your Mac when prompted

---

## Step 2 — Create a Multi-Output Device

This lets your Mac play audio through both your speakers AND BlackHole at the same time — so you still hear the call while it's being captured.

1. Open **Audio MIDI Setup** (search it in Spotlight with ⌘+Space)
2. Click the **+** button at the bottom left → **Create Multi-Output Device**
3. Check both:
   - ✅ **BlackHole 2ch**
   - ✅ **MacBook Pro Speakers** (or your headphones/monitor)
4. Right-click the new "Multi-Output Device" → **Use This Device For Sound Output**

> **Tip:** Name it "Meeting Capture" so it's easy to find.

---

## Step 3 — Set Your Mac's Output Before a Call

Before you start a Zoom or Google Meet call:

1. Click the **Volume icon** in the menu bar (or go to System Settings → Sound)
2. Set **Output** to **Multi-Output Device** (or whatever you named it in Step 2)

> You can switch back to regular speakers after the call.

---

## Step 4 — Select BlackHole in the CRM

1. Open the **Meeting Notes** pane in the CRM
2. In the **Audio source** dropdown under Live Recording, select **BlackHole 2ch**
3. Hit **Start Recording** — the recorder now captures call audio from both sides
4. When the call ends, hit **Stop** — Whisper transcribes it, Claude summarizes it, and you can save the PDF to Drive

---

## Quick Checklist Before Each Call

- [ ] Mac output set to Multi-Output Device
- [ ] CRM audio source set to BlackHole 2ch
- [ ] Hit Start Recording before the call begins

---

## Switching Back to Normal Audio

After the call, set your Mac's output back to **MacBook Pro Speakers** or headphones so regular audio works normally.

You can also create a quick **System Preferences shortcut** or use the menu bar volume toggle to make this a one-click switch.

---

## Troubleshooting

**I don't hear the call anymore**
→ Make sure both BlackHole AND your speakers are checked in the Multi-Output Device

**BlackHole doesn't appear in the CRM dropdown**
→ Reload the page and click "Start Recording" once to grant mic permission, then check the dropdown

**Recording is silent after transcription**
→ Make sure the Mac output was set to Multi-Output BEFORE the call started

