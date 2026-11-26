import test from "node:test";
import assert from "node:assert/strict";
import { cleanSteps, eventDate, formatLead, isPro, leadToMinutes, reminderBody, reminderTime, validateSchedule } from "../src/lib/notes-logic.ts";

test("plan: solo PRO es Pro", () => {
  assert.equal(isPro("PRO"), true);
  assert.equal(isPro("FREE"), false);
  assert.equal(isPro(undefined), false);
  assert.equal(isPro("pro"), false);
});

test("anticipación en minutos, horas y días", () => {
  assert.equal(leadToMinutes(30, "minutes"), 30);
  assert.equal(leadToMinutes(2, "hours"), 120);
  assert.equal(leadToMinutes(1, "days"), 1440);
  assert.equal(leadToMinutes(31, "days"), null);
  assert.equal(leadToMinutes(-1, "minutes"), null);
  assert.equal(leadToMinutes(1.5, "hours"), null);
  assert.equal(leadToMinutes(30, "days"), 43200);
});

test("texto de anticipación", () => {
  assert.equal(formatLead(0), "a la hora del acontecimiento");
  assert.equal(formatLead(1440), "1 día antes");
  assert.equal(formatLead(2880), "2 días antes");
  assert.equal(formatLead(60), "1 hora antes");
  assert.equal(formatLead(90), "90 minutos antes");
});

test("fecha del acontecimiento: 25 de noviembre 10:00 a. m.", () => {
  const d = eventDate({ day: 25, month: 11, year: 2026, hour12: 10, minute: 0, pm: false });
  assert.ok(d);
  assert.equal(d!.getHours(), 10);
  assert.equal(d!.getDate(), 25);
  assert.equal(reminderTime(d!, 1440), new Date(2026, 10, 24, 10, 0).getTime());
});

test("12 a. m. es medianoche y 12 p. m. es mediodía", () => {
  assert.equal(eventDate({ day: 1, month: 1, year: 2027, hour12: 12, minute: 0, pm: false })!.getHours(), 0);
  assert.equal(eventDate({ day: 1, month: 1, year: 2027, hour12: 12, minute: 0, pm: true })!.getHours(), 12);
  assert.equal(eventDate({ day: 1, month: 1, year: 2027, hour12: 3, minute: 5, pm: true })!.getHours(), 15);
});

test("fechas inválidas se rechazan", () => {
  assert.equal(eventDate({ day: 31, month: 2, year: 2027, hour12: 1, minute: 0, pm: false }), null);
  assert.equal(eventDate({ day: 1, month: 13, year: 2027, hour12: 1, minute: 0, pm: false }), null);
  assert.equal(eventDate({ day: 1, month: 1, year: 2027, hour12: 13, minute: 0, pm: false }), null);
  assert.equal(eventDate({ day: 1, month: 1, year: 2027, hour12: 1, minute: 60, pm: false }), null);
  assert.equal(eventDate({ day: NaN, month: 1, year: 2027, hour12: 1, minute: 0, pm: false }), null);
});

test("validación: pasado y aviso ya vencido", () => {
  const now = new Date(2026, 10, 20, 9, 0).getTime();
  const future = new Date(2026, 10, 25, 10, 0);
  assert.equal(validateSchedule(future, 1440, now), null);
  assert.match(validateSchedule(new Date(2026, 10, 19, 10, 0), 0, now)!, /pasó/);
  assert.match(validateSchedule(new Date(2026, 10, 21, 8, 0), 3000, now)!, /ya habría pasado/);
  assert.match(validateSchedule(future, null, now)!, /anticipación/);
  assert.match(validateSchedule(null, 10, now)!, /fecha/);
});

test("cuerpo de la notificación incluye recomendaciones", () => {
  const body = reminderBody({ title: "Reunión con inversionistas", whenText: "mié 25 nov, 10:00", leadMinutes: 1440, steps: ["Preparar la presentación", "Organizar las cifras"] });
  assert.match(body, /^Reunión con inversionistas · mié 25 nov, 10:00\n• Preparar la presentación\n• Organizar las cifras$/);
  assert.equal(reminderBody({ title: "A", whenText: "B", leadMinutes: 0, steps: [] }), "A · B");
});

test("limpieza de pasos del modelo", () => {
  assert.deepEqual(cleanSteps(["1. Preparar", "- Revisar cifras", "", "  • Definir temas"]), ["Preparar", "Revisar cifras", "Definir temas"]);
  assert.deepEqual(cleanSteps("no"), []);
  assert.equal(cleanSteps(["x".repeat(300)])[0].length, 178);
  assert.equal(cleanSteps(Array(9).fill("paso")).length, 5);
});

import {
  parseRecommendations, pendingRecommendations, recommendationChatPrompt, removeRecommendationsOfNote,
  setRecommendationStatus, upsertRecommendation, type Recommendation,
} from "../src/lib/notes-logic.ts";

const mkRec = (over: Partial<Recommendation> = {}): Recommendation => ({
  noteId: "n1", userId: "u1", title: "Reunión", content: "Presentar la oferta", whenText: "lun 10:00",
  steps: ["Preparar la oferta", "Ensayar el cierre"], dueAt: 1000, createdAt: 500, status: "pending", ...over,
});

test("recomendaciones: solo las pendientes, vencidas, de la cuenta y del plan Pro", () => {
  const list = [mkRec(), mkRec({ noteId: "n2", dueAt: 9000 }), mkRec({ noteId: "n3", status: "ignored" }), mkRec({ noteId: "n4", userId: "u2" })];
  assert.deepEqual(pendingRecommendations(list, "u1", true, 2000).map((r) => r.noteId), ["n1"]);
  assert.deepEqual(pendingRecommendations(list, "u1", false, 2000), []);
});

test("recomendaciones: Ignorar y Chat las sacan de pendientes y se gestionan una a una", () => {
  let list = [mkRec(), mkRec({ noteId: "n2" })];
  list = setRecommendationStatus(list, "u1", "n1", "ignored");
  assert.deepEqual(pendingRecommendations(list, "u1", true, 2000).map((r) => r.noteId), ["n2"]);
  list = setRecommendationStatus(list, "u1", "n2", "chat");
  assert.deepEqual(pendingRecommendations(list, "u1", true, 2000), []);
});

test("recomendaciones: una nueva sustituye a la anterior y vuelve a pendiente; se borran con la nota", () => {
  let list = upsertRecommendation([mkRec({ status: "ignored" })], mkRec({ steps: ["Otro paso"] }));
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "pending");
  assert.deepEqual(list[0].steps, ["Otro paso"]);
  list = removeRecommendationsOfNote(list, "n1");
  assert.equal(list.length, 0);
});

test("recomendaciones: sobreviven a guardar y leer (cierre y reapertura)", () => {
  const stored = JSON.stringify([mkRec(), { basura: true }]);
  const back = parseRecommendations(stored);
  assert.equal(back.length, 1);
  assert.deepEqual(back[0], mkRec());
  assert.deepEqual(parseRecommendations("no es json"), []);
  assert.deepEqual(parseRecommendations(null), []);
});

test("el mensaje del chat incluye la recomendación y el contexto de la nota", () => {
  const text = recommendationChatPrompt(mkRec());
  for (const part of ["Reunión", "Presentar la oferta", "lun 10:00", "• Preparar la oferta", "• Ensayar el cierre"]) assert.ok(text.includes(part), part);
});

import { mergeServerRecommendations, type ServerRecommendation } from "../src/lib/notes-logic.ts";

// Un «servidor» mínimo que se comporta como las rutas: una recomendación por nota y usuario; PATCH solo desde pendiente.
function fakeServer() {
  const rows = new Map<string, ServerRecommendation & { userId: string }>();
  const key = (u: string, n: string) => `${u}|${n}`;
  return {
    put(userId: string, r: Recommendation) {
      const k = key(userId, r.noteId); const text = r.steps.join("\n"); const old = rows.get(k);
      if (old && old.steps.join("\n") === text) return;
      rows.set(k, { userId, noteId: r.noteId, title: r.title, content: r.content, whenText: r.whenText, steps: r.steps, status: "pending", dueAt: new Date(r.dueAt).toISOString(), createdAt: new Date(r.createdAt).toISOString(), attendedAt: null });
    },
    patch(userId: string, noteId: string, status: "chat" | "ignored") { const o = rows.get(key(userId, noteId)); if (o && o.status === "pending") o.status = status; },
    list(userId: string): ServerRecommendation[] { return [...rows.values()].filter((r) => r.userId === userId); },
  };
}

test("sincronización: lo guardado en un dispositivo aparece en otro y Ignorar se refleja en ambos", () => {
  const server = fakeServer();
  const a1 = mkRec({ sync: "new" }); const a2 = mkRec({ noteId: "n2", sync: "new" });
  // Dispositivo A guarda dos recomendaciones y las envía.
  let devA = [a1, a2]; devA.forEach((r) => server.put("u1", r)); devA = mergeServerRecommendations(devA, server.list("u1"), "u1");
  assert.ok(devA.every((r) => r.sync === "ok"));
  // Dispositivo B (instalación nueva, vacío) las trae.
  let devB = mergeServerRecommendations([], server.list("u1"), "u1");
  assert.deepEqual(pendingRecommendations(devB, "u1", true, 2000).map((r) => r.noteId).sort(), ["n1", "n2"]);
  // B ignora una; A la ve como ignorada tras sincronizar; la otra sigue pendiente.
  devB = setRecommendationStatus(devB, "u1", "n1", "ignored"); server.patch("u1", "n1", "ignored");
  devB = mergeServerRecommendations(devB, server.list("u1"), "u1");
  devA = mergeServerRecommendations(devA, server.list("u1"), "u1");
  assert.deepEqual(pendingRecommendations(devA, "u1", true, 2000).map((r) => r.noteId), ["n2"]);
  assert.deepEqual(pendingRecommendations(devB, "u1", true, 2000).map((r) => r.noteId), ["n2"]);
});

test("sincronización: sin duplicados al sincronizar varias veces o desde dos dispositivos", () => {
  const server = fakeServer(); const r = mkRec({ sync: "new" });
  server.put("u1", r); server.put("u1", r);
  let dev = mergeServerRecommendations([r], server.list("u1"), "u1");
  dev = mergeServerRecommendations(dev, server.list("u1"), "u1");
  assert.equal(dev.length, 1);
});

test("sincronización: un Chat/Ignorar sin conexión se conserva y no reaparece como pendiente", () => {
  const server = fakeServer(); const r = mkRec({ sync: "new" });
  server.put("u1", r);
  let dev = mergeServerRecommendations([r], server.list("u1"), "u1");
  dev = setRecommendationStatus(dev, "u1", "n1", "chat"); // sin red: el servidor aún dice «pending»
  dev = mergeServerRecommendations(dev, server.list("u1"), "u1");
  assert.deepEqual(pendingRecommendations(dev, "u1", true, 2000), []);
  assert.equal(dev[0].sync, "attend");
  server.patch("u1", "n1", "chat"); // vuelve la red
  dev = mergeServerRecommendations(dev, server.list("u1"), "u1");
  assert.equal(dev[0].status, "chat"); assert.equal(dev[0].sync, "ok");
});

test("sincronización: una recomendación local aún no enviada se conserva; una sincronizada que el servidor ya no tiene se elimina", () => {
  const nueva = mkRec({ noteId: "n9", sync: "new" }); const vieja = mkRec({ noteId: "n8", sync: "ok" });
  const out = mergeServerRecommendations([nueva, vieja], [], "u1");
  assert.deepEqual(out.map((r) => r.noteId), ["n9"]);
});

test("permisos entre usuarios: la mezcla de una cuenta no toca ni mezcla las de otra", () => {
  const server = fakeServer(); const u1 = mkRec({ sync: "new" }); const u2 = mkRec({ userId: "u2", title: "De otro", sync: "new" });
  server.put("u1", u1); server.put("u2", u2);
  const dev = mergeServerRecommendations([u2], server.list("u1"), "u1"); // dispositivo con u2 guardada, entra u1
  assert.equal(dev.find((r) => r.userId === "u2")?.title, "De otro");
  assert.deepEqual(pendingRecommendations(dev, "u1", true, 2000).map((r) => r.userId), ["u1"]);
  assert.deepEqual(pendingRecommendations(dev, "u2", true, 2000).map((r) => r.userId), ["u2"]);
  assert.deepEqual(server.list("u1").map((r) => r.title), ["Reunión"]); // el servidor solo entrega lo de cada usuario
});
