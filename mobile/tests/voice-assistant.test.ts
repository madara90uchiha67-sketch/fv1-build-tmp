import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAmount, parseCommand, parseWhen, resolveWhen, reminderTitle, parseVoiceSwitch, rankVoices, pitchFor, salesQueryPeriod, periodRange, parseYesNo, handleUtterance, newSession, confirmDeleteByButton, formatAmount, findNotes, notesWithPendingReminders, firstSentences, parseControl, echoRatio, sttLadder, sttConfigKey,
  type Api, type Deps, type NoteLite, type SaleLite,
} from "../src/lib/voice-assistant.ts";

const NOW = new Date(2026, 10, 23, 12, 0, 0);
const at = (daysAgo: number, hour = 12) => new Date(2026, 10, 23 - daysAgo, hour, 0, 0).toISOString();

/** Servidor falso en memoria: guarda de verdad lo que recibe, para comprobar la verificación por relectura. */
function fakeServer(seed: { notes?: NoteLite[]; sales?: SaleLite[] } = {}) {
  const notes: NoteLite[] = [...(seed.notes ?? [])];
  const sales: SaleLite[] = [...(seed.sales ?? [])];
  const calls: string[] = [];
  let n = 0;
  const api: Api = {
    async get(path) {
      calls.push(`GET ${path}`);
      if (path === "/api/business/notes") return { items: notes, totalCount: notes.length, truncated: false } as never;
      if (path === "/api/business/sales") return { items: [...sales].sort((a, b) => String(b.soldAt).localeCompare(String(a.soldAt))), totalCount: sales.length, truncated: false } as never;
      throw new Error("ruta " + path);
    },
    async post(path, body: any) {
      calls.push(`POST ${path}`);
      if (path === "/api/business/notes") {
        const reminderAt = body.noteDate && body.reminderLeadMinutes !== null ? new Date(new Date(body.noteDate).getTime() - body.reminderLeadMinutes * 60_000).toISOString() : null;
        const item = { id: `n${++n}`, title: body.title, content: body.content, noteDate: body.noteDate, reminderAt, createdAt: NOW.toISOString(), reminderLeadMinutes: body.reminderLeadMinutes };
        notes.push(item); return { item } as never;
      }
      if (path === "/api/business/sales") { const item = { id: `s${++n}`, amount: String(body.amount), currency: body.currency, description: body.description, status: body.status, soldAt: body.soldAt }; sales.push(item); return { item } as never; }
      if (path === "/api/business/insights") return { insight: { summary: "Tus ventas subieron.", actions: ["Llama a tus clientes", "Sube el precio"] } } as never;
      throw new Error("ruta " + path);
    },
    async del(path, body: any) {
      calls.push(`DELETE ${path}`);
      const i = notes.findIndex((x) => x.id === body.id);
      if (i >= 0) notes.splice(i, 1);
      return { ok: true } as never;
    },
  };
  return { api, notes, sales, calls };
}

const deps = (api: Api, extra: Partial<Deps> = {}): Deps => ({
  api, now: () => NOW, timeZone: "America/Bogota",
  chat: async (t) => ({ text: `Respuesta a: ${t}. Segunda frase. Tercera frase. Cuarta frase.`, conversationId: "c1" }),
  recommendations: () => ({ pro: true, items: [{ title: "Llamar al proveedor", whenText: "mañana" }] }),
  ...extra,
});

test("importes: dígitos, miles, palabras y millones", () => {
  assert.deepEqual(parseAmount("registra una venta de 150.000 pesos"), { amount: 150000, currency: "COP" });
  assert.equal(parseAmount("venta de $150,000")?.amount, 150000);
  assert.equal(parseAmount("venta de 150000")?.amount, 150000);
  assert.equal(parseAmount("venta de 150 000 pesos")?.amount, 150000);
  assert.equal(parseAmount("venta de 150 mil pesos")?.amount, 150000);
  assert.equal(parseAmount("una venta de ciento cincuenta mil pesos")?.amount, 150000);
  assert.equal(parseAmount("vendí dos millones quinientos mil")?.amount, 2500000);
  assert.equal(parseAmount("venta de 1,5 millones")?.amount, 1500000);
  assert.equal(parseAmount("un millón de pesos")?.amount, 1000000);
  assert.equal(parseAmount("cincuenta y cinco mil")?.amount, 55000);
  assert.equal(parseAmount("200 dólares")?.currency, "USD");
  assert.equal(parseAmount("registra una venta"), null);
  assert.equal(formatAmount(150000), "150.000");
  assert.equal(formatAmount(1500000), "1.500.000");
});

test("órdenes: los 5 ejemplos del usuario", () => {
  const n = parseCommand("Crea una nota sobre mi nuevo negocio");
  assert.equal(n.kind, "create_note");
  if (n.kind === "create_note") { assert.equal(n.title, "Mi nuevo negocio"); assert.match(n.content, /nuevo negocio/); }
  const s = parseCommand("Registra una venta de 150.000 pesos");
  assert.equal(s.kind, "register_sale");
  if (s.kind === "register_sale") assert.equal(s.amount, 150000);
  assert.deepEqual(parseCommand("Muéstrame mis pendientes"), { kind: "list_pending", scope: "both" });
  assert.equal(parseCommand("Analiza mi negocio").kind, "analyze");
  const f = parseCommand("Busca la nota que hice ayer");
  assert.equal(f.kind, "find_note");
  if (f.kind === "find_note") { assert.equal(f.day, "yesterday"); assert.deepEqual(f.keywords, []); }
});

test("órdenes: pendientes por separado, nota sin tema, borrar, charla", () => {
  assert.deepEqual(parseCommand("muéstrame mis notas con recordatorios pendientes"), { kind: "list_pending", scope: "notes" });
  assert.deepEqual(parseCommand("cuáles son mis recomendaciones pendientes"), { kind: "list_pending", scope: "recommendations" });
  assert.equal(parseCommand("crea una nota").kind, "create_note_topic_missing");
  const d = parseCommand("borra la nota de mi nuevo negocio");
  assert.equal(d.kind, "delete_note");
  assert.equal(parseCommand("cancela la venta de ayer").kind, "delete_other");
  assert.equal(parseCommand("¿cómo puedo conseguir más clientes?").kind, "chat");
  assert.equal(parseCommand("busca la nota sobre proveedores").kind, "find_note");
});

test("sí / no", () => {
  assert.equal(parseYesNo("sí, confirmo"), "yes");
  assert.equal(parseYesNo("Sí"), "yes");
  assert.equal(parseYesNo("dale"), "yes");
  assert.equal(parseYesNo("no"), "no");
  assert.equal(parseYesNo("no, cancela"), "no");
  assert.equal(parseYesNo("mmm tal vez"), null);
});

test("META: «crea una nota sobre mi nuevo negocio» guarda de verdad, relee y confirma", async () => {
  const srv = fakeServer();
  const r = await handleUtterance(deps(srv.api), newSession(), "Crea una nota sobre mi nuevo negocio");
  assert.equal(srv.notes.length, 1);
  assert.equal(srv.notes[0].title, "Mi nuevo negocio");
  assert.deepEqual(srv.calls, ["POST /api/business/notes"]); // sin esperas extra: el servidor devuelve la fila guardada
  assert.equal(r.action, "create_note:ok");
  assert.match(r.speech, /quedó guardada en tu cuenta/);
});

test("nota: si el servidor falla NO se dice que se guardó", async () => {
  const srv = fakeServer();
  srv.api.post = async () => { throw new Error("Sin conexión"); };
  const r = await handleUtterance(deps(srv.api), newSession(), "crea una nota sobre proveedores");
  assert.equal(r.action, "create_note:error");
  assert.doesNotMatch(r.speech, /guardada/);
});

test("nota: si el servidor no devuelve la fila guardada, no se afirma que se guardó", async () => {
  const srv = fakeServer();
  srv.api.post = async () => ({} as never);
  const r = await handleUtterance(deps(srv.api), newSession(), "crea una nota sobre proveedores");
  assert.equal(r.action, "create_note:unverified");
});

test("nota sin tema: pregunta y luego guarda", async () => {
  const srv = fakeServer();
  const s = newSession();
  const a = await handleUtterance(deps(srv.api), s, "crea una nota");
  assert.equal(a.listenAgain, true);
  assert.equal(srv.notes.length, 0);
  const b = await handleUtterance(deps(srv.api), s, "ideas de marketing para diciembre");
  assert.equal(srv.notes.length, 1);
  assert.equal(b.action, "create_note:ok");
});

test("venta: lee importe y moneda, NO guarda hasta oír «sí»", async () => {
  const srv = fakeServer();
  const s = newSession();
  const ask = await handleUtterance(deps(srv.api), s, "Registra una venta de 150.000 pesos");
  assert.equal(srv.sales.length, 0);
  assert.equal(ask.listenAgain, true);
  assert.match(ask.speech, /150\.000 pesos colombianos/);
  assert.match(ask.speech, /¿Confirmas\?/);
  const ok = await handleUtterance(deps(srv.api), s, "sí");
  assert.equal(srv.sales.length, 1);
  assert.equal(srv.sales[0].amount, "150000");
  assert.equal(srv.sales[0].currency, "COP");
  assert.equal(ok.action, "sale:ok");
  assert.match(ok.speech, /registrada y verificada/);
});

test("venta: «no» cancela y no guarda nada", async () => {
  const srv = fakeServer();
  const s = newSession();
  await handleUtterance(deps(srv.api), s, "registra una venta de 80 mil pesos");
  const r = await handleUtterance(deps(srv.api), s, "no");
  assert.equal(srv.sales.length, 0);
  assert.equal(r.action, "cancelled");
  assert.equal(s.pending, null);
});

test("venta sin importe: pregunta cuánto", async () => {
  const srv = fakeServer();
  const s = newSession();
  const a = await handleUtterance(deps(srv.api), s, "registra una venta");
  assert.match(a.speech, /cuánto/);
  const b = await handleUtterance(deps(srv.api), s, "doscientos mil pesos");
  assert.match(b.speech, /200\.000/);
  assert.equal(srv.sales.length, 0);
});

test("borrar: por voz NUNCA se borra; solo con el botón", async () => {
  const srv = fakeServer({ notes: [{ id: "n9", title: "Mi nuevo negocio", content: "x", noteDate: null, reminderAt: null, createdAt: at(1) }] });
  const s = newSession();
  const r = await handleUtterance(deps(srv.api), s, "borra la nota de mi nuevo negocio");
  assert.equal(srv.notes.length, 1);
  assert.deepEqual(r.confirmDelete, { id: "n9", title: "Mi nuevo negocio" });
  assert.ok(!srv.calls.some((c) => c.startsWith("DELETE")));
  // Decir «sí» después no borra.
  await handleUtterance(deps(srv.api), s, "sí, bórrala");
  assert.equal(srv.notes.length, 1);
  assert.ok(!srv.calls.some((c) => c.startsWith("DELETE")));
});

test("borrar: el botón ejecuta y verifica", async () => {
  const srv = fakeServer({ notes: [{ id: "n9", title: "Mi nuevo negocio", content: "x", noteDate: null, reminderAt: null, createdAt: at(1) }] });
  const s = newSession();
  await handleUtterance(deps(srv.api), s, "elimina la nota de mi nuevo negocio");
  const r = await confirmDeleteByButton(deps(srv.api), s);
  assert.equal(srv.notes.length, 0);
  assert.equal(r.action, "delete:ok");
});

test("borrar: varias coincidencias → no elige una", async () => {
  const mk = (id: string, t: string) => ({ id, title: t, content: "negocio", noteDate: null, reminderAt: null, createdAt: at(1) });
  const srv = fakeServer({ notes: [mk("a", "Negocio uno"), mk("b", "Negocio dos")] });
  const r = await handleUtterance(deps(srv.api), newSession(), "borra la nota del negocio");
  assert.equal(r.confirmDelete, undefined);
  assert.equal(r.action, "delete:ambiguous");
});

test("buscar la nota de ayer", async () => {
  const srv = fakeServer({ notes: [
    { id: "1", title: "Reunión con proveedor", content: "Llevar muestras", noteDate: null, reminderAt: null, createdAt: at(1) },
    { id: "2", title: "Idea de precios", content: "Subir 5%", noteDate: null, reminderAt: null, createdAt: at(3) },
  ] });
  const r = await handleUtterance(deps(srv.api), newSession(), "Busca la nota que hice ayer");
  assert.equal(r.action, "find:ok");
  assert.match(r.speech, /Reunión con proveedor/);
  assert.doesNotMatch(r.speech, /Idea de precios/);
});

test("pendientes: notas con recordatorio y recomendaciones, separadas y juntas", async () => {
  const srv = fakeServer({ notes: [
    { id: "1", title: "Pagar proveedor", content: "x", noteDate: null, reminderAt: new Date(2026, 10, 24, 9, 0).toISOString(), createdAt: at(2) },
    { id: "2", title: "Ya pasó", content: "x", noteDate: null, reminderAt: at(1), createdAt: at(5) },
  ] });
  const notes = await handleUtterance(deps(srv.api), newSession(), "muéstrame mis notas con recordatorios pendientes");
  assert.match(notes.speech, /Pagar proveedor/);
  assert.doesNotMatch(notes.speech, /Ya pasó|Llamar al proveedor/);
  const recs = await handleUtterance(deps(srv.api), newSession(), "dime mis recomendaciones pendientes");
  assert.match(recs.speech, /Llamar al proveedor/);
  assert.doesNotMatch(recs.speech, /Pagar proveedor/);
  const both = await handleUtterance(deps(srv.api), newSession(), "muéstrame mis pendientes");
  assert.match(both.speech, /Pagar proveedor/);
  assert.match(both.speech, /Llamar al proveedor/);
  const free = await handleUtterance(deps(srv.api, { recommendations: () => ({ pro: false, items: [] }) }), newSession(), "mis recomendaciones pendientes");
  assert.match(free.speech, /Founder Pro/);
});

test("analizar el negocio", async () => {
  const srv = fakeServer();
  const r = await handleUtterance(deps(srv.api), newSession(), "Analiza mi negocio");
  assert.equal(r.action, "analyze:ok");
  assert.match(r.speech, /ventas subieron/);
});

test("charla libre va al chat y se resume para la voz", async () => {
  const srv = fakeServer();
  const s = newSession();
  const r = await handleUtterance(deps(srv.api), s, "¿cómo consigo más clientes?");
  assert.equal(r.action, "chat");
  assert.equal(s.conversationId, "c1");
  assert.ok(r.display && r.display.length >= r.speech.length);
});

test("utilidades de texto y fechas", () => {
  assert.ok(firstSentences("A. B. C. D. E.".repeat(100), 100).length <= 100);
  const notes: NoteLite[] = [{ id: "1", title: "T", content: "c", noteDate: null, reminderAt: null, createdAt: at(1) }];
  assert.equal(findNotes(notes, { day: "yesterday", keywords: [] }, NOW).length, 1);
  assert.equal(findNotes(notes, { day: "today", keywords: [] }, NOW).length, 0);
  assert.equal(notesWithPendingReminders(notes, NOW).length, 0);
});

test("control por voz: detente / repite, y se ignora el eco de Founder", () => {
  assert.equal(parseControl("detente"), "stop");
  assert.equal(parseControl("Detente un momento"), "stop");
  assert.equal(parseControl("espera"), "stop");
  assert.equal(parseControl("cállate"), "stop");
  assert.equal(parseControl("repite"), "repeat");
  assert.equal(parseControl("¿puedes repetir?"), "repeat");
  assert.equal(parseControl("otra vez"), "repeat");
  assert.equal(parseControl("crea una nota sobre mi nuevo negocio"), null);
  assert.equal(parseControl("registra una venta de 150.000 pesos"), null);
  // La palabra la dice Founder en su respuesta: es eco, no una orden del usuario.
  assert.equal(parseControl("espera", "Primero espera a que termine el mes y luego revisa"), null);
  assert.equal(parseControl("detente", "Aquí tienes tus notas"), "stop");
});

test("eco: lo que Founder dice vuelve al micrófono", () => {
  const spoken = "Hecho. La nota «Mi nuevo negocio» quedó guardada y verificada en tu cuenta.";
  assert.ok(echoRatio("la nota mi nuevo negocio quedó guardada", spoken) >= 0.9);
  assert.ok(echoRatio("crea una nota sobre mis clientes", spoken) < 0.5);
  assert.equal(echoRatio("", spoken), 0);
});

test("escalera del reconocedor: local primero, es-US como alternativa, luego el del sistema", () => {
  const l = sttLadder({ onDeviceAvailable: true, systemAvailable: true, installed: [], saved: null });
  assert.deepEqual(l[0], { onDevice: true, lang: "es-CO" });
  assert.ok(l.some((c) => c.onDevice && c.lang === "es-US"));
  assert.ok(l.findIndex((c) => !c.onDevice) > l.findIndex((c) => c.onDevice && c.lang === "es-US"));
  // Si el teléfono dice tener instalado es-US, se prueba primero.
  const l2 = sttLadder({ onDeviceAvailable: true, systemAvailable: true, installed: ["en-US", "es_US"], saved: null });
  assert.deepEqual(l2[0], { onDevice: true, lang: "es-US" });
  // La que ya funcionó va primera.
  const l3 = sttLadder({ onDeviceAvailable: true, systemAvailable: true, installed: [], saved: "sistema:es-US" });
  assert.equal(sttConfigKey(l3[0]), "sistema:es-US");
  // Sin reconocedor local solo hay del sistema; sin ninguno, vacía.
  assert.ok(sttLadder({ onDeviceAvailable: false, systemAvailable: true, installed: [], saved: null }).every((c) => !c.onDevice));
  assert.equal(sttLadder({ onDeviceAvailable: false, systemAvailable: false, installed: [], saved: null }).length, 0);
});

// ---------- Ganancias, recordatorios y diferencias entre consultar / crear / ejecutar ----------

// NOW = lunes 23-nov-2026 12:00 (hora local). La semana empieza el lunes 23.
const sale = (id: string, amount: number, day: number, status = "COMPLETED", currency = "COP"): SaleLite => ({ id, amount: String(amount), currency, description: null, status, soldAt: new Date(2026, 10, day, 10, 0).toISOString() });

test("ventas: «cuánto dinero he ganado esta semana» suma solo ventas completadas de la semana (datos reales)", async () => {
  const srv = fakeServer({ sales: [sale("a", 150000, 23), sale("b", 50000, 23), sale("c", 999000, 20), sale("d", 70000, 23, "PENDING"), sale("e", 30000, 23, "CANCELLED")] });
  const cmd = parseCommand("Cuánto dinero he ganado esta semana", NOW);
  assert.equal(cmd.kind, "sales_summary");
  const r = await handleUtterance(deps(srv.api), newSession(), "Cuánto dinero he ganado esta semana");
  assert.equal(r.action, "sales:summary");
  assert.match(r.speech, /200\.000 pesos colombianos en 2 ventas/);
  assert.doesNotMatch(r.speech, /999/);
  assert.match(r.speech, /1 venta pendiente/);
  assert.match(r.speech, /ingresos por ventas/); // «ganado» no es ganancia neta: no hay costos
  assert.deepEqual(srv.calls, ["GET /api/business/sales"]); // una sola consulta, sin chat ni errores de conexión
});

test("ventas: periodos (hoy, ayer, mes) y sin ventas", async () => {
  assert.equal(salesQueryPeriod("cuanto vendi hoy"), "today");
  assert.equal(salesQueryPeriod("cuanto vendi ayer"), "yesterday");
  assert.equal(salesQueryPeriod("cuanto he ganado este mes"), "month");
  assert.equal(salesQueryPeriod("como van mis ventas"), "month");
  assert.equal(salesQueryPeriod("registra una venta de 100 mil"), null);
  const r = periodRange("week", NOW);
  assert.equal(r.start.getDate(), 23);
  const srv = fakeServer();
  const none = await handleUtterance(deps(srv.api), newSession(), "cuánto vendí hoy");
  assert.match(none.speech, /No tienes ventas completadas registradas hoy/);
  const mixed = await handleUtterance(deps(fakeServer({ sales: [sale("a", 100, 23, "COMPLETED", "USD"), sale("b", 50000, 23)] }).api), newSession(), "cuánto vendí esta semana");
  assert.match(mixed.speech, /dólares/);
  assert.match(mixed.speech, /pesos colombianos/);
});

test("ventas: si el servidor falla se dice el motivo real y no se inventa una cifra", async () => {
  const srv = fakeServer();
  srv.api.get = async () => { throw new Error("No hay conexión con el servidor."); };
  const r = await handleUtterance(deps(srv.api), newSession(), "cuánto he ganado esta semana");
  assert.equal(r.action, "sales:error");
  assert.doesNotMatch(r.speech, /\d{2,}/);
});

test("ventas truncadas: avisa que el total puede estar incompleto", async () => {
  const srv = fakeServer({ sales: [sale("a", 1000, 23)] });
  const real = srv.api.get;
  srv.api.get = async (p: string) => ({ ...(await real(p) as object), truncated: true } as never);
  const r = await handleUtterance(deps(srv.api), newSession(), "cuánto vendí este mes");
  assert.match(r.speech, /podría estar incompleto/);
});

test("fechas habladas: mañana, hora con tarde/mañana/noche, día de la semana, relativo", () => {
  const at12 = (raw: string) => resolveWhen(parseWhen(raw, NOW), NOW);
  const fmt = (d: Date | null) => (d ? `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : null);
  assert.equal(fmt(at12("mañana a las 3 de la tarde")), "24/11 15:00");
  assert.equal(fmt(at12("mañana a las 9 de la mañana")), "24/11 9:00");
  assert.equal(fmt(at12("mañana a las 8 y media de la noche")), "24/11 20:30");
  assert.equal(fmt(at12("el viernes a las 9 de la mañana")), "27/11 9:00");
  assert.equal(fmt(at12("hoy a las 5 de la tarde")), "23/11 17:00");
  assert.equal(fmt(at12("pasado mañana a las 15:45")), "25/11 15:45");
  assert.equal(fmt(at12("el 5 de diciembre a las 10 de la mañana")), "5/12 10:00");
  assert.equal(fmt(at12("en 20 minutos")), "23/11 12:20");
  assert.equal(fmt(at12("en media hora")), "23/11 12:30");
  assert.equal(fmt(at12("en dos horas")), "23/11 14:00");
  assert.equal(fmt(at12("a las 3")), "23/11 15:00"); // hoy: la próxima vez que sean las 3
  assert.equal(fmt(at12("a las 9")), "23/11 21:00"); // las 9 de la mañana ya pasaron: se entiende esta noche
  assert.equal(parseWhen("mañana", NOW).time, null); // falta la hora → Founder pregunta
  assert.equal(at12("mañana"), null);
});

test("recordatorio: el título queda limpio, sin la orden ni la fecha", () => {
  const t = (raw: string) => reminderTitle(raw, parseWhen(raw, NOW).spans);
  assert.equal(t("Recuérdame mañana a las 3 de la tarde llamar a Juan"), "llamar a Juan");
  assert.equal(t("Crea un recordatorio para mañana a las 9 de la mañana sobre la reunión con proveedores"), "reunión con proveedores");
  assert.equal(t("recuérdame llamar a Juan en 20 minutos"), "llamar a Juan");
  assert.equal(t("avísame el viernes a las 10 de la mañana que pague el arriendo"), "pague el arriendo");
});

test("recordatorio: se crea, se guarda con hora de aviso, se verifica, se programa la alarma y luego se consulta", async () => {
  const srv = fakeServer();
  const alarms: string[] = [];
  const d = deps(srv.api, { scheduleAlarm: async (n) => { alarms.push(n.id); return "ok"; } });
  const session = newSession();
  const r = await handleUtterance(d, session, "Recuérdame mañana a las 3 de la tarde llamar a Juan");
  assert.equal(r.action, "reminder:ok");
  assert.match(r.speech, /Llamar a Juan/);
  assert.match(r.speech, /mañana a las 3:00 de la tarde/);
  assert.match(r.speech, /guardado y verificado/);
  assert.equal(srv.notes.length, 1);
  assert.equal(new Date(srv.notes[0].noteDate!).getHours(), 15);
  assert.equal(new Date(srv.notes[0].reminderAt!).getTime(), new Date(srv.notes[0].noteDate!).getTime()); // aviso a la hora exacta
  assert.deepEqual(srv.calls, ["POST /api/business/notes", "GET /api/business/notes"]);
  assert.deepEqual(alarms, ["n1"]);
  // Después se puede consultar por voz.
  const q = await handleUtterance(d, session, "¿Qué recordatorios tengo?");
  assert.equal(q.action, "pending:notes"); // los recordatorios son notas con aviso
  assert.match(q.speech, /Llamar a Juan/);
  const q2 = await handleUtterance(d, session, "muéstrame mis recordatorios pendientes");
  assert.match(q2.speech, /Llamar a Juan/);
});

test("recordatorio: pregunta lo que falta (qué / cuándo / hora) y luego lo crea", async () => {
  const srv = fakeServer();
  const d = deps(srv.api);
  const s1 = newSession();
  const a = await handleUtterance(d, s1, "crea un recordatorio");
  assert.equal(a.action, "reminder:ask_title"); assert.ok(a.listenAgain);
  const b = await handleUtterance(d, s1, "pagar el arriendo");
  assert.equal(b.action, "reminder:ask_when");
  const c = await handleUtterance(d, s1, "el viernes a las 8 de la mañana");
  assert.equal(c.action, "reminder:ok");
  assert.equal(srv.notes[0].title, "Pagar el arriendo");
  const s2 = newSession();
  const e = await handleUtterance(d, s2, "recuérdame mañana llamar al banco");
  assert.equal(e.action, "reminder:ask_when");
  const f = await handleUtterance(d, s2, "a las 10 de la mañana");
  assert.equal(f.action, "reminder:ok");
  assert.equal(srv.notes.length, 2);
});

test("recordatorio: hora pasada, plan sin Pro y fallo del servidor no se dan por guardados", async () => {
  const srv = fakeServer();
  const past = await handleUtterance(deps(srv.api), newSession(), "recuérdame hoy a las 8 de la mañana llamar a Juan");
  assert.match(past.speech, /ya pasó/);
  const free = await handleUtterance(deps(srv.api, { recommendations: () => ({ pro: false, items: [] }) }), newSession(), "recuérdame mañana a las 3 de la tarde llamar a Juan");
  assert.equal(free.action, "reminder:not_pro");
  assert.equal(srv.notes.length, 0);
  srv.api.post = async () => { throw new Error("No hay conexión con el servidor."); };
  const fail = await handleUtterance(deps(srv.api), newSession(), "recuérdame mañana a las 3 de la tarde llamar a Juan");
  assert.equal(fail.action, "reminder:error");
  assert.doesNotMatch(fail.speech, /Listo|guardado y verificado/);
  const noPerm = fakeServer();
  const np = await handleUtterance(deps(noPerm.api, { scheduleAlarm: async () => "no_permission" }), newSession(), "recuérdame mañana a las 3 de la tarde llamar a Juan");
  assert.match(np.speech, /notificaciones/);
});

test("consultar ≠ crear ≠ ejecutar: cada frase va a su acción", () => {
  const k = (t: string) => parseCommand(t, NOW).kind;
  // Consultar
  assert.equal(k("cuánto vendí esta semana"), "sales_summary");
  assert.equal(k("cuánto dinero he ganado hoy"), "sales_summary");
  assert.equal(k("qué recordatorios tengo"), "list_pending");
  assert.equal(k("muéstrame mis notas de ayer"), "find_note");
  assert.equal(k("analiza mi negocio"), "analyze");
  // Crear registros
  assert.equal(k("recuérdame mañana a las 3 llamar a Juan"), "create_reminder");
  assert.equal(k("crea un recordatorio para el viernes a las 9"), "create_reminder");
  assert.equal(k("crea una nota sobre mi negocio"), "create_note");
  assert.equal(k("registra una venta de 150 mil pesos"), "register_sale");
  assert.equal(k("vendí 200 mil pesos"), "register_sale");
  // Acciones destructivas
  assert.equal(k("borra la nota de proveedores"), "delete_note");
  assert.equal(k("cancela la venta de ayer"), "delete_other");
});

test("voz de Founder: se elige una voz masculina real, no un tono bajado de una femenina", () => {
  const voices = [
    "es-us-x-sfb-local|es-US|400|0|",
    "es-es-x-eea-local|es-ES|400|0|",
    "es-us-x-esd-local|es-US|400|0|",
    "es-mx-x-xyz-local|es-MX|400|0|",
    "es-us-x-esd-network|es-US|500|1|",
    "es-co-x-abc-local|es-CO|300|0|male",
  ];
  const ranked = rankVoices(voices);
  assert.equal(ranked[0].gender, "male");
  assert.equal(ranked[0].network, false);
  assert.equal(ranked[0].name, "es-us-x-esd-local"); // masculina, español latino, sin red, mejor calidad entre las masculinas latinas
  assert.ok(ranked.findIndex((v) => v.name === "es-us-x-sfb-local") > ranked.findIndex((v) => v.name === "es-mx-x-xyz-local"), "las femeninas van al final");
  assert.equal(rankVoices(["x|es-US|0|0|female", "y|es-US|0|0|male"])[0].name, "y"); // el género que declara el motor manda
  assert.equal(pitchFor(ranked[0]), 0.92); // casi sin tocar: cálida y natural
  assert.equal(pitchFor(ranked[ranked.length - 1]), 1); // nunca se baja el tono a una voz que no es masculina
  assert.equal(pitchFor(undefined), 1);
});

test("cambiar de voz por voz", () => {
  assert.equal(parseVoiceSwitch("cambia de voz"), "change");
  assert.equal(parseVoiceSwitch("cambia la voz"), "change");
  assert.equal(parseVoiceSwitch("quiero otra voz"), "change");
  assert.equal(parseVoiceSwitch("pon una voz más grave"), "change");
  assert.equal(parseVoiceSwitch("abre los ajustes de voz"), "settings");
  assert.equal(parseVoiceSwitch("crea una nota sobre mi negocio"), null);
  assert.equal(parseVoiceSwitch("cuánto vendí hoy"), null);
});

// ---------- Pantalla de Voice Mode: tema de Founder y sin textos técnicos ----------

import { readFileSync } from "node:fs";
const screen = readFileSync(new URL("../src/components/VoiceMode.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../src/lib/useTurnVoice.ts", import.meta.url), "utf8");

test("pantalla: usa los colores del tema de Founder, sin colores propios", () => {
  assert.match(screen, /import \{[^}]*\bcolors\b[^}]*\} from "\.\.\/theme"/);
  assert.match(screen, /const BG = colors\.page/);
  assert.match(screen, /colors\.text\b/);
  const code = screen.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, "no debe haber colores fijos (ni negro fijo)");
  assert.doesNotMatch(code, /BLACK/);
});

test("pantalla: no muestra textos técnicos del reconocimiento", () => {
  for (const banned of [/Oído local/i, /Oído del sistema/i, /paquetes locales/i, /es-US|es-CO|es-MX/, /diag/, /voz: \$\{/, /reconocimiento/i]) {
    assert.doesNotMatch(screen, banned);
  }
  // El hook tampoco entrega esos datos a la pantalla ni muestra la lista de configuraciones probadas.
  assert.doesNotMatch(hook, /setDiag|Oído local|paquetes locales/);
  assert.doesNotMatch(hook, /fail\(`[^`]*Probé/);
  assert.doesNotMatch(hook, /setNotice\([^)]*(es-US|sistema Android|reconocimiento)/);
});
