/* =============================
   StoryForge — app.js
   ============================= */

let isGenerating   = false;
let abortController = null;
let hasStory       = false;
let tokenQueue     = [];
let displayInterval = null;
let userScrolledUp = false;

// ── DOM refs ──
const descInput   = () => document.getElementById('descriptionInput');
const storyOutput = () => document.getElementById('storyOutput');
const whatNext    = () => document.getElementById('whatNextInput');
const btnGenerate = () => document.getElementById('btnGenerate');
const btnStop     = () => document.getElementById('btnStop');
const cursorBlink = () => document.getElementById('cursorBlink');
const genTag      = () => document.getElementById('generatingTag');
const statusDot   = () => document.querySelector('.status-dot');
const statusLabel = () => document.querySelector('.status-label');

// ── Counters ──
function updateCount(textareaId, countId) {
  const ta = document.getElementById(textareaId);
  const el = document.getElementById(countId);
  if (ta && el) el.textContent = ta.value.length + ' characters';
}

function updateStoryStats() {
  const text  = storyOutput().value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById('storyCount').textContent = text.length + ' characters';
  document.getElementById('wordCount').textContent  = words + ' words';
}

document.getElementById('descriptionInput').addEventListener('input', () => updateCount('descriptionInput', 'descCount'));
document.getElementById('whatNextInput').addEventListener('input',    () => updateCount('whatNextInput', 'nextCount'));
document.getElementById('storyOutput').addEventListener('input',      updateStoryStats);

// ── Auto-scroll ──
function autoScroll() {
  const ta = storyOutput();
  if (!userScrolledUp) {
    ta.scrollTop = ta.scrollHeight;
  }
}

storyOutput().addEventListener('scroll', () => {
  const ta = storyOutput();
  const atBottom = ta.scrollHeight - ta.scrollTop - ta.clientHeight < 40;
  userScrolledUp = !atBottom;
});

// ── Display loop (controls generation speed) ──
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

// ── Status bar ──
function setStatus(state) {
  const dot   = statusDot();
  const label = statusLabel();
  dot.className = 'status-dot';
  if (state === 'generating') {
    dot.classList.add('generating');
    label.textContent = 'Generating...';
  } else if (state === 'error') {
    dot.classList.add('error');
    label.textContent = 'Error';
  } else {
    label.textContent = 'Ready';
  }
}

// ── Button label toggle ──
function updateGenerateButton() {
  const btn        = btnGenerate();
  const hasContent = storyOutput().value.trim().length > 0;
  btn.querySelector('.btn-label').textContent = hasContent ? 'Continue' : 'Generate Story';
  btn.querySelector('.btn-icon').textContent  = hasContent ? '▶' : '◆';
}

// ── UI state ──
function setGeneratingUI(generating) {
  isGenerating = generating;
  btnGenerate().disabled  = generating;
  btnStop().style.display = generating ? 'flex' : 'none';
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

// ── Core streaming ──
async function streamGenerate(mode) {
  const description = descInput().value.trim();
  const storySoFar  = storyOutput().value;
  const next        = whatNext().value.trim();

  abortController = new AbortController();
  tokenQueue      = [];
  userScrolledUp  = false;
  setGeneratingUI(true);

  if (mode === 'continue' && storySoFar.trim()) {
    storyOutput().value;
  }

  startDisplayLoop();

  try {
    const res = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,
      body: JSON.stringify({ description, story_so_far: storySoFar, what_next: next, mode })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast(err.detail || 'Request failed', 'error');
      setStatus('error');
      stopDisplayLoop();
      setGeneratingUI(false);
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

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
            setStatus('error');
            stopDisplayLoop();
            setGeneratingUI(false);
            return;
          }
          if (parsed.token) {
            tokenQueue.push(...parsed.token.split(''));
          }
        } catch (_) { continue; }
      }
    }

    // Wait for display queue to drain before finishing
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (tokenQueue.length === 0) { clearInterval(check); resolve(); }
      }, 50);
    });

    stopDisplayLoop();
    hasStory = storyOutput().value.trim().length > 0;
    showToast('Generation complete ✦', 'success');

  } catch (err) {
    if (err.name === 'AbortError') {
      stopDisplayLoop();
      showToast('Generation stopped.', '');
    } else {
      stopDisplayLoop();
      showToast('Connection error: ' + err.message, 'error');
      setStatus('error');
    }
  }

  setGeneratingUI(false);
}

// ── Button actions ──
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

// ── Utilities ──
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
  clearField('storyOutput', 'storyCount');
  clearField('whatNextInput', 'nextCount');
  document.getElementById('wordCount').textContent = '0 words';
  hasStory = false;
  updateGenerateButton();
  showToast('Workspace cleared.', '');
}

function copyStory() {
  const text = storyOutput().value.trim();
  if (!text) { showToast('No story to copy.', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => showToast('Story copied to clipboard!', 'success'));
}

function downloadStory() {
  const text = storyOutput().value.trim();
  if (!text) { showToast('No story to download.', 'error'); return; }
  const desc = descInput().value.trim().slice(0, 40).replace(/[^a-z0-9 ]/gi, '').trim().replace(/\s+/g, '_') || 'story';
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `storyforge_${desc}.txt`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('Story downloaded!', 'success');
}

// ── Toast ──
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    if (!isGenerating) handleGenerate();
  }
  if (e.key === 'Escape' && isGenerating) stopGeneration();
});

// ── Init ──
updateGenerateButton();