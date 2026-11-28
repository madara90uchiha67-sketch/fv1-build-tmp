import { useRef, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect } from "react";
import { uiGet, uiSet } from "../../modules/founder-reminders";
import { AppText, Button } from "./ui";
import { GUTTER, colors, spacing, sz } from "../theme";

// Presentación de bienvenida: se muestra una sola vez a cada cuenta en este teléfono y explica para qué sirve cada función.

type Slide = { icon: keyof typeof Ionicons.glyphMap; title: string; body: string };

export const SLIDES: Slide[] = [
  { icon: "sparkles-outline", title: "Bienvenido a Founder", body: "Tu asistente para llevar tu negocio: registra ventas, guarda notas, recibe recomendaciones y habla con Founder cuando quieras. Te mostramos rápido para qué sirve cada parte." },
  { icon: "home-outline", title: "Inicio", body: "Un resumen de tu negocio con gráficas de tus ventas y registros recientes. Desde aquí también entras a Estrategia, para analizar un problema de tu negocio, y al Reto diario." },
  { icon: "briefcase-outline", title: "Negocio", body: "Registra tus ventas, guarda tus clientes y los productos que vendes. Mientras más registres, mejor se ve tu resumen en Inicio." },
  { icon: "chatbubble-ellipses-outline", title: "Chat", body: "Conversa con Founder por escrito: pídele ideas, análisis o ayuda con tu negocio. Tus conversaciones quedan guardadas en el historial." },
  { icon: "call-outline", title: "Hablar con Founder", body: "Toca el botón del teléfono arriba en el Chat y habla con Founder en voz alta. Te escucha solo, te responde y vuelve a escuchar. Para interrumpirlo, di «detente» o toca la esfera. Puede crear notas y registrar ventas con tu voz." },
  { icon: "flask-outline", title: "Laboratorio", body: "Cuéntale una idea y Founder te ayuda a convertirla en un experimento sencillo para probarla en tu negocio. Puedes guardar tus experimentos." },
  { icon: "document-text-outline", title: "Notas", body: "Crea, mira y edita tus notas a mano, o díctaselas a Founder por voz. En Founder Pro, tus notas pueden avisarte con recordatorios y recomendaciones." },
  { icon: "person-circle-outline", title: "Tu cuenta", body: "En Configuración eliges el tema blanco o negro, añades tu foto de perfil, envías feedback y cierras sesión cuando quieras." },
];

const seenKey = (userId: string) => `onboarding:v1:${userId}`;
export const needsOnboarding = (userId: string | undefined) => Boolean(userId) && uiGet(seenKey(userId as string)) !== "1";
export const markOnboardingSeen = (userId: string) => { uiSet(seenKey(userId), "1"); };

export function Onboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const finish = () => { markOnboardingSeen(userId); onDone(); };
  const goTo = (i: number) => { scroller.current?.scrollTo({ x: i * width, animated: true }); setIndex(i); };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { if (index > 0) { goTo(index - 1); } else { finish(); } return true; });
    return () => sub.remove();
  });

  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.max(0, Math.min(SLIDES.length - 1, Math.round(e.nativeEvent.contentOffset.x / width))));

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, sz(24)) + spacing.sm, paddingBottom: Math.max(insets.bottom, sz(12)) + spacing.md }]} accessibilityViewIsModal>
      <View style={styles.top}>
        {!last ? (
          <Pressable onPress={finish} hitSlop={12} accessibilityRole="button" accessibilityLabel="Saltar la presentación">
            <AppText variant="small" color={colors.textMuted}>Saltar</AppText>
          </Pressable>
        ) : null}
      </View>

      <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onEnd} style={{ flex: 1 }}>
        {SLIDES.map((s) => (
          <View key={s.title} style={{ width, paddingHorizontal: GUTTER + sz(8), alignItems: "center", justifyContent: "center" }}>
            <View style={styles.iconWrap}><Ionicons name={s.icon} size={sz(40)} color={colors.text} /></View>
            <AppText accessibilityRole="header" style={styles.title}>{s.title}</AppText>
            <AppText color={colors.textMuted} style={styles.body}>{s.body}</AppText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots} accessibilityElementsHidden>
        {SLIDES.map((s, i) => <View key={s.title} style={[styles.dot, i === index ? styles.dotActive : null]} />)}
      </View>

      <View style={{ paddingHorizontal: GUTTER }}>
        <Button title={last ? "Empezar" : "Siguiente"} onPress={() => (last ? finish() : goTo(index + 1))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", zIndex: 20, top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.page },
  top: { height: sz(32), flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: GUTTER },
  iconWrap: { width: sz(88), height: sz(88), borderRadius: sz(28), borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", marginBottom: sz(28) },
  title: { fontSize: sz(26), lineHeight: sz(32), textAlign: "center", marginBottom: sz(12), fontFamily: "sans-serif-medium" },
  body: { fontSize: sz(15), lineHeight: sz(23), textAlign: "center" },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, paddingVertical: sz(18) },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dot },
  dotActive: { width: 19, backgroundColor: colors.coral },
});
