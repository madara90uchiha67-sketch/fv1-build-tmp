// Cerebro del asistente de voz de Founder por turnos. Lógica pura (sin React ni módulos nativos) para poder probarla:
//  1) entiende la orden hablada (español colombiano) con reglas, sin IA ni coste;
//  2) ejecuta la acción REAL con los endpoints existentes de Founder (/api/business/*);
//  3) VERIFICA el resultado volviendo a leer los datos del servidor;
//  4) devuelve el texto que Founder dice en voz alta.
// Lo que no es una orden se responde con el chat de Founder (proveedores de IA gratuitos ya configurados en el servidor).
// Confirmaciones: lecturas directas · notas directo si los datos están claros · ventas piden «sí» · borrar exige botón en pantalla.

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown, timeoutMs?: number): Promise<T>;
  del<T>(path: string, body: unknown): Promise<T>;
}

export interface NoteLite { id: string; title: string; content: string; noteDate: string | null; reminderAt: string | null; createdAt?: string }
export interface SaleLite { id: string; amount: string; currency: string; description: string | null; status: string; soldAt?: string }

export interface Deps {
  api: Api;
  now: () => Date;
  /** Respuesta del chat de Founder para una frase libre (texto completo). */
  chat: (text: string, conversationId: string | null) => Promise<{ text: string; conversationId: string | null }>;
  /** Recomendaciones de Founder Pro que siguen pendientes (guardadas en el teléfono). */
  recommendations: () => { pro: boolean; items: { title: string; whenText: string }[] };
  timeZone: string;
  /** Programa la alarma local de Android para un recordatorio ya guardado. */
  scheduleAlarm?: (note: NoteLite) => Promise<"ok" | "no_permission" | "past" | "failed">;
}

export type Pending =
  | { type: "sale"; amount: number; currency: string; description: string }
  | { type: "sale_amount"; description: string }
  | { type: "note_topic" }
  | { type: "reminder"; title: string | null; when: Pick<WhenParts, "rel" | "day" | "time"> }
  | { type: "delete_note"; id: string; title: string };

export interface Session { pending: Pending | null; conversationId: string | null }
export const newSession = (): Session => ({ pending: null, conversationId: null });

export interface Reply {
  /** Lo que Founder dice en voz alta. */
  speech: string;
  /** Texto completo para mostrar en pantalla (si es más largo que lo hablado). */
  display?: string;
  /** Tras hablar, volver a escuchar sin que el usuario toque la esfera (p. ej. para un «sí» de confirmación). */
  listenAgain: boolean;
  /** Acción destructiva pendiente: la pantalla muestra botones; por voz nunca se ejecuta. */
  confirmDelete?: { id: string; title: string };
  /** Qué acción se resolvió (para pruebas e historial). */
  action?: string;
}

// ---------- Texto ----------

/** Minúsculas y sin acentos, carácter a carácter (misma longitud que el original, para poder recortar el original). */
export function fold(s: string): string {
  return Array.from(s).map((ch) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).join("");
}

const words = (folded: string): string[] => folded.replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);

export function capitalize(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export function cleanForSpeech(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>~]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Primeras frases del texto hasta ~max caracteres (para que la voz no lea párrafos enormes). */
export function firstSentences(s: string, max = 420, maxSentences = 3): string {
  const clean = cleanForSpeech(s);
  if (clean.length <= max) return clean;
  const parts = clean.match(/[^.!?¡¿]+[.!?]+|[^.!?]+$/g) ?? [clean];
  let out = "";
  let n = 0;
  for (const p of parts) {
    if (n >= maxSentences || (out + p).length > max) break;
    out += p;
    n++;
  }
  return (out || clean.slice(0, max)).trim();
}

// ---------- Números en español ----------

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21,
  veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};

function parseDigitToken(tok: string): number | null {
  const t = tok.replace(/^\$/, "").replace(/[.,]+$/, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  const m = /^(\d+)[.,](\d{1,2})$/.exec(t);
  if (m) return Number(`${m[1]}.${m[2]}`);
  const plain = t.replace(/[.,]+$/, "");
  return /^\d+$/.test(plain) ? Number(plain) : null;
}

export interface Amount { amount: number; currency: string }

export function currencyFrom(folded: string): string {
  if (/\b(usd|dolar|dolares)\b/.test(folded)) return "USD";
  if (/\b(eur|euro|euros)\b/.test(folded)) return "EUR";
  if (/\bmexican/.test(folded)) return "MXN";
  if (/\bargentin/.test(folded)) return "ARS";
  if (/\bchilen/.test(folded)) return "CLP";
  if (/\bperuan|\bsoles?\b/.test(folded)) return "PEN";
  return "COP";
}

export function currencyName(code: string): string {
  const names: Record<string, string> = { COP: "pesos colombianos", USD: "dólares", EUR: "euros", MXN: "pesos mexicanos", ARS: "pesos argentinos", CLP: "pesos chilenos", PEN: "soles" };
  return names[code] ?? code;
}

/** Busca el primer importe de la frase: «150.000», «150 mil», «ciento cincuenta mil», «2 millones», «$1,5 millones». */
export function parseAmount(raw: string): Amount | null {
  const folded = fold(raw).replace(/(\d{1,3})\s(?=\d{3}(?!\d))/g, "$1"); // «150 000» → «150000»
  const toks = folded.replace(/[^a-z0-9.,$ ]+/g, " ").split(/\s+/).filter(Boolean);
  const isNum = (t: string) => t in UNITS || t in TENS || t in HUNDREDS || t === "mil" || t === "millon" || t === "millones" || parseDigitToken(t) !== null;
  let i = 0;
  while (i < toks.length) {
    if (!isNum(toks[i])) { i++; continue; }
    // Corre de palabras/dígitos numéricos (permite «y» entre números).
    let j = i;
    const run: string[] = [];
    while (j < toks.length && (isNum(toks[j]) || (toks[j] === "y" && j + 1 < toks.length && isNum(toks[j + 1]) && run.length > 0))) {
      run.push(toks[j]); j++;
    }
    i = j;
    let total = 0, cur = 0, big = false;
    for (const t of run) {
      const d = parseDigitToken(t);
      if (d !== null) { cur += d; big = big || d >= 100; }
      else if (t in UNITS) cur += UNITS[t];
      else if (t in TENS) { cur += TENS[t]; big = true; }
      else if (t in HUNDREDS) { cur += HUNDREDS[t]; big = true; }
      else if (t === "mil") { cur = (cur || 1) * 1000; total += cur; cur = 0; big = true; }
      else if (t === "millon" || t === "millones") { cur = (cur || 1) * 1_000_000; total += cur; cur = 0; big = true; }
    }
    total += cur;
    // Una cifra suelta pequeña («una venta», «dos») no es un importe.
    if (total > 0 && big && total < 1e12) return { amount: Math.round(total * 100) / 100, currency: currencyFrom(folded) };
  }
  return null;
}

export function formatAmount(n: number): string {
  const fixed = Number.isInteger(n) ? String(n) : n.toFixed(2);
  const [int, dec] = fixed.split(".");
  const withDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec ? `${withDots},${dec}` : withDots;
}

// ---------- Órdenes ----------

export type Command =
  | { kind: "create_note"; title: string; content: string }
  | { kind: "create_note_topic_missing" }
  | { kind: "register_sale"; amount: number | null; currency: string; description: string }
  | { kind: "list_pending"; scope: "notes" | "recommendations" | "both" }
  | { kind: "analyze" }
  | { kind: "sales_summary"; period: SalesPeriod; wantsProfit: boolean }
  | { kind: "create_reminder"; title: string | null; when: WhenParts }
  | { kind: "find_note"; day: "today" | "yesterday" | "daybefore" | null; keywords: string[] }
  | { kind: "delete_note"; keywords: string[] }
  | { kind: "delete_other" }
  | { kind: "chat"; text: string };

const CREATE_VERBS = /\b(crea|crear|creame|haz|hazme|hacer|agrega|agregar|agregame|anota|anotar|anotame|apunta|apuntar|guarda|guardar|escribe|escribir|toma|tomar|nueva|redacta)\w*/;
const FIND_VERBS = /\b(busca|buscar|buscame|encuentra|encontrar|encuentrame|muestrame|ensename|abre|abrir|dime|cual|donde|ver)\w*/;
const DELETE_VERBS = /\b(borra|borrar|borrame|elimina|eliminar|eliminame|quita|quitar|suprime|suprimir|cancela|cancelar|anula|anular|reembolsa|reembolsar)\w*/;
const DAY_WORDS: Record<string, "today" | "yesterday" | "daybefore"> = { hoy: "today", ayer: "yesterday", anteayer: "daybefore", antier: "daybefore" };
const FILLER = new Set([
  "la", "el", "los", "las", "una", "un", "de", "del", "que", "hice", "hizo", "escribi", "cree", "guarde", "anote", "mi", "mis", "nota", "notas", "sobre", "acerca",
  "con", "llamada", "titulada", "por", "favor", "para", "en", "mi", "ayer", "hoy", "anteayer", "antier", "busca", "buscar", "buscame", "encuentra", "muestrame",
  "dime", "cual", "es", "fue", "donde", "esta", "ver", "abre", "borra", "borrar", "elimina", "eliminar", "quita", "quitar", "hable", "habla", "dice", "diga",
  "y", "o", "a", "al", "se", "te", "lo", "le", "me", "su", "tu", "ese", "esa", "esta", "estas", "ya",
]);

function keywordsOf(folded: string): string[] {
  return words(folded).filter((w) => w.length >= 3 && !FILLER.has(w) && !(w in DAY_WORDS));
}

/** Texto original que sigue a «nota … sobre/de/…» (conserva mayúsculas y acentos). */
function topicAfterNote(raw: string, folded: string): string {
  const m = /\bnotas?\b\s*(?:nueva\s+)?(?:(?:sobre|acerca\s+del?|acerca|de|para|que\s+diga|que\s+dice|con|llamada|titulada)\s+)?(.*)$/.exec(folded);
  if (!m) return "";
  const start = folded.length - m[1].length;
  return raw.slice(start).replace(/^[\s:,.-]+|[\s.,;]+$/g, "");
}

export function parseCommand(raw: string, now: Date = new Date()): Command {
  const text = raw.trim();
  const f = fold(text);
  const hasNote = /\b(nota|notas|apunte)\b/.test(f);
  const hasSale = /\b(venta|ventas|vendi|vendimos|vendio)\b/.test(f);

  // 1) Borrar / cancelar: nunca se ejecuta por voz; solo se prepara y se pide el botón.
  if (DELETE_VERBS.test(f) && (hasNote || hasSale || /\b(cliente|producto)\b/.test(f))) {
    if (hasNote) return { kind: "delete_note", keywords: keywordsOf(f.replace(DELETE_VERBS, " ")) };
    return { kind: "delete_other" };
  }
  // 2a) Crear un recordatorio («recuérdame mañana a las 3…», «crea un recordatorio para el viernes…»).
  if (/\b(recuerdame|recuerdeme|avisame)\b/.test(f) || (/\brecordatorio\b/.test(f) && CREATE_VERBS.test(f))) {
    const when = parseWhen(text, now);
    const title = reminderTitle(text, when.spans);
    return { kind: "create_reminder", title: title && words(fold(title)).length ? capitalize(title).slice(0, 150) : null, when };
  }
  // 2b) Consultar ventas/ganancias de un periodo (antes que registrar: «cuánto vendí esta semana» es una consulta).
  const period = salesQueryPeriod(f);
  if (period && !/\b(registra|registrar|registrame)\b/.test(f)) return { kind: "sales_summary", period, wantsProfit: /\b(ganancia|ganancias|ganado|gane|utilidad|neto)\b/.test(f) };
  // 2c) Registrar una venta.
  if (hasSale && (/\b(registra|registrar|registrame|anota|anotar|agrega|agregar|apunta|crea|crear|guarda|guardar|ingresa|ingresar|ponle|asienta)\w*/.test(f) || /\bvendi\b|\bvendimos\b/.test(f))) {
    const a = parseAmount(text);
    return { kind: "register_sale", amount: a?.amount ?? null, currency: a?.currency ?? currencyFrom(f), description: text };
  }
  // 3) Crear nota.
  if (hasNote && CREATE_VERBS.test(f) && !FIND_VERBS.test(f.replace(CREATE_VERBS, " "))) {
    const topic = topicAfterNote(text, f);
    if (words(fold(topic)).length === 0) return { kind: "create_note_topic_missing" };
    return noteFromTopic(topic);
  }
  // 4) Pendientes (antes que «buscar»: «muéstrame mis notas con recordatorios pendientes» es una consulta de pendientes).
  const asksPending = /\b(pendiente|pendientes|recomendacion|recomendaciones)\b/.test(f) || (/\b(recordatorio|recordatorios)\b/.test(f) && !/\b(busca|buscar|buscame|encuentra|encuentrame)\b/.test(f));
  if (asksPending && !CREATE_VERBS.test(f)) {
    const rec = /\brecomendacion|\brecomendaciones/.test(f);
    const notes = /\b(nota|notas|recordatorio|recordatorios)\b/.test(f);
    return { kind: "list_pending", scope: rec && !notes ? "recommendations" : notes && !rec ? "notes" : "both" };
  }
  // 5) Buscar nota.
  if (hasNote && FIND_VERBS.test(f)) {
    const dayWord = words(f).find((w) => w in DAY_WORDS);
    return { kind: "find_note", day: dayWord ? DAY_WORDS[dayWord] : null, keywords: keywordsOf(f) };
  }
  // 6) Analizar el negocio.
  if (/\b(analiza|analizar|analizame|analisis|analisa)\w*/.test(f) && /\b(negocio|ventas|empresa|mi)\b/.test(f)) return { kind: "analyze" };
  if (/\bcomo\s+(va|vamos|esta|anda)\s+(mi\s+)?(negocio|empresa)\b/.test(f)) return { kind: "analyze" };

  return { kind: "chat", text };
}

export function noteFromTopic(topic: string): { kind: "create_note"; title: string; content: string } {
  const clean = topic.replace(/\s+/g, " ").trim();
  const title = capitalize(clean).slice(0, 80).replace(/[\s,;:]+$/, "");
  const content = `${capitalize(clean)}.`.replace(/\.+$/, ".").slice(0, 4800);
  return { kind: "create_note", title, content };
}

export function parseYesNo(raw: string): "yes" | "no" | null {
  const f = fold(raw);
  const w = words(f);
  if (w.length === 0) return null;
  if (/^(no|cancela|cancelar|negativo|detente|para|mejor no|nunca)\b/.test(f.trim()) || /\b(no lo hagas|no lo registres|no registres|cancela)\b/.test(f)) return "no";
  if (w.some((x) => ["si", "claro", "confirmo", "confirmar", "correcto", "dale", "adelante", "ok", "okey", "listo", "afirmativo", "exacto", "hazlo", "registrala", "registralo", "guardala", "guardalo", "perfecto", "eso"].includes(x)) || /\bde acuerdo\b/.test(f)) return "yes";
  if (w.includes("no")) return "no";
  return null;
}

// ---------- Fechas habladas («mañana a las 3 de la tarde», «el viernes a las 9», «en 20 minutos») ----------

const WEEKDAYS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SMALL: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
const numTok = (t: string): number | null => (/^\d{1,3}$/.test(t) ? Number(t) : t in SMALL ? SMALL[t] : null);

export interface WhenParts {
  /** Momento relativo ya resuelto («en 20 minutos»). */
  rel: Date | null;
  /** Día (a medianoche local) si se dijo. */
  day: Date | null;
  /** Hora si se dijo: h en 0..23; amb = no se dijo mañana/tarde/noche y h12 puede ser am o pm. */
  time: { h: number; m: number; amb: boolean } | null;
  /** Tramos del texto original que son fecha/hora (para quitarlos del título). */
  spans: Array<[number, number]>;
}

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 0, 0, 0, 0);

export function parseWhen(raw: string, now: Date): WhenParts {
  const f = fold(raw);
  const spans: Array<[number, number]> = [];
  const mask = (m: RegExpExecArray) => { spans.push([m.index, m.index + m[0].length]); };
  let masked = f;
  const blank = (m: RegExpExecArray) => { masked = masked.slice(0, m.index) + " ".repeat(m[0].length) + masked.slice(m.index + m[0].length); };
  const out: WhenParts = { rel: null, day: null, time: null, spans };

  // Relativo: «en 20 minutos», «en media hora», «en dos horas», «en 3 días».
  const rel = /\ben\s+(\d{1,3}|media|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta)\s+(hora|horas|minuto|minutos|dia|dias|semana|semanas)\b/.exec(f);
  if (rel) {
    const q = rel[1] === "media" ? 0.5 : (numTok(rel[1]) ?? 1);
    const unit = rel[2].startsWith("min") ? 1 : rel[2].startsWith("hora") ? 60 : rel[2].startsWith("dia") ? 1440 : 10080;
    out.rel = new Date(now.getTime() + Math.round(q * unit * 60_000));
    mask(rel);
    return out;
  }

  // Hora: «a las 3», «a las 3 y media de la tarde», «a las 15:30», «a las 8 pm», «al mediodía».
  const t = /\b(?:a\s+las?|sobre\s+las)\s+(\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s*[:.h]\s*(\d{2}))?(?:\s+y\s+(media|cuarto)|\s+menos\s+cuarto)?(?:\s+(?:de\s+la|en\s+la|por\s+la)\s+(manana|tarde|noche|madrugada))?(?:\s*(am|pm)\b)?/.exec(f);
  if (t) {
    let h = numTok(t[1]) ?? 0;
    let m = t[2] ? Number(t[2]) : 0;
    if (t[3] === "media") m = 30;
    else if (t[3] === "cuarto") m = 15;
    else if (/menos\s+cuarto/.test(t[0])) { m = 45; h = h === 1 ? 12 : h - 1; }
    const part = t[4] ?? (t[5] === "pm" ? "tarde" : t[5] === "am" ? "manana" : "");
    let amb = false;
    if (h > 23 || m > 59) h = -1;
    else if (h >= 13) { /* 24 h explícita */ }
    else if (part === "tarde" || part === "noche") { if (h < 12) h += 12; if (part === "noche" && h === 12) h = 0; }
    else if (part === "manana" || part === "madrugada") { if (h === 12) h = 0; }
    else amb = h >= 1 && h <= 12;
    if (h >= 0) { out.time = { h, m, amb }; mask(t); blank(t); }
  } else {
    const noon = /\b(?:al\s+)?mediodia\b/.exec(f);
    if (noon) { out.time = { h: 12, m: 0, amb: false }; mask(noon); blank(noon); }
  }

  // Día: «pasado mañana», «mañana», «hoy», «el viernes», «el 25 de noviembre».
  const pre = "(?:para\\s+)?(?:el\\s+|este\\s+|proximo\\s+)?";
  let m: RegExpExecArray | null;
  if ((m = /\b(?:para\s+)?pasado\s+manana\b/.exec(masked))) { out.day = addDays(midnight(now), 2); mask(m); }
  else if ((m = /\b(?:para\s+)?manana\b/.exec(masked))) { out.day = addDays(midnight(now), 1); mask(m); }
  else if ((m = /\b(?:para\s+)?hoy\b/.exec(masked))) { out.day = midnight(now); mask(m); }
  else if ((m = new RegExp(`\\b${pre}(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\\b`).exec(masked))) {
    const diff = (WEEKDAYS[m[1]] - now.getDay() + 7) % 7 || 7;
    out.day = addDays(midnight(now), diff); mask(m);
  } else if ((m = new RegExp(`\\b${pre}(\\d{1,2})\\s+de\\s+(${MONTH_NAMES.join("|")})(?:\\s+de\\s+(\\d{4}))?\\b`).exec(masked))) {
    const mon = MONTH_NAMES.indexOf(m[2]);
    let year = m[3] ? Number(m[3]) : now.getFullYear();
    let d = new Date(year, mon, Number(m[1]), 0, 0, 0, 0);
    if (!m[3] && d.getTime() < midnight(now).getTime()) { year++; d = new Date(year, mon, Number(m[1]), 0, 0, 0, 0); }
    if (d.getMonth() === mon) out.day = d;
    mask(m);
  }
  return out;
}

/** Momento exacto a partir de lo dicho, o null si falta el día o la hora. */
export function resolveWhen(p: Pick<WhenParts, "rel" | "day" | "time">, now: Date): Date | null {
  if (p.rel) return p.rel;
  if (!p.time) return null;
  const { h, m, amb } = p.time;
  const at = (day: Date, hour: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, m, 0, 0);
  const today = midnight(now);
  const candidates = (): number[] => (amb ? (h === 12 ? [12] : [h, h + 12]) : [h]);
  if (p.day) {
    const isToday = p.day.getTime() === today.getTime();
    const hs = candidates();
    if (!amb) return at(p.day, hs[0]);
    if (isToday) { const hit = hs.map((x) => at(p.day!, x)).find((d) => d.getTime() > now.getTime() + 60_000); return hit ?? at(p.day, hs[hs.length - 1]); }
    return at(p.day, h <= 6 ? h + 12 : h); // sin «de la mañana/tarde»: 1–6 se entiende tarde, 7–11 mañana
  }
  // Solo hora: la próxima vez que ocurra.
  for (const day of [today, addDays(today, 1)]) {
    const hit = candidates().map((x) => at(day, x)).find((d) => d.getTime() > now.getTime() + 60_000);
    if (hit) return hit;
  }
  return null;
}

/** Título de un recordatorio: lo dicho sin la orden («recuérdame», «crea un recordatorio») ni la fecha/hora. */
export function reminderTitle(raw: string, spans: Array<[number, number]>): string {
  const keep = Array.from(raw).map(() => true);
  for (const [a, b] of spans) for (let i = a; i < b && i < keep.length; i++) keep[i] = false;
  let rest = Array.from(raw).filter((_, i) => keep[i]).join("").replace(/\s+/g, " ");
  const prefixes = [
    /^[\s,.:;¡!¿?-]+/,
    /^(?:por favor|oye|hola|founder)\b/,
    /^(?:crea|crear|creame|haz|hazme|hacer|agrega|agregar|agregame|pon|ponme|poner|programa|programame|programar|anota|anotame|guarda|guardame)\w*/,
    /^(?:un|una|el|la|mi|nuevo|nueva)\b/,
    /^(?:recordatorio|recordatorios)\b/,
    /^(?:recuerdame|recuerda|recuerdeme|avisame|avisa)\b/,
    /^(?:para|de|sobre|que|acerca|a|con|llamado|llamada|titulado)\b/,
  ];
  for (let guard = 0; guard < 40; guard++) {
    const f = fold(rest);
    const hit = prefixes.map((re) => re.exec(f)).find((x) => x && x[0].length > 0);
    if (!hit) break;
    rest = rest.slice(hit[0].length);
  }
  rest = rest.replace(/(?:[\s,.;:]+(?:el|la|a|para|de|en|por|las?|que|y))+[\s,.;:]*$/i, "").replace(/^[\s,.;:]+|[\s,.;:]+$/g, "");
  return rest;
}

// ---------- Ventas por periodo («cuánto he ganado esta semana») ----------

export type SalesPeriod = "today" | "yesterday" | "week" | "last7" | "month" | "lastmonth" | "year";

export function salesQueryPeriod(f: string): SalesPeriod | null {
  const asks = /\b(cuanto|cuantos|cuantas|total|totales|resumen|ganado|gane|ganancia|ganancias|ingreso|ingresos|facturado|facture|como\s+(?:van|va|vamos|voy|me\s+(?:fue|va|ha\s+ido))|que\s+tal)\b/.test(f);
  const money = /\b(venta|ventas|vendi|vendido|vendimos|ganado|gane|ganancia|ganancias|ingreso|ingresos|dinero|plata|facturado|facture|recaudado|entrado)\b/.test(f);
  if (!asks || !money) return null;
  if (/\bante?ayer\b/.test(f) && !/\bayer\b/.test(f)) return "yesterday";
  if (/\bayer\b/.test(f)) return "yesterday";
  if (/\bhoy\b/.test(f)) return "today";
  if (/\bultim[oa]s?\s+(7|siete)\s+dias\b/.test(f)) return "last7";
  if (/\b(mes\s+pasado|mes\s+anterior)\b/.test(f)) return "lastmonth";
  if (/\b(semana|semanal)\b/.test(f)) return "week";
  if (/\b(ano|anual)\b/.test(f)) return "year";
  return "month";
}

export function periodRange(p: SalesPeriod, now: Date): { start: Date; end: Date; label: string } {
  const today = midnight(now);
  const end = addDays(today, 1);
  switch (p) {
    case "today": return { start: today, end, label: "hoy" };
    case "yesterday": return { start: addDays(today, -1), end: today, label: "ayer" };
    case "week": return { start: addDays(today, -((today.getDay() + 6) % 7)), end, label: "esta semana, desde el lunes" };
    case "last7": return { start: addDays(today, -6), end, label: "en los últimos siete días" };
    case "month": return { start: new Date(now.getFullYear(), now.getMonth(), 1), end, label: "este mes" };
    case "lastmonth": return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1), label: "el mes pasado" };
    case "year": return { start: new Date(now.getFullYear(), 0, 1), end, label: "este año" };
  }
}

// ---------- Cambiar de voz por voz ----------

export type VoiceSwitch = "change" | "settings" | null;
export function parseVoiceSwitch(raw: string): VoiceSwitch {
  const f = fold(raw);
  if (/\b(ajustes|configuracion)\b.*\b(voz|texto a voz)\b|\binstalar\b.*\bvoz\b/.test(f)) return "settings";
  if (/\b(cambia|cambiar|cambiame|pon|ponme|usa|prueba|probar|quiero|dame)\b.*\b(otra|nueva|siguiente|diferente|masculina|grave|distinta)?\s*voz\b/.test(f) && /\bvoz\b/.test(f)) return "change";
  if (/\botra\s+voz\b|\bvoz\s+(?:mas\s+grave|masculina|de\s+hombre|distinta|diferente)\b/.test(f)) return "change";
  return null;
}

/**
 * Elige la voz más probable de ser masculina. Android no publica el género: se usan los datos que el motor entrega
 * (nombre/características con «male») y, si no, los códigos conocidos de las voces de Google. Cada entrada es
 * «nombre|idioma|calidad|red|características». Devuelve los nombres ordenados de más a menos probable.
 */
export interface VoiceInfo { name: string; tag: string; quality: number; network: boolean; features: string; gender: "male" | "female" | "unknown" }

const GOOGLE_MALE = /-x-(esd|esc|eef|eec|eed|ese|esm)\b/;
const GOOGLE_FEMALE = /-x-(sfb|esf|eea|ees|eeb|esa|esb|esg)\b/;

export function parseVoiceEntry(entry: string): VoiceInfo {
  const [name = "", tag = "", q = "0", net = "0", features = ""] = entry.split("|");
  const blob = `${name} ${features}`.toLowerCase();
  let gender: VoiceInfo["gender"] = "unknown";
  if (/\bfemale\b|femenin|(^|[-_ ])fem(ale)?([-_ ]|$)|mujer/.test(blob)) gender = "female";
  else if (/\bmale\b|masculin|(^|[-_ ])male([-_ ]|$)|hombre/.test(blob)) gender = "male";
  else if (GOOGLE_MALE.test(blob)) gender = "male";
  else if (GOOGLE_FEMALE.test(blob)) gender = "female";
  return { name, tag, quality: Number(q) || 0, network: net === "1", features, gender };
}

const latamRank = (tag: string) => {
  const c = tag.toUpperCase();
  if (c.endsWith("-US") || c.endsWith("-419")) return 0;
  if (c.endsWith("-MX") || c.endsWith("-CO")) return 1;
  if (c.endsWith("-ES")) return 3;
  return 2;
};

/** Orden de preferencia: hombre (sin red) > hombre (con red) > género desconocido > mujer; dentro de cada grupo, español latino y mayor calidad. */
export function rankVoices(entries: string[]): VoiceInfo[] {
  const g = { male: 0, unknown: 2, female: 4 } as const;
  return entries.map(parseVoiceEntry).sort((a, b) =>
    (g[a.gender] + (a.network ? 1 : 0)) - (g[b.gender] + (b.network ? 1 : 0)) ||
    latamRank(a.tag) - latamRank(b.tag) || b.quality - a.quality || a.name.localeCompare(b.name));
}

/** Tono: con voz masculina real casi no se toca (cálido y natural); si no se sabe, no se baja nunca el tono artificialmente. */
export const pitchFor = (v: VoiceInfo | undefined): number => (v?.gender === "male" ? 0.92 : 1.0);

// ---------- Datos ----------

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function dayTarget(now: Date, day: "today" | "yesterday" | "daybefore"): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  d.setDate(d.getDate() - (day === "today" ? 0 : day === "yesterday" ? 1 : 2));
  return d;
}

export function findNotes(notes: NoteLite[], q: { day: "today" | "yesterday" | "daybefore" | null; keywords: string[] }, now: Date): NoteLite[] {
  const target = q.day ? dayTarget(now, q.day) : null;
  return notes.filter((n) => {
    if (target) {
      const created = n.createdAt ? new Date(n.createdAt) : null;
      const dated = n.noteDate ? new Date(n.noteDate) : null;
      if (!((created && sameDay(created, target)) || (dated && sameDay(dated, target)))) return false;
    }
    if (q.keywords.length) {
      const hay = fold(`${n.title} ${n.content}`);
      if (!q.keywords.every((k) => hay.includes(k))) return false;
    }
    return true;
  });
}

export function notesWithPendingReminders(notes: NoteLite[], now: Date): NoteLite[] {
  return notes
    .filter((n) => n.reminderAt && new Date(n.reminderAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.reminderAt!).getTime() - new Date(b.reminderAt!).getTime());
}

function whenText(iso: string, now: Date): string {
  const d = new Date(iso);
  const hh = d.getHours();
  const hhmm = `${hh % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${hh < 12 ? "de la mañana" : hh < 19 ? "de la tarde" : "de la noche"}`;
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((dd - t) / 86_400_000);
  if (diff === 0) return `hoy a las ${hhmm}`;
  if (diff === 1) return `mañana a las ${hhmm}`;
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `el ${d.getDate()} de ${months[d.getMonth()]} a las ${hhmm}`;
}

const quote = (t: string) => `«${t.replace(/\s+/g, " ").trim().slice(0, 70)}»`;
const listWords = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`);
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : "error desconocido");

// ---------- Ejecución ----------

async function createNote(deps: Deps, cmd: { title: string; content: string }): Promise<Reply> {
  try {
    // El servidor responde con la fila que acaba de guardar en la base de datos: si trae su id y el mismo título, está guardada.
    const res = await deps.api.post<{ item: NoteLite }>("/api/business/notes", { title: cmd.title, content: cmd.content, noteDate: null, timeZone: "UTC", reminderLeadMinutes: null });
    const saved = res?.item;
    if (saved?.id && saved.title === cmd.title) {
      return { speech: `Hecho. La nota ${quote(cmd.title)} quedó guardada en tu cuenta.`, display: `Nota guardada: ${cmd.title}`, listenAgain: false, action: "create_note:ok" };
    }
    return { speech: "No pude confirmar que la nota se guardara. Revisa la sección Notas.", listenAgain: false, action: "create_note:unverified" };
  } catch (e) {
    return { speech: `No pude guardar la nota. ${errText(e)}`, listenAgain: false, action: "create_note:error" };
  }
}

async function createReminder(deps: Deps, title: string, at: Date): Promise<Reply> {
  const now = deps.now();
  if (!deps.recommendations().pro) {
    return { speech: "Los recordatorios con fecha son parte de Founder Pro y tu plan no los incluye. Puedo guardarte una nota normal si quieres.", listenAgain: false, action: "reminder:not_pro" };
  }
  if (at.getTime() <= now.getTime() + 5000) {
    return { speech: "Esa hora ya pasó. Dime otra fecha y hora para el recordatorio.", listenAgain: false, action: "reminder:past" };
  }
  try {
    const res = await deps.api.post<{ item: NoteLite }>("/api/business/notes", {
      title: title.slice(0, 160), content: `${title}.`.replace(/\.+$/, "."), noteDate: at.toISOString(), timeZone: deps.timeZone, reminderLeadMinutes: 0,
    });
    const id = res?.item?.id;
    if (!id) return { speech: "No pude confirmar que el recordatorio se guardara. Revisa la sección Notas.", listenAgain: false, action: "reminder:unverified" };
    // Verificación: se vuelve a leer y debe aparecer con su hora de aviso, igual que lo consultará después «mis recordatorios».
    const list = await deps.api.get<{ items: NoteLite[]; truncated?: boolean }>("/api/business/notes");
    const found = list.items.find((n) => n.id === id);
    const okTime = found?.reminderAt ? Math.abs(new Date(found.reminderAt).getTime() - at.getTime()) < 1500 : false;
    if (!found && !list.truncated) return { speech: "El servidor aceptó el recordatorio, pero no lo encuentro al releer tus notas. Revisa la sección Notas.", listenAgain: false, action: "reminder:unverified" };
    if (found && !okTime) return { speech: "El recordatorio se guardó, pero sin la hora de aviso correcta. Revísalo en la sección Notas.", listenAgain: false, action: "reminder:unverified" };
    const alarm = deps.scheduleAlarm ? await deps.scheduleAlarm(found ?? res.item) : "ok";
    const when = whenText(at.toISOString(), now);
    const base = `Listo. Te recordaré ${quote(title)} ${when}. Quedó guardado y verificado.`;
    const extra = alarm === "no_permission" ? " Pero Android tiene bloqueadas las notificaciones de Founder: actívalas en los ajustes para recibir el aviso."
      : alarm === "failed" ? " No pude programar el aviso en el teléfono; el recordatorio sí está guardado en tu cuenta." : "";
    return { speech: base + extra, display: `Recordatorio guardado: ${title} · ${when}`, listenAgain: false, action: alarm === "ok" ? "reminder:ok" : `reminder:ok_${alarm}` };
  } catch (e) {
    return { speech: `No pude guardar el recordatorio. ${errText(e)}`, listenAgain: false, action: "reminder:error" };
  }
}

async function salesSummary(deps: Deps, period: SalesPeriod, wantsProfit: boolean): Promise<Reply> {
  try {
    const { start, end, label } = periodRange(period, deps.now());
    const list = await deps.api.get<{ items: (SaleLite & { soldAt?: string })[]; truncated?: boolean }>("/api/business/sales");
    const inRange = list.items.filter((s) => { const t = s.soldAt ? new Date(s.soldAt).getTime() : NaN; return t >= start.getTime() && t < end.getTime(); });
    const done = inRange.filter((s) => s.status === "COMPLETED");
    const pending = inRange.filter((s) => s.status === "PENDING");
    const oldest = list.items.length ? new Date(list.items[list.items.length - 1].soldAt ?? "").getTime() : NaN;
    const partial = Boolean(list.truncated) && Number.isFinite(oldest) && oldest > start.getTime();
    const totals = new Map<string, { sum: number; n: number }>();
    for (const s of done) { const t = totals.get(s.currency) ?? { sum: 0, n: 0 }; t.sum += Number(s.amount); t.n++; totals.set(s.currency, t); }
    const parts = [...totals.entries()].map(([cur, t]) => `${formatAmount(Math.round(t.sum * 100) / 100)} ${currencyName(cur)} en ${t.n} ${t.n === 1 ? "venta" : "ventas"}`);
    let speech = parts.length ? `${capitalize(label)} has vendido ${listWords(parts)}.` : `No tienes ventas completadas registradas ${label}.`;
    if (pending.length) speech += ` Además hay ${pending.length} ${pending.length === 1 ? "venta pendiente" : "ventas pendientes"} que no cuento.`;
    if (wantsProfit && parts.length) speech += " Son ingresos por ventas; Founder aún no tiene tus costos para calcular la ganancia neta.";
    if (partial) speech += " Ojo: tengo solo tus últimas 300 ventas, así que el total podría estar incompleto.";
    return { speech, display: speech, listenAgain: false, action: "sales:summary" };
  } catch (e) {
    return { speech: `No pude consultar tus ventas. ${errText(e)}`, listenAgain: false, action: "sales:error" };
  }
}

async function saveSale(deps: Deps, p: { amount: number; currency: string; description: string }): Promise<Reply> {
  try {
    const res = await deps.api.post<{ item: SaleLite }>("/api/business/sales", {
      description: p.description.slice(0, 300), amount: p.amount, currency: p.currency, status: "COMPLETED", soldAt: deps.now().toISOString(),
    });
    const id = res?.item?.id;
    if (!id) return { speech: "No pude confirmar que la venta se guardara. Revísala en la sección Negocio.", listenAgain: false, action: "sale:unverified" };
    const list = await deps.api.get<{ items: SaleLite[]; truncated?: boolean }>("/api/business/sales");
    const found = list.items.find((s) => s.id === id);
    if (found && Number(found.amount) === p.amount && found.currency === p.currency) {
      return { speech: `Hecho. Venta de ${formatAmount(p.amount)} ${currencyName(p.currency)} registrada y verificada.`, display: `Venta registrada: ${formatAmount(p.amount)} ${p.currency}`, listenAgain: false, action: "sale:ok" };
    }
    return { speech: "El servidor aceptó la venta, pero no coincide al releerla. Revísala en la sección Negocio.", listenAgain: false, action: "sale:unverified" };
  } catch (e) {
    return { speech: `No pude registrar la venta. ${errText(e)}`, listenAgain: false, action: "sale:error" };
  }
}

async function listPending(deps: Deps, scope: "notes" | "recommendations" | "both"): Promise<Reply> {
  const now = deps.now();
  const parts: string[] = [];
  const shown: string[] = [];
  if (scope !== "recommendations") {
    try {
      const { items } = await deps.api.get<{ items: NoteLite[] }>("/api/business/notes");
      const pend = notesWithPendingReminders(items, now);
      if (pend.length === 0) parts.push("No tienes notas con recordatorios pendientes.");
      else {
        const top = pend.slice(0, 4).map((n) => `${quote(n.title)} ${whenText(n.reminderAt!, now)}`);
        parts.push(`Tienes ${pend.length} ${pend.length === 1 ? "nota con recordatorio pendiente" : "notas con recordatorios pendientes"}: ${listWords(top)}.`);
        shown.push(...pend.map((n) => `• ${n.title} (${whenText(n.reminderAt!, now)})`));
      }
    } catch (e) {
      parts.push(`No pude consultar tus notas. ${errText(e)}`);
    }
  }
  if (scope !== "notes") {
    const r = deps.recommendations();
    if (!r.pro) parts.push("Las recomendaciones pendientes son de Founder Pro y tu plan no las incluye.");
    else if (r.items.length === 0) parts.push("No tienes recomendaciones de Founder Pro pendientes.");
    else {
      const top = r.items.slice(0, 4).map((x) => `${quote(x.title)}${x.whenText ? ` ${x.whenText}` : ""}`);
      parts.push(`Tienes ${r.items.length} ${r.items.length === 1 ? "recomendación pendiente" : "recomendaciones pendientes"}: ${listWords(top)}.`);
      shown.push(...r.items.map((x) => `• Recomendación: ${x.title}`));
    }
  }
  return { speech: parts.join(" "), display: shown.length ? `${parts.join(" ")}\n${shown.join("\n")}` : undefined, listenAgain: false, action: `pending:${scope}` };
}

async function findNote(deps: Deps, q: { day: "today" | "yesterday" | "daybefore" | null; keywords: string[] }): Promise<Reply> {
  try {
    const { items } = await deps.api.get<{ items: NoteLite[] }>("/api/business/notes");
    const hits = findNotes(items, q, deps.now());
    const label = q.day === "yesterday" ? " de ayer" : q.day === "today" ? " de hoy" : q.day === "daybefore" ? " de anteayer" : "";
    if (hits.length === 0) return { speech: `No encontré ninguna nota${label}${q.keywords.length ? ` sobre ${q.keywords.join(" ")}` : ""}.`, listenAgain: false, action: "find:none" };
    const top = hits.slice(0, 3);
    const first = top[0];
    const body = hits.length === 1 ? ` Dice: ${firstSentences(first.content, 200, 2)}` : "";
    return {
      speech: `Encontré ${hits.length === 1 ? "una nota" : `${hits.length} notas`}${label}: ${listWords(top.map((n) => quote(n.title)))}.${body}`,
      display: hits.slice(0, 8).map((n) => `• ${n.title}: ${firstSentences(n.content, 120, 1)}`).join("\n"),
      listenAgain: false,
      action: "find:ok",
    };
  } catch (e) {
    return { speech: `No pude buscar tus notas. ${errText(e)}`, listenAgain: false, action: "find:error" };
  }
}

async function analyze(deps: Deps): Promise<Reply> {
  try {
    const data = await deps.api.post<{ insight: { summary: string; actions: string[] } }>("/api/business/insights", {}, 60000);
    const s = data?.insight?.summary;
    if (!s) return { speech: "El análisis no devolvió resultados. Inténtalo de nuevo.", listenAgain: false, action: "analyze:empty" };
    const acts = (data.insight.actions ?? []).slice(0, 3);
    const speech = firstSentences(`${s} ${acts.length ? `Acciones recomendadas: ${acts.map((a, i) => `${i + 1}. ${a}`).join(" ")}` : ""}`, 520, 5);
    return { speech, display: `${s}\n${acts.map((a) => `• ${a}`).join("\n")}`, listenAgain: false, action: "analyze:ok" };
  } catch (e) {
    return { speech: `No pude analizar tu negocio. ${errText(e)}`, listenAgain: false, action: "analyze:error" };
  }
}

async function prepareDelete(deps: Deps, session: Session, keywords: string[]): Promise<Reply> {
  if (keywords.length === 0) return { speech: "Dime qué nota quieres borrar, por ejemplo: borra la nota de mi nuevo negocio.", listenAgain: true, action: "delete:ask" };
  try {
    const { items } = await deps.api.get<{ items: NoteLite[] }>("/api/business/notes");
    const hits = findNotes(items, { day: null, keywords }, deps.now());
    if (hits.length === 0) return { speech: "No encontré esa nota, así que no borro nada.", listenAgain: false, action: "delete:none" };
    if (hits.length > 1) return { speech: `Encontré ${hits.length} notas que coinciden. Sé más específico para que no borre la equivocada.`, listenAgain: true, action: "delete:ambiguous" };
    const n = hits[0];
    session.pending = { type: "delete_note", id: n.id, title: n.title };
    return { speech: `Encontré la nota ${quote(n.title)}. Para borrarla, confirma con el botón en pantalla. No la borro por voz.`, listenAgain: false, confirmDelete: { id: n.id, title: n.title }, action: "delete:await_button" };
  } catch (e) {
    return { speech: `No pude buscar la nota. ${errText(e)}`, listenAgain: false, action: "delete:error" };
  }
}

/** Ejecuta el borrado SOLO tras pulsar el botón en pantalla; verifica que ya no exista. */
export async function confirmDeleteByButton(deps: Deps, session: Session): Promise<Reply> {
  const p = session.pending;
  if (!p || p.type !== "delete_note") return { speech: "No hay nada pendiente de borrar.", listenAgain: false };
  session.pending = null;
  try {
    await deps.api.del("/api/business/notes", { id: p.id });
    const { items } = await deps.api.get<{ items: NoteLite[] }>("/api/business/notes");
    const gone = !items.some((n) => n.id === p.id);
    return gone
      ? { speech: `Hecho. Borré la nota ${quote(p.title)} y verifiqué que ya no existe.`, listenAgain: false, action: "delete:ok" }
      : { speech: "Pedí borrar la nota, pero sigue apareciendo. Revísala en la sección Notas.", listenAgain: false, action: "delete:unverified" };
  } catch (e) {
    return { speech: `No pude borrar la nota. ${errText(e)}`, listenAgain: false, action: "delete:error" };
  }
}

export function cancelPending(session: Session): Reply {
  session.pending = null;
  return { speech: "De acuerdo, no hago nada.", listenAgain: false, action: "cancelled" };
}

/** Pide lo que falte (qué o cuándo) y, cuando está todo, crea el recordatorio. */
async function continueReminder(deps: Deps, session: Session, title: string | null, when: Pick<WhenParts, "rel" | "day" | "time">): Promise<Reply> {
  const at = resolveWhen(when, deps.now());
  if (!title) {
    session.pending = { type: "reminder", title: null, when };
    return { speech: "Claro. ¿De qué quieres que te recuerde?", listenAgain: true, action: "reminder:ask_title" };
  }
  if (!at) {
    session.pending = { type: "reminder", title, when };
    return { speech: when.day ? "¿A qué hora?" : "¿Para cuándo? Dime el día y la hora.", listenAgain: true, action: "reminder:ask_when" };
  }
  return createReminder(deps, title, at);
}

function saleQuestion(p: { amount: number; currency: string; description: string }): Reply {
  return {
    speech: `Voy a registrar una venta de ${formatAmount(p.amount)} ${currencyName(p.currency)}, completada, con fecha de hoy. ¿Confirmas?`,
    display: `Venta: ${formatAmount(p.amount)} ${p.currency} · completada · hoy\n«${p.description.slice(0, 120)}»\nDi «sí» para guardar o «no» para cancelar.`,
    listenAgain: true,
    action: "sale:ask",
  };
}

/** Procesa una frase del usuario y devuelve lo que Founder responde. Modifica la sesión (confirmaciones pendientes). */
export async function handleUtterance(deps: Deps, session: Session, utterance: string): Promise<Reply> {
  const text = utterance.trim();
  if (!text) return { speech: "No te escuché. Toca la esfera y vuelve a intentarlo.", listenAgain: false, action: "empty" };
  const pending = session.pending;

  if (pending?.type === "sale") {
    const yn = parseYesNo(text);
    if (yn === "yes") { session.pending = null; return saveSale(deps, pending); }
    if (yn === "no") return cancelPending(session);
    return { speech: "No te entendí. ¿Confirmo la venta? Di sí o no.", listenAgain: true, action: "sale:reask" };
  }
  if (pending?.type === "sale_amount") {
    const a = parseAmount(text);
    if (!a) { session.pending = null; return { speech: "Sigo sin entender el importe. Intenta de nuevo con, por ejemplo: registra una venta de 150.000 pesos.", listenAgain: false, action: "sale:no_amount" }; }
    const p = { type: "sale" as const, amount: a.amount, currency: a.currency, description: pending.description };
    session.pending = p;
    return saleQuestion(p);
  }
  if (pending?.type === "reminder") {
    session.pending = null;
    if (parseYesNo(text) === "no" || parseControl(text) === "stop") return cancelPending(session);
    const w = parseWhen(text, deps.now());
    const merged = { rel: w.rel ?? pending.when.rel, day: w.day ?? pending.when.day, time: w.time ?? pending.when.time };
    const title = pending.title ?? (reminderTitle(text, w.spans) || null);
    return continueReminder(deps, session, title ? capitalize(title).slice(0, 150) : null, merged);
  }
  if (pending?.type === "note_topic") {
    session.pending = null;
    const c = noteFromTopic(text);
    return createNote(deps, c);
  }
  if (pending?.type === "delete_note") {
    // El borrado solo se confirma con el botón. Una frase nueva descarta la solicitud.
    session.pending = null;
  }

  const cmd = parseCommand(text, deps.now());
  switch (cmd.kind) {
    case "create_note": return createNote(deps, cmd);
    case "create_note_topic_missing":
      session.pending = { type: "note_topic" };
      return { speech: "Claro. ¿Sobre qué quieres la nota?", listenAgain: true, action: "note:ask_topic" };
    case "register_sale":
      if (cmd.amount === null || cmd.amount <= 0) {
        session.pending = { type: "sale_amount", description: cmd.description };
        return { speech: "¿De cuánto fue la venta?", listenAgain: true, action: "sale:ask_amount" };
      }
      session.pending = { type: "sale", amount: cmd.amount, currency: cmd.currency, description: cmd.description };
      return saleQuestion({ amount: cmd.amount, currency: cmd.currency, description: cmd.description });
    case "create_reminder": return continueReminder(deps, session, cmd.title, cmd.when);
    case "sales_summary": return salesSummary(deps, cmd.period, cmd.wantsProfit);
    case "list_pending": return listPending(deps, cmd.scope);
    case "find_note": return findNote(deps, cmd);
    case "analyze": return analyze(deps);
    case "delete_note": return prepareDelete(deps, session, cmd.keywords);
    case "delete_other": return { speech: "Por seguridad, borrar o cancelar ventas, clientes o productos solo se hace desde la pantalla de Negocio.", listenAgain: false, action: "delete:other" };
    case "chat":
      try {
        const r = await deps.chat(cmd.text, session.conversationId);
        session.conversationId = r.conversationId ?? session.conversationId;
        return { speech: firstSentences(r.text) || "No tengo una respuesta para eso.", display: r.text, listenAgain: false, action: "chat" };
      } catch (e) {
        return { speech: `No pude consultar a Founder. ${errText(e)}`, listenAgain: false, action: "chat:error" };
      }
  }
}


// ---------- Escucha continua: órdenes de control, eco y configuración del reconocedor ----------

export type Control = "stop" | "repeat" | null;

const STOP_WORDS = ["detente", "detenete", "deten", "detener", "alto", "basta", "callate", "silencio", "espera", "esperame", "pausa", "stop", "calla"];
const REPEAT_WORDS = ["repite", "repiteme", "repetir", "repitelo", "repitela"];

/**
 * ¿Es una orden de control corta («detente», «repite»)? Se ignora si esa palabra la está diciendo el propio Founder
 * (eco del altavoz): [spoken] es el texto que Founder está leyendo.
 */
export function parseControl(raw: string, spoken = ""): Control {
  const w = words(fold(raw));
  if (w.length === 0 || w.length > 6) return null;
  const said = new Set(words(fold(spoken)));
  const has = (list: string[]) => w.some((x) => list.includes(x) && !said.has(x));
  if (has(STOP_WORDS) || (w.includes("no") && w.includes("sigas")) || (w.includes("ya") && w.includes("basta"))) return "stop";
  if (has(REPEAT_WORDS) || (w.includes("otra") && w.includes("vez") && !said.has("otra")) || (w.includes("que") && w.includes("dijiste") && !said.has("dijiste"))) return "repeat";
  return null;
}

/** Proporción de palabras de lo oído que coinciden con lo que Founder está diciendo (0..1). Alta = es su propio eco. */
export function echoRatio(heard: string, spoken: string): number {
  const h = words(fold(heard));
  if (h.length === 0) return 0;
  const sp = new Set(words(fold(spoken)));
  return h.filter((x) => sp.has(x)).length / h.length;
}

export interface SttConfig { onDevice: boolean; lang: string }
export const sttConfigKey = (c: SttConfig) => `${c.onDevice ? "local" : "sistema"}:${c.lang}`;

const normTag = (t: string) => t.replace("_", "-");
const LANG_TAGS = ["es-CO", "es-US", "es-MX", "es-ES", "es-419", "es"];

/**
 * Orden de configuraciones de reconocimiento a probar. Primero el reconocedor LOCAL (con los paquetes de español que el
 * teléfono dice tener instalados; luego es-CO, es-US, es-MX, es-ES…), después el del sistema Android. La configuración
 * que ya funcionó (saved) va primero.
 */
export function sttLadder(o: { onDeviceAvailable: boolean; systemAvailable: boolean; installed: string[]; saved: string | null }): SttConfig[] {
  const installed = o.installed.map(normTag).filter((t) => t.toLowerCase().startsWith("es"));
  const tags = [...installed, ...LANG_TAGS.filter((t) => !installed.includes(t))];
  const out: SttConfig[] = [];
  if (o.onDeviceAvailable) tags.forEach((lang) => out.push({ onDevice: true, lang }));
  if (o.systemAvailable) LANG_TAGS.forEach((lang) => out.push({ onDevice: false, lang }));
  const i = o.saved ? out.findIndex((c) => sttConfigKey(c) === o.saved) : -1;
  if (i > 0) out.unshift(...out.splice(i, 1));
  return out;
}
