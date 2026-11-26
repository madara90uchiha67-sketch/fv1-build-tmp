import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { UI_PREVIEW } from "../src/lib/config";
import { recordRecommendation } from "../src/lib/reminders";
import type { BusinessNote } from "../src/lib/types";

// Solo CI (EXPO_PUBLIC_UI_PREVIEW=1): guarda dos recomendaciones ya vencidas por el mismo camino que usa Notas
// (almacén nativo del teléfono) para comprobar que aparecen al entrar, sobreviven al cierre, Chat y Ignorar.
export default function PreviewRecommendations() {
  const [status, setStatus] = useState("sembrando");
  useEffect(() => {
    if (!UI_PREVIEW) return;
    const now = Date.now();
    const mk = (id: string, title: string, content: string, steps: string[]): BusinessNote => ({
      id, title, content, noteDate: new Date(now + 3_600_000).toISOString(), timeZone: "UTC",
      reminderLeadMinutes: 60, reminderAt: new Date(now - 60_000).toISOString(),
    } as BusinessNote);
    recordRecommendation("demo", mk("ci-a", "Reunión con inversionistas", "Presentar la ronda semilla y las cifras del trimestre", ["Preparar la presentación de la empresa", "Organizar las cifras del negocio"]), ["Preparar la presentación de la empresa", "Organizar las cifras del negocio"]);
    recordRecommendation("demo", mk("ci-b", "Lanzamiento de campaña", "Oferta de apertura para clientes actuales", ["Definir el público de la oferta", "Escribir el mensaje principal"]), ["Definir el público de la oferta", "Escribir el mensaje principal"]);
    setStatus("recs-sembradas");
  }, []);
  if (!UI_PREVIEW) return null;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
      <Text style={{ color: "#fff" }}>{status}</Text>
    </View>
  );
}
