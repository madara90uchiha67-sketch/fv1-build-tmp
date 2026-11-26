import { forwardRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { GUTTER, MAX_FONT_SCALE, colors, radius, spacing, sz, typography, type TextVariant } from "../theme";

// --- Texto ----------------------------------------------------------------------

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
}

export function AppText({ variant = "body", color = colors.text, style, ...props }: AppTextProps) {
  return <Text maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} style={[typography[variant], { color }, style]} />;
}

// --- Pantalla ---------------------------------------------------------------------

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  footer?: ReactNode;
  edges?: Edge[];
  keyboard?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  backgroundColor?: string;
}

export function Screen({ children, scroll = false, onRefresh, refreshing = false, footer, edges = ["top"], keyboard = false, contentStyle, backgroundColor = colors.bg }: ScreenProps) {
  const body = (
    <>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} progressBackgroundColor={colors.surfaceHigh} /> : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
      {footer}
    </>
  );
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor }]} edges={edges}>
      {keyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

export function ScreenTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.titleRow}>
      <View style={styles.flex}>
        <AppText variant="title" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

// --- Botones ----------------------------------------------------------------------

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "authPrimary";
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Button({ title, onPress, variant = "primary", loading = false, disabled = false, icon, style, accessibilityLabel }: ButtonProps) {
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: colors.coral, fg: colors.coralInk, border: colors.coral },
    secondary: { bg: "transparent", fg: colors.text, border: colors.lineStrong },
    ghost: { bg: "transparent", fg: colors.textMuted, border: "transparent" },
    danger: { bg: "transparent", fg: colors.danger, border: colors.danger },
    authPrimary: { bg: colors.authButton, fg: colors.coralInk, border: colors.authButton },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={16} color={palette.fg} style={{ marginRight: spacing.sm }} /> : null}
          <AppText variant="bodyStrong" color={palette.fg}>
            {title}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={19} color={colors.text} />
    </Pressable>
  );
}

// --- Campos -----------------------------------------------------------------------

interface InputProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  light?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input({ label, error, hint, light = false, style, onFocus, onBlur, multiline, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="label" color={light ? colors.authMuted : colors.textMuted} style={{ marginBottom: spacing.xs + 2 }}>
        {label.toUpperCase()}
      </AppText>
      <TextInput
        ref={ref}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        accessibilityLabel={label}
        placeholderTextColor={light ? colors.authMuted : colors.textFaint}
        selectionColor={light ? colors.authText : colors.coral}
        cursorColor={light ? colors.authText : colors.coral}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          multiline ? styles.inputMultiline : null,
          { borderColor: error ? colors.danger : focused ? (light ? colors.authText : colors.coral) : (light ? colors.authLine : colors.line), color: light ? colors.authText : colors.text, backgroundColor: light ? colors.authSurface : colors.surface },
          style,
        ]}
        {...props}
      />
      {error ? (
        <AppText variant="small" color={colors.danger} style={{ marginTop: spacing.xs }} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? colors.coral : colors.line, backgroundColor: selected ? colors.coral : "transparent", opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <AppText variant="small" color={selected ? colors.coralInk : colors.textMuted} style={{ fontFamily: typography.bodyStrong.fontFamily }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            style={[styles.segment, selected ? styles.segmentSelected : null]}
          >
            <AppText variant="small" color={selected ? colors.text : colors.textMuted} style={{ fontFamily: typography.bodyStrong.fontFamily }}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Filas y separadores ------------------------------------------------------------

interface RowProps {
  title: string;
  subtitle?: string;
  meta?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  chevron?: boolean;
  danger?: boolean;
  accessibilityLabel?: string;
}

export function Row({ title, subtitle, meta, icon, onPress, chevron = Boolean(onPress), danger = false, accessibilityLabel }: RowProps) {
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={19} color={danger ? colors.danger : colors.textMuted} style={{ marginRight: spacing.md }} /> : null}
      <View style={styles.flex}>
        <AppText variant="bodyStrong" color={danger ? colors.danger : colors.text} numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" color={colors.textMuted} numberOfLines={2} style={{ marginTop: 2 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {meta ? (
        <AppText variant="small" color={colors.textMuted} style={{ marginLeft: spacing.md }}>
          {meta}
        </AppText>
      ) : null}
      {chevron ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} style={{ marginLeft: spacing.sm }} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join(", ")}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function SectionLabel({ children }: { children: string }) {
  return (
    <AppText variant="label" color={colors.textFaint} style={{ marginTop: spacing.lg, marginBottom: spacing.xs }} accessibilityRole="header">
      {children.toUpperCase()}
    </AppText>
  );
}

export const layout = StyleSheet.create({
  flex: { flex: 1 },
  gutter: { paddingHorizontal: GUTTER },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: GUTTER, paddingTop: spacing.md, paddingBottom: spacing.huge },
  titleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.lg },
  button: {
    minHeight: sz(44),
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  iconButton: { width: sz(40), height: sz(40), borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  input: {
    minHeight: sz(44),
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
  },
  inputMultiline: { minHeight: sz(96), paddingTop: spacing.md },
  chip: {
    minHeight: sz(32),
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  segmented: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.md, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  segment: { flex: 1, minHeight: sz(34), borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  segmentSelected: { backgroundColor: colors.surfaceHigh },
  row: { minHeight: sz(52), flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
});
