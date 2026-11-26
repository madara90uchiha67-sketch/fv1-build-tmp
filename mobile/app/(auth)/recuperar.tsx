import { useRef, useState } from "react";
import { View, type TextInput } from "react-native";
import { Link } from "expo-router";
import { AuthShell } from "../../src/components/AuthShell";
import { AppText, Button, Input } from "../../src/components/ui";
import { errorMessage, request } from "../../src/lib/api";
import { MIN_TOUCH, colors, spacing } from "../../src/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RecoverScreen() {
  const codeRef = useRef<TextInput>(null);
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestCode() {
    if (loading) return;
    if (!EMAIL_RE.test(email.trim())) return setError("Introduce un correo válido.");
    setLoading(true);
    setError(null);
    try {
      const data = await request<{ message?: string }>("/api/auth/forgot-password", { method: "POST", auth: false, body: { email: email.trim() } });
      setInfo(data.message ?? "Si existe una cuenta con ese correo, recibirás un código de recuperación.");
      setStep("code");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    if (loading) return;
    if (!/^\d{6}$/.test(code.trim())) return setError("El código debe tener 6 dígitos.");
    if (password.length < 8 || password.length > 128) return setError("La contraseña debe tener entre 8 y 128 caracteres.");
    if (password !== confirmPassword) return setError("Las contraseñas no coinciden.");
    setLoading(true);
    setError(null);
    try {
      await request("/api/auth/reset-password", { method: "POST", auth: false, body: { email: email.trim(), code: code.trim(), password } });
      setPassword("");
      setConfirmPassword("");
      setStep("done");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={step === "done" ? "Contraseña actualizada" : "Recupera tu acceso"}
      subtitle={
        step === "email"
          ? "Te enviaremos un código de 6 dígitos a tu correo."
          : step === "code"
            ? "Escribe el código que recibiste y elige una contraseña nueva."
            : "Ya puedes iniciar sesión con tu nueva contraseña."
      }
    >
      {step === "email" ? (
        <>
          <Input
            label="Correo"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={requestCode}
            error={error}
            light
          />
          <Button title="Enviar código" onPress={requestCode} loading={loading} />
        </>
      ) : null}

      {step === "code" ? (
        <>
          {info ? (
            <AppText variant="small" color={colors.textMuted} style={{ marginBottom: spacing.lg }}>
              {info}
            </AppText>
          ) : null}
          <Input
            ref={codeRef}
            label="Código de 6 dígitos"
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            light
          />
          <Input
            label="Contraseña nueva"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            hint="Mínimo 8 caracteres."
            returnKeyType="done"
            onSubmitEditing={resetPassword}
            light
          />
          <Input
            label="Confirma la contraseña"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={resetPassword}
            error={error}
            light
          />
          <Button title="Cambiar contraseña" onPress={resetPassword} loading={loading} />
          <Button title="Pedir otro código" variant="ghost" onPress={() => { setStep("email"); setError(null); setCode(""); setPassword(""); setConfirmPassword(""); }} style={{ marginTop: spacing.sm }} />
        </>
      ) : null}

      <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
        <Link href="/login" accessibilityRole="link" style={{ minHeight: MIN_TOUCH, paddingVertical: spacing.md }}>
          <AppText variant="bodyStrong" color={colors.authText} style={{ textDecorationLine: "underline" }}>
            Volver a iniciar sesión
          </AppText>
        </Link>
      </View>
    </AuthShell>
  );
}
