import { useEffect, useState, type ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";
import { UI_PREVIEW } from "../../src/lib/config";
import { Alert, BackHandler, Image, Pressable, StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import { AppText, Button, Input, Screen } from "../../src/components/ui";
import { errorMessage, request } from "../../src/lib/api";
import { FEEDBACK_URL, LEGAL_LINKS } from "../../src/lib/config";
import { openUrl } from "../../src/lib/links";
import { loadAvatar, pickAvatar, saveAvatar } from "../../src/lib/avatar";
import { useSession } from "../../src/lib/session";
import { canNotify, openNotificationSettings } from "../../modules/founder-reminders";
import { isPro } from "../../src/lib/notes-logic";
import { ensureNotificationPermission } from "../../src/lib/reminders";
import { colors, GUTTER, setTheme, spacing, sz, themeName, type ThemeName } from "../../src/theme";

function initialsOf(name: string | null | undefined, email: string | undefined) {
  const source = (name?.trim() || email?.split("@")[0] || "F").split(/\s+/).filter(Boolean);
  return (source.length > 1 ? source[0][0] + source[1][0] : source[0].slice(0, 2)).toUpperCase();
}

// Tarjeta de sección de Founder Web: fondo surface, borde line, radio 17, relleno 16, título 16.
function Card({ title, subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title ? <AppText style={styles.cardTitle}>{title}</AppText> : null}
      {subtitle ? <AppText variant="small" color={colors.textMuted} style={{ marginBottom: spacing.md, marginTop: -sz(2) }}>{subtitle}</AppText> : null}
      {children}
    </View>
  );
}

function LinkRow({ label, onPress, last = false, danger = false }: { label: string; onPress: () => void; last?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.linkRow, last ? { borderBottomWidth: 0 } : null, { opacity: pressed ? 0.6 : 1 }]}>
      <AppText style={{ fontSize: sz(13), lineHeight: sz(18), flex: 1 }} color={danger ? colors.danger : colors.text}>{label}</AppText>
      {danger ? null : <AppText color={colors.textMuted} style={{ fontSize: sz(18) }}>›</AppText>}
    </Pressable>
  );
}

function Avatar({ initials, size, radiusPx, fontSize, photo }: { initials: string; size: number; radiusPx: number; fontSize: number; photo?: string | null }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radiusPx, backgroundColor: "#c9c9c9", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {photo ? (
        <Image source={{ uri: photo }} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
      ) : (
        <AppText style={{ color: "#111", fontSize, fontFamily: "sans-serif-medium", fontWeight: "700" }}>{initials}</AppText>
      )}
    </View>
  );
}

export default function AccountScreen() {
  const { user, signOut, deleteAccount } = useSession();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [accountOpen, setAccountOpen] = useState(UI_PREVIEW && view === "cuenta"); // la vista previa solo existe en CI
  const [signingOut, setSigningOut] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [themeMessage, setThemeMessage] = useState<string | null>(null);
  const [notifOn, setNotifOn] = useState<boolean>(() => canNotify());
  const [photo, setPhoto] = useState<string | null>(() => loadAvatar(user?.id));
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);

  async function changePhoto() {
    if (!user) return;
    setPhotoMsg(null);
    const r = await pickAvatar();
    if (r.ok) { saveAvatar(user.id, r.uri); setPhoto(r.uri); }
    else if (r.reason === "failed") setPhotoMsg("No pude usar esa foto. Prueba con otra imagen.");
  }
  function removePhoto() {
    if (!user) return;
    saveAvatar(user.id, null);
    setPhoto(null);
  }

  useEffect(() => {
    if (UI_PREVIEW) setAccountOpen(view === "cuenta"); // solo verificación visual en CI
  }, [view]);

  const pro = isPro(user?.plan);
  const planName = pro ? "Founder Pro" : "Plan gratuito";
  const initials = initialsOf(user?.name, user?.email);

  // El botón «atrás» de Android cierra la vista de cuenta y vuelve a Configuración (como «← Volver» en la web).
  useEffect(() => {
    if (!accountOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { setAccountOpen(false); return true; });
    return () => sub.remove();
  }, [accountOpen]);

  // Guarda el tema y reinicia la app para que todas las pantallas lo usen.
  function chooseTheme(name: ThemeName) {
    setThemeMessage(null);
    if (!setTheme(name)) setThemeMessage("No se pudo cambiar el tema. Cierra y vuelve a abrir Founder e inténtalo de nuevo.");
  }

  function confirmSignOut() {
    Alert.alert("Cerrar sesión", "¿Quieres cerrar la sesión en este dispositivo?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Cerrar sesión", onPress: async () => { setSigningOut(true); await signOut(); } },
    ]);
  }

  async function removeAccount() {
    if (deleting || confirmText.trim().toUpperCase() !== "ELIMINAR") return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (user) saveAvatar(user.id, null);
      await deleteAccount();
    } catch (e) {
      setDeleteError(errorMessage(e));
      setDeleting(false);
    }
  }

  async function enableNotifications() {
    const result = await ensureNotificationPermission();
    setNotifOn(result === "granted");
    if (result === "blocked") openNotificationSettings();
  }

  const header = (title: string, subtitle: string) => (
    <View style={{ marginBottom: spacing.lg }}>
      <AppText variant="title" accessibilityRole="header">{title}</AppText>
      <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.xs }}>{subtitle}</AppText>
    </View>
  );

  // ----- Vista «Cuenta» (como en la web: foto, nombre, estado de cuenta, feedback, sesión y eliminación) -----
  if (accountOpen) {
    return (
      <Screen scroll keyboard contentStyle={styles.content}>
        <Pressable onPress={() => setAccountOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Volver a Configuración" style={{ paddingBottom: spacing.md }}>
          <AppText variant="small" color={colors.textMuted}>← Volver a Configuración</AppText>
        </Pressable>
        {header("Cuenta", "Tu perfil en Founder")}

        <View style={[styles.card, { alignItems: "center", paddingVertical: sz(22) }]} accessible accessibilityLabel={`Perfil: ${user?.name ?? "sin nombre"}, ${user?.email}, ${planName}`}>
          <Pressable onPress={() => void changePhoto()} accessibilityRole="button" accessibilityLabel="Cambiar foto de perfil" hitSlop={6}>
            <Avatar initials={initials} size={sz(96)} radiusPx={sz(30)} fontSize={sz(26)} photo={photo} />
          </Pressable>
          <View style={{ flexDirection: "row", gap: sz(18), marginTop: spacing.sm }}>
            <Pressable onPress={() => void changePhoto()} accessibilityRole="button" hitSlop={8}><AppText variant="small" color={colors.text}>{photo ? "Cambiar foto" : "Añadir foto"}</AppText></Pressable>
            {photo ? <Pressable onPress={removePhoto} accessibilityRole="button" hitSlop={8}><AppText variant="small" color={colors.textMuted}>Quitar foto</AppText></Pressable> : null}
          </View>
          {photoMsg ? <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginTop: spacing.xs }}>{photoMsg}</AppText> : null}
          <AppText style={{ fontSize: sz(20), lineHeight: sz(26), marginTop: spacing.md }}>{user?.name?.trim() || "Sin nombre"}</AppText>
          <AppText variant="small" color={colors.textMuted} style={{ marginTop: 2 }}>{user?.email || "Cuenta de Founder"}</AppText>
        </View>

        <View style={styles.card}>
          <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.xs }}>Estado de cuenta</AppText>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText style={{ fontSize: sz(20), lineHeight: sz(26) }}>{planName}</AppText>
            <View style={[styles.badge, pro ? { backgroundColor: colors.text } : { backgroundColor: colors.surfaceHigh }]}>
              <AppText style={{ fontSize: sz(10), lineHeight: sz(14), fontWeight: "700" }} color={pro ? colors.coralInk : colors.text}>{pro ? "PRO" : "GRATUITO"}</AppText>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <LinkRow label="Enviar feedback" onPress={() => openUrl(FEEDBACK_URL)} />
          <LinkRow label={signingOut ? "Cerrando sesión…" : "Cerrar sesión"} onPress={confirmSignOut} />
          <LinkRow label="Eliminar cuenta permanentemente" danger last onPress={() => setShowDelete(true)} />
        </View>

        {showDelete ? (
          <View style={styles.card}>
            <AppText variant="body">Se eliminará tu cuenta y los datos asociados a ella. Esta acción no se puede deshacer.</AppText>
            <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.sm, marginBottom: spacing.lg }}>
              Si contrataste una suscripción Pro desde la web, también se cancelará. Para saber qué datos se eliminan, consulta la política de privacidad.
            </AppText>
            <Input label='Escribe "ELIMINAR" para confirmar' value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" autoCorrect={false} error={deleteError} />
            <Button title="Eliminar definitivamente" variant="danger" onPress={removeAccount} loading={deleting} disabled={confirmText.trim().toUpperCase() !== "ELIMINAR"} />
            <Button title="Cancelar" variant="ghost" onPress={() => { setShowDelete(false); setConfirmText(""); setDeleteError(null); }} disabled={deleting} style={{ marginTop: spacing.sm }} />
          </View>
        ) : null}

        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.lg, textAlign: "center" }}>
          Founder · versión {Constants.expoConfig?.version ?? "1.0.0"}
        </AppText>
      </Screen>
    );
  }

  // ----- Vista «Configuración» -----
  return (
    <Screen scroll keyboard contentStyle={styles.content}>
      {header("Configuración", "Founder")}

      <Pressable onPress={() => setAccountOpen(true)} accessibilityRole="button" accessibilityLabel={`Abrir cuenta de ${user?.name ?? "usuario"}, ${planName}`} style={({ pressed }) => [styles.profileCard, { opacity: pressed ? 0.8 : 1 }]}>
        <Avatar initials={initials} size={sz(52)} radiusPx={sz(17)} fontSize={sz(17)} photo={photo} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText numberOfLines={1} style={{ fontSize: sz(18), lineHeight: sz(24) }}>{user?.name?.trim() || "Sin nombre"}</AppText>
          <AppText variant="small" color={colors.textMuted} style={{ marginTop: 3, fontSize: sz(11.5) }}>{planName}</AppText>
        </View>
        <AppText color={colors.textMuted} style={{ fontSize: sz(22) }}>›</AppText>
      </Pressable>

      <Card title="Apariencia" subtitle="Elige cómo se ve Founder en todo el dispositivo.">
        <View accessibilityRole="radiogroup" style={{ gap: sz(8) }}>
          <ThemeOption label="Negro" description="El tema predeterminado de Founder" swatches={["#050505", "#f5f4f1"]} selected={themeName === "dark"} onPress={() => chooseTheme("dark")} />
          <ThemeOption label="Blanco" description="Claro, limpio y luminoso" swatches={["#f5f5f7", "#1d1d1f"]} selected={themeName === "light"} onPress={() => chooseTheme("light")} />
        </View>
        {themeMessage ? <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginTop: spacing.sm }}>{themeMessage}</AppText> : null}
      </Card>

      <Card title="Notificaciones">
        {pro ? (
          <>
            <AppText variant="small" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
              {notifOn ? "Los avisos de tus notas con recomendaciones de Founder llegarán a este teléfono, incluso con la app cerrada." : "Las notificaciones de Founder están desactivadas en este teléfono, así que no recibirás los avisos de tus notas."}
            </AppText>
            {!notifOn ? <Button title="Activar notificaciones" variant="secondary" onPress={() => void enableNotifications()} /> : null}
          </>
        ) : (
          <AppText variant="small" color={colors.textMuted}>Los avisos de tus notas con recomendaciones de Founder son parte de Founder Pro.</AppText>
        )}
      </Card>

      <Card title="Forma de pago y suscripción">
        <AppText variant="small" color={colors.textMuted}>
          {pro ? "Tu cuenta es Founder Pro. Esta versión de la app no gestiona pagos: administra tu suscripción desde Founder Web." : "Esta versión de la app todavía no gestiona suscripciones ni pagos. Founder Pro se contrata en Founder Web y se activa aquí con la misma cuenta."}
        </AppText>
      </Card>

      <Card title="Legal">
        <LinkRow label="Términos y condiciones" onPress={() => openUrl(LEGAL_LINKS.terminos)} />
        <LinkRow label="Política de privacidad" onPress={() => openUrl(LEGAL_LINKS.privacidad)} />
        <LinkRow label="Política de cookies" onPress={() => openUrl(LEGAL_LINKS.cookies)} />
        <LinkRow label="Solicitud de eliminación de datos" last onPress={() => openUrl(LEGAL_LINKS.eliminarCuenta)} />
      </Card>

      <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm, textAlign: "center" }}>
        Founder · versión {Constants.expoConfig?.version ?? "1.0.0"}
      </AppText>
    </Screen>
  );
}

function ThemeOption({ label, description, swatches, selected = false, disabled = false, onPress }: { label: string; description: string; swatches: string[]; selected?: boolean; disabled?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || selected}
      accessible
      accessibilityRole="radio"
      accessibilityLabel={`${label}. ${description}`}
      accessibilityState={{ selected, disabled }}
      style={[styles.theme, { borderColor: selected ? colors.coral : colors.line, backgroundColor: selected ? colors.surfaceHigh : "transparent", opacity: disabled ? 0.5 : 1 }]}
    >
      <View style={styles.swatch}>{swatches.map((c) => <View key={c} style={{ flex: 1, backgroundColor: c }} />)}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText style={{ fontSize: sz(12.5), lineHeight: sz(17), fontFamily: "sans-serif-medium" }}>{label}</AppText>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>{description}</AppText>
      </View>
      <View style={[styles.radio, { borderColor: selected ? colors.coral : colors.textMuted, backgroundColor: selected ? colors.coral : "transparent" }]}>
        {selected ? <View style={{ flex: 1, margin: 3, borderRadius: 8, backgroundColor: colors.surfaceHigh }} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: GUTTER - 2, paddingTop: sz(18), paddingBottom: sz(32) },
  card: { marginBottom: sz(14), padding: sz(16), borderRadius: sz(17), borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardTitle: { fontFamily: "sans-serif-medium", fontSize: sz(16), lineHeight: sz(22), marginBottom: sz(6), color: colors.text },
  profileCard: { flexDirection: "row", alignItems: "center", gap: sz(13), padding: sz(16), marginBottom: sz(14), borderRadius: sz(22), borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceHigh },
  linkRow: { flexDirection: "row", alignItems: "center", minHeight: sz(44), paddingVertical: sz(10), borderBottomWidth: 1, borderBottomColor: colors.line },
  badge: { paddingHorizontal: sz(10), paddingVertical: sz(5), borderRadius: 20 },
  theme: { flexDirection: "row", alignItems: "center", gap: sz(12), paddingVertical: sz(11), paddingHorizontal: sz(12), borderRadius: sz(14), borderWidth: 1 },
  swatch: { flexDirection: "row", width: sz(34), height: sz(24), borderRadius: sz(8), overflow: "hidden", borderWidth: 1, borderColor: colors.line },
  radio: { width: sz(17), height: sz(17), borderRadius: 9, borderWidth: 1 },
});
