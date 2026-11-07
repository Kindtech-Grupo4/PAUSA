"""PAUSA · motor local + lanzador de escritorio.

Uso:  python pausa.py            (abre la ventana de la app)
      python pausa.py --no-browser --port 8765
Solo escucha en 127.0.0.1. Sin dependencias externas (Python 3.10+)."""
import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from engine import llm
from engine.institution import Aggregator
from engine.nlp import analyze_note
from engine.patterns import summarize
from engine.recommender import recommend

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
AGG = Aggregator(os.path.join(ROOT, "data", "indicadores_agregados.json"))
MAX_BODY = 64 * 1024
LLM_STATE = {"available": False}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                      ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):  # sin registros de peticiones: nada que filtrar
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "microphone=(self), camera=(self), geolocation=()")
        super().end_headers()

    def _host_ok(self) -> bool:  # protege contra DNS rebinding
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def _json(self, status: int, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("cuerpo demasiado grande")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        if not self._host_ok():
            return self._json(403, {"error": "host no permitido"})
        if self.path == "/api/salud":
            return self._json(200, {"ok": True, "engine": "python-local", "llm": LLM_STATE["available"]})
        if self.path == "/api/institucion":
            return self._json(200, AGG.report())
        if self.path in ("/institucion", "/institucion/"):
            self.path = "/institucion.html"
        return super().do_GET()

    def do_POST(self):
        if not self._host_ok():
            return self._json(403, {"error": "host no permitido"})
        try:
            data = self._body()
            if self.path == "/api/analizar":
                return self._json(200, analyze_note(str(data.get("nota", ""))))
            if self.path == "/api/recomendar":
                alts = recommend(str(data.get("trigger", "otro")), int(data.get("intensity", 3)),
                                 int(data.get("hour", time.localtime().tm_hour)), data.get("history") or {})
                return self._json(200, {"alternatives": alts})
            if self.path == "/api/patrones":
                result = summarize(data.get("records") or [])
                if result.get("enough") and data.get("ai", True):
                    result["insights"], result["llm"] = llm.warm_rewrite(result["insights"])
                return self._json(200, result)
            if self.path == "/api/aportar":
                AGG.contribute(str(data.get("token", "")), str(data.get("trigger", "")),
                               str(data.get("franja", "")), data.get("helped"))
                return self._json(200, {"ok": True})
            if self.path == "/api/institucion/simular":
                AGG.simulate(int(data.get("n", 5)))
                return self._json(200, AGG.report())
            if self.path == "/api/institucion/reiniciar":
                AGG.reset()
                return self._json(200, AGG.report())
            return self._json(404, {"error": "ruta no encontrada"})
        except (ValueError, TypeError) as exc:
            return self._json(400, {"error": str(exc)})


def find_app_browser():
    candidates = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    ]
    for name in ("google-chrome", "chromium", "chromium-browser", "microsoft-edge"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    return next((c for c in candidates if c and os.path.exists(c)), None)


def open_window(url: str):
    exe = find_app_browser()
    if exe:
        profile = os.path.join(ROOT, "data", ".perfil_ventana")
        subprocess.Popen([exe, f"--app={url}", "--window-size=1280,860", f"--user-data-dir={profile}",
                          "--no-first-run", "--no-default-browser-check"])
    else:
        webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser(description="PAUSA · motor local")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://localhost:{args.port}/"
    threading.Thread(target=lambda: LLM_STATE.update(available=llm.available()), daemon=True).start()
    print(f"PAUSA en ejecución → {url}   (Ctrl+C para cerrar)")
    print(f"Vista institucional (demo) → {url}institucion")
    if not args.no_browser:
        threading.Timer(0.6, open_window, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
