import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Switch, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { UI_PREVIEW } from "../../src/lib/config";
import { AppText, Button, Chip, Divider, Input, Screen, Segmented } from "../../src/components/ui";
import { ReferenceHeader } from "../../src/components/ReferenceHeader";
import { errorMessage, request } from "../../src/lib/api";
import {
  eventDate, formatLead, formatWhen, isPro, leadToMinutes, validateSchedule, type LeadUnit,
} from "../../src/lib/notes-logic";
import {
  ensureNotificationPermission, generateSteps, loadSteps, reconcileReminders, recordRecommendation, saveSteps, scheduleNote, unscheduleNote,
} from "../../src/lib/reminders";
import { canScheduleExact, openExactAlarmSettings, openNotificationSettings } from "../../modules/founder-reminders";
import { useSession } from "../../src/lib/session";
import type { BusinessNote, ListResponse } from "../../src/lib/types";
import { colors, MIN_TOUCH, radius, spacing, sz } from "../../src/theme";

// Notas de Founder.
//  · Free: crear, consultar y borrar notas con título y descripción. Sin avisos ni recomendaciones.
//  · Pro: además fecha y hora del acontecimiento, aviso configurable (minutos, horas o días antes) como
//    notificación de Android y recomendaciones de Founder generadas a partir de lo que escribió el usuario.
// El plan se toma de la cuenta (/api/mobile/auth/me). El servidor no impide guardar fechas a una cuenta Free:
// esa restricción se aplica en la app (la UI no ofrece la opción y no se envían fechas ni avisos).

const UNITS: Array<{ value: LeadUnit; label: string }> = [
  { value: "minutes", label: "Minutos" },
  { value: "hours", label: "Horas" },
  { value: "days", label: "Días" },
];
const PRESETS: Array<{ label: string; amount: string; unit: LeadUnit }> = [
  { label: "10 min", amount: "10", unit: "minutes" },
  { label: "1 hora", amount: "1", unit: "hours" },
  { label: "1 día", amount: "1", unit: "days" },
];

const num = (value: string) => (value.trim() === "" ? NaN : Number(value));

function NoteCard({
  note, pro, steps, busy, onDelete, onRecommend,
}: {
  note: BusinessNote; pro: boolean; steps: string[]; busy: boolean;
  onDelete: (note: BusinessNote) => void; onRecommend: (note: BusinessNote) => void;
}) {
  const scheduled = note.reminderAt && new Date(note.reminderAt).getTime() > Date.now();
  return (
    <View style={{ paddingVertical: spacing.lg }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{note.title}</AppText>
          {note.noteDate ? (
            <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
              {formatWhen(new Date(note.noteDate))}
              {note.reminderLeadMinutes !== null ? ` · Aviso ${formatLead(note.reminderLeadMinutes)}` : ""}
            </AppText>
          ) : null}
          <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.sm }} selectable>
            {note.content}
          </AppText>
        </View>
        <Pressable
          onPress={() => onDelete(note)}
          accessibilityRole="button"
          accessibilityLabel={`Eliminar nota ${note.title}`}
          style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center" }}
        >
          <AppText variant="caption" color={colors.danger}>Eliminar</AppText>
        </Pressable>
      </View>

      {pro && scheduled ? (
        <View style={styles.recBox}>
          <AppText variant="label" color={colors.textMuted}>RECOMENDACIONES DE FOUNDER</AppText>
          {steps.length ? (
            steps.map((step, i) => (
              <AppText key={i} variant="small" style={{ marginTop: spacing.sm }} selectable>• {step}</AppText>
            ))
          ) : (
            <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
              {busy ? "Founder está preparando recomendaciones a partir de tu nota…" : "Todavía no hay recomendaciones para esta nota."}
            </AppText>
          )}
          <Pressable
            onPress={() => onRecommend(note)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={steps.length ? "Actualizar recomendaciones" : "Generar recomendaciones"}
            style={[styles.recButton, { opacity: busy ? 0.5 : 1 }]}
          >
            <AppText variant="caption">{busy ? "Generando…" : steps.length ? "Actualizar recomendaciones" : "Generar recomendaciones"}</AppText>
          </Pressable>
          <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
            Se incluirán en la notificación del aviso.
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

export default function NotesScreen() {
  const { user, refreshUser } = useSession();
  const pro = isPro(user?.plan);
  const { composer: previewComposer } = useLocalSearchParams<{ composer?: string }>();
  const previewOpen = UI_PREVIEW && previewComposer === "1"; // solo verificación visual en CI

  const [notes, setNotes] = useState<BusinessNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; action?: "exact" | "notifications" } | null>(null);
  const [composerOpen, setComposerOpen] = useState(previewOpen);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [scheduleOn, setScheduleOn] = useState(previewOpen);
  const [day, setDay] = useState(previewOpen ? "25" : "");
  const [month, setMonth] = useState(previewOpen ? "11" : "");
  const [year, setYear] = useState(previewOpen ? "2026" : "");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("00");
  const [pm, setPm] = useState<"am" | "pm">("am");
  const [leadAmount, setLeadAmount] = useState("1");
  const [leadUnit, setLeadUnit] = useState<LeadUnit>("hours");
  const [formError, setFormError] = useState<string | null>(null);
  const [, bump] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const tried = useRef(new Set<string>());

  const recommend = useCallback(async (note: BusinessNote) => {
    setBusyId(note.id);
    try {
      const steps = await generateSteps(note);
      if (steps.length) {
        saveSteps(note.id, steps);
        scheduleNote(note, steps);
        if (user) recordRecommendation(user.id, note, steps);
      } else {
        setError("Founder no devolvió recomendaciones. Inténtalo de nuevo.");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
      bump((n) => n + 1);
    }
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshUser();
      const data = await request<ListResponse<BusinessNote>>("/api/business/notes");
      setNotes(data.items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [refreshUser]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Mantiene los avisos del teléfono iguales a las notas de la cuenta y completa recomendaciones pendientes.
  // Solo verificación visual en CI: abrir el formulario Pro al llegar por enlace.
  useEffect(() => {
    if (!previewOpen) return;
    setComposerOpen(true); setScheduleOn(true); setDay("25"); setMonth("11"); setYear("2026");
  }, [previewOpen]);

  const signature = `${pro}|${notes.map((n) => `${n.id}:${n.reminderAt}`).join(",")}`;
  useEffect(() => {
    if (loading) return;
    const missing = reconcileReminders(notes, pro).filter((n) => !tried.current.has(n.id)).slice(0, 2);
    missing.forEach((n) => tried.current.add(n.id));
    void (async () => { for (const n of missing) await recommend(n); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depende solo de la firma de las notas y del plan
  }, [signature, loading]);

  function openComposer() {
    if (!composerOpen && pro && !day) {
      const t = new Date(Date.now() + 24 * 3600 * 1000);
      setDay(String(t.getDate()));
      setMonth(String(t.getMonth() + 1));
      setYear(String(t.getFullYear()));
    }
    setComposerOpen((v) => !v);
    setFormError(null);
  }

  async function save() {
    if (saving) return;
    setFormError(null);
    setNotice(null);
    if (!title.trim() || !content.trim()) {
      setFormError("Escribe un título y la descripción de la nota.");
      return;
    }
    let body: Record<string, unknown> = { title: title.trim(), content: content.trim(), noteDate: null, timeZone: "UTC", reminderLeadMinutes: null };
    const withSchedule = pro && scheduleOn;
    if (withSchedule) {
      const event = eventDate({ day: num(day), month: num(month), year: num(year), hour12: num(hour), minute: num(minute), pm: pm === "pm" });
      const lead = leadToMinutes(num(leadAmount), leadUnit);
      const problem = validateSchedule(event, lead, Date.now());
      if (problem || !event || lead === null) {
        setFormError(problem ?? "Revisa la fecha y el aviso.");
        return;
      }
      body = { ...body, noteDate: event.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", reminderLeadMinutes: lead };
    }
    setSaving(true);
    try {
      const res = await request<{ item?: BusinessNote }>("/api/business/notes", { method: "POST", body });
      const item = res.item;
      setTitle(""); setContent(""); setScheduleOn(false); setComposerOpen(false);
      if (withSchedule && item) {
        const permission = await ensureNotificationPermission();
        // El aviso se programa ya, con o sin recomendaciones, para no perderlo si falla la red.
        scheduleNote(item, []);
        setNotes((prev) => [item, ...prev]);
        await recommend(item);
        if (permission !== "granted") {
          setNotice({ text: "La nota quedó guardada, pero Android tiene bloqueadas las notificaciones de Founder: no recibirás el aviso hasta que las actives.", action: "notifications" });
        } else if (!canScheduleExact()) {
          setNotice({ text: "Para que el aviso llegue a la hora exacta, permite «Alarmas y recordatorios» a Founder. Si no, Android puede retrasarlo unos minutos.", action: "exact" });
        }
      }
      await load();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function remove(note: BusinessNote) {
    Alert.alert("¿Eliminar nota?", `Se eliminará “${note.title}”.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        try {
          await request("/api/business/notes", { method: "DELETE", body: { id: note.id } });
          unscheduleNote(note.id);
          setNotes((items) => items.filter((item) => item.id !== note.id));
        } catch (e) {
          setError(errorMessage(e));
        }
      } },
    ]);
  }

  return (
    <Screen edges={["top"]} keyboard>
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={() => void load()}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 }}
        ListHeaderComponent={
          <View>
            <ReferenceHeader title="Notas" centered />
            <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.xs, marginBottom: spacing.xl }}>
              {pro ? "Tu espacio para pensar y organizar. Con Founder Pro, tus acontecimientos llegan con aviso y recomendaciones." : "Tu espacio para pensar, registrar pendientes y guardar ideas."}
            </AppText>
            {error ? <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>{error}</AppText> : null}
            {notice ? (
              <View style={styles.notice}>
                <AppText variant="small">{notice.text}</AppText>
                {notice.action ? (
                  <Button title={notice.action === "exact" ? "Abrir ajustes de alarmas" : "Abrir ajustes de notificaciones"} variant="secondary" onPress={() => (notice.action === "exact" ? openExactAlarmSettings() : openNotificationSettings())} style={{ marginTop: spacing.md }} />
                ) : null}
              </View>
            ) : null}
            <Button title={composerOpen ? "Cerrar nota" : "Nueva nota"} variant={composerOpen ? "secondary" : "primary"} onPress={openComposer} />
            {composerOpen ? (
              <View style={styles.composer}>
                <Input label="Título" value={title} onChangeText={setTitle} maxLength={160} />
                <Input label="Descripción" value={content} onChangeText={setContent} multiline maxLength={5000} />

                {pro ? (
                  <View>
                    <View style={styles.switchRow}>
                      <View style={{ flex: 1 }}>
                        <AppText variant="bodyStrong">Programar acontecimiento</AppText>
                        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>Fecha, hora y aviso con recomendaciones de Founder</AppText>
                      </View>
                      <Switch value={scheduleOn} onValueChange={setScheduleOn} trackColor={{ false: colors.surfaceHigh, true: colors.coral }} thumbColor={scheduleOn ? colors.coralInk : colors.textMuted} accessibilityLabel="Programar acontecimiento" />
                    </View>
                    {scheduleOn ? (
                      <View style={{ marginTop: spacing.md }}>
                        <View style={styles.fields}>
                          <View style={{ flex: 1 }}><Input label="Día" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} /></View>
                          <View style={{ flex: 1 }}><Input label="Mes" value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} /></View>
                          <View style={{ flex: 1.4 }}><Input label="Año" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} /></View>
                        </View>
                        <View style={styles.fields}>
                          <View style={{ flex: 1 }}><Input label="Hora" value={hour} onChangeText={setHour} keyboardType="number-pad" maxLength={2} /></View>
                          <View style={{ flex: 1 }}><Input label="Minutos" value={minute} onChangeText={setMinute} keyboardType="number-pad" maxLength={2} /></View>
                          <View style={{ flex: 1.4, justifyContent: "flex-end", marginBottom: spacing.md }}>
                            <Segmented options={[{ value: "am", label: "a. m." }, { value: "pm", label: "p. m." }]} value={pm} onChange={setPm} />
                          </View>
                        </View>
                        <AppText variant="label" color={colors.textMuted} style={{ marginBottom: spacing.xs + 2 }}>AVISARME</AppText>
                        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                          {PRESETS.map((p) => (
                            <Chip key={p.label} label={`${p.label} antes`} selected={leadAmount === p.amount && leadUnit === p.unit} onPress={() => { setLeadAmount(p.amount); setLeadUnit(p.unit); }} />
                          ))}
                        </View>
                        <View style={[styles.fields, { marginTop: spacing.sm }]}>
                          <View style={{ flex: 1 }}><Input label="Cantidad" value={leadAmount} onChangeText={setLeadAmount} keyboardType="number-pad" maxLength={5} /></View>
                          <View style={{ flex: 2.2, justifyContent: "flex-end", marginBottom: spacing.md }}>
                            <Segmented options={UNITS} value={leadUnit} onChange={setLeadUnit} />
                          </View>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.locked}>
                    <AppText variant="bodyStrong">Avisos y recomendaciones</AppText>
                    <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
                      Los recordatorios con fecha y las recomendaciones de Founder son parte de Founder Pro. Con tu plan gratuito puedes guardar y consultar todas tus notas.
                    </AppText>
                  </View>
                )}

                {formError ? <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>{formError}</AppText> : null}
                <Button title="Guardar nota" onPress={() => void save()} loading={saving} />
              </View>
            ) : null}
            <AppText variant="heading" style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>Tus notas</AppText>
          </View>
        }
        ListEmptyComponent={!loading ? <AppText variant="small" color={colors.textMuted} style={{ paddingVertical: spacing.xl }}>Todavía no tienes notas guardadas.</AppText> : null}
        renderItem={({ item, index }) => (
          <View>
            <NoteCard note={item} pro={pro} steps={loadSteps(item.id)} busy={busyId === item.id} onDelete={remove} onRecommend={(n) => void recommend(n)} />
            {index < notes.length - 1 ? <Divider /> : null}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  composer: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm },
  fields: { flexDirection: "row", gap: spacing.sm },
  locked: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, marginBottom: spacing.lg },
  notice: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, marginBottom: spacing.md },
  recBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  recButton: { alignSelf: "flex-start", marginTop: spacing.md, minHeight: sz(30), paddingHorizontal: sz(12), borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
});
