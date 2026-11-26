// Lógica pura (sin React ni WebRTC) del control de turnos de la llamada de voz con OpenAI Realtime.
// Recibe los eventos del canal de datos "oai-events" y devuelve el nuevo estado de la llamada, la
// transcripción y las acciones que el cliente debe ejecutar (p. ej. cortar el audio al interrumpir).

export type VoicePhase = "connecting" | "listening" | "user_speaking" | "thinking" | "speaking" | "error";

export interface TranscriptLine {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface VoiceState {
  phase: VoicePhase;
  lines: TranscriptLine[];
  notice: string | null;
  /** Se vio al menos un evento output_audio_buffer.*: el fin del audio lo marca ese evento, no response.done. */
  sawBufferEvents: boolean;
}

export type VoiceAction = "interrupt";

export interface RealtimeEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { code?: string; message?: string };
  response?: { status?: string };
  [key: string]: unknown;
}

export const initialVoiceState: VoiceState = { phase: "connecting", lines: [], notice: null, sawBufferEvents: false };

// Errores sin importancia para el usuario (p. ej. cancelar cuando no había respuesta activa).
const BENIGN_ERRORS = new Set(["response_cancel_not_active", "no_active_response", "item_truncate_invalid_item_id", "input_audio_buffer_commit_empty"]);

function upsertLine(lines: TranscriptLine[], id: string, role: TranscriptLine["role"], patch: (line: TranscriptLine) => TranscriptLine): TranscriptLine[] {
  const index = lines.findIndex((line) => line.id === id);
  if (index === -1) return [...lines, patch({ id, role, text: "", final: false })];
  return lines.map((line, i) => (i === index ? patch(line) : line));
}

function finishOpenAssistantLines(lines: TranscriptLine[]): TranscriptLine[] {
  return lines.map((line) => (line.role === "assistant" && !line.final ? { ...line, final: true } : line));
}

export function reduceVoiceEvent(state: VoiceState, event: RealtimeEvent): { state: VoiceState; actions: VoiceAction[] } {
  const actions: VoiceAction[] = [];
  let next = state;
  if (state.phase === "error" || state.phase === "connecting") {
    // Antes de conectar solo se atienden los errores; el cliente pasa a "listening" al abrirse el canal.
    if (event.type !== "error") return { state, actions };
  }

  switch (event.type) {
    case "input_audio_buffer.speech_started": {
      // El usuario empieza a hablar. Si Founder estaba hablando o pensando, es una interrupción.
      if (state.phase === "speaking" || state.phase === "thinking") actions.push("interrupt");
      next = {
        ...state,
        phase: "user_speaking",
        lines: event.item_id ? upsertLine(finishOpenAssistantLines(state.lines), event.item_id, "user", (l) => l) : finishOpenAssistantLines(state.lines),
      };
      break;
    }
    case "input_audio_buffer.speech_stopped":
      next = { ...state, phase: "thinking" };
      break;
    case "response.created":
      if (state.phase !== "speaking" && state.phase !== "user_speaking") next = { ...state, phase: "thinking" };
      break;
    case "response.output_audio_transcript.delta": {
      if (state.phase === "user_speaking") break; // delta rezagado de una respuesta ya interrumpida
      const id = event.item_id ?? "assistant-current";
      next = {
        ...state,
        phase: "speaking",
        lines: upsertLine(state.lines, id, "assistant", (l) => ({ ...l, text: l.text + (event.delta ?? "") })),
      };
      break;
    }
    case "response.output_audio_transcript.done": {
      const id = event.item_id ?? "assistant-current";
      next = { ...state, lines: upsertLine(state.lines, id, "assistant", (l) => ({ ...l, text: event.transcript ?? l.text, final: true })) };
      break;
    }
    case "output_audio_buffer.started":
      next = { ...state, sawBufferEvents: true, phase: state.phase === "user_speaking" ? state.phase : "speaking" };
      break;
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared":
      next = {
        ...state,
        sawBufferEvents: true,
        phase: state.phase === "speaking" ? "listening" : state.phase,
        lines: finishOpenAssistantLines(state.lines),
      };
      break;
    case "response.done": {
      const finished = finishOpenAssistantLines(state.lines);
      if (state.phase === "thinking") next = { ...state, phase: "listening", lines: finished };
      else if (state.phase === "speaking" && !state.sawBufferEvents) next = { ...state, phase: "listening", lines: finished };
      else next = { ...state, lines: finished };
      break;
    }
    case "conversation.item.input_audio_transcription.completed": {
      const text = (event.transcript ?? "").trim();
      if (event.item_id && text) next = { ...state, lines: upsertLine(state.lines, event.item_id, "user", (l) => ({ ...l, text, final: true })) };
      break;
    }
    case "error": {
      const code = event.error?.code ?? "";
      if (!BENIGN_ERRORS.has(code)) next = { ...state, notice: event.error?.message ?? "Ocurrió un problema en la llamada." };
      break;
    }
    default:
      break;
  }
  return { state: next, actions };
}

/** Eventos session.update que se envían al abrir el canal (cada uno por separado: si uno falla, el resto sigue). */
export function sessionUpdates(): object[] {
  return [
    {
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            // semantic_vad detecta cuándo terminaste de hablar por el sentido de la frase, no solo por el silencio.
            turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true },
          },
        },
      },
    },
    {
      type: "session.update",
      session: { type: "realtime", audio: { input: { transcription: { model: "gpt-4o-mini-transcribe", language: "es" } } } },
    },
    {
      // Con el altavoz del teléfono la voz de Founder vuelve al micrófono: la reducción de ruido de campo lejano
      // ayuda a que no se interrumpa a sí mismo.
      type: "session.update",
      session: { type: "realtime", audio: { input: { noise_reduction: { type: "far_field" } } } },
    },
  ];
}

/** Reconexión automática: cada intento abre una sesión nueva (clave efímera nueva); se rinde tras varios fallos seguidos. */
export const MAX_RECONNECTS = 3;
export function reconnectPlan(failuresInRow: number): { retry: boolean; delayMs: number } {
  if (failuresInRow >= MAX_RECONNECTS) return { retry: false, delayMs: 0 };
  return { retry: true, delayMs: 700 * (failuresInRow + 1) };
}

/** Códigos legibles de la causa de un corte (se muestran para poder diagnosticar en un teléfono real). */
export type DropReason = "ice_disconnected" | "ice_failed" | "channel_closed" | "peer_closed" | "setup_failed";
