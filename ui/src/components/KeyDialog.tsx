import React, { useState, useEffect, useCallback } from "react";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadCsv, csvDate } from "@/lib/csv";

/**
 * Карточка ключа: что он потратил, что в нём можно поправить и что им делали.
 *
 * События живут здесь, а не отдельной страницей, потому что искать их можно
 * только по id ключа - а знает его именно это окно. Вкладка показывается лишь
 * полному доступу: в событиях лежат промпты и картинки клиентов.
 */
const DAY = 24 * 60 * 60;

const KeyDialog: React.FC<{ apiKey: any | null; onClose: () => void; onSaved: () => void }> = ({
  apiKey,
  onClose,
  onSaved,
}) => {
  const api = useApi();
  const { isFull } = useAuth();

  const [spend, setSpend] = useState<number | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ name: "", costLimitInUsd: "", revoked: false });
  const [tab, setTab] = useState("edit");

  useEffect(() => {
    if (!apiKey) return;

    setForm({
      name: apiKey.name || "",
      costLimitInUsd: apiKey.costLimitInUsd != null ? String(apiKey.costLimitInUsd) : "",
      revoked: !!apiKey.revoked,
    });
    setSpend(null);
    setEvents([]);
    setTab(isFull ? "edit" : "info");
  }, [apiKey, isFull]);

  // Расход берётся из счётчика, по которому шлюз гасит ключ на лимите - он же
  // переживает чистку истории событий.
  useEffect(() => {
    if (!api || !apiKey?.keyId) return;

    let cancelled = false;

    api
      .getKeySpend(apiKey.keyId)
      .then((r: any) => {
        if (!cancelled) setSpend((r?.costInMicroDollars ?? 0) / 1000000);
      })
      .catch(() => {
        if (!cancelled) setSpend(null);
      });

    return () => {
      cancelled = true;
    };
  }, [api, apiKey?.keyId]);

  const loadEvents = useCallback(async () => {
    if (!api || !apiKey?.keyId) return;

    setLoadingEvents(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const list = await api.listEvents({
        keyIds: apiKey.keyId,
        start: String(now - 30 * DAY),
        end: String(now),
      });
      setEvents(Array.isArray(list) ? list : []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingEvents(false);
    }
  }, [api, apiKey?.keyId]);

  useEffect(() => {
    if (tab === "events") loadEvents();
  }, [tab, loadEvents]);

  const save = async () => {
    if (!api || !apiKey?.keyId) return;

    const body: any = { name: form.name, revoked: form.revoked };

    const limit = parseFloat(form.costLimitInUsd);
    if (form.costLimitInUsd !== "") {
      if (!(limit >= 0)) {
        toast.error("The cost limit has to be a number");
        return;
      }
      body.costLimitInUsd = limit;
    }

    setSaving(true);
    try {
      await api.updateKey(apiKey.keyId, body);
      toast.success("Key updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!apiKey) return null;

  const limit = apiKey.costLimitInUsd;

  return (
    <Dialog open={!!apiKey} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{apiKey.name || apiKey.keyId}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 rounded-lg border border-border p-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Spent</p>
            <p className="font-medium">{spend === null ? "…" : `$${spend.toFixed(4)}`}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Limit</p>
            <p className="font-medium">{limit ? `$${limit}` : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Left</p>
            <p className="font-medium">
              {limit && spend !== null ? `$${Math.max(0, limit - spend).toFixed(4)}` : "—"}
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {isFull && <TabsTrigger value="edit">Edit</TabsTrigger>}
            {!isFull && <TabsTrigger value="info">Details</TabsTrigger>}
            {isFull && (
              <TabsTrigger value="events">Events</TabsTrigger>
            )}
          </TabsList>

          {isFull && (
            <TabsContent value="edit" className="space-y-3 pt-3">
              <div>
                <Label>Name</Label>
                <Input
                  className="mt-1"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <Label>Cost Limit (USD)</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costLimitInUsd}
                  onChange={(e) => setForm((p) => ({ ...p, costLimitInUsd: e.target.value }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Revoked</Label>
                  <p className="text-xs text-muted-foreground">A revoked key stops working at once.</p>
                </div>
                <Switch
                  checked={form.revoked}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, revoked: v }))}
                />
              </div>
              <Button className="w-full" onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </TabsContent>
          )}

          {!isFull && (
            <TabsContent value="info" className="space-y-2 pt-3 text-sm">
              <p className="text-muted-foreground">
                Unlock full access to change this key.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Tags</p>
                  <p>{apiKey.tags?.join(", ") || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p>{apiKey.revoked ? "Revoked" : "Active"}</p>
                </div>
              </div>
            </TabsContent>
          )}

          {isFull && (
            <TabsContent value="events" className="pt-3">
              {loadingEvents ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : events.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No requests in the last 30 days
                </p>
              ) : (
                <>
                  <div className="mb-2 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        downloadCsv(`events-${apiKey.keyId}`, events, [
                          { header: "Time", value: (e: any) => csvDate(e.created_at) },
                          { header: "Model", value: (e: any) => e.model },
                          { header: "Status", value: (e: any) => e.status },
                          { header: "Cost USD", value: (e: any) => e.cost_in_usd },
                          { header: "Prompt tokens", value: (e: any) => e.prompt_token_count },
                          { header: "Completion tokens", value: (e: any) => e.completion_token_count },
                          { header: "Latency ms", value: (e: any) => e.latency_in_ms },
                        ])
                      }
                    >
                      Export CSV
                    </Button>
                  </div>
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Time</TableHead>
                          <TableHead>Model</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Cost</TableHead>
                          <TableHead>Tokens</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {events.map((e: any) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              {e.created_at ? new Date(e.created_at * 1000).toLocaleString() : "—"}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{e.model || "—"}</TableCell>
                            <TableCell
                              className={`font-mono text-xs ${
                                e.status >= 200 && e.status < 300 ? "text-success" : "text-destructive"
                              }`}
                            >
                              {e.status}
                            </TableCell>
                            <TableCell className="text-sm">
                              {e.cost_in_usd != null ? `$${e.cost_in_usd.toFixed(4)}` : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              ↑{e.prompt_token_count ?? 0} ↓{e.completion_token_count ?? 0}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default KeyDialog;
