import { useCallback, useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import { AppText, Button, Divider, Input, Screen } from "../../src/components/ui";
import { ReferenceHeader } from "../../src/components/ReferenceHeader";
import { errorMessage, request } from "../../src/lib/api";
import { colors, radius, spacing } from "../../src/theme";

type Experiment = { id: string; title: string; hypothesis: string; status: string; updatedAt: string; _count?: { observations: number } };

type ExperimentList = { items: Experiment[] };

export default function LaboratoryScreen() {
  const [items, setItems] = useState<Experiment[]>([]);
  const [idea, setIdea] = useState("");
  const [draft, setDraft] = useState<{ title: string; hypothesis: string; objective: string; validationMethod: string; successCriteria: string; nextStep: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await request<ExperimentList>("/api/lab/experiments");
      setItems(data.items);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function assist() {
    if (!idea.trim() || working) return;
    setWorking(true);
    setError(null);
    try {
      const data = await request<{ item: typeof draft }>("/api/lab/assist", { method: "POST", body: { idea: idea.trim() } });
      setDraft(data.item);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  async function save() {
    if (!draft || working) return;
    setWorking(true);
    setError(null);
    try {
      await request("/api/lab/experiments", { method: "POST", body: { ...draft, originalIdea: idea.trim(), resources: "" } });
      setDraft(null);
      setIdea("");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Screen edges={["top"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={() => void load()}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxl, flexGrow: 1 }}
        ListHeaderComponent={
          <View>
            <ReferenceHeader title="Laboratorio" />
            <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.xs, marginBottom: spacing.xl }}>
              Convierte una idea en una prueba pequeña, ética y comprobable.
            </AppText>
            {error ? <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>{error}</AppText> : null}
            <View style={{ padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>
              <AppText variant="heading">Diseña un experimento</AppText>
              <Input label="¿Qué quieres comprobar?" value={idea} onChangeText={setIdea} multiline maxLength={4000} hint="Describe la idea en pocas palabras." />
              <Button title="Preparar experimento con Founder" onPress={() => void assist()} loading={working && !draft} disabled={!idea.trim()} />
            </View>
            {draft ? (
              <View style={{ marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceHigh }}>
                <AppText variant="heading">Propuesta de Founder</AppText>
                <Input label="Título" value={draft.title} onChangeText={(value) => setDraft({ ...draft, title: value })} />
                <Input label="Hipótesis" value={draft.hypothesis} onChangeText={(value) => setDraft({ ...draft, hypothesis: value })} multiline />
                <Input label="Objetivo" value={draft.objective} onChangeText={(value) => setDraft({ ...draft, objective: value })} multiline />
                <Input label="Método de validación" value={draft.validationMethod} onChangeText={(value) => setDraft({ ...draft, validationMethod: value })} multiline />
                <Input label="Criterio de éxito" value={draft.successCriteria} onChangeText={(value) => setDraft({ ...draft, successCriteria: value })} multiline />
                <Input label="Siguiente paso" value={draft.nextStep} onChangeText={(value) => setDraft({ ...draft, nextStep: value })} multiline />
                <Button title="Guardar experimento" onPress={() => void save()} loading={working && Boolean(draft)} />
              </View>
            ) : null}
            <AppText variant="heading" style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>Tus experimentos</AppText>
          </View>
        }
        ListEmptyComponent={!loading ? <AppText variant="small" color={colors.textMuted} style={{ paddingVertical: spacing.xl }}>Todavía no tienes experimentos guardados.</AppText> : null}
        renderItem={({ item, index }) => <View><View style={{ paddingVertical: spacing.lg }}><AppText variant="bodyStrong">{item.title}</AppText><AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.xs }}>{item.hypothesis}</AppText><AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>{item._count?.observations ?? 0} observaciones · {item.status}</AppText></View>{index < items.length - 1 ? <Divider /> : null}</View>}
      />
    </Screen>
  );
}
