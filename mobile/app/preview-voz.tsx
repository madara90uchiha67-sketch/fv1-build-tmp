import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { VoiceCallView } from "../src/components/VoiceCall";
import { UI_PREVIEW } from "../src/lib/config";
import { initialVoiceState } from "../src/lib/realtime-events";

// Pantalla de verificación visual de la llamada de voz (solo existe con EXPO_PUBLIC_UI_PREVIEW=1).
const noop = () => {};
const PHASES = ["connecting", "listening", "user_speaking", "thinking", "speaking", "error"] as const;

export default function PreviewVoice() {
  const { phase: phaseParam } = useLocalSearchParams<{ phase?: string }>();
  if (!UI_PREVIEW) return null;
  const phase = PHASES.find((p) => p === phaseParam) ?? "speaking";
  const voice = {
    ...initialVoiceState,
    phase,
    lines: [
      { id: "u1", role: "user" as const, text: "¿Cómo puedo mejorar mis ventas este mes?", final: true },
      { id: "a1", role: "assistant" as const, text: "Empieza por tus clientes actuales: contacta a los cinco mejores y ofréceles una recompra con una condición clara.", final: false },
    ],
  };
  return (
    <View style={{ flex: 1 }}>
      <VoiceCallView voice={voice} error={phase === "error" ? { message: "La llamada se desconectó. (código: ice_failed)" } : null} muted={false} levels={{ mic: 0.1, out: 0.3 }} toggleMute={noop} interrupt={noop} retry={noop} openSettings={noop} onClose={noop} />
    </View>
  );
}
