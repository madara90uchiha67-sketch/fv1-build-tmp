import { FlatList, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { EmptyState, ErrorState, LoadingState } from "../src/components/states";
import { Divider, Row, Screen } from "../src/components/ui";
import { errorMessage, request } from "../src/lib/api";
import { formatDate } from "../src/lib/format";
import type { ConversationSummary } from "../src/lib/types";
import { useLoad } from "../src/lib/useLoad";
import { colors, spacing } from "../src/theme";

const MODE_LABEL: Record<string, string> = {
  free: "Chat con Founder",
  idea: "Idea de negocio",
  story: "Plan de negocio",
  content: "Estrategia comercial",
};

export default function HistoryScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, reload, refresh } = useLoad(() => request<{ conversations: ConversationSummary[] }>("/api/conversations"));

  return (
    <Screen edges={["bottom"]}>
      {loading ? (
        <LoadingState label="Cargando tu historial…" />
      ) : error && !data ? (
        <ErrorState error={error} message={errorMessage(error)} onRetry={reload} />
      ) : data && data.conversations.length === 0 ? (
        <EmptyState title="Sin conversaciones" body="Cuando chatees con Founder, tus conversaciones aparecerán aquí." actionLabel="Empezar un chat" onAction={() => router.navigate({ pathname: "/chat", params: { conversationId: "" } })} />
      ) : data ? (
        <FlatList
          data={data.conversations}
          keyExtractor={(c) => c.id}
          ItemSeparatorComponent={Divider}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.coral} colors={[colors.coral]} progressBackgroundColor={colors.surfaceHigh} />}
          renderItem={({ item }) => (
            <Row
              title={item.preview || "Conversación"}
              subtitle={MODE_LABEL[item.mode] ?? "Conversación"}
              meta={formatDate(item.updatedAt)}
              onPress={() => router.navigate({ pathname: "/chat", params: { conversationId: item.id } })}
            />
          )}
        />
      ) : null}
    </Screen>
  );
}
