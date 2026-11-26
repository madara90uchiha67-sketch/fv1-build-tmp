// Lógica pura de Notas (sin React Native): plan, fechas, recordatorios y texto de la notificación.
// Se prueba con `npm test`.

export type LeadUnit = "minutes" | "hours" | "days";

/** Tope que acepta el servidor para reminderLeadMinutes (30 días). */
export const MAX_LEAD_MINUTES = 43_200;

export function isPro(plan: string | null | undefined): boolean {
  return plan === "PRO";
}

export function leadToMinutes(amount: number, unit: LeadUnit): number | null {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) return null;
  const minutes = unit === "minutes" ? amount : unit === "hours" ? amount * 60 : amount * 1440;
  return minutes <= MAX_LEAD_MINUTES ? minutes : null;
}

export function formatLead(minutes: number): string {
  if (minutes === 0) return "a la hora del acontecimiento";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} ${d === 1 ? "día" : "días"} antes`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} ${h === 1 ? "hora" : "horas"} antes`;
  }
  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"} antes`;
}

export interface EventParts {
  day: number;
  month: number; // 1-12
  year: number;
  hour12: number; // 1-12
  minute: number; // 0-59
  pm: boolean;
}

/** Fecha local del acontecimiento a partir de los campos del formulario; null si no es válida. */
export function eventDate(p: EventParts): Date | null {
  const { day, month, year, hour12, minute } = p;
  if (![day, month, year, hour12, minute].every(Number.isInteger)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;
  const hour = (hour12 % 12) + (p.pm ? 12 : 0);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Rechaza fechas inexistentes (31 de febrero se desplazaría a marzo).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function reminderTime(event: Date, leadMinutes: number): number {
  return event.getTime() - leadMinutes * 60_000;
}

export function validateSchedule(event: Date | null, leadMinutes: number | null, now: number): string | null {
  if (!event) return "Revisa la fecha y la hora del acontecimiento.";
  if (leadMinutes === null) return "Indica con cuánta anticipación quieres el aviso (máximo 30 días).";
  if (event.getTime() <= now) return "La fecha del acontecimiento ya pasó.";
  if (reminderTime(event, leadMinutes) <= now) return "Ese aviso ya habría pasado. Elige menos anticipación o una fecha más lejana.";
  return null;
}

export function formatWhen(date: Date, locale = "es"): string {
  return date.toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Texto de la notificación: aviso + las recomendaciones que Founder generó con el contenido de la nota. */
export function reminderBody(args: { title: string; whenText: string; leadMinutes: number; steps: string[] }): string {
  const head = `${args.title} · ${args.whenText}`;
  if (!args.steps.length) return head;
  return `${head}\n${args.steps.map((s) => `• ${s}`).join("\n")}`;
}

export function reminderTitle(leadMinutes: number): string {
  return leadMinutes === 0 ? "Founder · Ahora" : `Founder · ${formatLead(leadMinutes).replace(" antes", "")}`;
}

/** Entrada que se envía a /api/strategist para obtener pasos propios de esta nota. */
export function recommendationPrompt(note: { title: string; content: string }, whenText: string): string {
  return [
    "Tengo este acontecimiento en mi agenda y quiero llegar preparado.",
    `Título: ${note.title}`,
    `Descripción: ${note.content}`,
    `Fecha y hora: ${whenText}`,
    "En proximos_pasos dame de 3 a 5 acciones de preparación concretas, basadas únicamente en lo que escribí arriba (nada genérico), cada una breve, en español y en imperativo.",
  ].join("\n").slice(0, 11_000);
}

export function cleanSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => String(s).replace(/^[\s\-•*\d.)]+/, "").trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.length > 180 ? `${s.slice(0, 177)}…` : s))
    .slice(0, 5);
}

// ── Recomendaciones pendientes (Notas Pro) ───────────────────────────────────────────────────────────
// Founder genera una recomendación al guardar la nota con aviso. Cuando llega la hora del aviso queda
// «pendiente» dentro de la app hasta que el usuario elige Chat (continuar con Founder) o Ignorar.

export type RecStatus = "pending" | "chat" | "ignored";

export interface Recommendation {
  noteId: string;
  userId: string;
  title: string;
  content: string;
  whenText: string;
  steps: string[];
  /** Hora del aviso (ms). Antes de esa hora la recomendación aún no se muestra. */
  dueAt: number;
  createdAt: number;
  status: RecStatus;
  /** Estado de sincronización con el servidor: ok = igual que el servidor; new = falta enviarla; attend = falta enviar Chat/Ignorar. */
  sync?: RecSync;
}

export type RecSync = "ok" | "new" | "attend";

const sameRec = (r: Recommendation, userId: string, noteId: string) => r.userId === userId && r.noteId === noteId;

export function parseRecommendations(raw: string | null | undefined): Recommendation[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((r): r is Recommendation =>
      !!r && typeof r === "object" &&
      typeof r.noteId === "string" && typeof r.userId === "string" && typeof r.title === "string" &&
      typeof r.content === "string" && typeof r.whenText === "string" && Array.isArray(r.steps) &&
      typeof r.dueAt === "number" && typeof r.createdAt === "number" &&
      (r.status === "pending" || r.status === "chat" || r.status === "ignored") &&
      (r.sync === undefined || r.sync === "ok" || r.sync === "new" || r.sync === "attend"));
  } catch { return []; }
}

/** Guarda (o reemplaza) la recomendación de una nota. Una recomendación nueva vuelve a quedar pendiente. */
export function upsertRecommendation(list: Recommendation[], rec: Recommendation): Recommendation[] {
  return [...list.filter((r) => !sameRec(r, rec.userId, rec.noteId)), rec].slice(-200);
}

export function setRecommendationStatus(list: Recommendation[], userId: string, noteId: string, status: RecStatus): Recommendation[] {
  // Atender (Chat/Ignorar) deja pendiente enviar el cambio al servidor; el servidor tiene la última palabra al sincronizar.
  return list.map((r) => (sameRec(r, userId, noteId) ? { ...r, status, sync: status === "pending" ? r.sync : "attend" } : r));
}

export function removeRecommendationsOfNote(list: Recommendation[], noteId: string): Recommendation[] {
  return list.filter((r) => r.noteId !== noteId);
}

/** Pendientes de esta cuenta cuya hora de aviso ya llegó, de la más antigua a la más reciente. Solo plan Pro. */
export function pendingRecommendations(list: Recommendation[], userId: string, pro: boolean, now: number): Recommendation[] {
  if (!pro) return [];
  return list.filter((r) => r.userId === userId && r.status === "pending" && r.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
}

/** Primer mensaje que se envía al chat: la recomendación y la nota, para no tener que explicarlo otra vez. */
export function recommendationChatPrompt(rec: Pick<Recommendation, "title" | "content" | "whenText" | "steps">): string {
  const steps = rec.steps.map((s) => `• ${s}`).join("\n");
  return [
    "Quiero continuar con la recomendación que me diste para esta nota de mi agenda.",
    `Nota: ${rec.title}`,
    `Descripción: ${rec.content}`,
    `Fecha y hora: ${rec.whenText}`,
    "Tu recomendación:",
    steps || "(sin pasos)",
    "Ayúdame a desarrollarla y pulirla: empieza por lo más importante y pregúntame lo que necesites saber.",
  ].join("\n").slice(0, 9_000);
}

// ── Sincronización con el servidor (varios dispositivos) ─────────────────────────────────────────────

export interface ServerRecommendation {
  noteId: string; title: string; content: string; whenText: string; steps: string[];
  status: string; dueAt: string; createdAt: string; attendedAt: string | null;
}

const isStatus = (v: unknown): v is RecStatus => v === "pending" || v === "chat" || v === "ignored";

/**
 * Mezcla lo que dice el servidor con lo guardado en este dispositivo para una cuenta:
 *  · el servidor manda en lo que ya conoce (así Ignorar/Chat hechos en otro dispositivo se reflejan aquí);
 *  · un Chat/Ignorar que aún no se pudo enviar (sync = attend) se conserva hasta enviarse;
 *  · una recomendación local aún no enviada (sync = new) se conserva;
 *  · una recomendación ya sincronizada que el servidor ya no tiene (nota borrada) se elimina;
 *  · lo de otras cuentas no se toca. Nunca crea duplicados: una por nota y cuenta.
 */
export function mergeServerRecommendations(local: Recommendation[], server: ServerRecommendation[], userId: string): Recommendation[] {
  const others = local.filter((r) => r.userId !== userId);
  const mine = local.filter((r) => r.userId === userId);
  const result = new Map<string, Recommendation>();
  for (const s of server) {
    if (!isStatus(s.status)) continue;
    const dueAt = Date.parse(s.dueAt);
    const createdAt = Date.parse(s.createdAt);
    if (!Number.isFinite(dueAt)) continue;
    const l = mine.find((r) => r.noteId === s.noteId);
    if (l && l.sync === "attend" && l.status !== "pending" && s.status === "pending") { result.set(s.noteId, l); continue; }
    result.set(s.noteId, {
      noteId: s.noteId, userId, title: s.title, content: s.content, whenText: s.whenText, steps: s.steps,
      dueAt, createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(), status: s.status, sync: "ok",
    });
  }
  for (const l of mine) if (!result.has(l.noteId) && (l.sync === "new" || l.sync === "attend")) result.set(l.noteId, l);
  return [...others, ...result.values()].slice(-200);
}
