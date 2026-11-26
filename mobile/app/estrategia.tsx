import { useState } from "react";
import { View } from "react-native";
import { Button, Input, AppText, Screen } from "../src/components/ui";
import { ApiError, errorMessage, request } from "../src/lib/api";
import type { StrategyResult } from "../src/lib/types";
import { colors, spacing } from "../src/theme";

function Block({ title, children }: { title: string; children: string }) {
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      <AppText variant="body" style={{ marginTop: spacing.sm }} selectable>
        {children}
      </AppText>
    </View>
  );
}

export default function StrategyScreen() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<StrategyResult | null>(null);

  async function analyze() {
    const text = input.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await request<{ result: StrategyResult }>("/api/strategist", { method: "POST", body: { input: text }, timeoutMs: 70000 });
      setResult(data.result);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  const offline = error instanceof ApiError && error.kind === "network";

  return (
    <Screen scroll keyboard edges={["bottom"]}>
      {result ? (
        <View>
          <Block title="El problema">{result.problema}</Block>
          <Block title="La oportunidad">{result.oportunidad}</Block>
          <Block title="La estrategia">{result.estrategia}</Block>
          {result.proximos_pasos.length > 0 ? (
            <View style={{ marginBottom: spacing.xl }}>
              <AppText variant="title" accessibilityRole="header">
                Próximos pasos
              </AppText>
              {result.proximos_pasos.map((step, index) => (
                <View key={index} style={{ flexDirection: "row", marginTop: spacing.md }}>
                  <AppText variant="bodyStrong" color={colors.coral} style={{ width: 28 }}>
                    {index + 1}.
                  </AppText>
                  <AppText variant="body" style={{ flex: 1 }} selectable>
                    {step}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
          <AppText variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.lg }}>
            Es un análisis generado por IA a partir de lo que escribiste. Contrástalo con tu propio criterio y con datos reales de tu mercado.
          </AppText>
          <Button title="Nuevo análisis" variant="secondary" onPress={() => { setResult(null); setInput(""); }} />
        </View>
      ) : (
        <View>
          <AppText variant="display" accessibilityRole="header">
            Analiza tu idea
          </AppText>
          <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm, marginBottom: spacing.xl }}>
            Cuéntale a Founder tu idea, tu situación o el problema que quieres resolver. Recibirás un diagnóstico, una oportunidad y próximos pasos.
          </AppText>
          <Input
            label="Tu idea o problema"
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={12000}
            placeholder="Por ejemplo: vendo postres artesanales por encargo y quiero llegar a más clientes…"
            style={{ minHeight: 160 }}
          />
          {error ? (
            <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>
              {offline ? "Sin conexión. Revisa tu internet e inténtalo de nuevo." : errorMessage(error)}
            </AppText>
          ) : null}
          <Button title={loading ? "Analizando…" : "Analizar"} onPress={analyze} loading={loading} disabled={!input.trim()} />
          {loading ? (
            <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.md }} accessibilityLiveRegion="polite">
              Esto puede tardar hasta un minuto.
            </AppText>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
