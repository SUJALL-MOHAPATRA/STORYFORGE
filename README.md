# ✦ StoryForge — AI Story Generator

A locally-hosted AI-powered story generator with real-time streaming, fully editable interfaces, automatic summaries, character tracking, and intelligent story continuation.

---

## ⚡ Quick Start (Windows)

### Step 1 — Install Python
Download from https://python.org (3.10 or higher)
During install: ✅ check "Add Python to PATH"

### Step 2 — Get your FREE Groq API Key
1. Go to https://console.groq.com
2. Sign up (free, no credit card needed)
3. Click "API Keys" → "Create API Key"
4. Copy the key

### Step 3 — Add your API Key
Open `config/.env` in any text editor (Notepad is fine)
Replace `your_groq_api_key_here` with your actual key:
```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
```

### Step 4 — Run the app
Double-click `start.bat`
The browser will open automatically at http://localhost:8000

---

## 📁 Project Structure

```
STORYFORGE/
│
├── backend/
│   └── main.py                  ← FastAPI server + all AI endpoints
│
├── frontend/
│   ├── templates/
│   │   └── index.html           ← Main UI page
│   └── static/
│       ├── css/style.css        ← All styling
│       └── js/app.js            ← Frontend logic & streaming
│
├── config/
│   ├── .env                     ← Your API key goes here (KEEP SECRET, git-ignored)
│   └── .env.example             ← Safe template for reference
│
├── requirements.txt             ← Python packages
├── render.yaml                  ← Render deployment config
├── start.bat                    ← One-click launcher (Windows)
└── README.md                    ← This file
```

---

## 🎮 How to Use

### The Three Panels

**Panel 01 — Story Description** *(Optional)*
Describe your story — characters, setting, genre, length, mood.
Leave it blank and StoryForge will generate something unexpected.

**Panel 02 — Your Story**
The story appears here word by word as it generates.
You can edit this at any time — fix sentences, add your own writing, change character names — then click Continue to let the AI carry on from wherever you left it.

**Panel 03 — What Should Happen Next?** *(Optional)*
Give the AI a direction hint before generating or continuing.
The prompt is retained after each use so you can keep steering.

### Buttons

| Button | Action |
|--------|--------|
| **Generate Story** | Start fresh — appears when story area is empty |
| **Continue** | Continue from current content — appears when story has text |
| **Stop** | Stop generation mid-way, story stays as-is |
| **Undo (N)** | Roll back to state before last generation, N = undos available |
| **Copy Story** | Copy clean story text to clipboard |
| **Export PDF** | Download formatted A4 PDF with description and page numbers |
| **Save Session** | Download full session as .json file |
| **Load Session** | Restore a previously saved .json session |
| **Clear All** | Wipe everything and start fresh |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Enter` | Generate Story or Continue |
| `Ctrl + Z` | Undo last generation |
| `Escape` | Stop generation |

### Right-Click — Rewrite Selection
Select any passage in the story area → right-click → **Rewrite this**
The AI rewrites just that selection while keeping everything else untouched.

---

## 🧠 Smart Features

### Automatic Inline Summaries
Every 2000 story words, StoryForge automatically generates a compressed summary block and appends it to the story:
```
--- SUMMARY_1 ---
...summary of story so far...
--- END SUMMARY_1 ---
```
These blocks are visible and editable. The AI uses all summaries as context when continuing, preventing coherence loss in long stories. Summaries are automatically stripped from PDF exports.

### Character Tracker (Sidebar)
After each generation, named characters are automatically detected and listed in the sidebar. Click any character to add notes — appearance, personality, role — and the AI will keep them consistent in future generations.

### Story Summary Panel (Sidebar)
Click **Summarize** in the sidebar to get a 10–20 sentence overview of everything that has happened in the story so far. Useful for long sessions.

### Autosave
The current session is automatically saved to browser localStorage every 30 seconds and after every generation. If you close or refresh the browser accidentally, StoryForge will offer to restore your session on next load.

### Undo System
Before every generation or rewrite, the full state is saved to an undo stack (up to 10 states). Click **Undo** or press `Ctrl+Z` to roll back anytime.

---

## 🔧 Changing the AI Model

Open `config/.env` and add:
```
MODEL=llama-3.1-8b-instant
```

Available free Groq models:

| Model | Quality | Speed |
|-------|---------|-------|
| llama-3.3-70b-versatile | ⭐⭐⭐⭐⭐ Best | Fast |
| llama-3.1-8b-instant | ⭐⭐⭐ Good | Very Fast |
| mixtral-8x7b-32768 | ⭐⭐⭐⭐ Good | Fast |

---

## 🛠 Manual Start (if start.bat doesn't work)

Open a terminal in the project folder:
```bash
pip install -r requirements.txt
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Then open http://localhost:8000 in your browser.

### PyCharm Run Configuration
- **Mode:** Module
- **Module name:** `uvicorn`
- **Parameters:** `main:app --host 0.0.0.0 --port 8000 --reload`
- **Working directory:** `<project root>/backend`
- **Paths to .env:** `<project root>/config/.env`

---

## ☁️ Deployment (Render)

StoryForge is configured for deployment on [Render](https://render.com):

1. Push repo to GitHub
2. Create a new **Web Service** on Render, connect your repo
3. Render auto-detects `render.yaml` and fills settings
4. Add `GROQ_API_KEY` as an environment variable in the Render dashboard
5. Deploy — you'll get a live URL like `https://storyforge-xxxx.onrender.com`

> **Note:** Free tier on Render sleeps after 15 minutes of inactivity. First request after sleep takes ~30 seconds to wake up.

---

## 🔒 Privacy

- API key is stored only in `config/.env` locally, or as an environment variable on Render — never in code
- Stories are never stored server-side — all data stays in your browser (localStorage) unless you manually save a session file
- All AI calls go to Groq's API only

---

## ❓ Troubleshooting

**"API key not set" error**
→ Check `config/.env` — make sure there are no spaces around the `=`

**Button not responding / old behaviour after update**
→ Hard refresh: `Ctrl + Shift + R` in browser

**Browser doesn't open automatically**
→ Manually go to http://localhost:8000

**Generation is slow**
→ Switch to `llama-3.1-8b-instant` in `config/.env`

**"Connection error"**
→ Check your internet connection — Groq requires internet access