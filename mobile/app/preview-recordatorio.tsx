import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { scheduleReminder, scheduledReminderIds } from "../modules/founder-reminders";
import { UI_PREVIEW } from "../src/lib/config";
import { formatWhen, reminderBody, reminderTitle } from "../src/lib/notes-logic";

// Solo para la prueba en emulador (CI, EXPO_PUBLIC_UI_PREVIEW=1): programa por el mismo camino nativo que usa
// Notas un aviso que llega en 25 segundos, para comprobar que Android lo entrega con la app cerrada.
export default function PreviewReminder() {
  const [status, setStatus] = useState("programando");
  useEffect(() => {
    if (!UI_PREVIEW) return;
    const at = Date.now() + 25_000;
    const body = reminderBody({
      title: "Reunión con inversionistas",
      whenText: formatWhen(new Date(at + 86_400_000)),
      leadMinutes: 1440,
      steps: ["Preparar la presentación de la empresa", "Organizar las cifras del negocio", "Preparar las preguntas del inversionista"],
    });
    const ok = scheduleReminder("ci-prueba", at, reminderTitle(1440), body);
    setStatus(ok ? `recordatorio-programado (${scheduledReminderIds().length})` : "recordatorio-fallo");
  }, []);
  if (!UI_PREVIEW) return null;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
      <Text style={{ color: "#fff" }}>{status}</Text>
    </View>
  );
}
