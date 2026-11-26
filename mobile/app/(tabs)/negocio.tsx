import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { EmptyState, ErrorState, LoadingState } from "../../src/components/states";
import { BusinessInsight } from "../../src/components/BusinessInsight";
import { ReferenceHeader } from "../../src/components/ReferenceHeader";
import { AppText, Button, Divider, Row, Screen, Segmented } from "../../src/components/ui";
import { errorMessage, request } from "../../src/lib/api";
import { formatDate, formatMoney } from "../../src/lib/format";
import { ESTADOS_VENTA, type Customer, type ListResponse, type Product, type Sale } from "../../src/lib/types";
import { useLoad } from "../../src/lib/useLoad";
import { colors, spacing } from "../../src/theme";

type Tipo = "ventas" | "clientes" | "productos";
type Item = Sale | Customer | Product;

const TABS: Array<{ value: Tipo; label: string }> = [
  { value: "ventas", label: "Ventas" },
  { value: "clientes", label: "Clientes" },
  { value: "productos", label: "Productos" },
];

const RESOURCE: Record<Tipo, string> = { ventas: "sales", clientes: "customers", productos: "products" };

const COPY: Record<Tipo, { action: string; emptyTitle: string; emptyBody: string }> = {
  ventas: {
    action: "+ Registrar venta",
    emptyTitle: "Sin ventas todavía",
    emptyBody: "Registra tu primera venta para ver tu historial y el resumen del mes en Inicio.",
  },
  clientes: {
    action: "+ Agregar cliente",
    emptyTitle: "Sin clientes todavía",
    emptyBody: "Guarda los datos de tus clientes para asociarlos a tus ventas.",
  },
  productos: {
    action: "+ Agregar producto",
    emptyTitle: "Sin productos todavía",
    emptyBody: "Agrega lo que vendes, con su precio, para registrar ventas más rápido.",
  },
};

function describe(tipo: Tipo, item: Item): { title: string; subtitle?: string; meta?: string } {
  if (tipo === "ventas") {
    const sale = item as Sale;
    const status = ESTADOS_VENTA.find((s) => s.value === sale.status)?.label;
    const parts = [
      sale.description || sale.product?.name || "",
      sale.customer?.name ?? "",
      sale.status !== "COMPLETED" && status ? status : "",
    ].filter(Boolean);
    return { title: formatMoney(sale.amount, sale.currency), subtitle: parts.join(" · ") || "Sin descripción", meta: formatDate(sale.soldAt) };
  }
  if (tipo === "clientes") {
    const customer = item as Customer;
    return { title: customer.name, subtitle: customer.company || customer.email || customer.phone || undefined };
  }
  const product = item as Product;
  return {
    title: product.name,
    subtitle: product.isArchived ? "Archivado" : product.description || undefined,
    meta: formatMoney(product.price, product.currency),
  };
}

export default function BusinessScreen() {
  const router = useRouter();
  const [tipo, setTipo] = useState<Tipo>("ventas");
  const { data, error, loading, refreshing, reload, refresh } = useLoad(
    () => request<ListResponse<Item>>(`/api/business/${RESOURCE[tipo]}`),
    [tipo],
  );

  const copy = COPY[tipo];
  const openForm = (item?: Item) =>
    router.push({ pathname: "/negocio/formulario", params: item ? { tipo, item: JSON.stringify(item) } : { tipo } });

  return (
    <Screen
      footer={
        <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg }}>
          <Button title={copy.action} onPress={() => openForm()} accessibilityLabel={copy.action.replace("+ ", "")} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.lg }}>
        <ReferenceHeader title="Negocio" centered />
        <Segmented options={TABS} value={tipo} onChange={setTipo} />
        <BusinessInsight />
      </View>

      {loading ? (
        <LoadingState />
      ) : error && !data ? (
        <ErrorState error={error} message={errorMessage(error)} onRetry={reload} />
      ) : data && data.items.length === 0 ? (
        <EmptyState title={copy.emptyTitle} body={copy.emptyBody} />
      ) : data ? (
        <FlatList
          data={data.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl }}
          ItemSeparatorComponent={Divider}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.coral} colors={[colors.coral]} progressBackgroundColor={colors.surfaceHigh} />}
          renderItem={({ item }) => {
            const info = describe(tipo, item);
            return <Row title={info.title} subtitle={info.subtitle} meta={info.meta} onPress={() => openForm(item)} />;
          }}
          ListFooterComponent={
            data.truncated ? (
              <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.lg }}>
                Se muestran los {data.items.length} registros más recientes de {data.totalCount}.
              </AppText>
            ) : null
          }
        />
      ) : null}
    </Screen>
  );
}
