import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { UNAUTHORIZED_EVENT } from "@/lib/api";

/**
 * Панель больше не хранит админский ключ.
 *
 * Раньше он лежал в localStorage и подставлялся в каждый запрос из JS — а это не
 * узкий токен, а мастер-пароль шлюза: им читаются все ключи всех клиентов,
 * создаются и отзываются любые, и достаются настройки провайдеров с ключами
 * OpenAI. Один XSS на странице уносил всё это целиком.
 *
 * Теперь пароль уходит один раз в /api/login и меняется на HttpOnly-куку,
 * которую скрипт прочитать не может. Здесь остаётся только «пустили или нет».
 */
export type Role = "support" | "full";

interface AuthContextType {
  isAuthenticated: boolean;
  /** Полный доступ или только выписывание ключей. */
  role: Role | null;
  isFull: boolean;
  checking: boolean;
  /** Тем же вызовом делается и вход, и повышение прав: решает сервер по паролю. */
  login: (password: string) => Promise<Role>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<Role | null>(null);
  const [checking, setChecking] = useState(true);

  // Кука переживает перезагрузку страницы, поэтому при старте спрашиваем сервер,
  // жива ли она ещё: своего состояния у панели нет и быть не должно.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/session")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) { setRole(null); return; }
        const body = await res.json().catch(() => null);
        setRole(body?.role === "full" || body?.role === "support" ? body.role : null);
      })
      .catch(() => {
        if (!cancelled) setRole(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Сессия истекает сама, и 401 может прийти посреди работы — тогда роняем панель
  // на экран входа, а не показываем пустые таблицы.
  useEffect(() => {
    const onUnauthorized = () => setRole(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (password: string) => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || err?.title || "Sign in failed");
    }

    const body = await res.json();
    const granted: Role = body.role === "full" ? "full" : "support";
    setRole(granted);
    return granted;
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    setRole(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated: role !== null, role, isFull: role === "full", checking, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
