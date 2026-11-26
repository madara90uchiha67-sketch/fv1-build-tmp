import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing } from "../theme";
import { isNetworkError } from "../lib/api";
import { AppText, Button } from "./ui";

export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <ActivityIndicator color={colors.coral} />
      <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.md }}>
        {label}
      </AppText>
    </View>
  );
}

export function EmptyState({ title, body, actionLabel, onAction }: { title: string; body: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.center}>
      <AppText variant="heading" style={styles.centerText}>
        {title}
      </AppText>
      <AppText variant="small" color={colors.textMuted} style={[styles.centerText, { marginTop: spacing.xs }]}>
        {body}
      </AppText>
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} style={{ marginTop: spacing.lg, alignSelf: "stretch" }} /> : null}
    </View>
  );
}

// `error` puede ser un ApiError: si es de red se muestra el estado "sin conexión".
export function ErrorState({ error, message, onRetry }: { error?: unknown; message: string; onRetry?: () => void }) {
  const offline = isNetworkError(error);
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <Ionicons name={offline ? "cloud-offline-outline" : "alert-circle-outline"} size={28} color={colors.textMuted} />
      <AppText variant="heading" style={[styles.centerText, { marginTop: spacing.md }]}>
        {offline ? "Sin conexión" : "No se pudo cargar"}
      </AppText>
      <AppText variant="small" color={colors.textMuted} style={[styles.centerText, { marginTop: spacing.xs }]}>
        {message}
      </AppText>
      {onRetry ? <Button title="Reintentar" variant="secondary" onPress={onRetry} style={{ marginTop: spacing.lg, alignSelf: "stretch" }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  centerText: { textAlign: "center" },
});
