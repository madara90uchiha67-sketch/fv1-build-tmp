// Datos de ejemplo SOLO para la compilación de verificación visual (EXPO_PUBLIC_UI_PREVIEW=1).
// No se usan en el APK entregado y no representan datos reales de nadie.
const day = (n: number) => new Date(Date.UTC(2026, 10, 19 - n)).toISOString();

const sales = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`,
  description: i % 3 === 0 ? "Paquete de asesoría estratégica trimestral con seguimiento mensual y soporte" : i % 3 === 1 ? "Venta mostrador" : null,
  amount: String(120 + i * 83.5),
  currency: "USD",
  status: i === 4 ? "PENDING" : "COMPLETED",
  soldAt: day(i),
  customerId: "c1",
  productId: "p1",
  customer: { id: "c1", name: i % 2 ? "María Fernanda Rodríguez Castellanos" : "Juan" },
  product: { id: "p1", name: "Asesoría" },
}));

const customers = ["Ana Gómez", "Distribuidora La Esperanza S.A.S.", "Luis Prado", "Camila Torres"].map((name, i) => ({
  id: `c${i}`, name, email: i % 2 ? `contacto${i}@ejemplo.com` : null, phone: null, company: i === 1 ? "Distribuciones y Comercializadora del Norte" : null, notes: null, createdAt: day(i), updatedAt: day(i),
}));

const products = ["Asesoría estratégica", "Plan mensual", "Taller de ventas con un nombre bastante largo para probar"].map((name, i) => ({
  id: `p${i}`, name, description: i === 0 ? "Sesión de 60 minutos" : null, price: String(49 + i * 40), currency: "USD", isArchived: i === 2, createdAt: day(i), updatedAt: day(i),
}));

const notes = [
  { id: "n1", title: "Llamar a proveedor", content: "Confirmar el precio de la nueva línea y las condiciones de entrega antes del viernes.", noteDate: day(-1), timeZone: "UTC", reminderLeadMinutes: 30, reminderAt: null },
  { id: "n2", title: "Idea de campaña", content: "Probar una oferta de lanzamiento con clientes actuales.", noteDate: null, timeZone: "UTC", reminderLeadMinutes: null, reminderAt: null },
];

const list = <T,>(items: T[]) => ({ items, totalCount: items.length, truncated: false });

export function previewResponse<T>(path: string, method: string): T {
  const p = path.split("?")[0];
  let body: unknown = {};
  if (p === "/api/business/summary") {
    body = {
      generatedAt: day(0),
      currencies: [{ currency: "USD", amount: "12480.5", count: 18, previousAmount: "9000" }],
      dailySales: Array.from({ length: 20 }, (_, i) => ({ date: day(19 - i), currency: "USD", amount: String(150 + ((i * 97) % 400)), count: 1 })),
      dailyCustomers: Array.from({ length: 12 }, (_, i) => ({ date: day(12 - i), count: (i * 3) % 5 })),
      dailyProducts: Array.from({ length: 12 }, (_, i) => ({ date: day(12 - i), count: i % 4 })),
      customers: 14, activeProducts: 6, products: 7, nextNote: null,
    };
  } else if (p === "/api/business/sales") body = list(sales);
  else if (p === "/api/business/customers") body = list(customers);
  else if (p === "/api/business/products") body = list(products);
  else if (p === "/api/business/notes") body = method === "POST" ? { item: notes[0] } : list(notes);
  else if (p === "/api/lab/experiments") {
    body = { items: [
      { id: "e1", title: "Oferta de lanzamiento", hypothesis: "Si ofrezco un 10 % de descuento a clientes actuales, aumentarán las recompras.", status: "ACTIVE", _count: { observations: 2 } },
    ] };
  } else if (p === "/api/conversations") {
    body = { conversations: [
      { id: "demo", mode: "free", updatedAt: day(0), preview: "¿Cómo puedo mejorar mis ventas de este mes si tengo pocos clientes nuevos?" },
      { id: "demo2", mode: "free", updatedAt: day(2), preview: "Ayúdame a definir un precio" },
    ] };
  } else if (p.startsWith("/api/conversations/")) {
    body = { id: "demo", messages: [
      { role: "user", content: "¿Cómo puedo mejorar mis ventas de este mes si tengo pocos clientes nuevos?" },
      { role: "assistant", content: "Empieza por tus clientes actuales: son más baratos de vender que los nuevos.\n\n1. Contacta a los 5 mejores y ofréceles una recompra.\n2. Pide una recomendación a cada uno.\n3. Mide cuántos responden en una semana.\n\n**Primer paso:** escribe hoy a tu cliente más reciente." },
      { role: "user", content: "Gracias" },
    ] };
  } else if (p === "/api/strategist") {
    body = { result: { problema: "Pocos clientes nuevos.", oportunidad: "Recompra de clientes actuales.", estrategia: "Ofrecer una oferta limitada a tus mejores clientes.", proximos_pasos: ["Listar 10 clientes", "Escribirles hoy", "Medir respuestas"] } };
  }
  void method;
  return body as T;
}
