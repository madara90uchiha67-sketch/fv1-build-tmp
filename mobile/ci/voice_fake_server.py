#!/usr/bin/env python3
"""Servidor de PRUEBA que imita a OpenAI Realtime por WebRTC (solo CI, nunca produccion).

Acepta la oferta SDP de la app en POST /calls, abre el canal de datos "oai-events", envia audio (un tono que
hace de voz de Founder) y los mismos eventos que mandaria OpenAI, y mide lo que recibe del telefono:
audio del microfono, session.update, response.cancel y output_audio_buffer.clear (la interrupcion).
No habla con OpenAI y no usa ninguna clave. Resultado en GET /result y en el archivo indicado.
"""
import asyncio, fractions, json, math, re, sys, time
import av, numpy as np
from aiohttp import web
import aioice.ice as _ice
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription

# aioice no ofrece la direccion de loopback; el emulador llega al anfitrion como 10.0.2.2 (= 127.0.0.1 del anfitrion).
_orig_hosts = _ice.get_host_addresses
_ice.get_host_addresses = lambda use_ipv4, use_ipv6: ["127.0.0.1"] + [a for a in _orig_hosts(use_ipv4, use_ipv6) if a != "127.0.0.1"]

OUT = sys.argv[1] if len(sys.argv) > 1 else "voz-servidor.json"
PORT = 8787
RATE = 48000
SAMPLES = 960  # 20 ms

R = {
    "oferta_recibida": False, "autorizacion_recibida": False, "canal_abierto": False,
    "tramas_audio_del_telefono": 0, "rms_max_del_telefono": 0.0,
    "session_update": 0, "response_cancel": 0, "output_audio_buffer_clear": 0,
    "tramas_tono_enviadas": 0, "interrupcion_confirmada": False, "tipos_recibidos": [],
}


class Tone(MediaStreamTrack):
    kind = "audio"

    def __init__(self):
        super().__init__()
        self.talking = False
        self._t = 0
        self._start = None

    async def recv(self):
        if self._start is None:
            self._start = time.time()
        due = self._start + self._t / RATE
        await asyncio.sleep(max(0, due - time.time()))
        n = np.arange(self._t, self._t + SAMPLES)
        wave = (0.25 * np.sin(2 * math.pi * 440 * n / RATE) * 32767).astype(np.int16) if self.talking else np.zeros(SAMPLES, np.int16)
        frame = av.AudioFrame.from_ndarray(wave.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = RATE
        frame.pts = self._t
        frame.time_base = fractions.Fraction(1, RATE)
        self._t += SAMPLES
        if self.talking:
            R["tramas_tono_enviadas"] += 1
        return frame


async def consume(track):
    while True:
        try:
            frame = await track.recv()
        except Exception:
            return
        arr = frame.to_ndarray().astype(np.float32)
        R["tramas_audio_del_telefono"] += 1
        R["rms_max_del_telefono"] = max(R["rms_max_del_telefono"], float(np.sqrt(np.mean(arr ** 2))) if arr.size else 0.0)


def save():
    with open(OUT, "w") as f:
        json.dump(R, f, indent=2, ensure_ascii=False)


async def scenario(channel, tone):
    def send(obj):
        channel.send(json.dumps(obj))

    await asyncio.sleep(1)
    send({"type": "session.created"})
    await asyncio.sleep(2)
    # Founder responde hablando
    send({"type": "response.created"})
    send({"type": "output_audio_buffer.started"})
    send({"type": "response.output_audio_transcript.delta", "item_id": "a1", "delta": "Empieza por tus clientes actuales. "})
    tone.talking = True
    await asyncio.sleep(3)
    # El usuario interrumpe: el servidor real avisa con speech_started
    send({"type": "input_audio_buffer.speech_started", "item_id": "u1"})
    for _ in range(40):  # hasta 4 s para que la app corte la respuesta
        await asyncio.sleep(0.1)
        if R["response_cancel"] and R["output_audio_buffer_clear"]:
            tone.talking = False
            R["interrupcion_confirmada"] = True
            send({"type": "output_audio_buffer.cleared"})
            break
    await asyncio.sleep(1)
    send({"type": "input_audio_buffer.speech_stopped"})
    send({"type": "conversation.item.input_audio_transcription.completed", "item_id": "u1", "transcript": "Pregunta de prueba"})
    await asyncio.sleep(1)
    # Segunda respuesta (conversacion continua, sin pulsar nada)
    send({"type": "response.created"})
    send({"type": "output_audio_buffer.started"})
    send({"type": "response.output_audio_transcript.delta", "item_id": "a2", "delta": "Segunda respuesta. "})
    tone.talking = True
    await asyncio.sleep(3)
    tone.talking = False
    send({"type": "output_audio_buffer.stopped"})
    send({"type": "response.done"})
    save()


async def calls(request):
    R["oferta_recibida"] = True
    R["autorizacion_recibida"] = request.headers.get("Authorization", "").startswith("Bearer ")
    offer = await request.text()
    pc = RTCPeerConnection()
    tone = Tone()
    pc.addTrack(tone)

    @pc.on("track")
    def on_track(track):
        if track.kind == "audio":
            asyncio.ensure_future(consume(track))

    @pc.on("datachannel")
    def on_channel(channel):
        started = []

        def _open():
            if started:
                return
            started.append(1)
            R["canal_abierto"] = True
            asyncio.ensure_future(scenario(channel, tone))

        channel.on("open", _open)
        if channel.readyState == "open":  # el canal creado por la app ya llega abierto
            _open()

        @channel.on("message")
        def _msg(message):
            try:
                data = json.loads(message)
            except Exception:
                return
            t = data.get("type", "")
            if t not in R["tipos_recibidos"]:
                R["tipos_recibidos"].append(t)
            if t == "session.update":
                R["session_update"] += 1
            elif t == "response.cancel":
                R["response_cancel"] += 1
            elif t == "output_audio_buffer.clear":
                R["output_audio_buffer_clear"] += 1

    await pc.setRemoteDescription(RTCSessionDescription(sdp=offer, type="offer"))
    await pc.setLocalDescription(await pc.createAnswer())
    # El emulador ve al ordenador anfitrion como 10.0.2.2: se anuncia esa direccion en los candidatos.
    sdp = re.sub(r"(a=candidate:\S+ \d+ \S+ \d+ )127\.0\.0\.1( \d+ typ)", r"\g<1>10.0.2.2\2", pc.localDescription.sdp)
    print("candidatos anunciados:", [l for l in sdp.splitlines() if l.startswith("a=candidate")], flush=True)
    return web.Response(status=201, text=sdp, content_type="application/sdp")


async def result(_):
    save()
    return web.json_response(R)


app = web.Application()
async def session(_):
    return web.json_response({"value": "prueba"})

app.router.add_post("/session", session)
app.router.add_post("/calls", calls)
app.router.add_get("/result", result)
web.run_app(app, host="0.0.0.0", port=PORT)
