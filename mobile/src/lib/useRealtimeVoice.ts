import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, PermissionsAndroid, Platform } from "react-native";
import { mediaDevices, RTCPeerConnection, RTCSessionDescription, type MediaStream } from "react-native-webrtc";
import { resetAudioRoute, setKeepScreenOn, setSpeakerphoneOn } from "../../modules/founder-audio";
import { errorMessage, request } from "./api";
import { VOICE_TEST_BASE } from "./config";
import { initialVoiceState, reconnectPlan, reduceVoiceEvent, sessionUpdates, type DropReason, type RealtimeEvent, type VoiceState } from "./realtime-events";

// OpenAI Realtime por WebRTC (GA). La clave que usa el teléfono es efímera: la crea el backend en
// /api/mobile/voice/session con la clave privada de OpenAI, que nunca sale del servidor.
const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const REALTIME_URL = VOICE_TEST_BASE ? `${VOICE_TEST_BASE}/calls` : OPENAI_CALLS_URL;

// Solo CI (compilación preview): el servidor de pruebas entrega o una sesión falsa ("prueba") o una sesión efímera REAL de
// OpenAI creada con una clave guardada como secreto de GitHub Actions. Nunca existe en la compilación de producción.
async function testToken(): Promise<{ value?: string }> {
  try {
    const res = await fetch(`${VOICE_TEST_BASE}/session`, { method: "POST" });
    if (res.ok) return (await res.json()) as { value?: string };
  } catch { /* se usa la sesión falsa */ }
  return { value: "prueba" };
}

// Registro de la llamada para diagnosticar (adb logcat -s ReactNativeJS). Nunca incluye claves ni el contenido de la conversación.
const vlog = (message: string) => console.log(`[voz] ${message}`);

export interface VoiceError {
  message: string;
  needsSettings?: boolean;
}

export interface VoiceLevels {
  mic: number; // 0..1, nivel del micrófono
  out: number; // 0..1, nivel de la voz de Founder
}

// Los tipos de react-native-webrtc para addEventListener son estrictos con cada evento; este
// ayudante evita acoplarse a ellos (los eventos usados son los estándar del navegador).
function on(target: unknown, name: string, handler: (event: any) => void) {
  (target as { addEventListener: (n: string, h: unknown) => void }).addEventListener(name, handler);
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 3500);
    on(pc, "icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

async function ensureMicrophone(): Promise<VoiceError | null> {
  if (Platform.OS !== "android") return null;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: "Micrófono",
    message: "Founder necesita el micrófono para conversar contigo por voz.",
    buttonPositive: "Permitir",
    buttonNegative: "Ahora no",
  });
  if (result === PermissionsAndroid.RESULTS.GRANTED) return null;
  return {
    message: "Founder necesita acceso al micrófono para la llamada de voz. Actívalo en Ajustes → Aplicaciones → Founder → Permisos.",
    needsSettings: result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
  };
}

const DISCONNECT_GRACE_MS = 12000; // un «disconnected» de ICE suele recuperarse solo (cambio de red, bloqueo breve)
const SETUP_TIMEOUT_MS = 20000; // si el canal de datos no abre en este tiempo, la conexión no se estableció
const STABLE_AFTER_MS = 30000; // tras este tiempo conectado se reinicia el contador de fallos seguidos

export function useRealtimeVoice() {
  const [voice, setVoice] = useState<VoiceState>(initialVoiceState);
  const [error, setError] = useState<VoiceError | null>(null);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState<VoiceLevels>({ mic: 0, out: 0 });
  const [attempt, setAttempt] = useState(0);

  const voiceRef = useRef<VoiceState>(initialVoiceState);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<{ send: (data: string) => void; readyState: string; close: () => void } | null>(null);
  const mutedRef = useRef(false);
  const generationRef = useRef(0); // cada conexión tiene su número: los eventos de una conexión vieja se ignoran
  const failuresRef = useRef(0);

  const send = useCallback((payload: object) => {
    const channel = channelRef.current;
    if (channel && channel.readyState === "open") channel.send(JSON.stringify(payload));
  }, []);

  // Corta lo que Founder está diciendo: cancela la respuesta y vacía el audio que aún no se reprodujo.
  const interrupt = useCallback(() => {
    send({ type: "response.cancel" });
    send({ type: "output_audio_buffer.clear" });
  }, [send]);

  const update = useCallback((next: VoiceState) => {
    voiceRef.current = next;
    setVoice(next);
  }, []);

  useEffect(() => {
    let disposed = false;
    let levelTimer: ReturnType<typeof setInterval> | null = null;
    let dropTimer: ReturnType<typeof setTimeout> | null = null;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let setupTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const speakerTimers: Array<ReturnType<typeof setTimeout>> = [];
    let bytesOut = 0;
    let bytesIn = 0;
    let ticks = 0;
    let peakOut = 0;
    let peakMic = 0;

    failuresRef.current = 0;
    setKeepScreenOn(true);

    function fail(message: string, needsSettings = false) {
      if (disposed) return;
      setError({ message, needsSettings });
      update({ ...voiceRef.current, phase: "error" });
    }

    // Libera lo de la conexión actual (no toca el estado de la pantalla: sirve también para reconectar).
    function teardown() {
      if (levelTimer) clearInterval(levelTimer);
      if (dropTimer) clearTimeout(dropTimer);
      if (stableTimer) clearTimeout(stableTimer);
      if (setupTimer) clearTimeout(setupTimer);
      levelTimer = dropTimer = stableTimer = setupTimer = null;
      speakerTimers.splice(0).forEach(clearTimeout);
      try { channelRef.current?.close(); } catch { /* ya cerrado */ }
      channelRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      try { pcRef.current?.close(); } catch { /* ya cerrado */ }
      pcRef.current = null;
    }

    // La conexión se cayó a mitad de llamada: se intenta reconectar sola (sesión efímera nueva) varias veces.
    function dropped(reason: DropReason, message: string, gen: number) {
      if (disposed || gen !== generationRef.current) return;
      generationRef.current += 1;
      teardown();
      console.warn(`[voz] conexión perdida: ${reason}`);
      const plan = reconnectPlan(failuresRef.current);
      failuresRef.current += 1;
      if (!plan.retry) {
        fail(`${message} (código: ${reason})`);
        return;
      }
      update({ ...voiceRef.current, phase: "connecting", notice: "Se perdió la conexión. Reconectando…" });
      reconnectTimer = setTimeout(() => void connect(true), plan.delayMs);
    }

    async function connect(isReconnect: boolean) {
      const gen = ++generationRef.current;
      const stale = () => disposed || gen !== generationRef.current;
      setError(null);
      setLevels({ mic: 0, out: 0 });
      const fresh: VoiceState = {
        ...initialVoiceState,
        lines: isReconnect ? voiceRef.current.lines : [],
        notice: isReconnect ? "Se perdió la conexión. Reconectando…" : null,
      };
      voiceRef.current = fresh;
      setVoice(fresh);
      try {
        const denied = await ensureMicrophone();
        if (denied) return fail(denied.message, denied.needsSettings);
        if (stale()) return;

        vlog("micrófono: permiso concedido");
        const token = VOICE_TEST_BASE ? await testToken() : await request<{ value?: string }>("/api/mobile/voice/session", { method: "POST", timeoutMs: 15000 });
        if (!token.value) throw new Error("No se recibió una sesión de voz válida.");
        vlog("sesión efímera recibida");
        if (stale()) return;

        // Cancelación de eco, supresión de ruido y control de ganancia: evitan que Founder se oiga a sí mismo.
        const stream = await mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } as never,
          video: false,
        });
        if (stale()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        vlog(`micrófono abierto (pistas de audio: ${stream.getAudioTracks().length})`);
        stream.getAudioTracks().forEach((track) => { track.enabled = !mutedRef.current; });

        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        pcRef.current = pc;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const evaluate = () => {
          if (stale()) return;
          const conn = (pc as unknown as { connectionState?: string }).connectionState;
          const ice = (pc as unknown as { iceConnectionState?: string }).iceConnectionState;
          vlog(`estado WebRTC: conexión=${conn} ice=${ice}`);
          if (conn === "failed" || ice === "failed") return dropped("ice_failed", "La llamada se desconectó.", gen);
          if (conn === "closed") return dropped("peer_closed", "La llamada se cerró.", gen);
          if (conn === "connected" || ice === "connected" || ice === "completed") {
            if (dropTimer) { clearTimeout(dropTimer); dropTimer = null; }
            if (!stableTimer) stableTimer = setTimeout(() => { failuresRef.current = 0; }, STABLE_AFTER_MS);
            vlog(`altavoz activado: ${setSpeakerphoneOn(true)}`);
          } else if (conn === "disconnected" || ice === "disconnected") {
            if (!dropTimer) dropTimer = setTimeout(() => dropped("ice_disconnected", "Se perdió la conexión de la llamada.", gen), DISCONNECT_GRACE_MS);
          }
        };
        on(pc, "connectionstatechange", evaluate);
        on(pc, "iceconnectionstatechange", evaluate);

        // Guion de la prueba con OpenAI REAL (solo CI): saludo → pregunta por texto → interrupción → segunda pregunta.
        const real = Boolean(VOICE_TEST_BASE) && token.value !== "prueba";
        let stage = 0;
        let audioStarts = 0;
        const ask = (text: string) => {
          send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
          send({ type: "response.create" });
        };
        const drive = (event: RealtimeEvent) => {
          if (!real) return;
          const type = event.type as string;
          const transcript = (event as unknown as { transcript?: string }).transcript;
          if (type.endsWith("output_audio_transcript.done") && transcript) vlog(`REAL: Founder dijo: ${transcript.slice(0, 140)}`);
          if (type === "output_audio_buffer.started") {
            audioStarts += 1;
            vlog(`REAL: audio de Founder #${audioStarts} sonando`);
            if (stage === 1 && audioStarts === 2) {
              stage = 2;
              speakerTimers.push(setTimeout(() => { vlog("REAL: interrumpiendo a Founder mientras habla"); interrupt(); }, 1500));
            } else if (stage === 3) { stage = 4; vlog("REAL: segunda respuesta de audio tras la interrupción"); }
          }
          if (type === "response.done" && stage === 0) { stage = 1; vlog("REAL: saludo completo"); ask("¿Cuál es el primer paso para conseguir mi primer cliente? Explícamelo con calma."); }
          else if (stage === 2 && (type === "output_audio_buffer.cleared" || type === "output_audio_buffer.stopped")) {
            stage = 3; vlog("REAL: Founder se detuvo");
            speakerTimers.push(setTimeout(() => ask("Gracias. Ahora dime en una frase cuál sería el segundo paso."), 800));
          } else if (stage === 4 && type === "response.done") { stage = 5; vlog("REAL: segunda respuesta completa — GUION OK"); }
        };

        const channel = pc.createDataChannel("oai-events");
        channelRef.current = channel as never;
        on(channel, "open", () => {
          if (stale()) return;
          vlog("canal de datos abierto");
          if (setupTimer) { clearTimeout(setupTimer); setupTimer = null; }
          update({ ...voiceRef.current, phase: "listening", notice: isReconnect ? "Reconectado: Founder empieza una conversación nueva." : null });
          sessionUpdates().forEach((message) => send(message));
          // Founder saluda primero: se oye de inmediato que el audio de salida funciona y se sabe que puede hablar.
          if (!isReconnect) send({ type: "response.create", response: { instructions: "Saluda en una sola frase corta, en español, y pregunta en qué puedes ayudar." } });
          // WebRTC fija el modo de llamada al empezar el audio; se reafirma el altavoz unas veces.
          [0, 600, 2000].forEach((delay) => speakerTimers.push(setTimeout(() => setSpeakerphoneOn(true), delay)));
        });
        on(channel, "close", () => dropped("channel_closed", "Se cerró el canal de la llamada.", gen));
        on(channel, "message", (message: { data?: unknown }) => {
          if (stale() || typeof message.data !== "string") return;
          let event: RealtimeEvent;
          try { event = JSON.parse(message.data) as RealtimeEvent; } catch { return; }
          drive(event);
          const result = reduceVoiceEvent(voiceRef.current, event);
          update(result.state);
          vlog(`evento ${event.type} → ${result.state.phase}${event.type === "error" ? ` (${event.error?.code ?? "sin código"})` : ""}`);
          if (result.actions.includes("interrupt")) { vlog("interrupción: se corta la respuesta de Founder"); interrupt(); }
        });
        setupTimer = setTimeout(() => dropped("setup_failed", "No se pudo establecer el audio con Founder.", gen), SETUP_TIMEOUT_MS);

        const offer = await pc.createOffer({ offerToReceiveAudio: true } as never);
        await pc.setLocalDescription(offer);
        vlog("oferta local creada");
        await waitForIceGathering(pc);
        vlog(`candidatos ICE: ${pc.iceGatheringState}`);
        if (stale()) return;
        const localSdp = pc.localDescription?.sdp;
        if (!localSdp) throw new Error("No se pudo preparar el audio.");
        const response = await fetch(VOICE_TEST_BASE && token.value === "prueba" ? REALTIME_URL : OPENAI_CALLS_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" },
          body: localSdp,
        });
        vlog(`respuesta de OpenAI a la oferta: HTTP ${response.status}`);
        if (stale()) return;
        if (!response.ok) {
          throw new Error(response.status === 401 || response.status === 403 ? "La sesión de voz expiró. Inténtalo de nuevo." : `No se pudo iniciar la llamada de voz (código ${response.status}).`);
        }
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: await response.text() }));
        vlog("respuesta SDP aplicada; esperando conexión");
        if (stale()) return;

        // Niveles de audio reales (micrófono y voz de Founder) para animar la pantalla.
        levelTimer = setInterval(async () => {
          try {
            const report = (await (pc as unknown as { getStats: () => Promise<{ forEach: (cb: (value: any) => void) => void }> }).getStats());
            let mic = 0;
            let out = 0;
            report.forEach((item) => {
              const level = typeof item.audioLevel === "number" ? item.audioLevel : 0;
              if (item.type === "media-source") mic = Math.max(mic, level);
              else if (item.type === "inbound-rtp" || (item.type === "track" && item.remoteSource === true)) out = Math.max(out, level);
              if (item.type === "outbound-rtp" && typeof item.bytesSent === "number") bytesOut = item.bytesSent;
              if (item.type === "inbound-rtp" && typeof item.bytesReceived === "number") bytesIn = item.bytesReceived;
            });
            ticks += 1;
            peakOut = Math.max(peakOut, out);
            peakMic = Math.max(peakMic, mic);
            if (ticks % 10 === 0) {
              vlog(`audio: enviado=${bytesOut}B recibido=${bytesIn}B pico_mic=${peakMic.toFixed(3)} pico_voz=${peakOut.toFixed(3)}`);
              if (ticks === 50 && bytesOut === 0) vlog("ALERTA: no sale audio del micrófono");
              if (ticks === 50 && bytesIn === 0) vlog("ALERTA: no llega audio de Founder");
            }
            if (!stale()) setLevels((prev) => (Math.abs(prev.mic - mic) > 0.02 || Math.abs(prev.out - out) > 0.02 ? { mic, out } : prev));
          } catch { /* sin estadísticas: la animación usa solo la fase */ }
        }, 200);
      } catch (e) {
        if (stale()) return;
        const message = errorMessage(e);
        vlog(`ERROR de conexión: ${message} (${e instanceof Error ? e.message.slice(0, 120) : "sin detalle"})`);
        // Durante una reconexión un fallo de red cuenta como un intento más; en el primer intento se avisa al usuario.
        if (isReconnect) dropped("setup_failed", message, gen);
        else {
          generationRef.current += 1;
          teardown();
          fail(message);
        }
      }
    }

    // Al volver a la app (pantalla bloqueada, otra app encima) se reafirma el altavoz y la pantalla encendida.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active" && !disposed) {
        setKeepScreenOn(true);
        setSpeakerphoneOn(true);
      }
    });

    void connect(false);
    return () => {
      disposed = true;
      generationRef.current += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      appState.remove();
      teardown();
      resetAudioRoute();
      setKeepScreenOn(false);
    };
  }, [attempt, interrupt, send, update]);

  // Al empezar a hablar Founder se reafirma el altavoz (algunos teléfonos reinician la ruta al cambiar de modo).
  useEffect(() => {
    if (voice.phase === "speaking") setSpeakerphoneOn(true);
  }, [voice.phase]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const openSettings = useCallback(() => { void Linking.openSettings(); }, []);

  return { voice, error, muted, levels, toggleMute, interrupt, retry, openSettings };
}
