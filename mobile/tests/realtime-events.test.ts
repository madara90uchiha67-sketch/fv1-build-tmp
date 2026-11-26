import test from "node:test";
import assert from "node:assert/strict";
import { initialVoiceState, reconnectPlan, reduceVoiceEvent, sessionUpdates, type RealtimeEvent, type VoiceState } from "../src/lib/realtime-events.ts";

const listening: VoiceState = { ...initialVoiceState, phase: "listening" };
const run = (state: VoiceState, ...events: RealtimeEvent[]) => events.reduce((acc, e) => { const r = reduceVoiceEvent(acc.state, e); return { state: r.state, actions: [...acc.actions, ...r.actions] }; }, { state, actions: [] as string[] });

test("turno normal: escucha → piensa → habla → escucha", () => {
  const r = run(listening,
    { type: "input_audio_buffer.speech_started", item_id: "u1" },
    { type: "input_audio_buffer.speech_stopped" },
    { type: "response.created" },
    { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "Hola" },
    { type: "response.output_audio_transcript.delta", item_id: "a1", delta: " Cristian" },
    { type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Hola Cristian" },
    { type: "response.done" },
    { type: "output_audio_buffer.stopped" },
  );
  assert.equal(r.state.phase, "listening");
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.lines.find((l) => l.id === "a1")?.text, "Hola Cristian");
});

test("interrumpir mientras Founder habla pide cortar el audio y pasa a escuchar al usuario", () => {
  const r = run(listening,
    { type: "response.created" },
    { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "Te explico" },
    { type: "input_audio_buffer.speech_started", item_id: "u2" },
  );
  assert.equal(r.state.phase, "user_speaking");
  assert.deepEqual(r.actions, ["interrupt"]);
  assert.equal(r.state.lines.find((l) => l.id === "a1")?.final, true); // lo dicho hasta ahí queda como final
});

test("un delta rezagado de la respuesta interrumpida no vuelve a poner 'habla'", () => {
  const r = run(listening,
    { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "x" },
    { type: "input_audio_buffer.speech_started", item_id: "u2" },
    { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "tarde" },
  );
  assert.equal(r.state.phase, "user_speaking");
  assert.equal(r.state.lines.find((l) => l.id === "a1")?.text, "x");
});

test("hablar sobre Founder mientras piensa también interrumpe", () => {
  const r = run(listening, { type: "input_audio_buffer.speech_stopped" }, { type: "input_audio_buffer.speech_started", item_id: "u3" });
  assert.deepEqual(r.actions, ["interrupt"]);
});

test("hablar cuando está escuchando no es una interrupción", () => {
  assert.deepEqual(run(listening, { type: "input_audio_buffer.speech_started", item_id: "u1" }).actions, []);
});

test("sin eventos output_audio_buffer, response.done termina el turno", () => {
  const r = run(listening, { type: "response.created" }, { type: "response.output_audio_transcript.delta", item_id: "a", delta: "ok" }, { type: "response.done" });
  assert.equal(r.state.phase, "listening");
});

test("con eventos output_audio_buffer, response.done no corta el audio que aún suena", () => {
  const r = run(listening, { type: "response.created" }, { type: "output_audio_buffer.started" }, { type: "response.done" });
  assert.equal(r.state.phase, "speaking");
  assert.equal(run(r.state, { type: "output_audio_buffer.stopped" }).state.phase, "listening");
});

test("transcripción del usuario se asocia por item_id y mantiene el orden", () => {
  const r = run(listening,
    { type: "input_audio_buffer.speech_started", item_id: "u1" },
    { type: "input_audio_buffer.speech_stopped" },
    { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "Claro" },
    { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: " ¿Cómo voy? " },
  );
  assert.deepEqual(r.state.lines.map((l) => [l.id, l.role, l.text]), [["u1", "user", "¿Cómo voy?"], ["a1", "assistant", "Claro"]]);
});

test("errores benignos se ignoran y los demás se muestran como aviso sin cortar la llamada", () => {
  assert.equal(run(listening, { type: "error", error: { code: "response_cancel_not_active", message: "x" } }).state.notice, null);
  const r = run(listening, { type: "error", error: { code: "invalid_value", message: "Falló algo" } });
  assert.equal(r.state.notice, "Falló algo");
  assert.equal(r.state.phase, "listening");
});

test("antes de conectar se ignoran los eventos de turno", () => {
  assert.equal(run(initialVoiceState, { type: "input_audio_buffer.speech_started", item_id: "u" }).state.phase, "connecting");
});

test("las actualizaciones de sesión usan la ruta GA y no sobrescriben las instrucciones del servidor", () => {
  const [vad, transcription] = sessionUpdates() as Array<{ session: Record<string, any> }>;
  assert.equal(vad.session.type, "realtime");
  assert.equal(vad.session.audio.input.turn_detection.interrupt_response, true);
  assert.equal(transcription.session.audio.input.transcription.language, "es");
  assert.equal("instructions" in vad.session || "instructions" in transcription.session, false);
});

test("reconexión automática: reintenta con espera creciente y se rinde tras 3 fallos seguidos", () => {
  assert.deepEqual(reconnectPlan(0), { retry: true, delayMs: 700 });
  assert.deepEqual(reconnectPlan(1), { retry: true, delayMs: 1400 });
  assert.deepEqual(reconnectPlan(2), { retry: true, delayMs: 2100 });
  assert.deepEqual(reconnectPlan(3), { retry: false, delayMs: 0 });
});

test("hay una actualización de reducción de ruido para el altavoz", () => {
  const updates = sessionUpdates() as Array<{ session: Record<string, any> }>;
  assert.ok(updates.some((u) => u.session.audio.input.noise_reduction?.type === "far_field"));
});
