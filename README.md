# ✦ StoryForge — AI Story Generator

A local AI-powered story generator with streaming output, fully editable interfaces, and intelligent story continuation.

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
story-generator/
│
├── backend/
│   └── main.py              ← FastAPI server + AI logic
│
├── frontend/
│   ├── templates/
│   │   └── index.html       ← Main UI page
│   └── static/
│       ├── css/style.css    ← All styling
│       └── js/app.js        ← Frontend logic & streaming
│
├── config/
│   └── .env                 ← Your API key goes here (KEEP SECRET)
│
├── requirements.txt         ← Python packages
├── start.bat                ← One-click launcher (Windows)
└── README.md                ← This file
```

---

## 🎮 How to Use

### The Three Panels:

**Panel 01 — Story Description**
Describe your story: characters, setting, genre, length, mood.
This acts as the AI's permanent context throughout generation.

**Panel 02 — Your Story**
The story appears here word by word.
**You can edit this at any time** — fix sentences, add your own writing, change character names — then click Continue to let the AI carry on from wherever you left it.

**Panel 03 — What Should Happen Next? (Optional)**
Give the AI a direction hint before generating or continuing.
This is cleared after each use so you can set a new direction each time.

### Buttons:
- **Generate Story** — Start fresh from your description
- **Continue** — Continue from current story content (even if you edited it)
- **Stop** — Stop generation mid-way (the story stays as-is, ready to edit/continue)
- **Copy Story** — Copies story text to clipboard
- **Download** — Saves story as a .txt file

### Keyboard Shortcuts:
- `Ctrl + Enter` → Generate or Continue
- `Escape` → Stop generation

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

Open a terminal/command prompt in the project folder:
```bash
pip install -r requirements.txt
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Then open http://localhost:8000 in your browser.

---

## 🔒 Privacy
- Your API key is stored only in `config/.env` on your machine
- Stories are never saved unless you download them
- No data is sent anywhere except to Groq's API for generation

---

## ❓ Troubleshooting

**"API key not set" error**
→ Check config/.env — make sure there are no spaces around the `=`

**Browser doesn't open automatically**
→ Manually go to http://localhost:8000

**Generation is slow**
→ Try switching to `llama-3.1-8b-instant` in config/.env

**"Connection error"**
→ Check your internet connection; Groq requires internet access
