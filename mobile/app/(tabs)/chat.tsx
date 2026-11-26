import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FormattedText } from "../../src/components/FormattedText";
import { FounderVoice } from "../../src/components/VoiceMode";
import { ErrorState, LoadingState } from "../../src/components/states";
import { AppText, Button, IconButton, Screen } from "../../src/components/ui";
import { ApiError, errorMessage, request, streamChat } from "../../src/lib/api";
import { recommendationChatPrompt } from "../../src/lib/notes-logic";
import { findRecommendation, resolveRecommendation } from "../../src/lib/reminders";
import { useSession } from "../../src/lib/session";
import { GUTTER, MAX_FONT_SCALE, colors, radius, spacing, sz, typography } from "../../src/theme";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "streaming" | "partial" | "error";
  errorText?: string;
  retryable?: boolean;
}

interface ConversationDetail {
  id: string;
  messages: Array<{ role: string; content: string }>;
}

let counter = 0;
const uid = () => `m${Date.now()}-${counter++}`;

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string; recId?: string }>();
  const { user } = useSession();
  const handledRec = useRef<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const patch = useCallback((id: string, changes: Partial<Message>) => {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...changes } : m)));
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const data = await request<ConversationDetail>(`/api/conversations/${encodeURIComponent(id)}`);
      conversationRef.current = data.id;
      setMessages(
        data.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ id: uid(), role: m.role as "user" | "assistant", content: m.content })),
      );
    } catch (e) {
      setHistoryError(e);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Abre una conversación elegida desde el historial.
  useEffect(() => {
    const id = params.conversationId;
    if (id && id !== conversationRef.current) {
      abortRef.current?.abort();
      setSending(false);
      setRemaining(null);
      void loadConversation(id);
    }
  }, [params.conversationId, loadConversation]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Llega desde «Chat» en una recomendación pendiente: abre una conversación nueva y envía la recomendación con el
  // contexto de la nota para seguir conversando sin volver a explicarlo.
  useEffect(() => {
    const id = params.recId;
    if (!id) { handledRec.current = null; return; }
    if (!user || handledRec.current === id) return;
    const rec = findRecommendation(user.id, id);
    handledRec.current = id;
    router.setParams({ recId: "" });
    if (!rec) return;
    abortRef.current?.abort();
    conversationRef.current = null;
    setMessages([]);
    setHistoryError(null);
    resolveRecommendation(user.id, id, "chat");
    void send(recommendationChatPrompt(rec), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reacciona al parámetro y a la cuenta
  }, [params.recId, user]);

  function newChat() {
    abortRef.current?.abort();
    conversationRef.current = null;
    setMessages([]);
    setInput("");
    setSending(false);
    setHistoryError(null);
    setRemaining(null);
    router.setParams({ conversationId: "" });
  }

  async function send(text: string, force = false) {
    const content = text.trim();
    if (!content || (sending && !force)) return;
    const botId = uid();
    setMessages((list) => [...list, { id: uid(), role: "user", content }, { id: botId, role: "assistant", content: "", status: "streaming" }]);
    setInput("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;
    try {
      await streamChat({
        content,
        conversationId: conversationRef.current,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "meta") {
            conversationRef.current = event.conversationId;
          } else if (event.type === "delta") {
            setMessages((list) => list.map((m) => (m.id === botId ? { ...m, content: m.content + event.text } : m)));
          } else if (event.type === "done") {
            finished = true;
            setRemaining(event.remaining);
            patch(botId, { status: event.partial ? "partial" : undefined });
          } else if (event.type === "error") {
            finished = true;
            patch(botId, event.partial ? { status: "partial", errorText: event.message } : { status: "error", errorText: event.message, retryable: true });
          }
        },
      });
      if (!finished) {
        setMessages((list) =>
          list.map((m) =>
            m.id === botId && m.status === "streaming"
              ? m.content
                ? { ...m, status: "partial", errorText: "La respuesta terminó antes de tiempo." }
                : { ...m, status: "error", errorText: "Founder no devolvió respuesta. Inténtalo de nuevo.", retryable: true }
              : m,
          ),
        );
      }
    } catch (e) {
      if (e instanceof ApiError && e.kind === "aborted") {
        setMessages((list) =>
          list.flatMap((m) => {
            if (m.id !== botId) return [m];
            return m.content ? [{ ...m, status: "partial" as const, errorText: "Detuviste la respuesta." }] : [];
          }),
        );
      } else {
        const limit = e instanceof ApiError && e.kind === "limit";
        setMessages((list) =>
          list.map((m) =>
            m.id === botId
              ? m.content
                ? { ...m, status: "partial", errorText: errorMessage(e) }
                : { ...m, status: "error", errorText: errorMessage(e), retryable: !limit }
              : m,
          ),
        );
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function retry(botId: string) {
    // La respuesta fallida no se guardó en el servidor: se quita el par fallido y se vuelve a enviar.
    const index = messages.findIndex((m) => m.id === botId);
    const question = index > 0 ? messages[index - 1] : null;
    if (!question || question.role !== "user") return;
    setMessages((list) => list.filter((_, i) => i !== index && i !== index - 1));
    void send(question.content);
  }

  const canSend = input.trim().length > 0 && !sending;

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: GUTTER, paddingRight: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs }}>
      <View style={{ flex: 1 }}>
        <AppText variant="title" accessibilityRole="header" style={{ fontSize: sz(21), lineHeight: sz(26), letterSpacing: -0.4 }}>
          Chat
        </AppText>
        {remaining !== null ? (
          <AppText variant="caption" color={colors.textFaint}>
            {remaining === 1 ? "Te queda 1 mensaje hoy" : `Te quedan ${remaining} mensajes hoy`}
          </AppText>
        ) : null}
      </View>
      <IconButton icon="call-outline" label="Llamar a Founder por voz" onPress={() => setVoiceOpen(true)} />
      <IconButton icon="time-outline" label="Historial de chats" onPress={() => router.push("/historial")} />
      <IconButton icon="create-outline" label="Nuevo chat" onPress={newChat} />
    </View>
  );

  const composer = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        paddingHorizontal: spacing.md + 2,
        paddingVertical: spacing.sm + 2,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <Pressable onPress={() => {}} accessibilityRole="button" accessibilityLabel="Adjuntar archivo" hitSlop={5} style={{ width: sz(38), height: sz(38), borderRadius: sz(19), borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceHigh, alignItems: "center", justifyContent: "center", marginRight: spacing.sm }}>
        <Ionicons name="attach-outline" size={18} color={colors.text} />
      </Pressable>
      <Pressable onPress={() => setVoiceOpen(true)} accessibilityRole="button" accessibilityLabel="Hablar con Founder" hitSlop={5} style={{ width: sz(38), height: sz(38), borderRadius: sz(19), borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceHigh, alignItems: "center", justifyContent: "center", marginRight: spacing.sm }}>
        <Ionicons name="mic-outline" size={18} color={colors.text} />
      </Pressable>
      <TextInput
        value={input}
        onChangeText={setInput}
        accessibilityLabel="Mensaje para Founder"
        placeholder="Escribe a Founder…"
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.coral}
        cursorColor={colors.coral}
        multiline
        maxLength={12000}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          flex: 1,
          maxHeight: sz(126),
          minHeight: sz(42),
          borderRadius: sz(21),
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface,
          color: colors.text,
          paddingHorizontal: spacing.lg,
          paddingTop: sz(10),
          paddingBottom: sz(10),
          fontFamily: typography.body.fontFamily,
          fontSize: typography.body.fontSize,
        }}
      />
      <Pressable
        onPress={sending ? () => abortRef.current?.abort() : () => void send(input)}
        disabled={!sending && !canSend}
        accessibilityRole="button"
        accessibilityLabel={sending ? "Detener respuesta" : "Enviar mensaje"}
        accessibilityState={{ disabled: !sending && !canSend }}
        style={{
          width: sz(38),
          height: sz(38),
          marginLeft: spacing.sm,
          borderRadius: sz(19),
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: sending || canSend ? colors.coral : colors.surfaceHigh,
        }}
      >
        <Ionicons name={sending ? "stop" : "arrow-up"} size={18} color={sending || canSend ? colors.coralInk : colors.textFaint} />
      </Pressable>
    </View>
  );

  return (
    <Screen keyboard footer={composer}>
      {voiceOpen ? <FounderVoice onClose={() => setVoiceOpen(false)} /> : null}
      {header}
      {loadingHistory ? (
        <LoadingState label="Abriendo la conversación…" />
      ) : historyError ? (
        <ErrorState
          error={historyError}
          message={errorMessage(historyError)}
          onRetry={params.conversationId ? () => void loadConversation(params.conversationId as string) : undefined}
        />
      ) : messages.length === 0 ? (
        <View style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View style={{ marginBottom: spacing.lg, alignItems: item.role === "user" ? "flex-end" : "flex-start" }}>
              {item.role === "user" ? (
                <View style={{ maxWidth: "84%", backgroundColor: colors.text, borderRadius: radius.lg, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm + 2 }}>
                  <AppText variant="body" color={colors.coralInk} selectable>
                    {item.content}
                  </AppText>
                </View>
              ) : (
                <View style={{ width: "100%" }} accessible={false}>
                  <AppText variant="label" color={colors.textMuted} style={{ marginBottom: spacing.xs }}>
                    FOUNDER
                  </AppText>
                  {item.status === "streaming" && !item.content ? (
                    <View style={{ flexDirection: "row", alignItems: "center" }} accessibilityLiveRegion="polite" accessibilityLabel="Founder está escribiendo">
                      <ActivityIndicator size="small" color={colors.textMuted} />
                      <AppText variant="small" color={colors.textMuted} style={{ marginLeft: spacing.sm }}>
                        Escribiendo…
                      </AppText>
                    </View>
                  ) : item.content ? (
                    <FormattedText text={item.content} />
                  ) : null}
                  {item.status === "partial" ? (
                    <AppText variant="small" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
                      {item.errorText ?? "Respuesta incompleta."}
                    </AppText>
                  ) : null}
                  {item.status === "error" ? (
                    <View accessibilityLiveRegion="polite">
                      <AppText variant="small" color={colors.danger}>
                        {item.errorText}
                      </AppText>
                      {item.retryable ? <Button title="Reintentar" variant="secondary" onPress={() => retry(item.id)} style={{ marginTop: spacing.md, alignSelf: "flex-start" }} /> : null}
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          )}
        />
      )}
    </Screen>
  );
}
