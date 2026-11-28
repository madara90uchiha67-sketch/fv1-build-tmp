import { useEffect } from "react";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTurnVoice, type TurnPhase } from "../lib/useTurnVoice";
import type { VoicePhase } from "../lib/realtime-events";
import { Orb } from "./VoiceCall";
import { AppText, Button } from "./ui";
import { GUTTER, colors, spacing, sz } from "../theme";

// Modo de voz de Founder: esfera al centro y nada más (la conversación no se muestra aquí; queda en el chat). Usa los colores del tema elegido en Founder (claro u oscuro): no tiene
// una apariencia propia. El tema se aplica al abrir la app (cambiarlo la reinicia), así que el modo de voz siempre coincide. Sin botones de llamada, colgar ni silenciar.
// Escucha sola al abrirse y vuelve a escuchar tras cada respuesta. Un único control discreto (X) para salir; el botón
// «atrás» de Android también sale. Tocar la esfera: interrumpe a Founder, o reanuda la escucha si se pausó.
// Pulsación larga en la esfera (o decir «cambia de voz»): prueba la siguiente voz en español instalada. Sin textos técnicos.

const BG = colors.page;
const TEXT = colors.text;
const MUTED = colors.textMuted;
const FAINT = colors.textFaint;
const DANGER = colors.danger;

const ORB_PHASE: Record<TurnPhase, VoicePhase> = { idle: "connecting", listening: "listening", user_speaking: "user_speaking", thinking: "thinking", speaking: "speaking", error: "error" };
const STATUS: Record<TurnPhase, string> = { idle: "En pausa · toca la esfera", listening: "Escuchando", user_speaking: "Escuchando", thinking: "Pensando", speaking: "", error: "" };

export function FounderVoice({ onClose }: { onClose: () => void }) {
  const t = useTurnVoice();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const status = STATUS[t.phase];

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, sz(24)) + spacing.sm, paddingBottom: Math.max(insets.bottom, sz(12)) + spacing.md }]} accessibilityViewIsModal>
      <View style={styles.top}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Salir del modo de voz" hitSlop={14} style={styles.close}>
          <Ionicons name="close" size={sz(22)} color={MUTED} />
        </Pressable>
      </View>

      <View style={styles.center}>
        <Pressable
          onPress={t.orbPress}
          onLongPress={t.changeVoice}
          delayLongPress={900}
          accessibilityRole="button"
          accessibilityLabel="Esfera de Founder"
          accessibilityHint="Toca para interrumpir o reanudar la escucha. Mantén pulsado para cambiar la voz."
        >
          <Orb phase={ORB_PHASE[t.phase]} muted={false} mic={t.levels.mic} out={t.levels.out} />
        </Pressable>

        {status ? <AppText variant="small" color={MUTED} style={styles.status} accessibilityLiveRegion="polite">{status}</AppText> : null}

        {t.error ? (
          <View style={styles.block} accessibilityLiveRegion="polite">
            <AppText variant="small" color={DANGER} style={{ textAlign: "center" }}>{t.error.message}</AppText>
            <View style={{ marginTop: spacing.md }}>
              {t.error.needsSettings ? <Button title="Abrir ajustes" variant="secondary" onPress={t.openSettings} /> : <Button title="Reintentar" onPress={t.retry} />}
            </View>
          </View>
        ) : null}

        {t.pendingDelete ? (
          <View style={styles.block} accessibilityLiveRegion="polite">
            <AppText variant="small" color={TEXT} style={{ textAlign: "center" }}>{`¿Borrar la nota «${t.pendingDelete.title}»? No se puede deshacer.`}</AppText>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <Button title="Cancelar" variant="secondary" onPress={t.cancelDelete} />
              <Button title="Borrar nota" onPress={t.confirmDelete} />
            </View>
          </View>
        ) : null}

        {t.notice && !t.error ? <AppText variant="caption" color={FAINT} style={styles.notice}>{t.notice}</AppText> : null}
      </View>

      <View />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", zIndex: 10, top: 0, right: 0, bottom: 0, left: 0, backgroundColor: BG, paddingHorizontal: GUTTER },
  top: { flexDirection: "row", justifyContent: "flex-end" },
  close: { width: sz(40), height: sz(40), alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 0 },
  status: { marginTop: spacing.xs, textAlign: "center" },
  block: { marginTop: spacing.md, alignItems: "center", alignSelf: "stretch" },
  notice: { marginTop: spacing.md, textAlign: "center", paddingHorizontal: spacing.md },
});
