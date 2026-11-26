import type { ReactNode } from "react";
import { Image, View } from "react-native";
import { GUTTER, colors, radius, spacing } from "../theme";
import { AppText, Screen } from "./ui";

// Marco común de inicio de sesión, registro y recuperación.
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Screen scroll keyboard edges={["top", "bottom"]} backgroundColor={colors.authBg} contentStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: GUTTER, paddingVertical: spacing.xl }}>
      <View style={{ width: "100%", padding: spacing.xl, borderRadius: radius.lg + 1, borderWidth: 1, borderColor: colors.authLine, backgroundColor: colors.authSurface }}>
        <Image
          source={require("../../assets/icon.png")}
          accessibilityLabel="Logotipo de Founder"
          style={{ width: 42, height: 42, borderRadius: 21, marginBottom: spacing.md, backgroundColor: colors.authSurface }}
        />
        <AppText variant="title" color={colors.authText} accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="small" color={colors.authMuted} style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}>
          {subtitle}
        </AppText>
        <View>
          {children}
        </View>
      </View>
    </Screen>
  );
}
