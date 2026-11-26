import { PermissionsAndroid, Platform } from "react-native";
import { canNotify, cancelReminder, cancelAllReminders, scheduleReminder, scheduledReminderIds, storeGet, storeSet } from "../../modules/founder-reminders";
import { ApiError, request } from "./api";
import {
  cleanSteps, formatWhen, parseRecommendations, pendingRecommendations, recommendationPrompt, reminderBody, reminderTitle,
  mergeServerRecommendations, removeRecommendationsOfNote, setRecommendationStatus, upsertRecommendation,
  type RecStatus, type Recommendation, type ServerRecommendation,
} from "./notes-logic";
import type { BusinessNote } from "./types";

// Recordatorios de notas (solo Founder Pro). La notificación la dispara Android (AlarmManager) aunque la app
// esté cerrada. Founder no puede ejecutarse con la app cerrada, así que las recomendaciones se generan con la
// nota en mano (al guardarla o al abrir Notas) y se incluyen ya escritas en el aviso.

export type PermissionState = "granted" | "denied" | "blocked";

export async function ensureNotificationPermission(): Promise<PermissionState> {
  if (Platform.OS !== "android") return "granted";
  if (Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS" as never, {
      title: "Notificaciones",
      message: "Founder necesita enviarte avisos de tus notas a la hora que elijas.",
      buttonPositive: "Permitir",
      buttonNegative: "Ahora no",
    });
    if (result === PermissionsAndroid.RESULTS.GRANTED) return canNotify() ? "granted" : "denied";
    return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "denied";
  }
  return canNotify() ? "granted" : "denied";
}

const stepsKey = (id: string) => `rec:${id}`;

export function loadSteps(noteId: string): string[] {
  const raw = storeGet(stepsKey(noteId));
  if (!raw) return [];
  try { return cleanSteps(JSON.parse(raw)); } catch { return []; }
}

export function saveSteps(noteId: string, steps: string[]): void {
  storeSet(stepsKey(noteId), JSON.stringify(steps));
}

/** Pasos de preparación propios de esta nota, generados por Founder (/api/strategist, con tu memoria y tono). */
export async function generateSteps(note: Pick<BusinessNote, "title" | "content" | "noteDate">): Promise<string[]> {
  const whenText = note.noteDate ? formatWhen(new Date(note.noteDate)) : "sin fecha";
  const data = await request<{ result?: { proximos_pasos?: unknown } }>("/api/strategist", {
    method: "POST",
    // `purpose` hace que el servidor exija plan Pro para esta petición.
    body: { input: recommendationPrompt(note, whenText), purpose: "note_recommendation" },
    timeoutMs: 60000,
  });
  return cleanSteps(data.result?.proximos_pasos);
}

/** Programa (o reprograma) el aviso de una nota con el texto y los pasos actuales. Devuelve false si ya pasó. */
export function scheduleNote(note: BusinessNote, steps: string[]): boolean {
  if (!note.noteDate || note.reminderLeadMinutes === null || !note.reminderAt) return false;
  const triggerAt = new Date(note.reminderAt).getTime();
  if (!Number.isFinite(triggerAt) || triggerAt <= Date.now() + 2000) return false;
  const body = reminderBody({
    title: note.title,
    whenText: formatWhen(new Date(note.noteDate)),
    leadMinutes: note.reminderLeadMinutes,
    steps,
  });
  return scheduleReminder(note.id, triggerAt, reminderTitle(note.reminderLeadMinutes), body);
}

export function unscheduleNote(noteId: string): void {
  cancelReminder(noteId);
  storeSet(stepsKey(noteId), "[]");
  saveRecommendations(removeRecommendationsOfNote(loadRecommendations(), noteId));
}

// ── Recomendaciones pendientes ───────────────────────────────────────────────────────────────────────
// Se guardan en el teléfono (almacén nativo, sobrevive al cierre de la app) hasta que el usuario elige
// Chat o Ignorar. Cada una se gestiona por separado y pertenece a una cuenta.
const RECS_KEY = "recs:v1";

export function loadRecommendations(): Recommendation[] {
  return parseRecommendations(storeGet(RECS_KEY));
}

function saveRecommendations(list: Recommendation[]): void {
  storeSet(RECS_KEY, JSON.stringify(list));
}

/** Guarda la recomendación generada para una nota con aviso. Queda pendiente hasta que llegue su hora y se atienda. */
export function recordRecommendation(userId: string, note: BusinessNote, steps: string[]): void {
  if (!steps.length || !note.reminderAt || !note.noteDate) return;
  const dueAt = new Date(note.reminderAt).getTime();
  if (!Number.isFinite(dueAt)) return;
  saveRecommendations(upsertRecommendation(loadRecommendations(), {
    noteId: note.id, userId, title: note.title, content: note.content,
    whenText: formatWhen(new Date(note.noteDate)), steps, dueAt, createdAt: Date.now(), status: "pending", sync: "new",
  }));
  void syncRecommendations(userId);
}

export function pendingFor(userId: string, pro: boolean): Recommendation[] {
  return pendingRecommendations(loadRecommendations(), userId, pro, Date.now());
}

export function findRecommendation(userId: string, noteId: string): Recommendation | undefined {
  return loadRecommendations().find((r) => r.userId === userId && r.noteId === noteId);
}

export function resolveRecommendation(userId: string, noteId: string, status: Exclude<RecStatus, "pending">): void {
  saveRecommendations(setRecommendationStatus(loadRecommendations(), userId, noteId, status));
  void syncRecommendations(userId); // si no hay conexión queda pendiente de enviar y se reintenta en la próxima sincronización
}

// ── Sincronización con el servidor (Supabase vía la API de Founder, solo plan Pro) ─────────────────────
// Orden: 1) enviar lo que falta (recomendaciones nuevas y Chat/Ignorar) 2) traer lo del servidor y mezclarlo.
// Si algo falla (sin conexión, sesión caducada) no se pierde nada: se queda marcado y se reintenta después.
const BASE = "/api/mobile/notes/recommendations";
let syncing = false;

function markSynced(userId: string, noteId: string): void {
  saveRecommendations(loadRecommendations().map((r) => (r.userId === userId && r.noteId === noteId ? { ...r, sync: "ok" as const } : r)));
}
function dropLocal(userId: string, noteId: string): void {
  saveRecommendations(loadRecommendations().filter((r) => !(r.userId === userId && r.noteId === noteId)));
}

export async function syncRecommendations(userId: string): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    for (const rec of loadRecommendations().filter((r) => r.userId === userId && r.sync === "new")) {
      try {
        await request(BASE, { method: "PUT", body: { noteId: rec.noteId, title: rec.title, content: rec.content, whenText: rec.whenText, steps: rec.steps, dueAt: new Date(rec.dueAt).toISOString() }, timeoutMs: 15000 });
        // Si mientras tanto se pulsó Chat/Ignorar, ese cambio sigue pendiente de enviar.
        const now = loadRecommendations().find((r) => r.userId === userId && r.noteId === rec.noteId);
        if (now && now.sync === "new") markSynced(userId, rec.noteId);
        else if (now && now.sync === "attend") await sendAttend(userId, now);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) dropLocal(userId, rec.noteId); // no es Pro o la nota ya no existe
      }
    }
    for (const rec of loadRecommendations().filter((r) => r.userId === userId && r.sync === "attend")) await sendAttend(userId, rec);
    const res = await request<{ recommendations?: ServerRecommendation[] }>(`${BASE}?status=all`, { timeoutMs: 15000 });
    if (Array.isArray(res?.recommendations)) saveRecommendations(mergeServerRecommendations(loadRecommendations(), res.recommendations, userId));
  } catch {
    /* sin conexión o sin permiso: se conserva lo local */
  } finally {
    syncing = false;
  }
}

async function sendAttend(userId: string, rec: Recommendation): Promise<void> {
  if (rec.status === "pending") return;
  try {
    await request(`${BASE}/${encodeURIComponent(rec.noteId)}`, { method: "PATCH", body: { status: rec.status }, timeoutMs: 15000 });
    markSynced(userId, rec.noteId);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) dropLocal(userId, rec.noteId);
  }
}

/**
 * Deja los avisos del teléfono igual que las notas de la cuenta: programa los que faltan (por ejemplo notas
 * creadas en la web), quita los de notas borradas y, si el plan no es Pro, no deja ninguno.
 * Devuelve las notas a las que aún les faltan recomendaciones.
 */
export function reconcileReminders(notes: BusinessNote[], pro: boolean): BusinessNote[] {
  if (!pro) {
    cancelAllReminders();
    return [];
  }
  const now = Date.now();
  const live = new Set<string>();
  const missing: BusinessNote[] = [];
  const scheduled = new Set(scheduledReminderIds());
  for (const note of notes) {
    if (!note.reminderAt || new Date(note.reminderAt).getTime() <= now + 2000) continue;
    live.add(note.id);
    const steps = loadSteps(note.id);
    if (!steps.length) missing.push(note);
    if (!scheduled.has(note.id)) scheduleNote(note, steps);
  }
  for (const id of scheduled) if (!live.has(id)) cancelReminder(id);
  return missing;
}
