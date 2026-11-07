"""Capa 1 de IA: ordena alternativas de una biblioteca cerrada según detonante, hora,
intensidad e historial propio. Cada recomendación explica por qué se ofrece."""
import random

LIBRARY = {
    "breath": {
        "title": "Respiración bio-interactiva",
        "desc": "Exhala hacia el micrófono (o mantén pulsado) y la luz responde a tu ritmo. 6 respiraciones por minuto.",
        "minutes": 3, "sensor": "micrófono o táctil",
    },
    "tense": {
        "title": "Micro-pausa de 10 segundos",
        "desc": "Tensa los puños mientras mantienes pulsado, suelta y siente el cuerpo. Corta el automatismo.",
        "minutes": 0.2, "sensor": "táctil",
    },
    "motion": {
        "title": "Reconexión corporal",
        "desc": "60 segundos de movimiento guiado. La cámara solo mide movimiento abstracto en memoria.",
        "minutes": 1, "sensor": "cámara (opcional)",
    },
    "sleep": {
        "title": "Rutina para dormir 4-7-8",
        "desc": "Respiración lenta con la pantalla atenuándose hasta apagarse. Termina dejando el dispositivo.",
        "minutes": 4, "sensor": "micrófono o táctil",
    },
    "reach": {
        "title": "Escribirle a alguien de confianza",
        "desc": "Te damos una frase para empezar la conversación. Nadie sabrá por qué escribiste.",
        "minutes": 5, "sensor": None,
    },
    "walk": {
        "title": "Cambiar de espacio",
        "desc": "Levántate, toma agua o camina 5 minutos. PAUSA te avisa con un sonido suave al terminar.",
        "minutes": 5, "sensor": None,
    },
}

# Afinidad base detonante → alternativa (0-3). Biblioteca pendiente de validación profesional.
AFFINITY = {
    "estres":          {"breath": 3, "tense": 2, "motion": 2, "walk": 2, "reach": 1, "sleep": 0},
    "ansiedad":        {"breath": 3, "tense": 3, "motion": 1, "walk": 1, "reach": 2, "sleep": 0},
    "aburrimiento":    {"motion": 3, "walk": 3, "reach": 2, "tense": 1, "breath": 1, "sleep": 0},
    "antes_de_dormir": {"sleep": 3, "breath": 2, "tense": 1, "reach": 0, "walk": 0, "motion": 0},
    "habito":          {"tense": 3, "motion": 2, "walk": 2, "breath": 1, "reach": 1, "sleep": 0},
    "soledad":         {"reach": 3, "walk": 2, "breath": 1, "motion": 1, "tense": 1, "sleep": 0},
    "curiosidad":      {"walk": 2, "motion": 2, "tense": 2, "breath": 1, "reach": 1, "sleep": 0},
    "otro":            {"breath": 2, "tense": 2, "motion": 1, "walk": 1, "reach": 1, "sleep": 0},
}

REASONS = {
    "trigger": "suele ayudar cuando hay {trig}",
    "night": "es de noche y tu cuerpo necesita bajar el ritmo",
    "late_reach": "a esta hora escribir puede esperar a mañana",
    "intense": "el impulso es intenso y conviene algo inmediato",
    "history": "te ayudó {h} de {u} veces",
    "history_bad": "no te ha funcionado mucho antes",
}

REACH_PHRASES = {
    "soledad": ["Hola, me acordé de ti. ¿Cómo va tu semana?",
                "Oye, ¿te animas a una llamada corta? Me vendría bien conversar."],
    "estres": ["Estoy a full con la u, ¿te provoca un café o una llamada de 10 min?",
               "¿Tienes un rato? Necesito despejarme un poco de tanto estudio."],
    "ansiedad": ["Hola, ¿puedo llamarte un momento? Hoy ando algo inquieto/a.",
                 "¿Me cuentas algo de tu día? Me ayudaría distraerme un rato."],
    "default": ["Hola, ¿cómo estás? Hace tiempo que no hablamos.",
                "¿Qué haces mañana? Podríamos salir a caminar."],
}


def is_night(hour: int) -> bool:
    return hour >= 22 or hour < 5


def recommend(trigger: str, intensity: int, hour: int, history: dict | None = None, top: int = 3):
    trigger = trigger if trigger in AFFINITY else "otro"
    history = history or {}
    from .nlp import TRIGGERS
    ranked = []
    for alt, base in AFFINITY[trigger].items():
        score, why = float(base), []
        if base >= 2:
            why.append(REASONS["trigger"].format(trig=TRIGGERS[trigger].lower()))
        if is_night(hour):
            if alt == "sleep":
                score += 2.5; why.append(REASONS["night"])
            if alt in ("walk", "motion"):
                score -= 1
            if alt == "reach":
                score -= 1.5; why.append(REASONS["late_reach"])
        elif alt == "sleep":
            score -= 2
        if intensity >= 4 and alt in ("tense", "breath"):
            score += 1.5; why.append(REASONS["intense"])
        h = history.get(alt) or {}
        used, helped = int(h.get("used", 0)), int(h.get("helped", 0))
        if used >= 2:
            rate = helped / used
            score += (rate - 0.5) * 3
            why.append(REASONS["history"].format(h=helped, u=used) if rate >= 0.5 else REASONS["history_bad"])
        ranked.append((score, alt, why))
    ranked.sort(key=lambda r: r[0], reverse=True)
    result = []
    for score, alt, why in ranked[:top]:
        item = {"id": alt, **LIBRARY[alt], "score": round(score, 2),
                "why": ("Porque " + "; ".join(why[:2]) + ".") if why else "Opción general de la biblioteca."}
        if alt == "reach":
            item["phrase"] = random.choice(REACH_PHRASES.get(trigger, REACH_PHRASES["default"]))
        result.append(item)
    return result
