from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import httpx
import json
import os
import re
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', 'config', '.env'))

app = FastAPI(title="AI Story Generator")

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), '..', 'frontend', 'static')), name="static")
templates = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), '..', 'frontend', 'templates'))

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL        = "llama-3.3-70b-versatile"


# ── Models ──────────────────────────────────────────────────────────────────

class StoryRequest(BaseModel):
    description:   str
    story_so_far:  str
    what_next:     str = ""
    mode:          str = "start"
    character_notes: dict = {}

class SummarizeRequest(BaseModel):
    chunk:          str
    summary_number: int

class CharactersRequest(BaseModel):
    new_text: str

class RewriteRequest(BaseModel):
    selected_text:  str
    before_context: str
    after_context:  str
    description:    str = ""


# ── Summary parser ───────────────────────────────────────────────────────────

def parse_story_for_prompt(story_text: str) -> dict:
    pattern = r'--- SUMMARY_(\d+) ---\n(.*?)\n--- END SUMMARY_\1 ---'
    matches = list(re.finditer(pattern, story_text, re.DOTALL))

    summaries = []
    for m in matches:
        summaries.append({
            "label":   f"SUMMARY_{m.group(1)}",
            "content": m.group(2).strip()
        })

    if matches:
        last_end    = matches[-1].end()
        recent_text = story_text[last_end:].strip()
    else:
        recent_text = story_text.strip()

    return {"summaries": summaries, "recent_text": recent_text}


# ── Prompt builders ──────────────────────────────────────────────────────────

def build_messages(req: StoryRequest) -> list:
    system_prompt = """You are a master storyteller. You write vivid, engaging, emotionally rich stories.
- Write naturally, as a human author would
- Match the tone and style already present in the story
- Do NOT repeat what has already been written
- Continue smoothly from exactly where the story left off
- Write 200-400 words per generation unless told otherwise
- Never add meta-commentary, just write the story"""

    if req.mode == "start":
        if req.description.strip():
            user_content = f"""Write the beginning of a story based on this description:

DESCRIPTION: {req.description}

Begin the story now. Do not write a title, just start the narrative."""
        else:
            user_content = "Write the beginning of an interesting, creative story of your choosing. Surprise me with the genre, setting and characters. Do not write a title, just start the narrative."

        if req.what_next.strip():
            user_content += f"\n\nAlso keep in mind for the story direction: {req.what_next}"

    else:
        parsed = parse_story_for_prompt(req.story_so_far)
        context_parts = []

        if req.description.strip():
            context_parts.append(f"ORIGINAL DESCRIPTION: {req.description}")
        else:
            context_parts.append("ORIGINAL DESCRIPTION: No description provided — continue the story naturally.")

        # Inject character notes if any exist
        if req.character_notes:
            notes_lines = []
            for name, note in req.character_notes.items():
                if note.strip():
                    notes_lines.append(f"- {name}: {note}")
                else:
                    notes_lines.append(f"- {name}: (no notes)")
            context_parts.append("CHARACTER NOTES (keep these consistent):\n" + "\n".join(notes_lines))

        if parsed["summaries"]:
            summary_block = "\n\n".join(
                f"[{s['label']}]\n{s['content']}"
                for s in parsed["summaries"]
            )
            context_parts.append(f"STORY SUMMARIES (compressed history):\n{summary_block}")

        if parsed["recent_text"]:
            context_parts.append(f"RECENT STORY TEXT (continue from here):\n{parsed['recent_text']}")

        if req.what_next.strip():
            context_parts.append(f"WHAT SHOULD HAPPEN NEXT: {req.what_next}")

        context_parts.append("Continue the story from exactly where the recent text ends. Do not repeat anything already written.")
        user_content = "\n\n".join(context_parts)

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_content}
    ]


def build_summary_messages(chunk: str, summary_number: int) -> list:
    system_prompt = """You are a precise story summarizer.
Your summaries are used as memory for an AI continuing the story.
- Be factual and complete — capture all key events, character developments, and plot points
- Write in past tense
- 10 to 15 sentences
- No commentary, just the summary itself"""

    user_content = f"""Summarize this portion of the story for SUMMARY_{summary_number}.
Capture all important events, characters introduced, and plot developments.

STORY CHUNK:
{chunk}

Write the summary now:"""

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_content}
    ]


def build_character_messages(new_text: str) -> list:
    system_prompt = """You extract character names from story text.
Return ONLY a JSON array of character first names (or full names if short).
Only include actual named characters — not unnamed roles like "the guard" or "a stranger".
If no named characters found, return an empty array [].
Return nothing else — no explanation, no markdown, just the raw JSON array."""

    user_content = f"""Extract all named characters from this story text:

{new_text}

Return only a JSON array like: ["Alice", "John", "Maria"]"""

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_content}
    ]


def build_story_summary_messages(story_text: str) -> list:
    system_prompt = """You are a story summarizer writing for the author.
- Write 10 to 20 sentences
- Cover all major events, character arcs, and plot developments so far
- Write in present tense as if describing what has happened
- Be clear and detailed — this helps the author remember the full story
- No commentary, just the summary"""

    user_content = f"""Summarize the full story so far for the author:

{story_text}

Write the summary now:"""

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_content}
    ]


def build_rewrite_messages(req: RewriteRequest) -> list:
    system_prompt = """You are a story editor. You rewrite selected passages.
- Match the tone, style, and voice of the surrounding text exactly
- Keep the same approximate length unless the original is very poor
- Do not add meta-commentary
- Return ONLY the rewritten passage, nothing else"""

    context = ""
    if req.before_context.strip():
        context += f"TEXT BEFORE THE SELECTION:\n{req.before_context}\n\n"
    if req.after_context.strip():
        context += f"TEXT AFTER THE SELECTION:\n{req.after_context}\n\n"
    if req.description.strip():
        context += f"STORY DESCRIPTION: {req.description}\n\n"

    user_content = f"""{context}PASSAGE TO REWRITE:
{req.selected_text}

Rewrite this passage now, matching the surrounding style:"""

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_content}
    ]


# ── Groq calls ───────────────────────────────────────────────────────────────

async def stream_groq(messages: list):
    if not GROQ_API_KEY:
        yield "data: " + json.dumps({"error": "GROQ_API_KEY not set. Please check your config/.env file."}) + "\n\n"
        return

    payload = {
        "model":       MODEL,
        "messages":    messages,
        "stream":      True,
        "temperature": 0.85,
        "max_tokens":  1024,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            async with client.stream(
                "POST", GROQ_API_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json=payload
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    yield "data: " + json.dumps({"error": f"API error {response.status_code}: {error_body.decode()}"}) + "\n\n"
                    return

                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            yield "data: [DONE]\n\n"
                            break
                        try:
                            chunk = json.loads(data)
                            delta = chunk["choices"][0]["delta"].get("content", "")
                            if delta:
                                yield "data: " + json.dumps({"token": delta}) + "\n\n"
                        except (json.JSONDecodeError, KeyError):
                            continue
        except httpx.RequestError as e:
            yield "data: " + json.dumps({"error": f"Connection error: {str(e)}"}) + "\n\n"


async def call_groq_sync(messages: list, temperature: float = 0.4, max_tokens: int = 512) -> str:
    if not GROQ_API_KEY:
        return "Error: GROQ_API_KEY not set."

    payload = {
        "model":       MODEL,
        "messages":    messages,
        "stream":      False,
        "temperature": temperature,
        "max_tokens":  max_tokens,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            response = await client.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
                json=payload
            )
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            return f"Error: {str(e)}"


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/generate")
async def generate_story(req: StoryRequest):
    messages = build_messages(req)
    return StreamingResponse(
        stream_groq(messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.post("/summarize")
async def summarize_chunk(req: SummarizeRequest):
    if not req.chunk.strip():
        raise HTTPException(status_code=400, detail="Empty chunk")
    messages = build_summary_messages(req.chunk, req.summary_number)
    summary  = await call_groq_sync(messages)
    return {"summary": summary, "summary_number": req.summary_number}


@app.post("/story-summary")
async def story_summary(req: SummarizeRequest):
    if not req.chunk.strip():
        raise HTTPException(status_code=400, detail="Empty story")
    messages = build_story_summary_messages(req.chunk)
    summary  = await call_groq_sync(messages, temperature=0.3, max_tokens=800)
    return {"summary": summary}


@app.post("/characters")
async def extract_characters(req: CharactersRequest):
    if not req.new_text.strip():
        return {"characters": []}
    messages = build_character_messages(req.new_text)
    result   = await call_groq_sync(messages, temperature=0.1, max_tokens=200)
    try:
        result   = result.strip()
        # Strip markdown fences if model adds them
        result   = re.sub(r'^```json|^```|```$', '', result, flags=re.MULTILINE).strip()
        names    = json.loads(result)
        if isinstance(names, list):
            return {"characters": [str(n) for n in names if n]}
    except Exception:
        pass
    return {"characters": []}


@app.post("/rewrite")
async def rewrite_selection(req: RewriteRequest):
    if not req.selected_text.strip():
        raise HTTPException(status_code=400, detail="No text selected")
    messages  = build_rewrite_messages(req)
    rewritten = await call_groq_sync(messages, temperature=0.75, max_tokens=512)
    return {"rewritten": rewritten}


@app.get("/health")
async def health():
    return {"status": "ok", "api_key_configured": bool(GROQ_API_KEY), "model": MODEL}