import React, { useState, useEffect, useCallback } from "react";
import { useApi } from "@/hooks/useApi";
import { PageHeader, EmptyState } from "@/components/ui/page-helpers";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Copy, Settings, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { rememberSetting, recallSetting } from "@/lib/defaultSetting";

const PROVIDERS = ["openai", "anthropic", "azure", "vllm", "deepinfra"];

const emptyForm = { provider: "openai", apikey: "", name: "", allowedModels: "" };

/**
 * Настройки провайдера, и главное в них — список разрешённых моделей.
 *
 * Он действует на все ключи, привязанные к настройке: шлюз отклоняет запрос к
 * модели вне списка и тем же списком подрезает ответ /v1/models, так что
 * выпадающие списки, построенные по каталогу, показывают только доступное.
 *
 * Пустой список означает «без ограничений». И если у ключа несколько настроек,
 * достаточно одной без ограничений, чтобы разрешено было всё.
 */
const ProviderSettingsPage: React.FC = () => {
  const api = useApi();
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: "", allowedModels: "", apikey: "" });
  const [saving, setSaving] = useState(false);
  const [defaultId, setDefaultId] = useState(recallSetting());

  const load = useCallback(async () => {
    if (!api) return;

    setLoading(true);
    try {
      const list = await api.listProviderSettings();
      const available = Array.isArray(list) ? list : [];
      setSettings(available);

      // Запомненная настройка могла исчезнуть; единственную выбираем сами.
      setDefaultId((current) => {
        if (current && available.some((s: any) => s.id === current)) return current;
        const only = available.length === 1 ? available[0].id : "";
        if (only) rememberSetting(only);
        return only;
      });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!api) return;

    try {
      await api.createProviderSetting({
        provider: form.provider,
        setting: { apikey: form.apikey },
        name: form.name || undefined,
        allowedModels: form.allowedModels
          ? form.allowedModels.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      });

      toast.success("Provider setting created");
      setForm(emptyForm);
      setDialogOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const openEdit = (setting: any) => {
    setEditing(setting);
    setEditForm({
      name: setting.name || "",
      allowedModels: (setting.allowedModels || []).join(", "),
      apikey: "",
    });
  };

  const handleSave = async () => {
    if (!api || !editing) return;

    setSaving(true);
    try {
      const body: any = {
        name: editForm.name,
        // Пустое поле — осознанное «без ограничений», а не «не менять»: форма
        // показывает текущий список, и стереть его можно только нарочно.
        allowedModels: editForm.allowedModels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      // Ключ меняем, только если его ввели: пустое поле оставляет прежний.
      if (editForm.apikey) body.setting = { apikey: editForm.apikey };

      await api.updateProviderSetting(editing.id, body);
      toast.success("Provider setting updated");
      setEditing(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <div>
      <PageHeader title="Provider Settings" description="Provider connections and the models keys may use">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Provider
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Provider Setting</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <Label>Provider</Label>
                <Select value={form.provider} onValueChange={(v) => setForm((p) => ({ ...p, provider: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Name</Label>
                <Input className="mt-1" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <Label>API Key</Label>
                <Input
                  className="mt-1 font-mono text-sm"
                  type="password"
                  value={form.apikey}
                  onChange={(e) => setForm((p) => ({ ...p, apikey: e.target.value }))}
                />
              </div>
              <div>
                <Label>Allowed models (comma-separated)</Label>
                <Input
                  className="mt-1"
                  value={form.allowedModels}
                  onChange={(e) => setForm((p) => ({ ...p, allowedModels: e.target.value }))}
                  placeholder="gpt-5.4-nano, gpt-5-mini"
                />
                <p className="mt-1 text-xs text-muted-foreground">Empty means every model the account has.</p>
              </div>
              <Button onClick={handleCreate} className="w-full">
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="p-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : settings.length === 0 ? (
          <EmptyState
            icon={<Settings className="h-6 w-6" />}
            title="No provider settings"
            description="Add one to point keys at a provider"
          />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12">Default</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Allowed models</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <input
                        type="radio"
                        name="default-provider-setting"
                        className="h-4 w-4 accent-primary"
                        checked={defaultId === s.id}
                        onChange={() => {
                          setDefaultId(s.id);
                          rememberSetting(s.id);
                          toast.success("New keys will use this provider setting");
                        }}
                        title="Use this setting for new keys"
                      />
                    </TableCell>
                    <TableCell className="font-medium">{s.name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.provider}</Badge>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => copy(s.id)}
                        className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {s.id?.slice(0, 8)}… <Copy className="h-3 w-3" />
                      </button>
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.allowedModels?.length ? (
                        <span className="font-mono">{s.allowedModels.join(", ")}</span>
                      ) : (
                        <span className="text-muted-foreground">all models</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(s)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </motion.div>
        )}
      </div>

      <div className="px-6 pb-6">
        <p className="text-xs text-muted-foreground">
          The radio picks the setting new keys are created against. It is remembered in this browser
          and is a convenience, not a rule: for a support session the server decides, from
          SUPPORT_SETTING_ID or from the only setting there is. With more than one setting and no
          SUPPORT_SETTING_ID a support session is refused, and told so.
        </p>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.name || editing?.provider}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label>Name</Label>
              <Input className="mt-1" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <Label>Allowed models (comma-separated)</Label>
              <Input
                className="mt-1"
                value={editForm.allowedModels}
                onChange={(e) => setEditForm((p) => ({ ...p, allowedModels: e.target.value }))}
                placeholder="gpt-5.4-nano, gpt-5-mini"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Applies to every key using this setting: other models are refused, and /v1/models stops
                offering them. Empty means no restriction.
              </p>
            </div>
            <div>
              <Label>Replace API key</Label>
              <Input
                className="mt-1 font-mono text-sm"
                type="password"
                value={editForm.apikey}
                onChange={(e) => setEditForm((p) => ({ ...p, apikey: e.target.value }))}
                placeholder="leave empty to keep the current one"
              />
            </div>
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProviderSettingsPage;
