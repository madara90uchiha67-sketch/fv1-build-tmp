import { useMemo, useState, type ReactNode } from "react";
import { Alert, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { AppText, Button, Chip, Input, Screen } from "../../src/components/ui";
import { request } from "../../src/lib/api";
import { dateInputToIso, normalizeAmount, toDateInput } from "../../src/lib/format";
import {
  ESTADOS_VENTA,
  MONEDAS,
  type Customer,
  type ListResponse,
  type Product,
  type Sale,
  type SaleStatus,
} from "../../src/lib/types";
import { useLoad } from "../../src/lib/useLoad";
import { colors, spacing } from "../../src/theme";

type Tipo = "ventas" | "clientes" | "productos";
const RESOURCE: Record<Tipo, string> = { ventas: "sales", clientes: "customers", productos: "products" };
const NOUN: Record<Tipo, string> = { ventas: "venta", clientes: "cliente", productos: "producto" };

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "No se pudo guardar. Inténtalo de nuevo.";
}

// Marco común: título, botón Guardar fijo al pie, errores y eliminación con confirmación.
function FormFrame({
  tipo,
  itemId,
  onSave,
  extraActions,
  children,
}: {
  tipo: Tipo;
  itemId: string | null;
  onSave: () => Promise<void>;
  extraActions?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = itemId !== null;

  async function save() {
    if (saving || deleting) return;
    setSaving(true);
    setError(null);
    try {
      await onSave();
      router.back();
    } catch (e) {
      setError(messageOf(e));
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert(`¿Eliminar ${NOUN[tipo]}?`, "Esta acción no se puede deshacer.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          setError(null);
          try {
            await request(`/api/business/${RESOURCE[tipo]}`, { method: "DELETE", body: { id: itemId } });
            router.back();
          } catch (e) {
            setError(messageOf(e));
            setDeleting(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen
      scroll
      keyboard
      edges={["bottom"]}
      footer={
        <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.lg, backgroundColor: colors.bg }}>
          {error ? (
            <AppText variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={{ marginBottom: spacing.md }}>
              {error}
            </AppText>
          ) : null}
          <Button title={editing ? "Guardar cambios" : "Guardar"} onPress={save} loading={saving} disabled={deleting} />
        </View>
      }
    >
      <Stack.Screen options={{ title: `${editing ? "Editar" : "Nueva"} ${NOUN[tipo]}` }} />
      {children}
      {editing ? (
        <View style={{ marginTop: spacing.lg }}>
          {extraActions}
          <Button title={`Eliminar ${NOUN[tipo]}`} variant="danger" onPress={confirmDelete} loading={deleting} disabled={saving} style={{ marginTop: spacing.md }} />
        </View>
      ) : null}
    </Screen>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: spacing.xs }}>
      {children}
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <AppText variant="label" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
        {label.toUpperCase()}
      </AppText>
      {children}
    </View>
  );
}

// --- Venta ----------------------------------------------------------------------

function SaleForm({ item }: { item: Sale | null }) {
  const [amount, setAmount] = useState(item ? item.amount : "");
  const [currency, setCurrency] = useState<string>(item?.currency ?? "USD");
  const [status, setStatus] = useState<SaleStatus>(item?.status ?? "COMPLETED");
  const [date, setDate] = useState(item ? toDateInput(item.soldAt) : toDateInput(new Date()));
  const [customerId, setCustomerId] = useState<string | null>(item?.customerId ?? null);
  const [productId, setProductId] = useState<string | null>(item?.productId ?? null);
  const [description, setDescription] = useState(item?.description ?? "");

  const customers = useLoad(() => request<ListResponse<Customer>>("/api/business/customers"));
  const products = useLoad(() => request<ListResponse<Product>>("/api/business/products"));
  const availableProducts = (products.data?.items ?? []).filter((p) => !p.isArchived || p.id === productId);

  async function save() {
    const cleanAmount = normalizeAmount(amount);
    if (!cleanAmount) throw new Error("Escribe un importe mayor que cero, con hasta 2 decimales.");
    let soldAt: string | null;
    if (item && date === toDateInput(item.soldAt)) soldAt = item.soldAt;
    else soldAt = dateInputToIso(date);
    if (!soldAt) throw new Error("La fecha debe tener el formato AAAA-MM-DD, por ejemplo 2026-11-12.");
    const body = { amount: cleanAmount, currency, status, soldAt, customerId, productId, description: description.trim() };
    if (item) await request(`/api/business/sales`, { method: "PATCH", body: { id: item.id, ...body } });
    else await request(`/api/business/sales`, { method: "POST", body });
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return (
    <FormFrame tipo="ventas" itemId={item?.id ?? null} onSave={save}>
      <Input label="Importe" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
      <Field label="Moneda">
        <ChipRow>
          {MONEDAS.map((code) => (
            <Chip key={code} label={code} selected={currency === code} onPress={() => setCurrency(code)} />
          ))}
        </ChipRow>
      </Field>
      <Field label="Estado">
        <ChipRow>
          {ESTADOS_VENTA.map((option) => (
            <Chip key={option.value} label={option.label} selected={status === option.value} onPress={() => setStatus(option.value)} />
          ))}
        </ChipRow>
      </Field>
      <Input label="Fecha de la venta" value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" placeholder="AAAA-MM-DD" maxLength={10} />
      <View style={{ flexDirection: "row", marginTop: -spacing.sm, marginBottom: spacing.lg }}>
        <Chip label="Hoy" selected={date === toDateInput(new Date())} onPress={() => setDate(toDateInput(new Date()))} />
        <Chip label="Ayer" selected={date === toDateInput(yesterday)} onPress={() => setDate(toDateInput(yesterday))} />
      </View>
      <Field label="Cliente (opcional)">
        {customers.loading ? (
          <AppText variant="small" color={colors.textMuted}>Cargando clientes…</AppText>
        ) : customers.error ? (
          <AppText variant="small" color={colors.textMuted}>No se pudieron cargar tus clientes. Puedes guardar la venta sin cliente.</AppText>
        ) : (customers.data?.items.length ?? 0) === 0 ? (
          <AppText variant="small" color={colors.textMuted}>Aún no tienes clientes registrados.</AppText>
        ) : (
          <ChipRow>
            <Chip label="Ninguno" selected={customerId === null} onPress={() => setCustomerId(null)} />
            {customers.data?.items.map((c) => (
              <Chip key={c.id} label={c.name} selected={customerId === c.id} onPress={() => setCustomerId(c.id)} />
            ))}
          </ChipRow>
        )}
      </Field>
      <Field label="Producto (opcional)">
        {products.loading ? (
          <AppText variant="small" color={colors.textMuted}>Cargando productos…</AppText>
        ) : products.error ? (
          <AppText variant="small" color={colors.textMuted}>No se pudieron cargar tus productos. Puedes guardar la venta sin producto.</AppText>
        ) : availableProducts.length === 0 ? (
          <AppText variant="small" color={colors.textMuted}>Aún no tienes productos activos.</AppText>
        ) : (
          <ChipRow>
            <Chip label="Ninguno" selected={productId === null} onPress={() => setProductId(null)} />
            {availableProducts.map((p) => (
              <Chip key={p.id} label={p.name} selected={productId === p.id} onPress={() => setProductId(p.id)} />
            ))}
          </ChipRow>
        )}
      </Field>
      <Input label="Descripción (opcional)" value={description} onChangeText={setDescription} multiline maxLength={1200} />
    </FormFrame>
  );
}

// --- Cliente --------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CustomerForm({ item }: { item: Customer | null }) {
  const [name, setName] = useState(item?.name ?? "");
  const [email, setEmail] = useState(item?.email ?? "");
  const [phone, setPhone] = useState(item?.phone ?? "");
  const [company, setCompany] = useState(item?.company ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");

  async function save() {
    if (!name.trim()) throw new Error("El nombre del cliente es obligatorio.");
    if (email.trim() && !EMAIL_RE.test(email.trim())) throw new Error("Revisa el correo del cliente.");
    const body = { name: name.trim(), email: email.trim(), phone: phone.trim(), company: company.trim(), notes: notes.trim() };
    if (item) await request(`/api/business/customers`, { method: "PATCH", body: { id: item.id, ...body } });
    else await request(`/api/business/customers`, { method: "POST", body });
  }

  return (
    <FormFrame tipo="clientes" itemId={item?.id ?? null} onSave={save}>
      <Input label="Nombre" value={name} onChangeText={setName} maxLength={120} autoComplete="name" />
      <Input label="Correo (opcional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={254} />
      <Input label="Teléfono (opcional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={48} />
      <Input label="Empresa (opcional)" value={company} onChangeText={setCompany} maxLength={120} />
      <Input label="Notas (opcional)" value={notes} onChangeText={setNotes} multiline maxLength={1200} />
    </FormFrame>
  );
}

// --- Producto -------------------------------------------------------------------

function ProductForm({ item }: { item: Product | null }) {
  const router = useRouter();
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? item.price : "");
  const [currency, setCurrency] = useState<string>(item?.currency ?? "USD");
  const [description, setDescription] = useState(item?.description ?? "");
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) throw new Error("El nombre del producto es obligatorio.");
    const cleanPrice = normalizeAmount(price);
    if (!cleanPrice) throw new Error("Escribe un precio mayor que cero, con hasta 2 decimales.");
    const body = { name: name.trim(), price: cleanPrice, currency, description: description.trim() };
    if (item) await request(`/api/business/products`, { method: "PATCH", body: { id: item.id, ...body } });
    else await request(`/api/business/products`, { method: "POST", body });
  }

  async function toggleArchive() {
    if (!item || archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await request(`/api/business/products`, { method: "PATCH", body: { id: item.id, isArchived: !item.isArchived } });
      router.back();
    } catch (e) {
      setArchiveError(messageOf(e));
      setArchiving(false);
    }
  }

  return (
    <FormFrame
      tipo="productos"
      itemId={item?.id ?? null}
      onSave={save}
      extraActions={
        item ? (
          <View>
            <Button title={item.isArchived ? "Restaurar producto" : "Archivar producto"} variant="secondary" onPress={toggleArchive} loading={archiving} />
            {archiveError ? (
              <AppText variant="small" color={colors.danger} style={{ marginTop: spacing.sm }}>
                {archiveError}
              </AppText>
            ) : null}
          </View>
        ) : null
      }
    >
      <Input label="Nombre" value={name} onChangeText={setName} maxLength={120} />
      <Input label="Precio" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.00" />
      <Field label="Moneda">
        <ChipRow>
          {MONEDAS.map((code) => (
            <Chip key={code} label={code} selected={currency === code} onPress={() => setCurrency(code)} />
          ))}
        </ChipRow>
      </Field>
      <Input label="Descripción (opcional)" value={description} onChangeText={setDescription} multiline maxLength={1200} />
    </FormFrame>
  );
}

// --- Pantalla -------------------------------------------------------------------

export default function BusinessFormScreen() {
  const params = useLocalSearchParams<{ tipo?: string; item?: string }>();
  const tipo: Tipo = params.tipo === "clientes" || params.tipo === "productos" ? params.tipo : "ventas";
  const item = useMemo(() => {
    if (!params.item) return null;
    try {
      return JSON.parse(params.item) as Sale | Customer | Product;
    } catch {
      return null;
    }
  }, [params.item]);

  if (tipo === "clientes") return <CustomerForm item={item as Customer | null} />;
  if (tipo === "productos") return <ProductForm item={item as Product | null} />;
  return <SaleForm item={item as Sale | null} />;
}
