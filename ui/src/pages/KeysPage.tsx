import React, { useState, useEffect, useCallback } from "react";
import { useApi } from "@/hooks/useApi";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui/page-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { KeyRound, Plus, Copy, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const AVAILABLE_TAGS = ["client", "daminion", "trial", "newyearevent"];

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

const KeysPage: React.FC = () => {
  const api = useApi();
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

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
    if (!api) return;
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
  }, [api]);

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
      setKeys(Array.isArray(data) ? data : data?.keys ?? []);
      setSearched(true);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!api) return;
    if (!settingId) {
      toast.error("Choose the provider this key will use");
      return;
    }
    try {
      const body: any = {
        name: form.name,
        key: form.key,
        settingIds: [settingId],
        isKeyNotHashed: true,
        shouldLogRequest: form.shouldLogRequest,
        shouldLogResponse: form.shouldLogResponse,
      };
      if (form.tags) body.tags = form.tags.split(",").map(s => s.trim());
      if (form.costLimitInUsd) body.costLimitInUsd = parseFloat(form.costLimitInUsd);
      if (form.costLimitInUsdOverTime) body.costLimitInUsdOverTime = parseFloat(form.costLimitInUsdOverTime);
      if (form.costLimitInUsdOverTime) body.costLimitInUsdUnit = form.costLimitInUsdUnit;
      if (form.rateLimitOverTime) body.rateLimitOverTime = parseInt(form.rateLimitOverTime);
      if (form.rateLimitOverTime) body.rateLimitUnit = form.rateLimitUnit;
      if (form.ttl) body.ttl = form.ttl;
      await api.createKey(body);
      rememberSetting(settingId);
      toast.success("Key created");
      setDialogOpen(false);
      setForm({
        name: "", key: generateKey(), tags: "",
        costLimitInUsd: "", costLimitInUsdOverTime: "", costLimitInUsdUnit: "d",
        rateLimitOverTime: "", rateLimitUnit: "d", ttl: "",
        shouldLogRequest: true, shouldLogResponse: true,
      });
      // Re-fetch if we had a search
      if (searched) fetchKeys();
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
              <div><Label>Name</Label><Input className="mt-1" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="My key" /></div>
              <div>
                <Label>Key (auto-generated)</Label>
                <div className="flex gap-2 mt-1">
                  <Input className="font-mono text-xs" value={form.key} onChange={e => setForm(p => ({ ...p, key: e.target.value }))} />
                  <Button variant="outline" size="icon" onClick={() => setForm(p => ({ ...p, key: generateKey() }))} title="Regenerate">🔄</Button>
                </div>
              </div>
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
              <div><Label>Cost Limit (USD)</Label><Input className="mt-1" type="number" value={form.costLimitInUsd} onChange={e => setForm(p => ({ ...p, costLimitInUsd: e.target.value }))} /></div>
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
              <Button onClick={handleCreate} className="w-full">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

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
                  <TableHead>ID</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Limit (USD)</TableHead>
                  <TableHead>Rate Limit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.keyId || key.key}>
                    <TableCell className="font-medium">{key.name || "—"}</TableCell>
                    <TableCell>
                      <button onClick={() => copyText(key.keyId)} className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors">
                        {key.keyId?.slice(0, 8)}… <Copy className="h-3 w-3" />
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {key.tags?.map((t: string) => (
                          <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{key.costLimitInUsd != null ? `$${key.costLimitInUsd}` : "—"}</TableCell>
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
