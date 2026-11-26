import { requireOptionalNativeModule } from "expo-modules-core";

// Módulo nativo local (Android): reconocimiento de voz en el dispositivo y voz del sistema, sin servicios de pago.
// Es opcional: si no está disponible (p. ej. en Expo Go), las funciones devuelven false y la voz no arranca.

export type SpeechEvents = {
  onReady: { onDevice: boolean };
  onBegin: Record<string, never>;
  onEnd: Record<string, never>;
  onPartial: { text: string };
  onResult: { text: string; onDevice: boolean };
  onError: { code: number; name: string; onDevice: boolean };
  onLevel: { db: number };
  onSpeakStart: { id: string };
  onSpeakDone: { id: string; stopped: boolean };
  onSpeakError: { id: string; code: number };
  onVoices: { voices: string[] };
  onSupport: { available: boolean; installed: string[]; supported: string[]; pending: string[]; error: number };
};

type Subscription = { remove(): void };

type FounderSpeechNative = {
  isOnDeviceAvailable(): boolean;
  isSystemRecognizerAvailable(): boolean;
  startListening(lang: string, onDevice: boolean): boolean;
  stopListening(): boolean;
  cancelListening(): boolean;
  downloadModel(lang: string): boolean;
  checkSupport(lang: string): boolean;
  speak(text: string, id: string, pitch: number, rate: number): boolean;
  stopSpeaking(): boolean;
  getSpanishVoices(): string[];
  warmUp(): boolean;
  getVoice(): string | null;
  setVoice(name: string): boolean;
  addListener<K extends keyof SpeechEvents>(event: K, listener: (payload: SpeechEvents[K]) => void): Subscription;
};

const native = requireOptionalNativeModule<FounderSpeechNative>("FounderSpeech");

export const speechAvailable = native != null;

export function onSpeech<K extends keyof SpeechEvents>(event: K, listener: (payload: SpeechEvents[K]) => void): () => void {
  if (!native) return () => undefined;
  const sub = native.addListener(event, listener);
  return () => sub.remove();
}

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export const speech = {
  isOnDeviceAvailable: () => safe(() => native?.isOnDeviceAvailable() ?? false, false),
  isSystemRecognizerAvailable: () => safe(() => native?.isSystemRecognizerAvailable() ?? false, false),
  startListening: (lang: string, onDevice: boolean) => safe(() => native?.startListening(lang, onDevice) ?? false, false),
  stopListening: () => safe(() => native?.stopListening() ?? false, false),
  cancelListening: () => safe(() => native?.cancelListening() ?? false, false),
  downloadModel: (lang: string) => safe(() => native?.downloadModel(lang) ?? false, false),
  checkSupport: (lang: string) => safe(() => native?.checkSupport(lang) ?? false, false),
  speak: (text: string, id: string, pitch: number, rate: number) => safe(() => native?.speak(text, id, pitch, rate) ?? false, false),
  stopSpeaking: () => safe(() => native?.stopSpeaking() ?? false, false),
  warmUp: () => safe(() => native?.warmUp() ?? false, false),
  getSpanishVoices: () => safe(() => native?.getSpanishVoices() ?? [], [] as string[]),
  getVoice: () => safe(() => native?.getVoice() ?? null, null as string | null),
  setVoice: (name: string) => safe(() => native?.setVoice(name) ?? false, false),
};
