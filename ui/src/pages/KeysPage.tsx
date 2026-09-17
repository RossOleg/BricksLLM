import React, { useState, useEffect, useCallback } from "react";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/contexts/AuthContext";
import CreatedKeyDialog from "@/components/CreatedKeyDialog";
import KeyDialog from "@/components/KeyDialog";
import { downloadCsv } from "@/lib/csv";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui/page-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { KeyRound, Plus, Copy, Loader2, Search, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const AVAILABLE_TAGS = ["client", "daminion", "trial", "newyearevent"];

// Ключ, выписанный поддержкой, всегда попадает в эту группу и всегда с лимитом.
// Здесь это только подпись на форме - решает сервер, он же и проставляет тег.
const SUPPORT_TAG = "client";

// Ключ обязан назвать настройку провайдера, через которую пойдут его запросы.
// Раньше id был вписан в код одной строкой; теперь он выбирается, а последний
// выбор запоминается, чтобы не тыкать его каждый раз.
const SETTING_STORAGE_KEY = "bricks_setting_id";

function rememberSetting(id: string) {
  try { localStorage.setItem(SETTING_STORAGE_KEY, id); } catch { /* приватное окно */ }
}

function recallSetting(): string {
  try { return localStorage.getItem(SETTING_STORAGE_KEY) || ""; } catch { return ""; }
}

function generateKey() {
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  return `dam-${uuid}`;
}

/**
 * Сам ключ в таблице: по умолчанию скрыт, разворачивается и копируется.
 *
 * Показывается значение, а не keyId - тот внутренний и клиенту ни о чём не
 * говорит. Ключи, сохранённые хешем, показать нечем: в этом поле у них хеш,
 * и выдать его за ключ было бы хуже, чем честно сказать, что его нет.
 *
 * Хеш узнаём по самому значению - 64 шестнадцатеричных знака sha256, - а не по
 * полю isKeyNotHashed: оно появилось позже, по умолчанию false, и у ключей,
 * выписанных до него, соврало бы.
 */
const HASHED_KEY = /^[0-9a-f]{64}$/;

const KeyCell: React.FC<{ value?: string; keyId?: string; onCopy: (v: string) => void }> = ({
  value,
  keyId,
  onCopy,
}) => {
  const [shown, setShown] = useState(false);

  if (!value || HASHED_KEY.test(value)) {
    return (
      <span className="font-mono text-xs text-muted-foreground" title={keyId ? `id ${keyId}` : undefined}>
        stored hashed
      </span>
    );
  }

  const masked = value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;

  return (
    <div className="flex items-center gap-1" title={keyId ? `id ${keyId}` : undefined}>
      <button
        onClick={() => onCopy(value)}
        className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors break-all text-left"
      >
        {shown ? value : masked}
      </button>
      <button
        onClick={() => setShown((s) => !s)}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title={shown ? "Hide" : "Show"}
      >
        {shown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <button
        onClick={() => onCopy(value)}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Copy"
      >
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
};

const KeysPage: React.FC = () => {
  const api = useApi();
  const { isFull } = useAuth();
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<any | null>(null);
  // keyId -> потрачено в долларах; один запрос на весь показанный список.
  const [spend, setSpend] = useState<Record<string, number>>({});

  // Search
  const [searchTag, setSearchTag] = useState("");
  const [searchName, setSearchName] = useState("");

  // Настройки провайдера для выбора при создании ключа.
  const [settings, setSettings] = useState<any[]>([]);
  const [settingId, setSettingId] = useState<string>(recallSetting());

  // Create form
  const [form, setForm] = useState({
    name: "",
    key: generateKey(),
    tags: "",
    costLimitInUsd: "",
    costLimitInUsdOverTime: "",
    costLimitInUsdUnit: "d",
    rateLimitOverTime: "",
    rateLimitUnit: "d",
    ttl: "",
    shouldLogRequest: true,
    shouldLogResponse: true,
  });

  const loadSettings = useCallback(async () => {
    // Только полный режим выбирает провайдера; support-сессии его проставляет
    // сервер, и спрашивать список ей незачем.
    if (!api || !isFull) return;
    try {
      const list = await api.listProviderSettings();
      const available = Array.isArray(list) ? list : [];
      setSettings(available);

      // Если запомненной настройки больше нет - не молчим, а выбираем
      // единственную, когда она единственная.
      setSettingId((current) => {
        if (current && available.some((s: any) => s.id === current)) return current;
        return available.length === 1 ? available[0].id : "";
      });
    } catch (e: any) {
      toast.error(`Could not load providers: ${e.message}`);
    }
  }, [api, isFull]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const fetchKeys = async () => {
    if (!api) return;
    if (!searchTag && !searchName) {
      toast.error("Enter a tag or name to search");
      return;
    }
    setLoading(true);
    try {
      const body: any = { returnCount: true, order: "asc" };
      if (searchTag) body.tags = [searchTag.trim()];
      if (searchName) body.name = searchName.trim();
      const data = await api.listKeys(body);
      // Этот эндпоинт отдаёт { keys, count }, а не голый массив - в отличие от
      // остальных списков панели.
      const list = Array.isArray(data) ? data : data?.keys ?? [];
      setKeys(list);
      setSearched(true);

      const ids = list.map((k: any) => k.keyId).filter(Boolean);
      if (ids.length) {
        try {
          const reports = await api.getKeysSpend(ids);
          const map: Record<string, number> = {};
          for (const r of reports || []) map[r.id] = (r.costInMicroDollars ?? 0) / 1000000;
          setSpend(map);
        } catch {
          // Расход - дополнение к списку: без него таблица остаётся полезной.
          setSpend({});
        }
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!api) return;
    // Провайдера выбирает только полный режим; support-сессии его проставляет
    // сервер, поэтому и спрашивать не о чем.
    if (isFull && !settingId) {
      toast.error("Choose the provider this key will use");
      return;
    }

    // Ключ без потолка тратит, пока его не заметят. Сервер это тоже проверяет,
    // здесь - чтобы сказать об этом до отправки.
    const costLimit = parseFloat(form.costLimitInUsd);
    if (!isFull && !(costLimit > 0)) {
      toast.error("Set a cost limit greater than zero");
      return;
    }
    try {
      const body: any = {
        name: form.name,
        key: form.key,
        isKeyNotHashed: true,
        shouldLogRequest: form.shouldLogRequest,
        shouldLogResponse: form.shouldLogResponse,
      };
      if (isFull) body.settingIds = [settingId];
      if (form.costLimitInUsd) body.costLimitInUsd = parseFloat(form.costLimitInUsd);

      // Остальные способы задать лимит доступны только в полном режиме -
      // сервер отклонит их у support-сессии, так что и не отправляем.
      if (isFull) {
        if (form.tags) body.tags = form.tags.split(",").map(s => s.trim());
        if (form.costLimitInUsdOverTime) body.costLimitInUsdOverTime = parseFloat(form.costLimitInUsdOverTime);
        if (form.costLimitInUsdOverTime) body.costLimitInUsdUnit = form.costLimitInUsdUnit;
        if (form.rateLimitOverTime) body.rateLimitOverTime = parseInt(form.rateLimitOverTime);
        if (form.rateLimitOverTime) body.rateLimitUnit = form.rateLimitUnit;
        if (form.ttl) body.ttl = form.ttl;
      }
      await api.createKey(body);
      if (isFull) rememberSetting(settingId);
      setDialogOpen(false);
      // Ключ показывается один раз, в окне, которое не закрыть мимоходом.
      setCreatedKey(body.key);
      setForm({
        name: "", key: generateKey(), tags: "",
        costLimitInUsd: "", costLimitInUsdOverTime: "", costLimitInUsdUnit: "d",
        rateLimitOverTime: "", rateLimitUnit: "d", ttl: "",
        shouldLogRequest: true, shouldLogResponse: true,
      });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <div>
      <PageHeader title="Keys" description="Manage API keys for the proxy">
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (open) setForm(f => ({ ...f, key: generateKey() }));
        }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-1.5 h-3.5 w-3.5" /> Create Key</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Key</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              {isFull && (
              <div>
                <Label>Provider</Label>
                <Select value={settingId} onValueChange={setSettingId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={settings.length ? "Choose a provider setting" : "No provider settings found"} />
                  </SelectTrigger>
                  <SelectContent>
                    {settings.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name || s.id}{s.provider ? ` — ${s.provider}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Requests made with this key go through the chosen provider setting.
                </p>
              </div>
              )}
              <div><Label>Name</Label><Input className="mt-1" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="My key" /></div>
              {isFull && (
                <div>
                  <Label>Key</Label>
                  <div className="flex gap-2 mt-1">
                    <Input className="font-mono text-xs" value={form.key} onChange={e => setForm(p => ({ ...p, key: e.target.value }))} />
                    <Button variant="outline" size="icon" onClick={() => setForm(p => ({ ...p, key: generateKey() }))} title="Regenerate">🔄</Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Generated as dam- plus a uuid. Typing your own is only possible here.
                  </p>
                </div>
              )}
              {isFull ? (
                <div>
                  <Label>Tags</Label>
                  <div className="flex gap-2 flex-wrap mt-1">
                    {AVAILABLE_TAGS.map(t => {
                      const selected = form.tags.split(",").map(s => s.trim()).filter(Boolean).includes(t);
                      return (
                        <Button
                          key={t}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          onClick={() => {
                            const current = form.tags.split(",").map(s => s.trim()).filter(Boolean);
                            const next = selected ? current.filter(x => x !== t) : [...current, t];
                            setForm(p => ({ ...p, tags: next.join(", ") }));
                          }}
                        >
                          {t}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <Label>Tag</Label>
                  <p className="mt-1 text-sm font-mono">{SUPPORT_TAG}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Keys issued here always belong to this group.
                  </p>
                </div>
              )}
              <div>
                <Label>Cost Limit (USD){!isFull && " *"}</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costLimitInUsd}
                  onChange={e => setForm(p => ({ ...p, costLimitInUsd: e.target.value }))}
                />
                {!isFull && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Required, and greater than zero.
                  </p>
                )}
              </div>
              {isFull && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Cost Limit Over Time</Label><Input className="mt-1" type="number" value={form.costLimitInUsdOverTime} onChange={e => setForm(p => ({ ...p, costLimitInUsdOverTime: e.target.value }))} /></div>
                    <div>
                      <Label>Unit</Label>
                      <Select value={form.costLimitInUsdUnit} onValueChange={v => setForm(p => ({ ...p, costLimitInUsdUnit: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="h">Hour</SelectItem>
                          <SelectItem value="d">Day</SelectItem>
                          <SelectItem value="m">Month</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Rate Limit Over Time</Label><Input className="mt-1" type="number" value={form.rateLimitOverTime} onChange={e => setForm(p => ({ ...p, rateLimitOverTime: e.target.value }))} /></div>
                    <div>
                      <Label>Unit</Label>
                      <Select value={form.rateLimitUnit} onValueChange={v => setForm(p => ({ ...p, rateLimitUnit: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="h">Hour</SelectItem>
                          <SelectItem value="d">Day</SelectItem>
                          <SelectItem value="m">Month</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label>TTL</Label><Input className="mt-1" value={form.ttl} onChange={e => setForm(p => ({ ...p, ttl: e.target.value }))} placeholder="e.g. 24h" /></div>
                  <div className="flex items-center justify-between">
                    <Label>Log Requests</Label>
                    <Switch checked={form.shouldLogRequest} onCheckedChange={v => setForm(p => ({ ...p, shouldLogRequest: v }))} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Log Responses</Label>
                    <Switch checked={form.shouldLogResponse} onCheckedChange={v => setForm(p => ({ ...p, shouldLogResponse: v }))} />
                  </div>
                </>
              )}
              <Button onClick={handleCreate} className="w-full">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <KeyDialog apiKey={openKey} onClose={() => setOpenKey(null)} onSaved={fetchKeys} />

      <CreatedKeyDialog
        value={createdKey}
        onClose={() => {
          setCreatedKey(null);
          if (searched) fetchKeys();
        }}
      />

      <div className="p-6 space-y-4">
        {/* Search bar */}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Search by Tag</Label>
            <Select value={searchTag} onValueChange={setSearchTag}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select tag" /></SelectTrigger>
              <SelectContent>
                {AVAILABLE_TAGS.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Search by Name</Label>
            <Input className="mt-1" value={searchName} onChange={e => setSearchName(e.target.value)} placeholder="e.g. My Key" onKeyDown={e => e.key === "Enter" && fetchKeys()} />
          </div>
          <Button onClick={fetchKeys} disabled={loading} className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-1.5" />}
            Search
          </Button>
        </div>

        {searched && keys.length > 0 && (
          <div className="mb-3 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv("keys", keys, [
                  { header: "Name", value: (k: any) => k.name },
                  { header: "Key", value: (k: any) => k.key },
                  { header: "Key id", value: (k: any) => k.keyId },
                  { header: "Tags", value: (k: any) => k.tags?.join(" ") },
                  { header: "Spent USD", value: (k: any) => spend[k.keyId] },
                  { header: "Limit USD", value: (k: any) => k.costLimitInUsd },
                  { header: "Status", value: (k: any) => (k.revoked ? "revoked" : "active") },
                ])
              }
            >
              Export CSV
            </Button>
          </div>
        )}

        {!searched ? (
          <EmptyState icon={<KeyRound className="h-6 w-6" />} title="Search for keys" description="Enter a tag or name to find keys" />
        ) : keys.length === 0 ? (
          <EmptyState icon={<KeyRound className="h-6 w-6" />} title="No keys found" description="No keys match your search" />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Spent</TableHead>
                  <TableHead>Limit (USD)</TableHead>
                  <TableHead>Rate Limit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.keyId || key.key}>
                    <TableCell className="font-medium">
                      <button className="hover:underline" onClick={() => setOpenKey(key)}>
                        {key.name || "—"}
                      </button>
                    </TableCell>
                    <TableCell>
                      <KeyCell value={key.key} keyId={key.keyId} onCopy={copyText} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {key.tags?.map((t: string) => (
                          <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {spend[key.keyId] != null ? `$${spend[key.keyId].toFixed(4)}` : "—"}
                    </TableCell>
                    <TableCell>{key.costLimitInUsd ? `$${key.costLimitInUsd}` : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {key.rateLimitOverTime ? `${key.rateLimitOverTime}/${key.rateLimitUnit}` : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={key.revoked ? "revoked" : "active"}>
                        {key.revoked ? "Revoked" : "Active"}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default KeysPage;
