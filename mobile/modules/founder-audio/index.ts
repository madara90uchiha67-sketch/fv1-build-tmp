import { requireOptionalNativeModule } from "expo-modules-core";

// Módulo nativo local (Android): enruta el audio de la llamada de voz al altavoz.
// Es opcional: si no está disponible (p. ej. en Expo Go), la llamada sigue funcionando.
type FounderAudioNative = { setSpeakerphoneOn(on: boolean): boolean; reset(): boolean; setKeepScreenOn(on: boolean): boolean };
const native = requireOptionalNativeModule<FounderAudioNative>("FounderAudio");

export function setSpeakerphoneOn(on: boolean): boolean {
  try { return native?.setSpeakerphoneOn(on) ?? false; } catch { return false; }
}

export function resetAudioRoute(): void {
  try { native?.reset(); } catch { /* sin efecto */ }
}

export function setKeepScreenOn(on: boolean): boolean {
  try { return native?.setKeepScreenOn(on) ?? false; } catch { return false; }
}
