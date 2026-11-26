import { Dimensions } from "react-native";
import { restartApp, uiGet, uiSet } from "../modules/founder-reminders";

// Tokens tomados de app/globals.css de Founder Web (tema oscuro, que es el predeterminado de la web).
// Web → nativo: 1 px CSS = 1 dp. Los tamaños de texto, radios y espacios de abajo son los de la web
// (texto 10–14, títulos 19–30, radios 13–19), no una reducción porcentual de otra escala.
// Los dos temas de Founder Web (app/globals.css: data-theme="dark" y data-theme="light").
const DARK = {
  bg: "#050505", //          --yama-bg
  page: "#000000", //        --yama-page
  surface: "#101010", //     --yama-surface
  surfaceHigh: "#171717", // --yama-elevated
  line: "rgba(255,255,255,0.10)", // --yama-line
  lineStrong: "rgba(255,255,255,0.18)",
  text: "#F5F4F1", //       --yama-ink
  textMuted: "#858585", //   --yama-muted
  textFaint: "#6A6A6A",
  coral: "#F5F4F1", //       --yama-accent (botón primario)
  coralInk: "#090909", //    --yama-accent-ink
  coralSoft: "rgba(255,255,255,0.06)",
  danger: "#FF9E86", //      --yama-danger
  overlay: "rgba(0,0,0,0.55)",
  grid: "rgba(255,255,255,0.08)", // --yama-grid
  dot: "#595959", //         punto inactivo del carrusel
};
const LIGHT: typeof DARK = {
  bg: "#F2F2F7",
  page: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceHigh: "#E5E5EA",
  line: "rgba(29,29,31,0.18)",
  lineStrong: "rgba(29,29,31,0.30)",
  text: "#1D1D1F",
  textMuted: "#5F6368",
  textFaint: "#6B7075",
  coral: "#1D1D1F",
  coralInk: "#FFFFFF",
  coralSoft: "rgba(29,29,31,0.06)",
  danger: "#B42318",
  overlay: "rgba(0,0,0,0.35)",
  grid: "rgba(29,29,31,0.14)",
  dot: "#B5B8BD",
};

export type ThemeName = "dark" | "light";

/** Tema guardado en el teléfono (archivo propio, sobrevive a cerrar la app y a cerrar sesión). */
function readTheme(): ThemeName {
  return uiGet("theme") === "light" ? "light" : "dark";
}
export const themeName: ThemeName = readTheme();
const palette = themeName === "light" ? LIGHT : DARK;

// Los estilos de toda la app se crean al arrancar con estos valores; por eso cambiar de tema guarda la
// elección y reinicia la app (ver setTheme), en vez de intentar repintar estilos ya creados.
export const colors = {
  ...palette,
  // Alias de las pantallas de acceso: comparten el tema de la web.
  authBg: palette.bg,
  authSurface: palette.surface,
  authText: palette.text,
  authMuted: palette.textMuted,
  authLine: palette.line,
  authButton: palette.coral,
};

/** Guarda el tema y reinicia la app para aplicarlo en todas las pantallas. Devuelve false si no pudo reiniciar. */
export function setTheme(name: ThemeName): boolean {
  if (name === themeName) return true;
  if (!uiSet("theme", name)) return false;
  return restartApp();
}

// --- Sistema de tamaños adaptable ------------------------------------------------------
// Referencia de diseño: 390 dp de ancho (el viewport móvil con el que se diseñó la web). El factor se
// acota a 0,92–1,08 y se aplica a la mitad, para que un teléfono estrecho o ancho varíe pocos dp
// y nada se desborde. No es una reducción porcentual global: los valores base ya son los de la web.
const REFERENCE_WIDTH = 390;
const { width: W, height: H } = Dimensions.get("window");
const shortSide = Math.min(W, H);
const raw = shortSide / REFERENCE_WIDTH;
const factor = 1 + (Math.min(1.08, Math.max(0.92, raw)) - 1) * 0.5;

/** Escala un valor en dp según el ancho del teléfono (suave y acotada). */
export const sz = (value: number): number => Math.round(value * factor * 2) / 2;

/** Tope para el tamaño de fuente del sistema (Ajustes → Tamaño de fuente): evita que el texto crezca sin control. */
export const MAX_FONT_SCALE = 1.15;

export const spacing = { xs: sz(4), sm: sz(8), md: sz(12), lg: sz(16), xl: sz(20), xxl: sz(28), huge: sz(40) } as const;
export const radius = { sm: sz(9), md: sz(13), lg: sz(18), pill: 999 } as const;

// Zona táctil: el control se dibuja compacto y se amplía con hitSlop hasta 48 dp.
export const MIN_TOUCH = 44;
export const GUTTER = sz(20); // margen lateral de pantalla (web: padding 0 20px)

export const fonts = {
  serif: "sans-serif", // la web usa la sans del sistema también en títulos
  sans: "sans-serif",
  sansMedium: "sans-serif-medium",
  sansSemibold: "sans-serif-medium",
} as const;

export type TextVariant = "display" | "title" | "heading" | "body" | "bodyStrong" | "small" | "caption" | "label";

export const typography: Record<TextVariant, { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number }> = {
  display: { fontFamily: fonts.sans, fontSize: sz(29), lineHeight: sz(32), letterSpacing: -1 }, // cifras grandes de métricas (web 29)
  title: { fontFamily: fonts.sans, fontSize: sz(28), lineHeight: sz(31), letterSpacing: -0.9 }, //  títulos de pantalla (web 30 con clamp)
  heading: { fontFamily: fonts.sansSemibold, fontSize: sz(15), lineHeight: sz(20) },
  body: { fontFamily: fonts.sans, fontSize: sz(14), lineHeight: sz(20) }, //  web 14
  bodyStrong: { fontFamily: fonts.sansMedium, fontSize: sz(14), lineHeight: sz(20) },
  small: { fontFamily: fonts.sans, fontSize: sz(12), lineHeight: sz(17) }, //  web 12
  caption: { fontFamily: fonts.sans, fontSize: sz(10.5), lineHeight: sz(14) }, // web 10–10.5
  label: { fontFamily: fonts.sansMedium, fontSize: sz(10), lineHeight: sz(14), letterSpacing: 1.2 },
};
