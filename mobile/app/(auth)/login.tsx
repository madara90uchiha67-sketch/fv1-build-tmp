import { useRef, useState } from "react";
import { Pressable, View, type TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { AuthShell } from "../../src/components/AuthShell";
import { AppText, Button, Input } from "../../src/components/ui";
import { errorMessage } from "../../src/lib/api";
import { useSession } from "../../src/lib/session";
import { MIN_TOUCH, colors, spacing, sz } from "../../src/theme";

export default function LoginScreen() {
  const { signIn } = useSession();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (loading) return;
    if (!email.trim() || !password) {
      setError("Escribe tu correo y tu contraseña.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(errorMessage(e));
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Founder" subtitle="Estrategia para emprendedores. Inicia sesión para continuar.">
      <Input
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
        placeholder="tu@correo.com"
        light
      />
      <View>
        <Input
          ref={passwordRef}
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          error={error}
          light
          style={{ paddingRight: MIN_TOUCH + spacing.sm }}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          style={{ position: "absolute", right: 4, top: 20, width: MIN_TOUCH, height: sz(44), alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <Button title="Entrar" variant="authPrimary" onPress={submit} loading={loading} />

      <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
        <Link href="/recuperar" accessibilityRole="link" style={{ minHeight: MIN_TOUCH, paddingVertical: spacing.md }}>
          <AppText variant="small" color={colors.authMuted}>
            ¿Olvidaste tu contraseña?
          </AppText>
        </Link>
        <Link href="/registro" accessibilityRole="link" style={{ minHeight: MIN_TOUCH, paddingVertical: spacing.md }}>
          <AppText variant="body" color={colors.authText}>
            ¿No tienes cuenta? <AppText variant="body" color={colors.authText} style={{ textDecorationLine: "underline" }}>Regístrate</AppText>
          </AppText>
        </Link>
      </View>
    </AuthShell>
  );
}
