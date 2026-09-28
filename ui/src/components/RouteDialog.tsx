import React, { useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Создание маршрута.
 *
 * Маршрут - это адрес /api/routes/<path> на прокси и цепочка шагов: запрос
 * уходит в первый шаг, при ошибке - в следующий. Пускает туда только ключи из
 * списка, и сервер проверяет, что их настройки провайдера подходят под шаги.
 *
 * Правки маршрута API не умеет - только создать и удалить.
 */
type Step = {
  provider: string;
  model: string;
  retries: string;
  retryInterval: string;
  timeout: string;
  apiVersion: string;
  deploymentId: string;
};

const emptyStep = (): Step => ({
  provider: "openai",
  model: "",
  retries: "",
  retryInterval: "",
  timeout: "",
  apiVersion: "",
  deploymentId: "",
});

const NO_RETRY = "__none__";

const RouteDialog: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void }> = ({
  open,
  onClose,
  onSaved,
}) => {
  const api = useApi();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [retryStrategy, setRetryStrategy] = useState(NO_RETRY);
  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [cacheTtl, setCacheTtl] = useState("");
  const [steps, setSteps] = useState<Step[]>([emptyStep()]);
  const [keys, setKeys] = useState<{ keyId: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  // Подсказки для поля модели. Своего списка здесь нет: сервер отдаёт тот же,
  // по которому проверяет маршрут, - модели из таблицы цен.
  const [models, setModels] = useState<Record<string, { chat: string[]; embeddings: string[] }>>({});

  // Поиск ключей по имени: id ключа нигде в панели не набирают руками.
  const [keyQuery, setKeyQuery] = useState("");
  const [found, setFound] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPath("");
    setRetryStrategy(NO_RETRY);
    setCacheEnabled(false);
    setCacheTtl("");
    setSteps([emptyStep()]);
    setKeys([]);
    setKeyQuery("");
    setFound([]);
  }, [open]);

  useEffect(() => {
    if (!open || !api) return;
    api
      .getRouteModels()
      .then((m) => setModels(m || {}))
      .catch(() => setModels({}));
  }, [open, api]);

  const searchKeys = async () => {
    if (!api || !keyQuery.trim()) return;
    setSearching(true);
    try {
      const data = await api.listKeys({ name: keyQuery.trim(), limit: 20 });
      setFound(Array.isArray(data) ? data : data?.keys ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSearching(false);
    }
  };

  const updateStep = (i: number, patch: Partial<Step>) =>
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const save = async () => {
    if (!api) return;
    if (!name.trim() || !path.trim()) {
      toast.error("Name and path are required");
      return;
    }
    if (keys.length === 0) {
      toast.error("Add at least one key that may use this route");
      return;
    }
    if (steps.some((s) => !s.model.trim())) {
      toast.error("Every step needs a model");
      return;
    }

    const body: any = {
      name: name.trim(),
      // Сервер хранит путь как есть и сравнивает с хвостом /api/routes/...
      path: "/" + path.trim().replace(/^\/+/, ""),
      keyIds: keys.map((k) => k.keyId),
      cacheConfig: { enabled: cacheEnabled, ttl: cacheEnabled ? cacheTtl.trim() : "" },
      steps: steps.map((s) => {
        const step: any = { provider: s.provider, model: s.model.trim() };
        if (s.retries) step.retries = parseInt(s.retries) || 0;
        if (s.retryInterval.trim()) step.retryInterval = s.retryInterval.trim();
        if (s.timeout.trim()) step.timeout = s.timeout.trim();
        if (s.provider === "azure") {
          step.params = { apiVersion: s.apiVersion.trim(), deploymentId: s.deploymentId.trim() };
        }
        return step;
      }),
    };
    if (retryStrategy !== NO_RETRY) body.retryStrategy = retryStrategy;

    setSaving(true);
    try {
      await api.createRoute(body);
      toast.success("Route created");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Route</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name *</Label>
              <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Path *</Label>
              <div className="mt-1 flex items-center gap-1">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">/api/routes/</span>
                <Input
                  className="font-mono text-xs"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="tagging"
                />
              </div>
            </div>
          </div>

          <div>
            <Label>Keys *</Label>
            <p className="text-xs text-muted-foreground">
              Only these keys may call the route, and their provider settings must cover every step's provider.
            </p>
            {keys.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {keys.map((k) => (
                  <span
                    key={k.keyId}
                    className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
                    title={k.keyId}
                  >
                    {k.name || k.keyId}
                    <button onClick={() => setKeys((all) => all.filter((x) => x.keyId !== k.keyId))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <Input
                value={keyQuery}
                onChange={(e) => setKeyQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchKeys()}
                placeholder="Find a key by name"
              />
              <Button variant="outline" size="sm" onClick={searchKeys} disabled={searching} className="shrink-0">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {found.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border">
                {found.map((k: any) => {
                  const added = keys.some((x) => x.keyId === k.keyId);
                  return (
                    <button
                      key={k.keyId}
                      disabled={added}
                      className="flex w-full items-center justify-between px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
                      onClick={() => setKeys((all) => [...all, { keyId: k.keyId, name: k.name }])}
                    >
                      <span>{k.name || "—"}</span>
                      <span className="font-mono text-muted-foreground">{added ? "added" : k.keyId}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Retry strategy</Label>
              <Select value={retryStrategy} onValueChange={setRetryStrategy}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RETRY}>None</SelectItem>
                  <SelectItem value="constant">Constant</SelectItem>
                  <SelectItem value="exponential">Exponential</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch checked={cacheEnabled} onCheckedChange={setCacheEnabled} />
              <Label>Cache responses</Label>
            </div>
            <div>
              <Label>Cache TTL</Label>
              <Input
                className="mt-1"
                value={cacheTtl}
                disabled={!cacheEnabled}
                onChange={(e) => setCacheTtl(e.target.value)}
                placeholder="168h (max 720h)"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Steps *</Label>
              <Button variant="outline" size="sm" onClick={() => setSteps((s) => [...s, emptyStep()])}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add fallback
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tried in order. Any model from the gateway's price table works; chat and embedding models cannot be mixed
              in one route.
            </p>

            <div className="mt-2 space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Step {i + 1}</span>
                    {steps.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={s.provider} onValueChange={(v) => updateStep(i, { provider: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">openai</SelectItem>
                        <SelectItem value="azure">azure</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      list={`route-models-${s.provider}`}
                      className="font-mono text-xs"
                      value={s.model}
                      onChange={(e) => updateStep(i, { model: e.target.value })}
                      placeholder="Model"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      type="number"
                      min="0"
                      value={s.retries}
                      onChange={(e) => updateStep(i, { retries: e.target.value })}
                      placeholder="Retries"
                    />
                    <Input
                      value={s.retryInterval}
                      onChange={(e) => updateStep(i, { retryInterval: e.target.value })}
                      placeholder="Retry interval, e.g. 2s"
                    />
                    <Input
                      value={s.timeout}
                      onChange={(e) => updateStep(i, { timeout: e.target.value })}
                      placeholder="Timeout (default 5m)"
                    />
                  </div>
                  {s.provider === "azure" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={s.apiVersion}
                        onChange={(e) => updateStep(i, { apiVersion: e.target.value })}
                        placeholder="apiVersion *"
                      />
                      <Input
                        value={s.deploymentId}
                        onChange={(e) => updateStep(i, { deploymentId: e.target.value })}
                        placeholder="deploymentId *"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {Object.entries(models).map(([provider, list]) => (
              <datalist key={provider} id={`route-models-${provider}`}>
                {list.chat.map((m) => (
                  <option key={m} value={m} />
                ))}
                {list.embeddings.map((m) => (
                  <option key={m} value={m} label="embeddings" />
                ))}
              </datalist>
            ))}
          </div>
        </div>

        <Button className="w-full" onClick={save} disabled={saving}>
          {saving ? "Creating..." : "Create"}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default RouteDialog;
