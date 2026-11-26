// URL pública del backend. No es un secreto. Se puede cambiar con EXPO_PUBLIC_API_URL (ver .env.example).
// El valor por defecto es el dominio que ya usa el repositorio web (biblioteca/sitio.ts).
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://yamaai.vercel.app").replace(/\/+$/, "");

// Contacto que ya usa la app web (biblioteca/creador.ts). Confírmalo antes de publicar en tienda.
export const SUPPORT_EMAIL = "soporte@example.com";

// WhatsApp de feedback que ya usa «Enviar feedback» en Founder Web.
export const FEEDBACK_URL = "https://wa.me/570000000000?text=Hola%2C%20quiero%20reportar%20algo%20sobre%20Founder%3A%20";

export const LEGAL_LINKS = {
  terminos: `${API_URL}/legal/terminos`,
  privacidad: `${API_URL}/legal/privacidad`,
  cookies: `${API_URL}/legal/cookies`,
  eliminarCuenta: `${API_URL}/account-deletion`,
} as const;

// Solo para comprobar el diseño en un emulador (CI): sin cuenta ni red, con datos de ejemplo.
// El APK que se entrega se compila SIN esta variable, por lo que esta rama del código nunca se activa.
export const UI_PREVIEW = process.env.EXPO_PUBLIC_UI_PREVIEW === "1";

// Solo CI (compilación preview): dirección de un servidor de prueba que imita a OpenAI Realtime por WebRTC,
// para comprobar en un emulador que el audio viaja de verdad. Sin esta variable la llamada usa siempre OpenAI.
export const VOICE_TEST_BASE = UI_PREVIEW ? (process.env.EXPO_PUBLIC_VOICE_TEST_BASE || "") : "";
