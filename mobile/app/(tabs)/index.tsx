import { useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ErrorState, LoadingState } from "../../src/components/states";
import { LineChart } from "../../src/components/LineChart";
import { AppText, Screen } from "../../src/components/ui";
import { PendingRecommendations } from "../../src/components/PendingRecommendations";
import { errorMessage, request } from "../../src/lib/api";
import { formatMoney } from "../../src/lib/format";
import type { BusinessSummary } from "../../src/lib/types";
import { useLoad } from "../../src/lib/useLoad";
import { GUTTER, colors, radius, spacing, sz } from "../../src/theme";

// Réplica de VistaInicio de Founder Web: logo de 36 + botón de cuenta de 40, tarjeta cuadrada de
// hasta 360 con el carrusel Ventas / Clientes / Productos y dos mosaicos cuadrados (Estrategia, Reto diario).
const CARD_MAX = 360;

function Tile({ icon, title, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [styles.tile, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <Ionicons name={icon} size={sz(24)} color={colors.text} />
      <AppText variant="small" style={{ marginTop: spacing.md, fontFamily: "sans-serif-medium", fontSize: sz(13) }}>{title}</AppText>
    </Pressable>
  );
}

function dailyCounts(items?: Array<{ date: string; count: number }>) {
  return [...(items ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-30).map((item) => item.count);
}

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data, error, loading, reload, refresh, refreshing } = useLoad(() => request<BusinessSummary>("/api/business/summary"));
  const [slide, setSlide] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const cardSize = Math.min(CARD_MAX, width - GUTTER * 2);
  const innerWidth = cardSize - 2 * sz(20);
  const currency = data?.currencies?.[0]?.currency ?? data?.dailySales?.[0]?.currency ?? "USD";

  const slides = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const sale of (data?.dailySales ?? []).filter((s) => s.currency === currency)) {
      const day = sale.date.slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + Number(sale.amount));
    }
    const sales = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([, value]) => value);
    const month = data?.currencies?.length ? `${data.currencies.map((row) => formatMoney(row.amount, row.currency)).join(" · ")} este mes` : "Sin ventas este mes";
    return [
      { title: "Ventas", caption: month, series: sales, label: "Gráfica de ventas registradas" },
      { title: "Clientes", caption: `${(data?.customers ?? 0).toLocaleString("es")} registrados`, series: dailyCounts(data?.dailyCustomers), label: "Evolución de registros de clientes en los últimos 30 días" },
      { title: "Productos", caption: `${(data?.products ?? 0).toLocaleString("es")} registrados`, series: dailyCounts(data?.dailyProducts), label: "Evolución de registros de productos en los últimos 30 días" },
    ];
  }, [data, currency]);

  const goTo = (index: number) => {
    scroller.current?.scrollTo({ x: innerWidth * index, animated: true });
    setSlide(index);
  };

  return (
    <Screen scroll onRefresh={refresh} refreshing={refreshing} edges={["top"]} contentStyle={styles.content}>
      <View style={styles.header}>
        <Image source={require("../../assets/icon.png")} style={styles.brandMark} accessibilityLabel="Logo de Founder" />
        <Pressable onPress={() => router.push("/cuenta")} hitSlop={6} style={({ pressed }) => [styles.profileButton, { opacity: pressed ? 0.7 : 1 }]} accessibilityRole="button" accessibilityLabel="Abrir cuenta">
          <Ionicons name="person-circle-outline" size={19} color={colors.text} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing.md }}><PendingRecommendations /></View>

      <View style={styles.body}>
      <View style={{ alignItems: "center" }}>
        <View style={[styles.card, { width: cardSize, height: cardSize }]}>
          {loading ? <LoadingState label="Cargando resumen…" /> : error ? <ErrorState error={error} message={errorMessage(error)} onRetry={reload} /> : (
            <>
              <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flex: 1 }} onMomentumScrollEnd={(e) => setSlide(Math.min(2, Math.round(e.nativeEvent.contentOffset.x / innerWidth)))}>
                {slides.map((item) => (
                  <View key={item.title} style={{ width: innerWidth }}>
                    <AppText style={styles.slideTitle}>{item.title}</AppText>
                    {item.title !== "Ventas" ? <AppText variant="small" color={colors.textMuted} style={{ textAlign: "center" }}>{item.caption}</AppText> : null}
                    <View style={{ flex: 1, paddingTop: spacing.sm, justifyContent: "center" }}>
                      {item.series.length ? <LineChart values={item.series} label={item.label} /> : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><AppText variant="small" color={colors.textMuted}>Sin registros recientes</AppText></View>}
                    </View>
                    {item.title === "Ventas" ? <AppText variant="caption" color={colors.textMuted} style={{ textAlign: "center" }}>{item.caption}</AppText> : null}
                  </View>
                ))}
              </ScrollView>
              <View style={styles.dots} accessibilityRole="tablist">
                {slides.map((item, index) => (
                  <Pressable key={item.title} onPress={() => goTo(index)} hitSlop={8} accessibilityRole="tab" accessibilityLabel={`Mostrar gráfica de ${item.title.toLowerCase()}`} accessibilityState={{ selected: slide === index }}>
                    <View style={[styles.dot, slide === index ? styles.dotActive : null]} />
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
      </View>

      <View style={styles.tiles}>
        <Tile icon="locate-outline" title="Estrategia" onPress={() => router.push("/estrategia")} />
        <Tile icon="flame-outline" title="Reto diario" onPress={() => router.push("/estrategia")} />
      </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingBottom: spacing.xl },
  // El bloque de tarjetas ocupa el espacio bajo la cabecera y se centra vertical y horizontalmente;
  // en pantallas bajas el contenido simplemente se desplaza.
  body: { flex: 1, justifyContent: "center", alignSelf: "stretch", paddingTop: spacing.lg, paddingBottom: sz(28) },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandMark: { width: sz(36), height: sz(36), borderRadius: sz(18), backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  profileButton: { width: sz(40), height: sz(40), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: sz(23), borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: sz(20), paddingTop: sz(20), paddingBottom: sz(12), overflow: "hidden" },
  slideTitle: { fontFamily: "sans-serif-medium", fontSize: sz(18), lineHeight: sz(24), textAlign: "center", color: colors.text, marginBottom: sz(4) },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, paddingTop: sz(10) },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dot },
  dotActive: { width: 19, backgroundColor: colors.coral },
  tiles: { flexDirection: "row", gap: sz(14), marginTop: sz(14) },
  tile: { flex: 1, aspectRatio: 1, borderRadius: sz(23), borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
});
