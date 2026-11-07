"""Capa 2 opcional: modelo de lenguaje LOCAL (Ollama) solo para reescribir con calidez
frases ya calculadas por reglas. Nunca recibe notas ni identificadores. Si no está
disponible, falla o su salida no pasa las validaciones, se usa la plantilla original.

Activar:  set PAUSA_LLM=ollama   (opcional: set PAUSA_LLM_MODEL=llama3.2:3b)"""
import json
import os
import urllib.request

ENDPOINT = os.environ.get("PAUSA_OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("PAUSA_LLM_MODEL", "llama3.2:3b")
FORBIDDEN = ("adicci", "adicto", "diagn", "trastorno", "debes", "tienes que", "culpa", "vergüenza",
             "porn", "sexual", "racha", "puntaje", "fracaso", "recaída", "recaida")

PROMPT = """Reescribe cada frase en español neutro, cálido y breve (máximo 30 palabras cada una).
Reglas: conserva los números exactos; usa lenguaje de posibilidad ("parece que");
no juzgues, no diagnostiques, no des consejos médicos, no menciones contenido sexual.
Devuelve SOLO un JSON con la forma {{"frases": ["...", "..."]}} con {n} frases.
Frases:
{items}"""


def enabled() -> bool:
    return os.environ.get("PAUSA_LLM", "").lower() == "ollama"


def available() -> bool:
    if not enabled():
        return False
    try:
        with urllib.request.urlopen(ENDPOINT + "/api/tags", timeout=1.5) as r:
            return r.status == 200
    except OSError:
        return False


def _valid(original: list, rewritten: list) -> bool:
    if not isinstance(rewritten, list) or len(rewritten) != len(original):
        return False
    for src, out in zip(original, rewritten):
        if not isinstance(out, str) or not (10 <= len(out) <= 240):
            return False
        low = out.lower()
        if any(w in low for w in FORBIDDEN):
            return False
        nums_src = {t.strip("%().,") for t in src.split() if any(c.isdigit() for c in t)}
        if not all(n in out for n in nums_src):
            return False
    return True


def warm_rewrite(insights: list) -> tuple[list, bool]:
    """Devuelve (frases, usó_llm)."""
    if not insights or not enabled():
        return insights, False
    body = json.dumps({
        "model": MODEL, "stream": False, "format": "json",
        "options": {"temperature": 0.3, "num_predict": 300},
        "prompt": PROMPT.format(n=len(insights), items="\n".join(f"- {i}" for i in insights)),
    }).encode()
    try:
        req = urllib.request.Request(ENDPOINT + "/api/generate", data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=12) as r:
            out = json.loads(json.loads(r.read())["response"]).get("frases")
        if _valid(insights, out):
            return out, True
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return insights, False
