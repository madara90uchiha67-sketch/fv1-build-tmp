import { UI_PREVIEW } from "./config";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, request, setSessionLostHandler, tokensFromResponse } from "./api";
import { clearTokens, loadTokens, saveTokens } from "./tokens";
import type { User } from "./types";
import { cancelAllReminders } from "../../modules/founder-reminders";

// "error": hay tokens guardados pero no se pudo verificar la sesión (p. ej. sin conexión al abrir la app).
type Status = "loading" | "anon" | "auth" | "error";

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

interface SessionValue {
  status: Status;
  user: User | null;
  bootError: unknown;
  retryBoot: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { name: string; email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** Vuelve a consultar el plan y los datos de la cuenta (p. ej. tras suscribirse en la web). */
  refreshUser: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [bootError, setBootError] = useState<unknown>(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  useEffect(() => {
    setSessionLostHandler(() => {
      cancelAllReminders();
      setUser(null);
      setStatus("anon");
    });
    return () => setSessionLostHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      if (UI_PREVIEW) {
        setUser({ id: "demo", name: "Cristian", email: "demo@founder.test", plan: "PRO" });
        setStatus("auth");
        return;
      }
      const tokens = await loadTokens();
      if (!tokens) {
        if (!cancelled) setStatus("anon");
        return;
      }
      try {
        const data = await request<{ user: User }>("/api/mobile/auth/me");
        if (cancelled) return;
        setUser(data.user);
        setStatus("auth");
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.kind === "auth") {
          await clearTokens();
          setStatus("anon");
        } else {
          setBootError(error);
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await request<LoginResponse>("/api/mobile/auth/login", {
      method: "POST",
      auth: false,
      body: { email: email.trim(), password },
    });
    await saveTokens(tokensFromResponse(data));
    setUser(data.user);
    setStatus("auth");
  }, []);

  const signUp = useCallback(
    async ({ name, email, password }: { name: string; email: string; password: string }) => {
      await request("/api/auth/register", {
        method: "POST",
        auth: false,
        body: { name: name.trim(), email: email.trim(), password, agreed: true },
      });
      await signIn(email, password);
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    try {
      await request("/api/mobile/auth/logout", { method: "POST", body: {}, timeoutMs: 8000 });
    } catch {
      // Si no hay red, igualmente se borran los tokens locales.
    }
    cancelAllReminders(); // los avisos son de esta cuenta: no deben sonar para la siguiente
    await clearTokens();
    setUser(null);
    setStatus("anon");
  }, []);

  const refreshUser = useCallback(async () => {
    if (UI_PREVIEW) return;
    try {
      const data = await request<{ user: User }>("/api/mobile/auth/me");
      setUser(data.user);
    } catch {
      // Sin red: se conserva el plan que ya se conocía.
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    await request("/api/account/delete", { method: "DELETE", timeoutMs: 60000 });
    cancelAllReminders();
    await clearTokens();
    setUser(null);
    setStatus("anon");
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      bootError,
      retryBoot: () => setBootAttempt((n) => n + 1),
      signIn,
      signUp,
      signOut,
      deleteAccount,
      refreshUser,
    }),
    [status, user, bootError, signIn, signUp, signOut, deleteAccount, refreshUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession debe usarse dentro de SessionProvider.");
  return value;
}
