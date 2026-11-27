#!/usr/bin/env python3
"""Servidor local SOLO PARA CI: entrega a la app de prueba una sesión efímera REAL de OpenAI Realtime.
Usa la clave del secreto OPENAI_API_KEY de GitHub Actions (nunca se imprime ni se guarda). La app habla después
directamente con OpenAI. No es el servidor de producción ni se usa fuera de CI."""
import json, os, sys, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

KEY = os.environ.get("OPENAI_API_KEY", "").strip()
MODEL = os.environ.get("OPENAI_REALTIME_MODEL", "").strip() or "gpt-realtime-2.1"
VOICE = os.environ.get("OPENAI_REALTIME_VOICE", "").strip() or "marin"
LOG = {"sesiones_pedidas": 0, "sesiones_ok": 0, "ultimo_error": None}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # sin registro de peticiones
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._json(200, LOG)

    def do_POST(self):
        LOG["sesiones_pedidas"] += 1
        payload = {"session": {"type": "realtime", "model": MODEL,
                               "instructions": "Eres Founder, la asesora de negocios de YAMA. Habla en español con tono directo, cálido, exigente y orientado a resultados. No inventes datos. Si no sabes algo, dilo. Mantén respuestas breves y conversacionales.",
                               "audio": {"output": {"voice": VOICE}}}}
        req = urllib.request.Request("https://api.openai.com/v1/realtime/client_secrets", data=json.dumps(payload).encode(),
                                     headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            LOG["sesiones_ok"] += 1
            self._json(200, {"value": data.get("value")})
        except Exception as e:  # el mensaje no incluye la clave
            LOG["ultimo_error"] = f"{type(e).__name__}: {getattr(e, 'code', '')} {getattr(e, 'reason', '')}".strip()
            self._json(502, {"error": LOG["ultimo_error"]})


if not KEY:
    print("SIN CLAVE: falta el secreto OPENAI_API_KEY", file=sys.stderr)
    sys.exit(3)
HTTPServer(("0.0.0.0", 8787), H).serve_forever()
