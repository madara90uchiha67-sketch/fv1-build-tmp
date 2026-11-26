export function formatMoney(amount: string | number, currency: string): string {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat("es", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function toDateInput(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Convierte AAAA-MM-DD a un instante con zona explícita (el backend la exige). Devuelve null si no es válida.
export function dateInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.toISOString();
}

// Importe con hasta 2 decimales, como exige el backend. Acepta coma decimal. Devuelve null si no es válido o es 0.
export function normalizeAmount(value: string): string | null {
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  if (Number(text) <= 0) return null;
  return text;
}

export function firstName(name: string | null | undefined, email: string | undefined): string {
  const source = (name && name.trim()) || (email ? email.split("@")[0] : "");
  return source.split(/\s+/)[0] ?? "";
}
