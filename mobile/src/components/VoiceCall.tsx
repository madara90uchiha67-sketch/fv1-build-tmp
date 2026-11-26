import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Easing, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRealtimeVoice } from "../lib/useRealtimeVoice";
import type { VoicePhase } from "../lib/realtime-events";
import { AppText, Button } from "./ui";
import { colors, GUTTER, radius, spacing, sz, themeName } from "../theme";

const ORB = sz(190);
const BOX = ORB * 1.5; // espacio reservado: las ondas crecen hasta ~1,4 veces la esfera y se desvanecen

const PHASE_TEXT: Record<VoicePhase, string> = {
  connecting: "Conectando…",
  listening: "Te escucho",
  user_speaking: "Te escucho…",
  thinking: "Pensando…",
  speaking: "Founder está hablando",
  error: "No se pudo continuar",
};

const PHASE_HINT: Partial<Record<VoicePhase, string>> = {
  listening: "Habla cuando quieras. No hace falta pulsar nada.",
  user_speaking: "Cuando termines, Founder responde.",
  thinking: "Preparando la respuesta.",
  speaking: "Puedes interrumpir hablando o tocando el botón.",
};

const loop = (value: Animated.Value, duration: number, easing: (t: number) => number = Easing.linear, delay = 0) =>
  Animated.loop(Animated.sequence([Animated.delay(delay), Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true }), Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true })]));

// Segundos que tarda la franja luminosa en dar una vuelta completa según la fase (menos = más viva).
const BAND_SECONDS: Record<VoicePhase, number> = { connecting: 9, listening: 7, user_speaking: 4.2, thinking: 2.2, speaking: 3.4, error: 14 };
const BAND_ALPHA: Record<VoicePhase, number> = { connecting: 0.28, listening: 0.8, user_speaking: 1, thinking: 0.95, speaking: 1, error: 0.15 };

// Esfera metálica de Founder: parte superior oscura, inferior plateada y una franja luminosa ondulada (azul, blanco y
// naranja) que recorre la esfera. Las texturas son imágenes propias; todo el movimiento es animación en vivo:
//  · conectando: se enciende despacio · escuchando: respira y la franja avanza lenta · tú hablando: la franja se
//    ensancha con tu voz · pensando: la franja acelera y gira un arco alrededor · Founder habla: la franja y las
//    ondas laten con su volumen.
export function Orb({ phase, muted, mic, out }: { phase: VoicePhase; muted: boolean; mic: number; out: number }) {
  const breath = useRef(new Animated.Value(0)).current; // 0→1 respiración suave (ida y vuelta)
  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current; // avance continuo de la franja (periodos)
  const level = useRef(new Animated.Value(0)).current; // volumen suavizado 0..1
  const ringsOn = useRef(new Animated.Value(0)).current;
  const arcOn = useRef(new Animated.Value(0)).current;
  const awake = useRef(new Animated.Value(0.4)).current; // brillo general de la esfera
  const bandOn = useRef(new Animated.Value(0.28)).current;

  useEffect(() => {
    const anims = [
      Animated.loop(Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])),
      loop(ringA, 2000, Easing.out(Easing.quad)),
      loop(ringB, 2000, Easing.out(Easing.quad), 1000),
      loop(spin, 1500),
    ];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [breath, ringA, ringB, spin]);

  // La franja nunca se reinicia al cambiar de fase: continúa desde donde iba y solo cambia de velocidad.
  useEffect(() => {
    drift.stopAnimation((value) => {
      Animated.timing(drift, { toValue: value + 2000, duration: 2000 * BAND_SECONDS[phase] * 1000, easing: Easing.linear, useNativeDriver: true }).start();
    });
  }, [phase, drift]);
  useEffect(() => () => drift.stopAnimation(), [drift]);

  useEffect(() => {
    const talking = phase === "speaking" || phase === "user_speaking";
    Animated.parallel([
      Animated.timing(ringsOn, { toValue: talking ? 1 : 0, duration: 320, useNativeDriver: true }),
      Animated.timing(arcOn, { toValue: phase === "thinking" ? 1 : 0, duration: 320, useNativeDriver: true }),
      Animated.timing(awake, { toValue: phase === "connecting" ? 0.4 : muted ? 0.55 : 1, duration: 450, useNativeDriver: true }),
      Animated.timing(bandOn, { toValue: muted ? 0.3 : BAND_ALPHA[phase], duration: 450, useNativeDriver: true }),
    ]).start();
  }, [phase, muted, ringsOn, arcOn, awake, bandOn]);

  useEffect(() => {
    const value = phase === "speaking" ? out : phase === "user_speaking" && !muted ? mic : 0;
    Animated.timing(level, { toValue: Math.min(1, value * 3), duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [phase, muted, mic, out, level]);

  const coreScale = Animated.add(
    breath.interpolate({ inputRange: [0, 1], outputRange: [1, phase === "listening" ? 1.035 : 1.012] }),
    level.interpolate({ inputRange: [0, 1], outputRange: [0, 0.07] }),
  );
  const halo = level.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1.3] });
  const haloOpacity = Animated.multiply(awake, breath.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.85] }));
  const ring = (v: Animated.Value) => ({
    opacity: Animated.multiply(ringsOn, v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.35, 0] })),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.42] }) }],
  });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  // Franja: avanza de derecha a izquierda; con la voz se ensancha y se desplaza un poco en vertical.
  const shift = Animated.multiply(Animated.modulo(drift, 1), -ORB);
  const shiftBack = Animated.multiply(Animated.modulo(Animated.add(drift, 0.5), 1), -ORB);
  const bandScaleY = Animated.add(breath.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.04] }), level.interpolate({ inputRange: [0, 1], outputRange: [0, 0.65] }));
  const bandBob = breath.interpolate({ inputRange: [0, 1], outputRange: [-ORB * 0.018, ORB * 0.018] });
  const light = themeName === "light";

  return (
    <View style={{ width: BOX, height: BOX, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.ring, ring(ringA)]} />
      <Animated.View style={[styles.ring, ring(ringB)]} />
      <Animated.View style={{ position: "absolute", width: ORB, height: ORB, borderRadius: ORB, backgroundColor: light ? "#3a4256" : "#6f9bff", opacity: Animated.multiply(haloOpacity, light ? 0.1 : 0.16), transform: [{ scale: halo }] }} />
      <Animated.View style={[styles.arc, { opacity: arcOn, transform: [{ rotate }] }]} />
      <Animated.View style={[styles.sphere, light ? styles.sphereShadowLight : styles.sphereShadowDark, { opacity: awake, transform: [{ scale: coreScale }] }]}>
        <Image source={require("../../assets/orb/orb-base.png")} style={styles.fill} />
        <Animated.View style={[styles.bandBox, { opacity: Animated.multiply(bandOn, 0.45), transform: [{ translateY: ORB * 0.07 }, { scaleY: -0.8 }] }]}>
          <Animated.Image source={require("../../assets/orb/orb-band.png")} style={[styles.band, { transform: [{ translateX: shiftBack }] }]} />
        </Animated.View>
        <Animated.View style={[styles.bandBox, { opacity: bandOn, transform: [{ translateY: bandBob }, { scaleY: bandScaleY }] }]}>
          <Animated.Image source={require("../../assets/orb/orb-band.png")} style={[styles.band, { transform: [{ translateX: shift }] }]} />
        </Animated.View>
        <Image source={require("../../assets/orb/orb-gloss.png")} style={styles.fill} />
        {muted ? (
          <View style={styles.mutedBadge}>
            <Ionicons name="mic-off" size={sz(26)} color="#ffffff" />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

function RoundButton({ icon, label, onPress, tone = "neutral", active = false, disabled = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; tone?: "neutral" | "danger"; active?: boolean; disabled?: boolean }) {
  const bg = tone === "danger" ? colors.danger : active ? colors.text : colors.surface;
  const fg = tone === "danger" || active ? colors.coralInk : colors.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} hitSlop={6} style={({ pressed }) => [styles.round, { backgroundColor: bg, borderColor: tone === "danger" ? colors.danger : colors.line, opacity: disabled ? 0.35 : pressed ? 0.75 : 1 }]}>
      <Ionicons name={icon} size={sz(20)} color={fg} />
    </Pressable>
  );
}

export function VoiceCall({ onClose }: { onClose: () => void }) {
  const live = useRealtimeVoice();
  return <VoiceCallView {...live} onClose={onClose} />;
}

type VoiceViewProps = ReturnType<typeof useRealtimeVoice> & { onClose: () => void };

/** Parte visual de la llamada: recibe el estado ya calculado (también se usa para la verificación visual en CI). */
export function VoiceCallView({ voice, error, muted, levels, toggleMute, interrupt, retry, openSettings, onClose }: VoiceViewProps) {
  const insets = useSafeAreaInsets();
  const [showTranscript, setShowTranscript] = useState(false);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const lines = useMemo(() => voice.lines.filter((line) => line.text.trim().length > 0).slice(-8), [voice.lines]);
  const last = lines[lines.length - 1];
  const phase = voice.phase;
  const status = muted && phase !== "error" && phase !== "connecting" ? "Micrófono silenciado" : PHASE_TEXT[phase];
  const hint = muted && phase !== "error" ? "Founder no te oye hasta que actives el micrófono." : PHASE_HINT[phase];

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, sz(24)) + spacing.sm, paddingBottom: Math.max(insets.bottom, sz(12)) + spacing.md }]} accessibilityViewIsModal>
      <View style={styles.top}>
        <AppText variant="label" color={colors.textMuted}>FOUNDER · VOZ</AppText>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar llamada" hitSlop={8} style={styles.close}>
          <Ionicons name="close" size={sz(19)} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.center}>
        <Orb phase={phase} muted={muted} mic={levels.mic} out={levels.out} />
        <AppText variant="heading" style={{ marginTop: spacing.xs, fontSize: sz(17), lineHeight: sz(22) }} accessibilityLiveRegion="polite">{status}</AppText>
        {hint ? <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.xs, textAlign: "center" }}>{hint}</AppText> : null}
        {!showTranscript && last && !error ? (
          <AppText variant="small" color={last.role === "user" ? colors.textMuted : colors.text} numberOfLines={4} style={styles.caption}>
            {last.text}
          </AppText>
        ) : null}
        {error ? (
          <View style={{ marginTop: spacing.md, alignItems: "center", alignSelf: "stretch" }} accessibilityLiveRegion="polite">
            <AppText variant="small" color={colors.danger} style={{ textAlign: "center" }}>{error.message}</AppText>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              {error.needsSettings ? <Button title="Abrir ajustes" variant="secondary" onPress={openSettings} /> : <Button title="Reintentar" onPress={retry} />}
            </View>
          </View>
        ) : null}
        {voice.notice && !error ? <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm, textAlign: "center" }}>{voice.notice}</AppText> : null}
      </View>

      {showTranscript ? (
        <View style={styles.transcript}>
          <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })} showsVerticalScrollIndicator={false}>
            {lines.length === 0 ? (
              <AppText variant="small" color={colors.textFaint} style={{ textAlign: "center" }}>La transcripción aparecerá aquí.</AppText>
            ) : lines.map((line) => (
              <View key={line.id} style={{ marginBottom: spacing.sm, alignItems: line.role === "user" ? "flex-end" : "flex-start" }}>
                <AppText variant="caption" color={colors.textFaint}>{line.role === "user" ? "Tú" : "Founder"}</AppText>
                <AppText variant="small" color={line.role === "user" ? colors.textMuted : colors.text} style={{ textAlign: line.role === "user" ? "right" : "left", fontSize: sz(13), lineHeight: sz(18) }}>{line.text}</AppText>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.controls}>
        <RoundButton icon={muted ? "mic-off" : "mic"} label={muted ? "Activar micrófono" : "Silenciar micrófono"} onPress={toggleMute} active={muted} />
        <RoundButton icon="hand-left-outline" label="Interrumpir a Founder" onPress={interrupt} disabled={phase !== "speaking"} />
        <RoundButton icon={showTranscript ? "chatbox-ellipses" : "chatbox-ellipses-outline"} label={showTranscript ? "Ocultar transcripción" : "Mostrar transcripción"} onPress={() => setShowTranscript((v) => !v)} active={showTranscript} />
        <RoundButton icon="call" label="Finalizar llamada" onPress={onClose} tone="danger" />
      </View>
      <AppText variant="caption" color={colors.textFaint} style={{ textAlign: "center", marginTop: spacing.md }}>
        La conversación de voz no reemplaza el historial de texto.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", zIndex: 10, top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.page, paddingHorizontal: GUTTER, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  close: { width: sz(40), height: sz(40), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 0 },
  caption: { marginTop: spacing.lg, textAlign: "center", fontSize: sz(14), lineHeight: sz(20), paddingHorizontal: spacing.md },
  transcript: { flex: 0.9, minHeight: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: spacing.md },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sz(14), paddingTop: spacing.md },
  round: { width: sz(50), height: sz(50), borderRadius: sz(25), borderWidth: 1, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: ORB, height: ORB, borderRadius: ORB, borderWidth: 1.5, borderColor: colors.text },
  arc: { position: "absolute", width: ORB * 1.22, height: ORB * 1.22, borderRadius: ORB, borderWidth: 2, borderColor: colors.text, borderTopColor: "transparent", borderRightColor: "transparent" },
  sphere: { width: ORB, height: ORB, borderRadius: ORB / 2, overflow: "hidden", backgroundColor: "#0b0d12" },
  sphereShadowDark: { elevation: 0 },
  sphereShadowLight: { elevation: 10, shadowColor: "#000" },
  fill: { position: "absolute", width: ORB, height: ORB },
  bandBox: { position: "absolute", left: 0, top: 0, width: ORB, height: ORB, overflow: "hidden" },
  band: { position: "absolute", left: 0, top: 0, width: ORB * 2, height: ORB },
  mutedBadge: { position: "absolute", left: 0, top: 0, width: ORB, height: ORB, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.38)" },
});
