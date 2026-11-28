import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, PermissionsAndroid, Platform } from "react-native";
import { resetAudioRoute, setKeepScreenOn } from "../../modules/founder-audio";
import { storeGet, storeSet } from "../../modules/founder-reminders";
import { onSpeech, speech, speechAvailable } from "../../modules/founder-speech";
import { ApiError, request, streamChat } from "./api";
import { FOUNDER_CREATOR } from "./config";
import { isPro, pendingRecommendations } from "./notes-logic";
import { ensureNotificationPermission, loadRecommendations, scheduleNote } from "./reminders";
import { useSession } from "./session";
import {
  NEURAL_VOICE, cancelPending, confirmDeleteByButton, echoRatio, failureSpeech, handleUtterance, newSession, parseControl, parseVoiceSwitch, pitchFor, rankVoices, sttConfigKey, sttLadder, takeFirstSentence,
  type Api, type Deps, type Reply, type SttConfig, type VoiceInfo,
} from "./voice-assistant";
import type { BusinessNote } from "./types";
import type { TranscriptLine } from "./realtime-events";
import type { VoiceError, VoiceLevels } from "./useRealtimeVoice";

// Founder Voice, conversación continua por turnos: al abrirse empieza a escuchar sola; entiende la orden, la ejecuta de
// verdad en tu cuenta, la verifica y la confirma con la voz del teléfono; y vuelve a escuchar. Mientras habla sigue
// atenta solo a «detente» / «repite» / una orden nueva (ignorando su propio eco). Sin servicios de pago ni claves.

export type TurnPhase = "idle" | "listening" | "user_speaking" | "thinking" | "speaking" | "error";

const RATE = 0.95; // ritmo tranquilo y seguro
const VOICE_KEY = "voice:male:v2"; // voz elegida (clave nueva: la anterior era una voz femenina con el tono bajado)
const CFG_KEY = "stt:cfg"; // última configuración de reconocimiento que funcionó en este teléfono
/** Escuchar mientras Founder habla (para poder interrumpirlo). Si el eco del altavoz molestara, ponerlo en false. */
const BARGE_IN = true;
const MAX_EMPTY_SESSIONS = 6; // sesiones seguidas sin oír nada antes de pausar la escucha

const apiClient: Api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body: unknown, timeoutMs?: number) => request<T>(path, { method: "POST", body, timeoutMs }),
  del: <T,>(path: string, body: unknown) => request<T>(path, { method: "DELETE", body }),
};

const VOICE_BREVITY = "Responde en español, de forma breve y natural (máximo tres frases), sin listas ni formato, porque se va a leer en voz alta.";

async function askChat(text: string, conversationId: string | null, onFirstSentence?: (s: string) => void): Promise<{ text: string; conversationId: string | null }> {
  const run = async (impl?: typeof fetch) => {
    const acc = { answer: "", id: conversationId, failure: null as string | null, first: false };
    await streamChat({
      content: `${text}\n\n(${VOICE_BREVITY})`,
      conversationId,
      impl,
      channel: "voice",
      onEvent: (e) => {
        if (e.type === "meta") acc.id = e.conversationId;
        else if (e.type === "delta") {
          acc.answer += e.text;
          if (!acc.first && onFirstSentence) {
            const s = takeFirstSentence(acc.answer, 16);
            if (s) { acc.first = true; onFirstSentence(s); }
          }
        } else if (e.type === "error") acc.failure = e.message;
      },
    });
    if (!acc.answer && acc.failure) throw new ApiError(acc.failure, "server");
    return { text: acc.answer, conversationId: acc.id };
  };
  try {
    return await run();
  } catch (e) {
    // Si el canal de flujo falla por red, se reintenta una vez con el cliente normal (respuesta completa).
    if (e instanceof ApiError && e.kind === "network" && e.reason !== "timeout") return run(fetch);
    throw e;
  }
}

async function ensureMic(): Promise<VoiceError | null> {
  if (Platform.OS !== "android") return null;
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: "Micrófono", message: "Founder necesita el micrófono para escucharte.", buttonPositive: "Permitir", buttonNegative: "Ahora no",
  });
  if (r === PermissionsAndroid.RESULTS.GRANTED) return null;
  return r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    ? { message: "El micrófono está bloqueado. Actívalo en los ajustes de Android para hablar con Founder.", needsSettings: true }
    : { message: "Sin permiso de micrófono Founder no puede escucharte." };
}

const vlog = (m: string) => console.log(`[voz] ${m}`);

type Actions = { orbPress(): void; retry(): void; confirmDelete(): void; cancelDelete(): void; changeVoice(): void };
const noActions: Actions = { orbPress() {}, retry() {}, confirmDelete() {}, cancelDelete() {}, changeVoice() {} };

export function useTurnVoice() {
  const { user } = useSession();
  const userRef = useRef(user);
  userRef.current = user;

  const [phase, setPhase] = useState<TurnPhase>("idle");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<VoiceError | null>(null);
  const [levels, setLevels] = useState<VoiceLevels>({ mic: 0, out: 0 });
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const actions = useRef<Actions>(noActions);

  useEffect(() => {
    let alive = true;
    let ph: TurnPhase = "idle";
    const session = newSession();
    let ladder: SttConfig[] = [];
    let idx = 0;
    let retries = 0;
    let empties = 0;
    let hardErrors = 0;
    let bargeErrors = 0;
    let spoken = "";
    let lastSpeech = "";
    let seq = 0;
    let curSpeakId = "";
    // Respuesta rápida: se habla la primera frase mientras llega el resto.
    let early = "";
    let earlyPlaying = false;
    let queuedTail = "";
    let lineN = 0;
    let voices: VoiceInfo[] = [];
    let voiceIdx = -1;
    let curPitch = 1;
    let heardAt = 0;
    const tried: string[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    const setP = (p: TurnPhase) => { ph = p; if (alive) setPhase(p); };
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(() => { if (alive) fn(); }, ms)); };
    const addLine = (role: TranscriptLine["role"], text: string) => {
      if (!text.trim() || !alive) return;
      setLines((prev) => [...prev, { id: `l${++lineN}`, role, text, final: true }].slice(-30));
    };
    const cfg = (): SttConfig | undefined => ladder[idx];
    const fail = (message: string, needsSettings?: boolean) => {
      speech.cancelListening();
      if (alive) setError({ message, needsSettings });
      setP("error");
    };

    const deps = (): Deps => ({
      api: apiClient,
      now: () => new Date(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      chat: askChat,
      identity: { creator: FOUNDER_CREATOR },
      onFirstSentence: (sentence) => {
        if (!alive || ph !== "thinking") return;
        early = sentence; earlyPlaying = true; queuedTail = "";
        speakText(sentence);
      },
      scheduleAlarm: async (n) => {
        try {
          const perm = await ensureNotificationPermission();
          const scheduled = scheduleNote(n as unknown as BusinessNote, []);
          if (!scheduled) return "past";
          return perm === "granted" ? "ok" : "no_permission";
        } catch { return "failed"; }
      },
      recommendations: () => {
        const u = userRef.current;
        const pro = isPro(u?.plan);
        if (!u) return { pro, items: [] };
        return { pro, items: pendingRecommendations(loadRecommendations(), u.id, pro, Date.now()).map((r) => ({ title: r.title, whenText: r.whenText })) };
      },
    });

    // ---- Escuchar ----
    const listen = () => {
      if (!alive) return;
      const c = cfg();
      if (!c) { fail("No hay ninguna configuración de reconocimiento disponible."); return; }
      setP("listening");
      vlog(`escuchando con ${sttConfigKey(c)}`);
      speech.startListening(c.lang, c.onDevice);
    };

    const advance = (why: string) => {
      const c = cfg();
      if (c) tried.push(`${sttConfigKey(c)} → ${why}`);
      vlog(`config descartada: ${c ? sttConfigKey(c) : "?"} (${why})`);
      retries = 0;
      idx++;
      if (idx >= ladder.length) {
        vlog(`sin configuración válida. Probé: ${tried.join("; ")}`);
        fail("No pude activar el micrófono de voz en español. Revisa que «Servicios de voz de Google» esté actualizado y vuelve a intentarlo.");
        return;
      }
      const next = ladder[idx];
      vlog(`siguiente configuración: ${sttConfigKey(next)}`);
      listen();
    };

    const onEmpty = () => {
      empties++;
      if (empties >= MAX_EMPTY_SESSIONS) { setP("idle"); setNotice("Pausé la escucha porque no oí nada. Toca la esfera para seguir."); return; }
      later(listen, 250);
    };

    const begin = async () => {
      if (!speechAvailable) { fail("La voz local no está disponible en esta compilación."); return; }
      const denied = await ensureMic();
      if (!alive) return;
      if (denied) { fail(denied.message, denied.needsSettings); return; }
      if (alive) { setError(null); setNotice(null); }
      tried.length = 0; empties = 0; hardErrors = 0; retries = 0;
      const onDev = speech.isOnDeviceAvailable();
      const sys = speech.isSystemRecognizerAvailable();
      if (!onDev && !sys) { fail("Este teléfono no tiene reconocimiento de voz. Instala o actualiza «Servicios de voz de Google»."); return; }
      const finish = (installed: string[]) => {
        ladder = sttLadder({ onDeviceAvailable: onDev, systemAvailable: sys, installed, saved: storeGet(CFG_KEY) });
        idx = 0;
        vlog(`reconocedor local=${onDev} sistema=${sys} instalados=[${installed.join(",")}] escalera=${ladder.map(sttConfigKey).join(" > ")}`);
        listen();
      };
      if (!onDev) { finish([]); return; }
      let done = false;
      const off = onSpeech("onSupport", (s) => { if (done) return; done = true; off(); finish(s.installed ?? []); });
      speech.checkSupport("es-US");
      later(() => { if (!done) { done = true; off(); finish([]); } }, 2500);
    };

    // ---- Voz de Founder: una voz masculina REAL del motor de voz (no un tono bajado de una femenina) ----
    const applyVoice = (i: number) => {
      const v = voices[i];
      if (!v) return;
      voiceIdx = i;
      speech.setVoice(v.name);
      curPitch = pitchFor(v);
      if (alive) setVoiceName(v.name);
      vlog(`voz: ${v.name} (${v.tag}, género probable: ${v.gender}, red: ${v.network}) tono ${curPitch}`);
    };
    const setupVoices = (entries: string[]) => {
      const hasNeural = voices.some((v) => v.name === NEURAL_VOICE);
      // La voz masculina local puede terminar de cargarse después de las voces de Android: entonces pasa a ser la principal.
      if (voices.length && (hasNeural || !entries.some((e) => e.startsWith(`${NEURAL_VOICE}|`)))) return;
      voices = rankVoices(entries);
      if (voices.length === 0) return;
      const saved = storeGet(VOICE_KEY);
      const i = saved ? voices.findIndex((v) => v.name === saved) : -1;
      applyVoice(i >= 0 ? i : 0);
      if (i < 0 && voices[0].gender !== "male") setNotice("No encontré una voz masculina instalada. Di «ajustes de voz» para instalar una, o «cambia de voz» para probar otras.");
    };
    const cycleVoice = () => {
      if (voices.length === 0) setupVoices(speech.getSpanishVoices());
      if (voices.length === 0) { setNotice("No hay voces en español instaladas. Di «ajustes de voz» para instalar una."); later(listen, 300); return; }
      const next = (voiceIdx + 1) % voices.length;
      applyVoice(next);
      storeSet(VOICE_KEY, voices[next].name);
      speech.cancelListening();
      speakText(`Esta es la voz ${next + 1} de ${voices.length}. Si prefieres otra, di: cambia de voz.`);
    };

    // ---- Hablar ----
    const speakText = (text: string): boolean => {
      spoken = text;
      curSpeakId = `t${++seq}`;
      bargeErrors = 0;
      setP("speaking");
      const ok = speech.speak(text, curSpeakId, curPitch, RATE);
      if (!ok) { curSpeakId = ""; setNotice("No se pudo usar la voz del teléfono. Instala o activa una voz en español en Ajustes › Texto a voz."); later(listen, 300); }
      return ok;
    };

    const say = (reply: Reply, showText = true) => {
      if (showText) addLine("assistant", reply.display ?? reply.speech);
      if (alive) setPendingDelete(reply.confirmDelete ?? null);
      lastSpeech = reply.speech;
      if (earlyPlaying && early && reply.action === "chat" && reply.speech.startsWith(early)) {
        const tail = reply.speech.slice(early.length).trim();
        earlyPlaying = false;
        if (!tail) { early = ""; if (curSpeakId === "") { setP("listening"); later(listen, 350); } return; }
        if (curSpeakId) { queuedTail = tail; early = ""; return; } // la primera frase aún suena: el resto va al terminar
        early = "";
        speakText(tail);
        return;
      }
      if (earlyPlaying) { curSpeakId = ""; speech.stopSpeaking(); }
      earlyPlaying = false; early = ""; queuedTail = "";
      speakText(reply.speech);
    };

    /** Corta la voz de Founder y vuelve a escuchar (interrupción por voz o por toque). */
    const interrupt = () => {
      curSpeakId = ""; earlyPlaying = false; early = ""; queuedTail = "";
      speech.stopSpeaking();
      speech.cancelListening();
      setLevels((l) => ({ ...l, out: 0 }));
      setP("listening");
      later(listen, 350);
    };

    const onUtterance = async (text: string) => {
      addLine("user", text);
      setP("thinking");
      const t0 = Date.now();
      let reply: Reply;
      try {
        reply = await handleUtterance(deps(), session, text);
      } catch (e) {
        reply = { speech: failureSpeech(e, "No pude completar eso.", false), listenAgain: false };
      }
      vlog(`tiempos: reconocer→orden ${t0 - heardAt} ms · procesar ${Date.now() - t0} ms · acción ${reply.action ?? "?"}`);
      if (alive) say(reply);
    };

    const onHeard = (text: string) => {
      if (!text.trim()) { onEmpty(); return; }
      heardAt = Date.now();
      const c = cfg();
      if (c) storeSet(CFG_KEY, sttConfigKey(c));
      empties = 0; retries = 0; hardErrors = 0;
      const ctl = parseControl(text);
      if (ctl === "repeat" && lastSpeech) { addLine("user", text); speakText(lastSpeech); return; }
      if (ctl === "stop") { later(listen, 200); return; }
      const vs = parseVoiceSwitch(text);
      if (vs === "change") { addLine("user", text); cycleVoice(); return; }
      if (vs === "settings") {
        addLine("user", text);
        void Linking.sendIntent("com.android.settings.TTS_SETTINGS").catch(() => Linking.openSettings());
        say({ speech: "Abro los ajustes de texto a voz. Ahí puedes instalar o elegir una voz masculina en español.", listenAgain: false });
        return;
      }
      void onUtterance(text);
    };

    // Durante la voz de Founder: solo se atiende a una orden de control o a una orden nueva real; el eco se ignora.
    const restartBarge = () => later(() => {
      const c = cfg();
      if (ph === "speaking" && c && bargeErrors <= 8) speech.startListening(c.lang, c.onDevice);
    }, 250);

    const onBargeText = (text: string) => {
      if (!text.trim()) { restartBarge(); return; }
      const ctl = parseControl(text, spoken);
      if (ctl === "stop") { vlog(`interrumpido por voz: «${text}»`); interrupt(); return; }
      if (ctl === "repeat") { vlog("pidió repetir"); addLine("user", text); curSpeakId = ""; speech.stopSpeaking(); speech.cancelListening(); later(() => { if (lastSpeech) speakText(lastSpeech); else listen(); }, 350); return; }
      const words = text.trim().split(/\s+/).length;
      if (echoRatio(text, spoken) >= 0.5 || words < 2) { restartBarge(); return; }
      vlog(`orden nueva sobre la voz de Founder: «${text}»`);
      curSpeakId = "";
      speech.stopSpeaking();
      speech.cancelListening();
      void onUtterance(text);
    };

    // ---- Eventos del módulo nativo ----
    const offs = [
      onSpeech("onBegin", () => { if (ph === "listening") setP("user_speaking"); }),
      onSpeech("onLevel", ({ db }) => { if (ph === "listening" || ph === "user_speaking") setLevels((l) => ({ ...l, mic: Math.max(0, Math.min(1, (db + 2) / 12)) })); }),
      onSpeech("onPartial", ({ text }) => {
        if (ph !== "speaking" || !BARGE_IN) return;
        if (parseControl(text, spoken) === "stop") { vlog(`«${text}» → detener`); interrupt(); }
      }),
      onSpeech("onResult", ({ text }) => {
        if (ph === "speaking") { if (BARGE_IN) onBargeText(text); return; }
        if (ph === "listening" || ph === "user_speaking") onHeard(text);
      }),
      onSpeech("onError", ({ code, name }) => {
        if (ph === "speaking") { bargeErrors++; restartBarge(); return; }
        if (ph !== "listening" && ph !== "user_speaking") return;
        const c = cfg();
        vlog(`error de reconocimiento ${name} (${code}) con ${c ? sttConfigKey(c) : "?"}`);
        if (code === 6 || code === 7) { onEmpty(); return; }
        if (code === 8 || code === 5) { if (++retries <= 3) { later(listen, 600); return; } advance(name); return; }
        if (code === 9) { fail("Falta el permiso de micrófono.", true); return; }
        if (code === 3) { if (++hardErrors <= 3) { later(listen, 800); return; } fail("No pude usar el micrófono (AUDIO). Cierra otras apps que lo estén usando."); return; }
        // LANGUAGE_NOT_SUPPORTED (12), LANGUAGE_UNAVAILABLE (13), sin reconocedor local (100…), red/servidor: siguiente configuración.
        if (code === 13 && c?.onDevice) speech.downloadModel(c.lang);
        advance(name);
      }),
      onSpeech("onSpeakStart", ({ id }) => {
        if (id !== curSpeakId || ph !== "speaking" || !BARGE_IN) return;
        later(() => { const c = cfg(); if (ph === "speaking" && id === curSpeakId && c) speech.startListening(c.lang, c.onDevice); }, 450);
      }),
      onSpeech("onSpeakDone", ({ id }) => {
        if (id !== curSpeakId || ph !== "speaking") return;
        curSpeakId = "";
        if (queuedTail) { const t = queuedTail; queuedTail = ""; speakText(t); return; }
        if (earlyPlaying) return; // primera frase terminada; la respuesta completa aún está llegando
        speech.cancelListening();
        setLevels((l) => ({ ...l, out: 0 }));
        setP("listening");
        later(listen, 200); // deja que se apague la cola del altavoz antes de volver a escuchar
      }),
      onSpeech("onSpeakError", ({ id }) => {
        if (id !== curSpeakId || ph !== "speaking") return;
        const bad = voices[voiceIdx];
        if (bad?.network) {
          // Una voz de red falló (sin Internet o sin datos de voz): se descarta y se usa la siguiente.
          voices = voices.filter((v) => v !== bad);
          if (voices.length) { applyVoice(0); speakText(spoken); return; }
        }
        curSpeakId = "";
        speech.cancelListening();
        setNotice("No pude hablar: falta una voz en español sin conexión. Instálala en Ajustes › Texto a voz.");
        setP("listening");
        later(listen, 400);
      }),
    ];

    // ---- Acciones de la pantalla ----
    actions.current = {
      orbPress: () => {
        if (ph === "speaking") interrupt();
        else if (ph === "listening" || ph === "user_speaking") speech.stopListening();
        else if (ph === "idle") { setNotice(null); empties = 0; if (ladder.length) listen(); else void begin(); }
        else if (ph === "error") { setError(null); void begin(); }
      },
      retry: () => { setError(null); void begin(); },
      confirmDelete: async () => {
        setPendingDelete(null);
        speech.cancelListening();
        setP("thinking");
        const r = await confirmDeleteByButton(deps(), session);
        if (alive) say(r);
      },
      cancelDelete: () => { setPendingDelete(null); speech.cancelListening(); say(cancelPending(session)); },
      changeVoice: () => cycleVoice(),
    };

    offs.push(onSpeech("onVoices", ({ voices: list }) => setupVoices(list)));
    speech.warmUp();
    void request("/api/version", { auth: false, timeoutMs: 8000 }).catch(() => undefined); // abre la conexión con el servidor de antemano
    setKeepScreenOn(true);
    void begin();

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      offs.forEach((off) => off());
      actions.current = noActions;
      setKeepScreenOn(false);
      resetAudioRoute();
      speech.cancelListening();
      speech.stopSpeaking();
    };
  }, []);

  // Latido visual mientras Founder habla (el motor de voz no entrega nivel de audio).
  useEffect(() => {
    if (phase !== "speaking") return;
    const timer = setInterval(() => setLevels((l) => ({ ...l, out: 0.25 + 0.2 * Math.abs(Math.sin(Date.now() / 140)) })), 90);
    return () => clearInterval(timer);
  }, [phase]);

  const orbPress = useCallback(() => actions.current.orbPress(), []);
  const retry = useCallback(() => actions.current.retry(), []);
  const confirmDelete = useCallback(() => actions.current.confirmDelete(), []);
  const cancelDelete = useCallback(() => actions.current.cancelDelete(), []);
  const changeVoice = useCallback(() => actions.current.changeVoice(), []);
  const openSettings = useCallback(() => { void Linking.openSettings(); }, []);

  return { phase, lines, notice, error, levels, pendingDelete, voiceName, orbPress, retry, confirmDelete, cancelDelete, changeVoice, openSettings };
}
