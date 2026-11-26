import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText } from "./ui";
import { errorMessage, request } from "../lib/api";
import { colors, radius, sz, spacing } from "../theme";

interface Insight {
  summary: string;
  actions: string[];
}

// «Analizar negocio» de Founder Web: POST /api/business/insights analiza las ventas, clientes y productos
// reales del usuario de los últimos 90 días. El servidor aplica el límite diario del plan (Free 2, Pro 50).
export function BusinessInsight() {
  const { height } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await request<{ insight: Insight }>("/api/business/insights", { method: "POST", body: {}, timeoutMs: 60000 });
      setInsight(data.insight);
      setOpen(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const label = busy ? "Analizando…" : open ? "Cerrar análisis" : insight ? "Ver análisis" : "Analizar negocio";
  const onPress = () => {
    if (insight) setOpen((v) => !v);
    else void analyze();
  };

  return (
    <View style={{ marginTop: spacing.md }}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy, expanded: open }}
        style={({ pressed }) => [styles.button, { opacity: pressed ? 0.8 : 1 }]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="sparkles-outline" size={sz(17)} color={colors.text} />}
        <AppText variant="bodyStrong">{label}</AppText>
      </Pressable>

      {error ? (
        <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginTop: spacing.sm }}>
          {error}
        </AppText>
      ) : null}

      {insight && open ? (
        <View style={styles.card} accessibilityLiveRegion="polite">
          <View style={styles.cardHead}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 }}>
              <Ionicons name="sparkles-outline" size={sz(14)} color={colors.textMuted} />
              <AppText variant="small" color={colors.textMuted}>Lectura de Founder</AppText>
            </View>
            <Pressable onPress={analyze} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Actualizar análisis" style={styles.small}>
              <AppText variant="caption">{busy ? "Actualizando…" : "Actualizar"}</AppText>
            </Pressable>
            <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cerrar análisis" style={[styles.small, { paddingHorizontal: sz(8) }]}>
              <Ionicons name="close" size={sz(13)} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: height * 0.38 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            <AppText variant="body" style={{ marginTop: spacing.md }} selectable>{insight.summary}</AppText>
            {insight.actions.map((action, index) => (
              <AppText key={index} variant="small" color={colors.textMuted} style={{ marginTop: spacing.sm }} selectable>
                {index + 1}. {action}
              </AppText>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: sz(52), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sz(10), paddingHorizontal: sz(16), borderRadius: sz(16), borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  card: { marginTop: spacing.sm, padding: sz(16), borderRadius: sz(18), borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  small: { minHeight: sz(28), paddingHorizontal: sz(10), borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
});
