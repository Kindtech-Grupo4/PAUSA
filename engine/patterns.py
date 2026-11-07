"""Capa 1 + 2 de IA: conteos simples y redacción en lenguaje de posibilidad ("parece que").
Sin rachas, sin puntajes. Con menos de 7 registros no se afirma ningún patrón."""
from collections import Counter

from .nlp import TRIGGERS
from .recommender import LIBRARY

MIN_RECORDS = 7
FRANJAS = [("madrugada", 0, 5), ("mañana", 6, 11), ("tarde", 12, 17), ("noche", 18, 23)]
DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
HELPED_VALUE = {"si": 1.0, "algo": 0.5, "no": 0.0}


def franja(hour: int) -> str:
    for name, a, b in FRANJAS:
        if a <= hour <= b:
            return name
    return "noche"


def summarize(records: list) -> dict:
    records = [r for r in records if isinstance(r, dict) and "hour" in r]
    n = len(records)
    by_franja = Counter(franja(int(r["hour"])) for r in records)
    by_trigger = Counter(r.get("trigger", "otro") for r in records)
    by_day = Counter(int(r.get("weekday", 0)) % 7 for r in records)
    counts = {
        "franja": {name: by_franja.get(name, 0) for name, _, _ in FRANJAS},
        "trigger": {k: by_trigger.get(k, 0) for k in TRIGGERS if by_trigger.get(k)},
        "weekday": {DAYS[i]: by_day.get(i, 0) for i in range(7)},
    }
    if n < MIN_RECORDS:
        return {"enough": False, "n": n, "needed": MIN_RECORDS - n, "counts": counts,
                "insights": [f"Aún no hay patrones: llevas {n} de {MIN_RECORDS} registros. "
                             "Seguir registrando sin presión ayuda a que la lectura sea honesta."]}

    insights = []
    top_f, cf = by_franja.most_common(1)[0]
    insights.append(f"Parece que el impulso aparece con más frecuencia en la {top_f} "
                    f"({round(cf * 100 / n)}% de tus registros).")

    top_t, ct = by_trigger.most_common(1)[0]
    if ct / n >= 0.25:
        insights.append(f"Parece que «{TRIGGERS.get(top_t, top_t)}» es lo que más acompaña al impulso "
                        f"({ct} de {n} veces).")

    alt_stats = {}
    for r in records:
        if r.get("alt") in LIBRARY and r.get("helped") in HELPED_VALUE:
            s = alt_stats.setdefault(r["alt"], [0, 0.0])
            s[0] += 1
            s[1] += HELPED_VALUE[r["helped"]]
    useful = [(v[1] / v[0], k, v[0]) for k, v in alt_stats.items() if v[0] >= 2]
    if useful:
        rate, alt, uses = max(useful)
        if rate >= 0.5:
            insights.append(f"La pausa que más parece ayudarte es «{LIBRARY[alt]['title']}» "
                            f"(útil en {round(rate * 100)}% de {uses} usos).")

    drops = [int(r["intensity"]) - int(r["after"]) for r in records
             if r.get("after") not in (None, "") and r.get("intensity") not in (None, "")]
    avg_drop = round(sum(drops) / len(drops), 1) if drops else None
    if avg_drop is not None and avg_drop > 0 and len(insights) < 3:
        insights.append(f"Después de pausar, la intensidad del impulso parece bajar {avg_drop} puntos en promedio.")

    top_day, cd = by_day.most_common(1)[0]
    if len(insights) < 3 and cd / n >= 0.3:
        insights.append(f"Los {DAYS[top_day]} parecen ser días más difíciles ({cd} registros).")

    autonomy = (
        "Ya reconoces tus principales horarios y detonantes. El éxito de PAUSA es tu autonomía: "
        "si sientes que ya identificas el impulso a tiempo, puedes necesitar abrirla cada vez menos."
        if n >= 10 else None
    )
    return {"enough": True, "n": n, "counts": counts, "insights": insights[:3], "avg_drop": avg_drop,
            "autonomy": autonomy,
            "disclaimer": "Son correlaciones, no causas. Puede equivocarse y no es un diagnóstico."}
