import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, sz } from "../../src/theme";

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(active: IconName, inactive: IconName) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? active : inactive} size={19} color={color} />;
  };
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, sz(6));
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarAllowFontScaling: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, borderTopWidth: 1, height: sz(54) + bottom, paddingBottom: bottom, paddingTop: sz(6) },
        tabBarItemStyle: { paddingTop: 0 },
        tabBarIconStyle: { marginBottom: -1 },
        tabBarLabelStyle: { fontFamily: fonts.sans, fontSize: sz(10.5), lineHeight: sz(14), marginTop: sz(2) },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Inicio", tabBarIcon: tabIcon("home", "home-outline") }} />
      <Tabs.Screen name="negocio" options={{ title: "Negocio", tabBarIcon: tabIcon("briefcase", "briefcase-outline") }} />
      <Tabs.Screen name="chat" options={{ title: "Chat", tabBarIcon: tabIcon("chatbubble-ellipses", "chatbubble-ellipses-outline") }} />
      <Tabs.Screen name="laboratorio" options={{ title: "Laboratorio", tabBarIcon: tabIcon("flask", "flask-outline") }} />
      <Tabs.Screen name="notas" options={{ title: "Notas", tabBarIcon: tabIcon("document-text", "document-text-outline") }} />
      <Tabs.Screen name="cuenta" options={{ href: null }} />
    </Tabs>
  );
}
