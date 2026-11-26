import { useCallback, useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { AppText, Button } from "./ui";
import { pendingFor, resolveRecommendation, syncRecommendations } from "../lib/reminders";
import { isPro, type Recommendation } from "../lib/notes-logic";
import { useSession } from "../lib/session";
import { colors, radius, spacing } from "../theme";

// Recomendaciones de Founder para tus notas con aviso (solo Pro). Aparecen al entrar a la app cuando llega la hora
// del aviso, aunque la notificación ya haya desaparecido, y siguen aquí hasta que eliges Chat o Ignorar.
export function PendingRecommendations() {
  const router = useRouter();
  const { user } = useSession();
  const pro = isPro(user?.plan);
  const [items, setItems] = useState<Recommendation[]>([]);

  const refresh = useCallback(() => {
    setItems(user && pro ? pendingFor(user.id, pro) : []);
  }, [user, pro]);

  // Trae lo del servidor (otro dispositivo, otra instalación) y vuelve a mostrar lo pendiente.
  const sync = useCallback(() => {
    refresh();
    if (user && pro) void syncRecommendations(user.id).then(refresh);
  }, [user, pro, refresh]);

  useFocusEffect(useCallback(() => { sync(); }, [sync]));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") sync(); });
    const timer = setInterval(refresh, 20_000); // por si llega la hora del aviso con la app abierta
    const syncTimer = setInterval(sync, 90_000);
    return () => { sub.remove(); clearInterval(timer); clearInterval(syncTimer); };
  }, [sync, refresh]);

  if (!user || !pro || !items.length) return null;

  const open = (rec: Recommendation) => router.push({ pathname: "/chat", params: { recId: rec.noteId } });
  const ignore = (rec: Recommendation) => {
    resolveRecommendation(user.id, rec.noteId, "ignored");
    refresh();
  };

  return (
    <View accessibilityLabel="Recomendaciones pendientes" style={{ gap: spacing.md, marginBottom: spacing.lg }}>
      <AppText variant="bodyStrong">{items.length === 1 ? "Recomendación pendiente" : `Recomendaciones pendientes (${items.length})`}</AppText>
      {items.map((rec) => (
        <View key={rec.noteId} style={{ borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.lg }}>
          <AppText variant="bodyStrong">{rec.title}</AppText>
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>{rec.whenText}</AppText>
          <View style={{ marginTop: spacing.sm, gap: 2 }}>
            {rec.steps.slice(0, 4).map((step, i) => (
              <AppText key={i} variant="small" color={colors.textMuted}>{`• ${step}`}</AppText>
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
            <Button title="Chat" onPress={() => open(rec)} accessibilityLabel={`Chat: ${rec.title}`} style={{ flex: 1 }} />
            <Button title="Ignorar" variant="secondary" onPress={() => ignore(rec)} accessibilityLabel={`Ignorar: ${rec.title}`} style={{ flex: 1 }} />
          </View>
        </View>
      ))}
    </View>
  );
}
