/* =============================
   StoryForge — app.js
   ============================= */

let isGenerating    = false;
let abortController = null;
let hasStory        = false;
let tokenQueue      = [];
let displayInterval = null;
let userScrolledUp  = false;
let characterNotes  = {};
let undoStack       = [];      // each entry: { story, description, what_next, character_notes }

const WORDS_PER_SUMMARY = 2000;
const AUTOSAVE_KEY      = 'storyforge_autosave';
const AUTOSAVE_INTERVAL = 30000;
const MAX_UNDO          = 10;


// ── DOM refs ──────────────────────────────────────────────────────────────────

const descInput   = () => document.getElementById('descriptionInput');
const storyOutput = () => document.getElementById('storyOutput');
const whatNext    = () => document.getElementById('whatNextInput');
const btnGenerate = () => document.getElementById('btnGenerate');
const btnStop     = () => document.getElementById('btnStop');
const btnUndo     = () => document.getElementById('btnUndo');
const cursorBlink = () => document.getElementById('cursorBlink');
const genTag      = () => document.getElementById('generatingTag');
const statusDot   = () => document.querySelector('.status-dot');
const statusLabel = () => document.querySelector('.status-label');
const autosaveEl  = () => document.getElementById('autosaveIndicator');


// ── Counters ──────────────────────────────────────────────────────────────────

function updateCount(textareaId, countId) {
  const ta = document.getElementById(textareaId);
  const el = document.getElementById(countId);
  if (ta && el) el.textContent = ta.value.length + ' characters';
}

function updateStoryStats() {
  const text  = storyOutput().value;
  const words = countStoryWords(text);
  document.getElementById('storyCount').textContent = text.length + ' characters';
  document.getElementById('wordCount').textContent  = words + ' words';
}

document.getElementById('descriptionInput').addEventListener('input', () => updateCount('descriptionInput', 'descCount'));
document.getElementById('whatNextInput').addEventListener('input',    () => updateCount('whatNextInput', 'nextCount'));
document.getElementById('storyOutput').addEventListener('input',      updateStoryStats);


// ── Undo system ───────────────────────────────────────────────────────────────

function pushUndo() {
  undoStack.push({
    story:           storyOutput().value,
    description:     descInput().value,
    what_next:       whatNext().value,
    character_notes: JSON.parse(JSON.stringify(characterNotes))
  });
  // Keep stack capped
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  updateUndoButton();
}

function undoGeneration() {
  if (undoStack.length === 0) return;
  const prev = undoStack.pop();
  descInput().value   = prev.description;
  storyOutput().value = prev.story;
  whatNext().value    = prev.what_next;
  characterNotes      = prev.character_notes;
  updateCount('descriptionInput', 'descCount');
  updateCount('whatNextInput',    'nextCount');
  updateStoryStats();
  renderCharacters();
  hasStory = storyOutput().value.trim().length > 0;
  updateGenerateButton();
  updateUndoButton();
  showToast(`Undo — ${undoStack.length} more available`, '');
}

function updateUndoButton() {
  const btn = btnUndo();
  btn.disabled = undoStack.length === 0;
  const count = undoStack.length;
  btn.querySelector('.btn-label').textContent = count > 0 ? `Undo (${count})` : 'Undo';
}


// ── Summary helpers ───────────────────────────────────────────────────────────

function countStoryWords(text) {
  const cleaned = removeSummaryBlocks(text);
  return cleaned.trim() ? cleaned.trim().split(/\s+/).length : 0;
}

function removeSummaryBlocks(text) {
  return text.replace(/--- SUMMARY_\d+ ---\n[\s\S]*?\n--- END SUMMARY_\d+ ---/g, '');
}

function getHighestSummaryNumber(text) {
  const matches = [...text.matchAll(/--- SUMMARY_(\d+) ---/g)];
  if (matches.length === 0) return 0;
  return Math.max(...matches.map(m => parseInt(m[1])));
}

function getTextAfterLastSummary(text) {
  const pattern = /--- END SUMMARY_\d+ ---/g;
  let lastMatch = null, m;
  while ((m = pattern.exec(text)) !== null) lastMatch = m;
  if (!lastMatch) return text;
  return text.slice(lastMatch.index + lastMatch[0].length).trim();
}

function getChunkForSummary(text, summaryNumber) {
  const prevPattern = summaryNumber > 1
    ? new RegExp(`--- END SUMMARY_${summaryNumber - 1} ---`)
    : null;
  let startIndex = 0;
  if (prevPattern) {
    const m = prevPattern.exec(text);
    if (m) startIndex = m.index + m[0].length;
  }
  return removeSummaryBlocks(text.slice(startIndex)).trim();
}

function shouldGenerateSummary(text) {
  const totalWords     = countStoryWords(text);
  const highestSummary = getHighestSummaryNumber(text);
  const nextThreshold  = (highestSummary + 1) * WORDS_PER_SUMMARY;
  return totalWords >= nextThreshold ? highestSummary + 1 : null;
}


// ── Auto-summary (inline blocks) ──────────────────────────────────────────────

async function checkAndGenerateSummary() {
  const text          = storyOutput().value;
  const summaryNeeded = shouldGenerateSummary(text);
  if (!summaryNeeded) return;

  const chunk = getChunkForSummary(text, summaryNeeded);
  if (!chunk || chunk.split(/\s+/).length < 100) return;

  setStatus('summarizing');

  try {
    const res = await fetch('/summarize', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunk, summary_number: summaryNeeded })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.summary) return;

    const currentText  = storyOutput().value;
    const summaryBlock = `\n\n--- SUMMARY_${summaryNeeded} ---\n${data.summary}\n--- END SUMMARY_${summaryNeeded} ---\n\n`;
    storyOutput().value = currentText.trimEnd() + summaryBlock;

    updateStoryStats();
    autoScroll();
    showToast(`Summary ${summaryNeeded} generated ✦`, 'success');
  } catch (e) {
    console.warn('Summary generation failed:', e);
  }

  setStatus('ready');
}


// ── Story summary panel ───────────────────────────────────────────────────────

async function generateStorySummary() {
  const text = removeSummaryBlocks(storyOutput().value).trim();
  if (!text) { showToast('No story to summarize.', 'error'); return; }

  const btn = document.getElementById('btnStorySummary');
  btn.disabled    = true;
  btn.textContent = 'Working...';
  setStatus('summarizing');

  try {
    const res = await fetch('/story-summary', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunk: text, summary_number: 0 })
    });
    if (!res.ok) throw new Error('Request failed');
    const data = await res.json();
    const el   = document.getElementById('storySummaryContent');
    el.innerHTML = `<p class="story-summary-text">${data.summary.replace(/\n/g, '<br>')}</p>`;
    showToast('Story summarized ✦', 'success');
  } catch (e) {
    showToast('Summary failed.', 'error');
  }

  btn.disabled    = false;
  btn.textContent = 'Summarize';
  setStatus('ready');
}


// ── Character tracker ─────────────────────────────────────────────────────────

async function detectCharacters(newText) {
  if (!newText || !newText.trim()) return;
  try {
    const res = await fetch('/characters', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_text: newText })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.characters || data.characters.length === 0) return;

    let added = false;
    for (const name of data.characters) {
      if (!characterNotes.hasOwnProperty(name)) {
        characterNotes[name] = '';
        added = true;
      }
    }
    if (added) renderCharacters();
  } catch (e) {
    console.warn('Character detection failed:', e);
  }
}

function renderCharacters() {
  const list  = document.getElementById('characterList');
  const names = Object.keys(characterNotes);

  if (names.length === 0) {
    list.innerHTML = '<p class="sidebar-empty">Characters detected in the story will appear here.</p>';
    return;
  }

  list.innerHTML = names.map(name => `
    <div class="character-card">
      <div class="character-name">${name}</div>
      <textarea
        class="character-note"
        placeholder="Add notes — appearance, personality, role..."
        oninput="characterNotes['${name}'] = this.value"
      >${characterNotes[name] || ''}</textarea>
    </div>
  `).join('');
}


// ── Rewrite selection ─────────────────────────────────────────────────────────

let selectionStart = 0;
let selectionEnd   = 0;

storyOutput().addEventListener('contextmenu', (e) => {
  const ta    = storyOutput();
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  if (start === end) return;

  e.preventDefault();
  selectionStart = start;
  selectionEnd   = end;

  const menu = document.getElementById('contextMenu');
  menu.style.display = 'block';
  menu.style.left    = e.clientX + 'px';
  menu.style.top     = e.clientY + 'px';
});

document.addEventListener('click', () => {
  document.getElementById('contextMenu').style.display = 'none';
});

async function rewriteSelection() {
  document.getElementById('contextMenu').style.display = 'none';

  const ta           = storyOutput();
  const fullText     = ta.value;
  const selectedText = fullText.slice(selectionStart, selectionEnd);
  if (!selectedText.trim()) { showToast('No text selected.', 'error'); return; }

  const contextWindow = 300;
  const beforeContext = fullText.slice(Math.max(0, selectionStart - contextWindow), selectionStart);
  const afterContext  = fullText.slice(selectionEnd, Math.min(fullText.length, selectionEnd + contextWindow));
  const description   = descInput().value.trim();

  // Push undo before rewriting
  pushUndo();
  setStatus('generating');
  showToast('Rewriting selection...', '');

  try {
    const res = await fetch('/rewrite', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_text: selectedText, before_context: beforeContext, after_context: afterContext, description })
    });
    if (!res.ok) throw new Error('Rewrite failed');
    const data = await res.json();
    ta.value = fullText.slice(0, selectionStart) + data.rewritten + fullText.slice(selectionEnd);
    updateStoryStats();
    showToast('Rewrite done ✦', 'success');
  } catch (e) {
    showToast('Rewrite failed.', 'error');
  }

  setStatus('ready');
}


// ── PDF export ────────────────────────────────────────────────────────────────

function exportToPDF() {
  const text = getCleanStory();
  if (!text) { showToast('No story to export.', 'error'); return; }

  const { jsPDF } = window.jspdf;
  const doc      = new jsPDF({ unit: 'mm', format: 'a4' });

  const pageW    = doc.internal.pageSize.getWidth();
  const pageH    = doc.internal.pageSize.getHeight();
  const marginL  = 20;
  const marginR  = 20;
  const marginT  = 20;
  const marginB  = 20;
  const maxLineW = pageW - marginL - marginR;
  let   cursorY  = marginT;

  function checkPageBreak(neededHeight) {
    if (cursorY + neededHeight > pageH - marginB) {
      doc.addPage();
      cursorY = marginT;
    }
  }

  // ── Title ──
  doc.setFont('times', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(0);
  doc.text('Untitled Story', marginL, cursorY);
  cursorY += 10;

  // ── Date ──
  doc.setFont('times', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Generated by StoryForge — ' + new Date().toLocaleDateString(), marginL, cursorY);
  cursorY += 6;

  // ── Divider ──
  doc.setDrawColor(180);
  doc.line(marginL, cursorY, pageW - marginR, cursorY);
  cursorY += 6;

  // ── Description section ──
  const rawDesc = descInput().value.trim();
  if (rawDesc) {
    doc.setFont('times', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(80);
    doc.text('Description', marginL, cursorY);
    cursorY += 5;

    doc.setFont('times', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(80);
    const descLines = doc.splitTextToSize(rawDesc, maxLineW);
    checkPageBreak(descLines.length * 5 + 4);
    doc.text(descLines, marginL, cursorY);
    cursorY += descLines.length * 5 + 4;

    // Divider after description
    doc.setDrawColor(200);
    doc.line(marginL, cursorY, pageW - marginR, cursorY);
    cursorY += 7;
  }

  // ── Story body ──
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(0);
  const lineHeight = 6;

  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  for (const para of paragraphs) {
    const lines = doc.splitTextToSize(para.trim(), maxLineW);
    checkPageBreak(lines.length * lineHeight + 4);
    doc.text(lines, marginL, cursorY);
    cursorY += lines.length * lineHeight + 4;
  }

  // ── Page numbers ──
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text(`${i} / ${totalPages}`, pageW / 2, pageH - 10, { align: 'center' });
  }

  // ── Save ──
  const filename = 'storyforge_' +
    new Date().toISOString().slice(0, 10) + '_story.pdf';
  doc.save(filename);
  showToast('PDF exported ✦', 'success');
}

// ── Volatile autosave ─────────────────────────────────────────────────────────

function buildSaveData() {
  return {
    description:     descInput().value,
    story:           storyOutput().value,
    what_next:       whatNext().value,
    character_notes: characterNotes,
    saved_at:        new Date().toISOString()
  };
}

function restoreFromData(data) {
  descInput().value   = data.description     || '';
  storyOutput().value = data.story           || '';
  whatNext().value    = data.what_next       || '';
  characterNotes      = data.character_notes || {};
  updateCount('descriptionInput', 'descCount');
  updateCount('whatNextInput',    'nextCount');
  updateStoryStats();
  renderCharacters();
  hasStory = storyOutput().value.trim().length > 0;
  updateGenerateButton();
  updateUndoButton();
}

function autoSave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(buildSaveData()));
    const el = autosaveEl();
    el.textContent = 'autosaved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setTimeout(() => { el.textContent = ''; }, 3000);
  } catch (e) {
    console.warn('Autosave failed:', e);
  }
}

function checkAutosaveOnLoad() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data.story || !data.story.trim()) return;
    const savedAt = new Date(data.saved_at).toLocaleString();
    if (confirm(`StoryForge found an autosaved session from ${savedAt}.\n\nRestore it?`)) {
      restoreFromData(data);
      showToast('Session restored from autosave ✦', 'success');
    }
  } catch (e) {
    console.warn('Autosave restore failed:', e);
  }
}

setInterval(autoSave, AUTOSAVE_INTERVAL);


// ── Manual save / load ────────────────────────────────────────────────────────

function saveSession() {
  const data = buildSaveData();
  if (!data.story.trim() && !data.description.trim()) {
    showToast('Nothing to save yet.', 'error'); return;
  }
  const filename = 'storyforge_' +
    new Date().toISOString().slice(0, 10) + '_' +
    (data.description.trim().slice(0, 20).replace(/[^a-z0-9 ]/gi, '').trim().replace(/\s+/g, '_') || 'session') +
    '.json';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('Session saved ✦', 'success');
}

function triggerLoadSession() {
  document.getElementById('loadFileInput').click();
}

function loadSession(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.story && !data.description) { showToast('Invalid session file.', 'error'); return; }
      if (storyOutput().value.trim()) {
        if (!confirm('Loading will replace your current story. Continue?')) return;
      }
      restoreFromData(data);
      showToast('Session loaded ✦', 'success');
    } catch (err) {
      showToast('Could not read file.', 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}


// ── Auto-scroll ───────────────────────────────────────────────────────────────

function autoScroll() {
  const ta = storyOutput();
  if (!userScrolledUp) ta.scrollTop = ta.scrollHeight;
}

storyOutput().addEventListener('scroll', () => {
  const ta       = storyOutput();
  const atBottom = ta.scrollHeight - ta.scrollTop - ta.clientHeight < 40;
  userScrolledUp = !atBottom;
});


// ── Display loop ──────────────────────────────────────────────────────────────

function startDisplayLoop() {
  if (displayInterval) return;
  displayInterval = setInterval(() => {
    if (tokenQueue.length === 0) return;
    const batch = tokenQueue.splice(0, 2).join('');
    storyOutput().value += batch;
    updateStoryStats();
    autoScroll();
  }, 30);
}

function stopDisplayLoop() {
  clearInterval(displayInterval);
  displayInterval = null;
  if (tokenQueue.length > 0) {
    storyOutput().value += tokenQueue.join('');
    tokenQueue = [];
    updateStoryStats();
    autoScroll();
  }
}


// ── Status bar ────────────────────────────────────────────────────────────────

function setStatus(state) {
  const dot   = statusDot();
  const label = statusLabel();
  dot.className = 'status-dot';
  if (state === 'generating') {
    dot.classList.add('generating');
    label.textContent = 'Generating...';
  } else if (state === 'summarizing') {
    dot.classList.add('generating');
    label.textContent = 'Summarizing...';
  } else if (state === 'error') {
    dot.classList.add('error');
    label.textContent = 'Error';
  } else {
    label.textContent = 'Ready';
  }
}


// ── Button label toggle ───────────────────────────────────────────────────────

function updateGenerateButton() {
  const btn        = btnGenerate();
  const hasContent = storyOutput().value.trim().length > 0;
  btn.querySelector('.btn-label').textContent = hasContent ? 'Continue' : 'Generate Story';
  btn.querySelector('.btn-icon').textContent  = hasContent ? '▶' : '◆';
}


// ── UI state ──────────────────────────────────────────────────────────────────

function setGeneratingUI(generating) {
  isGenerating            = generating;
  btnGenerate().disabled  = generating;
  btnStop().style.display = generating ? 'flex' : 'none';
  btnUndo().disabled      = generating || undoStack.length === 0;
  cursorBlink().style.display = generating ? 'block' : 'none';
  genTag().style.display  = generating ? 'flex' : 'none';
  setStatus(generating ? 'generating' : 'ready');
  updateGenerateButton();
}

function onStoryEdit() {
  updateStoryStats();
  hasStory = storyOutput().value.trim().length > 0;
  updateGenerateButton();
}


// ── Core streaming ────────────────────────────────────────────────────────────

async function streamGenerate(mode) {
  const description = descInput().value.trim();
  const storySoFar  = storyOutput().value;
  const next        = whatNext().value.trim();

  // Save state to undo stack before generating
  pushUndo();

  abortController = new AbortController();
  tokenQueue      = [];
  userScrolledUp  = false;
  setGeneratingUI(true);
  startDisplayLoop();

  try {
    const res = await fetch('/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  abortController.signal,
      body: JSON.stringify({
        description,
        story_so_far:    storySoFar,
        what_next:       next,
        mode,
        character_notes: characterNotes
      })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast(err.detail || 'Request failed', 'error');
      setStatus('error'); stopDisplayLoop(); setGeneratingUI(false); return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';
    let newText   = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { buffer = ''; break; }

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            showToast(parsed.error, 'error');
            setStatus('error'); stopDisplayLoop(); setGeneratingUI(false); return;
          }
          if (parsed.token) {
            tokenQueue.push(...parsed.token.split(''));
            newText += parsed.token;
          }
        } catch (_) { continue; }
      }
    }

    await new Promise(resolve => {
      const check = setInterval(() => {
        if (tokenQueue.length === 0) { clearInterval(check); resolve(); }
      }, 50);
    });

    stopDisplayLoop();
    hasStory = storyOutput().value.trim().length > 0;
    showToast('Generation complete ✦', 'success');

    autoSave();

    await Promise.all([
      checkAndGenerateSummary(),
      detectCharacters(newText)
    ]);

  } catch (err) {
    if (err.name === 'AbortError') {
      stopDisplayLoop();
      showToast('Generation stopped.', '');
      autoSave();
    } else {
      stopDisplayLoop();
      showToast('Connection error: ' + err.message, 'error');
      setStatus('error');
    }
  }

  setGeneratingUI(false);
}


// ── Button actions ────────────────────────────────────────────────────────────

function handleGenerate() {
  if (isGenerating) return;
  const hasContent = storyOutput().value.trim().length > 0;
  if (hasContent) {
    streamGenerate('continue');
  } else {
    storyOutput().value = '';
    streamGenerate('start');
  }
}

function stopGeneration() {
  if (abortController) abortController.abort();
  stopDisplayLoop();
}


// ── Utilities ─────────────────────────────────────────────────────────────────

function clearField(textareaId, countId) {
  document.getElementById(textareaId).value = '';
  if (countId) document.getElementById(countId).textContent = '0 characters';
  if (textareaId === 'storyOutput') {
    hasStory = false;
    updateStoryStats();
    updateGenerateButton();
  }
}

function clearAll() {
  if (isGenerating) { showToast('Stop generation first.', 'error'); return; }
  if (!confirm('Clear everything and start fresh?')) return;
  clearField('descriptionInput', 'descCount');
  clearField('storyOutput',      'storyCount');
  clearField('whatNextInput',    'nextCount');
  document.getElementById('wordCount').textContent = '0 words';
  characterNotes = {};
  undoStack      = [];
  renderCharacters();
  updateUndoButton();
  document.getElementById('storySummaryContent').innerHTML =
    '<p class="sidebar-empty">Click Summarize to get a running summary of your story so far.</p>';
  hasStory = false;
  updateGenerateButton();
  localStorage.removeItem(AUTOSAVE_KEY);
  showToast('Workspace cleared.', '');
}

function copyStory() {
  const text = storyOutput().value.trim();
  if (!text) { showToast('No story to copy.', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => showToast('Story copied to clipboard!', 'success'));
}

function getCleanStory() {
  return removeSummaryBlocks(storyOutput().value).replace(/\n{3,}/g, '\n\n').trim();
}

// ── Toast ──────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}


// ── Keyboard shortcuts ─────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    if (!isGenerating) handleGenerate();
  }
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    if (!isGenerating) undoGeneration();
  }
  if (e.key === 'Escape' && isGenerating) stopGeneration();
});


// ── Init ───────────────────────────────────────────────────────────────────────
updateGenerateButton();
updateUndoButton();
checkAutosaveOnLoad();