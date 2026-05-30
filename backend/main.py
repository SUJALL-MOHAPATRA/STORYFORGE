from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import httpx
import json
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', 'config', '.env'))

app = FastAPI(title="AI Story Generator")

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), '..', 'frontend', 'static')), name="static")
templates = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), '..', 'frontend', 'templates'))

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.3-70b-versatile"


class StoryRequest(BaseModel):
    description: str
    story_so_far: str
    what_next: str = ""
    mode: str = "start"


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
        user_content = f"""Here is the story description and the story written so far. Continue it naturally.

DESCRIPTION: {req.description if req.description.strip() else "No description provided — continue the story naturally."}

STORY SO FAR:
{req.story_so_far}"""

        if req.what_next.strip():
            user_content += f"\n\nWHAT SHOULD HAPPEN NEXT: {req.what_next}"

        user_content += "\n\nContinue the story from exactly where it left off. Do not repeat any part of what's already written."

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content}
    ]


async def stream_groq(messages: list):
    if not GROQ_API_KEY:
        yield "data: " + json.dumps({"error": "GROQ_API_KEY not set. Please check your config/.env file."}) + "\n\n"
        return

    payload = {
        "model": MODEL,
        "messages": messages,
        "stream": True,
        "temperature": 0.85,
        "max_tokens": 1024,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            async with client.stream("POST", GROQ_API_URL,
                                     headers={"Authorization": f"Bearer {GROQ_API_KEY}",
                                              "Content-Type": "application/json"},
                                     json=payload) as response:
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


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/generate")
async def generate_story(req: StoryRequest):
    messages = build_messages(req)
    return StreamingResponse(stream_groq(messages), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/health")
async def health():
    key_set = bool(GROQ_API_KEY)
    return {"status": "ok", "api_key_configured": key_set, "model": MODEL}