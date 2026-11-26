import { useRef, useState } from "react";
import { Pressable, View, type TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { AuthShell } from "../../src/components/AuthShell";
import { AppText, Button, Input } from "../../src/components/ui";
import { errorMessage } from "../../src/lib/api";
import { LEGAL_LINKS } from "../../src/lib/config";
import { openUrl } from "../../src/lib/links";
import { useSession } from "../../src/lib/session";
import { MIN_TOUCH, colors, spacing } from "../../src/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const { signUp } = useSession();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (loading) return;
    const cleanEmail = email.trim();
    if (!EMAIL_RE.test(cleanEmail)) return setError("Introduce un correo válido.");
    if (password.length < 8 || password.length > 128) return setError("La contraseña debe tener entre 8 y 128 caracteres.");
    if (!agreed) return setError("Debes aceptar los Términos y la Política de Privacidad.");
    setLoading(true);
    setError(null);
    try {
      await signUp({ name, email: cleanEmail, password });
    } catch (e) {
      setError(errorMessage(e));
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Crea tu cuenta" subtitle="Empieza a trabajar tu negocio con Founder.">
      <Input
        label="Nombre (opcional)"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        textContentType="name"
        maxLength={80}
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        light
      />
      <Input
        ref={emailRef}
        label="Correo"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        light
      />
      <Input
        ref={passwordRef}
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        hint="Mínimo 8 caracteres."
        returnKeyType="done"
        light
      />

      <Pressable
        onPress={() => setAgreed((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        accessibilityLabel="Acepto los Términos y la Política de Privacidad"
        style={{ flexDirection: "row", alignItems: "center", minHeight: MIN_TOUCH, marginBottom: spacing.sm }}
      >
        <Ionicons name={agreed ? "checkbox" : "square-outline"} size={24} color={agreed ? colors.authText : colors.authMuted} />
        <AppText variant="small" color={colors.authMuted} style={{ flex: 1, marginLeft: spacing.md }}>
          Acepto los{" "}
          <AppText variant="small" color={colors.authText} style={{ textDecorationLine: "underline" }} onPress={() => openUrl(LEGAL_LINKS.terminos)}>
            Términos
          </AppText>{" "}
          y la{" "}
          <AppText variant="small" color={colors.authText} style={{ textDecorationLine: "underline" }} onPress={() => openUrl(LEGAL_LINKS.privacidad)}>
            Política de Privacidad
          </AppText>
          .
        </AppText>
      </Pressable>

      {error ? (
        <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>
          {error}
        </AppText>
      ) : null}

      <Button title="Crear cuenta" variant="authPrimary" onPress={submit} loading={loading} />

      <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
        <Link href="/login" accessibilityRole="link" style={{ minHeight: MIN_TOUCH, paddingVertical: spacing.md }}>
          <AppText variant="small" color={colors.authMuted}>
            ¿Ya tienes cuenta? <AppText variant="small" color={colors.authText} style={{ textDecorationLine: "underline" }}>Inicia sesión</AppText>
          </AppText>
        </Link>
      </View>
    </AuthShell>
  );
}
