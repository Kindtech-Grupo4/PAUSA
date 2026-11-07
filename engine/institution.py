"""Indicadores institucionales con k-anonimato (k >= 20) y supresión de celdas pequeñas.

El dispositivo solo aporta (si la persona lo activa) tres campos: detonante, franja y si
la pausa ayudó. Nunca nota, hora exacta, fecha ni identificador personal. El token de
aportante es aleatorio, rotable y se guarda solo como hash salado para contar personas
distintas."""
import hashlib
import json
import os
import random
import secrets
import threading
from collections import Counter

from .nlp import TRIGGERS
from .patterns import FRANJAS

K_MIN = 20
CELL_MIN = 5
_LOCK = threading.Lock()


class Aggregator:
    def __init__(self, path: str):
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.data = self._load()

    def _load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, ValueError):
                pass
        return {"salt": secrets.token_hex(16), "rows": []}

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f)
        os.replace(tmp, self.path)

    def _hash(self, token: str) -> str:
        return hashlib.sha256((self.data["salt"] + token).encode()).hexdigest()[:16]

    def contribute(self, token: str, trigger: str, franja: str, helped: str | None, synthetic=False,
                   save=True):
        if trigger not in TRIGGERS or franja not in {f[0] for f in FRANJAS}:
            raise ValueError("campos no válidos")
        if helped not in ("si", "algo", "no", None):
            helped = None
        if not token or len(token) < 16:
            raise ValueError("token no válido")
        with _LOCK:
            self.data["rows"].append({"c": self._hash(token), "t": trigger, "f": franja, "h": helped,
                                      "s": bool(synthetic)})
            if save:
                self._save()

    def simulate(self, n: int):
        n = max(1, min(int(n), 100))
        weights_t = {"estres": 5, "ansiedad": 3, "antes_de_dormir": 4, "aburrimiento": 3,
                     "soledad": 3, "habito": 2, "curiosidad": 1, "otro": 1}
        weights_f = {"madrugada": 3, "mañana": 1, "tarde": 2, "noche": 5}
        for _ in range(n):
            token = secrets.token_hex(12)
            for _ in range(random.randint(1, 4)):
                self.contribute(token,
                                random.choices(list(weights_t), list(weights_t.values()))[0],
                                random.choices(list(weights_f), list(weights_f.values()))[0],
                                random.choices(["si", "algo", "no"], [5, 3, 2])[0], synthetic=True,
                                save=False)
        with _LOCK:
            self._save()

    def reset(self):
        with _LOCK:
            self.data = {"salt": secrets.token_hex(16), "rows": []}
            self._save()

    def report(self) -> dict:
        rows = list(self.data["rows"])
        people = len({r["c"] for r in rows})
        real = len({r["c"] for r in rows if not r.get("s")})
        base = {"k": K_MIN, "people": people, "real_people": real, "synthetic_people": people - real}
        if people < K_MIN:
            return {**base, "locked": True,
                    "message": f"Bloqueado por k-anonimato: hay {people} personas y se necesitan al menos {K_MIN}."}

        def suppress(counter, keys):
            return {k: (counter.get(k, 0) if counter.get(k, 0) >= CELL_MIN else f"<{CELL_MIN}") for k in keys}

        by_t = Counter(r["t"] for r in rows)
        by_f = Counter(r["f"] for r in rows)
        rated = [r for r in rows if r["h"]]
        helped = sum(1 for r in rated if r["h"] == "si") + 0.5 * sum(1 for r in rated if r["h"] == "algo")
        return {**base, "locked": False, "pauses": len(rows),
                "by_trigger": {TRIGGERS[k]: v for k, v in suppress(by_t, TRIGGERS).items()},
                "by_franja": suppress(by_f, [f[0] for f in FRANJAS]),
                "helped_rate": round(helped * 100 / len(rated)) if len(rated) >= CELL_MIN else None,
                "note": f"Celdas con menos de {CELL_MIN} aportes se ocultan. Sin registros individuales."}
