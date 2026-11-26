import { View } from "react-native";
import { VoiceCall } from "../src/components/VoiceCall";
import { UI_PREVIEW } from "../src/lib/config";

// Solo CI (EXPO_PUBLIC_UI_PREVIEW=1): abre la llamada de voz REAL (micrófono, WebRTC, altavoz) contra el
// servidor de prueba del emulador, para medir que el audio viaja en los dos sentidos.
export default function PreviewCall() {
  if (!UI_PREVIEW) return null;
  return (
    <View style={{ flex: 1 }}>
      <VoiceCall onClose={() => undefined} />
    </View>
  );
}
