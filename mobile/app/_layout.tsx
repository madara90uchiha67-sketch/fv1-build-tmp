import { useEffect } from "react";
import { Appearance } from "react-native";
import { Stack, useGlobalSearchParams, usePathname, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../src/lib/session";
import { errorMessage } from "../src/lib/api";
import { ErrorState } from "../src/components/states";
import { Screen } from "../src/components/ui";
import { colors, fonts, themeName } from "../src/theme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Los diálogos del sistema (alertas) siguen el tema elegido en Founder.
try { Appearance.setColorScheme(themeName); } catch { /* sin efecto */ }

const headerOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  headerTitleStyle: { fontFamily: fonts.sansSemibold, fontSize: 15 },
  headerBackTitle: "Atrás",
} as const;

type RouteParams = Record<string, string | string[] | undefined>;

function requestedLocalPath(pathname: string, params: RouteParams): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return "/";
  const query = Object.entries(params)
    .filter(([key, value]) => key !== "callbackUrl" && value !== undefined)
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value as string]).map((item) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`))
    .join("&");
  return query ? `${pathname}?${query}` : pathname;
}

function safeCallbackUrl(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return "/";
  return value;
}

function Gate() {
  const { status, bootError, retryBoot } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams() as RouteParams;

  useEffect(() => {
    if (status !== "loading") SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);

  useEffect(() => {
    const inAuthGroup = segments[0] === "(auth)";
    if (status === "anon" && !inAuthGroup) {
      const callbackUrl = requestedLocalPath(pathname, params);
      router.replace(callbackUrl === "/" ? "/login" : (`/login?callbackUrl=${encodeURIComponent(callbackUrl)}` as Href));
    } else if (status === "auth" && inAuthGroup) {
      const destination = pathname === "/login" ? safeCallbackUrl(params.callbackUrl) : "/";
      router.replace(destination as Href);
    }
  }, [status, segments, router, pathname, params]);

  if (status === "loading") return null;
  if (status === "error") {
    return (
      <Screen>
        <ErrorState error={bootError} message={errorMessage(bootError)} onRetry={retryBoot} />
      </Screen>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="estrategia" options={{ ...headerOptions, title: "Estrategia" }} />
      <Stack.Screen name="historial" options={{ ...headerOptions, title: "Historial de chats" }} />
      <Stack.Screen name="negocio/formulario" options={{ ...headerOptions, title: "Registro" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    InstrumentSerif_400Regular,
  });

  // Si las fuentes no cargan, la app sigue funcionando con la tipografía del sistema.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style={themeName === "light" ? "dark" : "light"} />
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
