"""Capa 1 de IA: etiquetado de detonantes, filtro de privacidad y detección de riesgo.

Todo se ejecuta en el dispositivo. No se diagnostica: solo se sugiere una etiqueta
editable y, ante señales de crisis, se devuelve un mensaje fijo prevalidado.
"""
import re
import unicodedata

TRIGGERS = {
    "aburrimiento": "Aburrimiento",
    "estres": "Estrés",
    "ansiedad": "Ansiedad",
    "antes_de_dormir": "Antes de dormir",
    "habito": "Hábito",
    "soledad": "Soledad",
    "curiosidad": "Curiosidad",
    "otro": "Otro",
}

# Raíces normalizadas (sin tildes). Peso 2 = señal fuerte, 1 = señal contextual.
LEXICON = {
    "estres": {"estres": 2, "estresad": 2, "examen": 2, "parcial": 2, "entrega": 1, "tesis": 2,
               "presion": 2, "agobi": 2, "saturad": 2, "deadline": 2, "trabajo": 1, "procrastin": 2,
               "notas": 1, "jefe": 1, "exposicion": 1, "final": 1, "tarea": 1},
    "ansiedad": {"ansie": 2, "ansios": 2, "nervio": 2, "inquiet": 2, "preocup": 2, "angust": 2,
                 "acelerad": 1, "panico": 2, "no puedo parar": 2, "intranquil": 2, "miedo": 1},
    "aburrimiento": {"aburr": 2, "nada que hacer": 2, "sin hacer nada": 2, "matar el tiempo": 2,
                     "tiempo libre": 1, "sin plan": 1, "vacio": 1, "scroll": 1},
    "antes_de_dormir": {"dormir": 2, "insomnio": 2, "cama": 1, "no tengo sueno": 2, "madrugada": 2,
                        "desvel": 2, "noche": 1, "acostad": 1, "sin sueno": 2},
    "habito": {"costumbre": 2, "automatic": 2, "sin pensar": 2, "rutina": 1, "otra vez": 1,
               "de nuevo": 1, "siempre": 1, "por inercia": 2, "sin darme cuenta": 2},
    "soledad": {"soledad": 2, "solo": 1, "sola": 1, "nadie": 2, "aislad": 2, "extran": 2,
                "ruptura": 2, "termine con": 2, "me dejo": 2, "sin amigos": 2, "rechaz": 1},
    "curiosidad": {"curios": 2, "explorar": 1, "probar": 1, "ver que": 1, "novedad": 1},
}

NEGATIONS = ("no", "nada", "ni", "nunca", "tampoco")

# Señales de riesgo: activan derivación con mensaje fijo, nunca consejo generado.
CRISIS = {
    "autolesion": ["suicid", "matarme", "quitarme la vida", "no quiero vivir", "hacerme dano",
                   "cortarme", "lastimarme", "acabar con todo", "desaparecer para siempre",
                   "quiero morir", "me quiero morir", "mejor muert"],
    "desesperanza": ["ya no puedo mas", "no vale la pena vivir", "sin salida", "nada tiene sentido",
                     "no le veo sentido a nada", "no tengo salida"],
    "violencia": ["me pega", "me golpea", "me obliga", "me obligan", "abus", "violac", "me amenaza",
                  "chantaje", "sextorsion", "difundir mis fotos", "publicar mis fotos", "me extorsiona"],
    "menores": ["menor de edad", "tengo 13", "tengo 14", "tengo 15", "tengo 16", "tengo 17",
                "contenido de menores", "con menores"],
}

# Términos explícitos: la nota NO se guarda (solo la etiqueta), como promete la Ficha 4.
SENSITIVE = ["porn", "xxx", "onlyfans", "desnud", "masturb", "nude", "pack", "sexo explicito",
             "hentai", "camgirl", "webcam sex", "xvideos", "pornhub"]

URL_RE = re.compile(r"(https?://\S+|www\.\S+|\S+\.(com|net|org|xxx|tv)\S*)", re.I)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", text).strip()


def _negated(norm: str, idx: int) -> bool:
    """'no estoy estresado' niega; 'no puedo dormir' no niega el detonante."""
    prev = norm[:idx].split()[-2:]
    if "puedo" in prev or "logro" in prev:
        return False
    return any(w in NEGATIONS for w in prev)


def detect_crisis(norm: str):
    for category, terms in CRISIS.items():
        for term in terms:
            if term in norm:
                return category
    return None


def suggest_label(norm: str):
    scores, evidence = {}, {}
    for trig, words in LEXICON.items():
        for word, weight in words.items():
            for m in re.finditer(re.escape(word), norm):
                if _negated(norm, m.start()):
                    continue
                scores[trig] = scores.get(trig, 0) + weight
                evidence.setdefault(trig, []).append(word)
                break
    if not scores:
        return None
    total = sum(scores.values())
    best = max(scores, key=scores.get)
    confidence = round(scores[best] / total, 2) if total else 0
    if scores[best] < 2:
        confidence = min(confidence, 0.45)
    return {
        "id": best,
        "label": TRIGGERS[best],
        "confidence": confidence,
        "evidence": evidence[best][:3],
        "alternatives": [t for t in sorted(scores, key=scores.get, reverse=True) if t != best][:2],
    }


def analyze_note(note: str) -> dict:
    note = (note or "")[:280]
    norm = normalize(note)
    crisis = detect_crisis(norm)
    without_urls = URL_RE.sub("[enlace omitido]", note)
    sensitive = any(term in norm for term in SENSITIVE)
    label = None if crisis else suggest_label(norm)
    reason = None
    if label:
        words = ", ".join(f"“{w}”" for w in label["evidence"])
        reason = f"Sugerida porque tu nota incluye {words}. Puedes cambiarla o ignorarla."
    return {
        "crisis": crisis,
        "label": label,
        "reason": reason,
        "store_note": not sensitive and not crisis,
        "sanitized_note": "" if sensitive else without_urls,
        "privacy_notice": ("Por tu privacidad no guardamos detalles explícitos: basta con la etiqueta."
                           if sensitive else None),
        "uncertain": label is None or label["confidence"] < 0.5,
    }
