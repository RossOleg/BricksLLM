/**
 * Событие, по которому панель уходит на экран входа.
 *
 * Сессия живёт в HttpOnly-куке и истекает сама, так что 401 может прийти в любой
 * момент — в том числе в фоновом запросе, за которым никто не следит.
 */
export const UNAUTHORIZED_EVENT = "bricksllm:unauthorized";

/**
 * Клиент админского API.
 *
 * Адреса относительные, потому что панель отдаётся тем же сервером, что и API:
 * один origin, никакого CORS и никакого preflight (который всё равно не смог бы
 * унести с собой заголовок с ключом). Кука уходит сама, ключей здесь нет.
 */
export class BricksApi {
  private async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v) url.searchParams.append(k, v);
      });
    }
    const res = await fetch(url.toString(), {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      throw new Error("Session expired, please sign in again");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || err.title || `Error ${res.status}`);
    }
    if (res.status === 204) return null as T;
    return res.json();
  }

  // Health
  healthCheck() { return this.request<void>("GET", "/api/health"); }

  // Keys
  /** Отдаёт { keys, count }, а не голый массив - единственный такой список. */
  listKeys(data: any) { return this.request<any>("POST", "/api/v2/key-management/keys", data); }
  /** Создание и правка живут без префикса v2, и правка требует id в пути. */
  createKey(data: any) { return this.request<any>("PUT", "/api/key-management/keys", data); }
  updateKey(keyId: string, data: any) { return this.request<any>("PATCH", `/api/key-management/keys/${keyId}`, data); }

  // Provider Settings
  listProviderSettings(ids?: string[]) {
    const params = ids?.length ? { ids: ids.join(",") } : undefined;
    return this.request<any[]>("GET", "/api/provider-settings", undefined, params);
  }
  /** Создание настройки провайдера - PUT, а не POST. */
  createProviderSetting(data: any) { return this.request<any>("PUT", "/api/provider-settings", data); }
  updateProviderSetting(id: string, data: any) { return this.request<any>("PATCH", `/api/provider-settings/${id}`, data); }

  // Events
  listEvents(params?: Record<string, string>) { return this.request<any[]>("GET", "/api/events", undefined, params); }

  // Users
  listUsers(params?: Record<string, string>) { return this.request<any[]>("GET", "/api/users", undefined, params); }
  createUser(data: any) { return this.request<any>("POST", "/api/users", data); }
  updateUser(id: string, data: any) { return this.request<any>("PATCH", `/api/users/${id}`, data); }

  // Routes
  listRoutes() { return this.request<any[]>("GET", "/api/routes"); }
  createRoute(data: any) { return this.request<any>("POST", "/api/routes", data); }
  deleteRoute(id: string) { return this.request<any>("DELETE", `/api/routes/${id}`); }

  // Custom Providers
  listCustomProviders() { return this.request<any[]>("GET", "/api/custom/providers"); }
  createCustomProvider(data: any) { return this.request<any>("POST", "/api/custom/providers", data); }

  // Policies
  listPolicies(tags: string[]) {
    return this.request<any[]>("GET", "/api/policies", undefined, { tags: tags.join(",") });
  }
  createPolicy(data: any) { return this.request<any>("POST", "/api/policies", data); }
  updatePolicy(id: string, data: any) { return this.request<any>("PATCH", `/api/policies/${id}`, data); }

  // Reporting
  getMetrics(data: any) { return this.request<any>("POST", "/api/reporting/events", data); }
  getTopKeys(data: any) { return this.request<any>("POST", "/api/reporting/top-keys", data); }
}
