import { fetch as expoFetch } from "expo/fetch";
import { API_URL, UI_PREVIEW } from "./config";
import { previewResponse } from "./preview-fixtures";
import { clearTokens, loadTokens, saveTokens, type Tokens } from "./tokens";

export type ApiErrorKind = "network" | "auth" | "limit" | "client" | "server" | "aborted";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status: number;
  limitReached: boolean;
  /** Solo para «network»: «timeout» = el servidor no respondió a tiempo; «offline» = no hubo conexión. */
  reason?: "timeout" | "offline";
  constructor(message: string, kind: ApiErrorKind, status = 0, limitReached = false) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.limitReached = limitReached;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Ocurrió un error inesperado. Inténtalo de nuevo.";
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "network";
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

type Headers_ = Record<string, string>;

async function fetchWithTimeout(
  url: string,
  init: { method?: string; body?: string; headers?: Headers_ },
  timeoutMs = 20000,
  impl: typeof fetch = fetch,
  external?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onAbort);
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await impl(url, { ...init, signal: controller.signal });
  } catch {
    if (external?.aborted) throw new ApiError("Solicitud cancelada.", "aborted");
    if (timedOut) throw Object.assign(new ApiError("El servidor tardó más de lo normal en responder. Inténtalo de nuevo en un momento.", "network"), { reason: "timeout" as const });
    throw Object.assign(new ApiError("No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.", "network"), { reason: "offline" as const });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }
}

// --- Sesión -----------------------------------------------------------------

let onSessionLost: (() => void) | null = null;
export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler;
}

export function tokensFromResponse(data: { accessToken: string; refreshToken: string; expiresIn: number }): Tokens {
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
  };
}

// El backend rota el token de renovación en cada uso: solo puede haber una renovación en vuelo.
let refreshing: Promise<Tokens | null> | null = null;

export function refreshTokens(): Promise<Tokens | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const current = await loadTokens();
    if (!current) return null;
    const res = await fetchWithTimeout(`${API_URL}/api/mobile/auth/refresh`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (res.status === 401) {
      await clearTokens();
      onSessionLost?.();
      return null;
    }
    if (!res.ok) throw await toApiError(res);
    const data = await res.json();
    const tokens = tokensFromResponse(data);
    await saveTokens(tokens);
    return tokens;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() < 30_000) {
    const renewed = await refreshTokens();
    return renewed?.accessToken ?? null;
  }
  return tokens.accessToken;
}

// --- Peticiones ---------------------------------------------------------------

async function toApiError(res: Response): Promise<ApiError> {
  let message = "";
  let limitReached = false;
  try {
    const data = await res.json();
    if (typeof data?.error === "string") message = data.error;
    limitReached = data?.limitReached === true;
  } catch {
    // Respuesta sin JSON.
  }
  const kind: ApiErrorKind = res.status === 401 ? "auth" : res.status === 429 ? "limit" : res.status >= 500 ? "server" : "client";
  const fallback =
    kind === "server" ? "Founder no está disponible en este momento. Inténtalo de nuevo en unos minutos."
    : kind === "limit" ? "Alcanzaste un límite de uso. Inténtalo más tarde."
    : kind === "auth" ? "Tu sesión expiró. Inicia sesión de nuevo."
    : "No se pudo completar la solicitud.";
  return new ApiError(message || fallback, kind, res.status, limitReached);
}

interface AuthedInit {
  method?: string;
  body?: string;
  headers?: Headers_;
  signal?: AbortSignal;
}

export async function authedFetch(
  path: string,
  init: AuthedInit,
  options: { impl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Response> {
  const send = (token: string) =>
    fetchWithTimeout(
      `${API_URL}${path}`,
      { method: init.method, body: init.body, headers: { ...JSON_HEADERS, ...init.headers, Authorization: `Bearer ${token}` } },
      options.timeoutMs,
      options.impl,
      init.signal,
    );
  const token = await getAccessToken();
  if (!token) throw new ApiError("Inicia sesión para continuar.", "auth", 401);
  let res = await send(token);
  if (res.status === 401) {
    const renewed = await refreshTokens();
    if (!renewed) throw new ApiError("Tu sesión expiró. Inicia sesión de nuevo.", "auth", 401);
    res = await send(renewed.accessToken);
  }
  return res;
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const { method = "GET", body, auth = true, signal, timeoutMs } = options;
  if (UI_PREVIEW) return previewResponse<T>(path, method);
  const init: AuthedInit = { method, body: body === undefined ? undefined : JSON.stringify(body), signal };
  const res = auth
    ? await authedFetch(path, init, { timeoutMs })
    : await fetchWithTimeout(`${API_URL}${path}`, { method, body: init.body, headers: JSON_HEADERS }, timeoutMs, fetch, signal);
  if (!res.ok) throw await toApiError(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("Respuesta inesperada del servidor.", "server", res.status);
  }
}

// --- Chat con streaming (SSE) -------------------------------------------------

export type ChatEvent =
  | { type: "meta"; conversationId: string }
  | { type: "delta"; text: string }
  | { type: "done"; remaining: number; partial?: boolean }
  | { type: "error"; message: string; partial?: boolean };

export async function streamChat(params: {
  content: string;
  conversationId: string | null;
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
  /** Cliente HTTP alternativo (por defecto expo/fetch, que lee el flujo; el fetch normal entrega la respuesta completa). */
  impl?: typeof fetch;
  /** «voice»: respuestas breves y límites de seguridad de voz aplicados también en el servidor. */
  channel?: "voice";
}): Promise<void> {
  const res = await authedFetch(
    "/api/chat",
    {
      method: "POST",
      body: JSON.stringify({ content: params.content, mode: "free", conversationId: params.conversationId ?? undefined, ...(params.channel ? { channel: params.channel } : {}) }),
      headers: { Accept: "text/event-stream" },
      signal: params.signal,
    },
    // expo/fetch permite leer el cuerpo como flujo; el fetch de React Native no.
    { impl: params.impl ?? (expoFetch as unknown as typeof fetch), timeoutMs: 30000 },
  );
  if (!res.ok) throw await toApiError(res);

  const handleBlock = (block: string) => {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        params.onEvent(JSON.parse(raw) as ChatEvent);
      } catch {
        // Evento mal formado: se ignora.
      }
    }
  };

  try {
    const body = res.body;
    if (!body) {
      (await res.text()).split("\n\n").forEach(handleBlock);
      return;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        handleBlock(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleBlock(buffer);
  } catch (error) {
    if (params.signal?.aborted) throw new ApiError("Solicitud cancelada.", "aborted");
    if (error instanceof ApiError) throw error;
    throw new ApiError("Se perdió la conexión mientras Founder respondía.", "network");
  }
}
