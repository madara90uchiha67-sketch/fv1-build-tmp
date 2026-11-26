import { Image, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppText } from "./ui";
import { colors, radius, spacing, sz } from "../theme";

// Cabecera de las vistas de Founder Web (ContenedorVista): logo circular de 42, botón de cuenta de 40
// con radio 13 y el título de la vista debajo (alineado a la izquierda, o centrado en Negocio y Notas).
export function ReferenceHeader({ title, centered = false }: { title: string; centered?: boolean }) {
  const router = useRouter();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xl }}>
        <Image source={require("../../assets/icon.png")} style={{ width: sz(42), height: sz(42), borderRadius: sz(21), backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }} accessibilityLabel="Logo de Founder" />
        <Pressable onPress={() => router.push("/cuenta")} hitSlop={6} style={({ pressed }) => ({ width: sz(40), height: sz(40), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })} accessibilityRole="button" accessibilityLabel="Abrir cuenta">
          <Ionicons name="person-circle-outline" size={19} color={colors.text} />
        </Pressable>
      </View>
      <AppText variant="title" accessibilityRole="header" style={centered ? { textAlign: "center" } : undefined}>{title}</AppText>
    </View>
  );
}
