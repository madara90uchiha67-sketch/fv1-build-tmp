// Formas de datos tal como las devuelve el backend (ver app/api/** en el repositorio web).
// Los importes (Prisma Decimal) llegan como cadenas.

export type Plan = "FREE" | "PRO";

export interface User {
  id: string;
  name: string | null;
  email: string;
  plan: Plan | string;
}

export type SaleStatus = "COMPLETED" | "PENDING" | "CANCELLED" | "REFUNDED";

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessNote {
  id: string;
  title: string;
  content: string;
  noteDate: string | null;
  timeZone: string;
  reminderLeadMinutes: number | null;
  reminderAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Sale {
  id: string;
  description: string | null;
  amount: string;
  currency: string;
  status: SaleStatus;
  soldAt: string;
  customerId: string | null;
  productId: string | null;
  customer: { id: string; name: string } | null;
  product: { id: string; name: string } | null;
}

export interface ListResponse<T> {
  items: T[];
  totalCount: number;
  truncated: boolean;
}

export interface BusinessSummary {
  generatedAt: string;
  currencies: Array<{ currency: string; amount: string; count: number; previousAmount: string | null }>;
  dailySales: Array<{ date: string; currency: string; amount: string; count: number }>;
  dailyCustomers?: Array<{ date: string; count: number }>;
  dailyProducts?: Array<{ date: string; count: number }>;
  customers: number;
  activeProducts: number;
  products: number;
  nextNote: { id: string; title: string; noteDate: string | null; timeZone: string } | null;
}

export interface ConversationSummary {
  id: string;
  mode: string;
  updatedAt: string;
  preview: string;
}

export interface StrategyResult {
  problema: string;
  oportunidad: string;
  estrategia: string;
  proximos_pasos: string[];
}

// Monedas admitidas por el backend (biblioteca/validacion-negocio.ts).
export const MONEDAS = [
  "USD", "MXN", "COP", "EUR", "GBP", "CAD", "ARS", "CLP", "PEN", "BRL",
  "CRC", "GTQ", "DOP", "UYU", "BOB", "PYG", "HNL", "NIO", "JPY", "AUD",
] as const;

export const ESTADOS_VENTA: Array<{ value: SaleStatus; label: string }> = [
  { value: "COMPLETED", label: "Completada" },
  { value: "PENDING", label: "Pendiente" },
  { value: "CANCELLED", label: "Cancelada" },
  { value: "REFUNDED", label: "Reembolsada" },
];
