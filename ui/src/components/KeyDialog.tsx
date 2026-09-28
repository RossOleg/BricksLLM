import React, { useState, useEffect, useCallback, useMemo } from "react";
import { DateRange } from "react-day-picker";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadCsv, csvDate } from "@/lib/csv";
import EventDetails from "@/components/EventDetails";
import DateRangeField, { toPeriod } from "@/components/DateRangeField";
import { daminionFields } from "@/lib/payload";

/**
 * Карточка ключа: что он потратил, что в нём можно поправить и что им делали.
 *
 * События живут здесь, а не отдельной страницей, потому что искать их можно
 * только по id ключа - а знает его именно это окно. Вкладка показывается лишь
 * полному доступу: в событиях лежат промпты и картинки клиентов.
 */
const DAY = 24 * 60 * 60;

/** Период истории: последние N дней или свой диапазон. */
type Span = "30" | "60" | "90" | "custom";

/** Значение фильтра "без отбора". Пустую строку Select не принимает. */
const ALL = "__all__";

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
  // Раскрытое событие: тела грузятся по id и только для него.
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [span, setSpan] = useState<Span>("30");
  const [range, setRange] = useState<DateRange | undefined>();
  const [catalog, setCatalog] = useState(ALL);
  const [mediaType, setMediaType] = useState(ALL);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    tags: "",
    costLimitInUsd: "",
    costLimitInUsdOverTime: "",
    costLimitInUsdUnit: "d",
    rateLimitOverTime: "",
    rateLimitUnit: "d",
    shouldLogRequest: false,
    shouldLogResponse: false,
    revoked: false,
  });
  const [tab, setTab] = useState("edit");

  useEffect(() => {
    if (!apiKey) return;

    setForm({
      name: apiKey.name || "",
      tags: (apiKey.tags || []).join(", "),
      costLimitInUsd: apiKey.costLimitInUsd != null ? String(apiKey.costLimitInUsd) : "",
      costLimitInUsdOverTime: apiKey.costLimitInUsdOverTime ? String(apiKey.costLimitInUsdOverTime) : "",
      costLimitInUsdUnit: apiKey.costLimitInUsdUnit || "d",
      rateLimitOverTime: apiKey.rateLimitOverTime ? String(apiKey.rateLimitOverTime) : "",
      rateLimitUnit: apiKey.rateLimitUnit || "d",
      shouldLogRequest: !!apiKey.shouldLogRequest,
      shouldLogResponse: !!apiKey.shouldLogResponse,
      revoked: !!apiKey.revoked,
    });
    setSpend(null);
    setEvents([]);
    setOpenEvent(null);
    setSpan("30");
    setRange(undefined);
    setCatalog(ALL);
    setMediaType(ALL);
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

    let period: { start: number; end: number } | null;
    if (span === "custom") {
      // Пока диапазон не выбран, спрашивать нечего: API без границ ключ не примет.
      period = toPeriod(range);
      if (!period) {
        setEvents([]);
        return;
      }
    } else {
      const now = Math.floor(Date.now() / 1000);
      period = { start: now - Number(span) * DAY, end: now };
    }

    setLoadingEvents(true);
    setOpenEvent(null);
    try {
      const list = await api.listEvents({
        keyIds: apiKey.keyId,
        start: String(period.start),
        end: String(period.end),
      });
      // Поля Daminion разбираем один раз здесь, а не на каждой перерисовке:
      // метаданные приходят base64, и декодировать их на тысячах строк не бесплатно.
      setEvents(Array.isArray(list) ? list.map((e: any) => ({ ...e, daminion: daminionFields(e) })) : []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingEvents(false);
    }
  }, [api, apiKey?.keyId, span, range]);

  const catalogs = useMemo(
    () => [...new Set<string>(events.map((e) => e.daminion.catalog).filter(Boolean))].sort(),
    [events],
  );
  const mediaTypes = useMemo(
    () => [...new Set<string>(events.map((e) => e.daminion.mediaType).filter(Boolean))].sort(),
    [events],
  );

  const shown = useMemo(
    () =>
      events.filter(
        (e) =>
          (catalog === ALL || e.daminion.catalog === catalog) &&
          (mediaType === ALL || e.daminion.mediaType === mediaType),
      ),
    [events, catalog, mediaType],
  );

  // Итог по отобранному: сколько запросов, сколько разных элементов и во что обошлись.
  const totals = useMemo(
    () => ({
      cost: shown.reduce((sum, e) => sum + (e.cost_in_usd || 0), 0),
      items: new Set(shown.map((e) => e.custom_id).filter(Boolean)).size,
    }),
    [shown],
  );

  useEffect(() => {
    if (tab === "events") loadEvents();
  }, [tab, loadEvents]);

  const save = async () => {
    if (!api || !apiKey?.keyId) return;

    const body: any = {
      name: form.name,
      revoked: form.revoked,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      shouldLogRequest: form.shouldLogRequest,
      shouldLogResponse: form.shouldLogResponse,
    };

    const limit = parseFloat(form.costLimitInUsd);
    if (form.costLimitInUsd !== "") {
      if (!(limit >= 0)) {
        toast.error("The cost limit has to be a number");
        return;
      }
      body.costLimitInUsd = limit;
    }

    // Значение и единица едут только парой, и при нуле единица обязана быть
    // пустой - иначе сервер отклонит всё обновление целиком. Пустое поле здесь
    // и означает ноль, то есть снятие оконного лимита.
    const overTime = parseFloat(form.costLimitInUsdOverTime) || 0;
    body.costLimitInUsdOverTime = overTime;
    body.costLimitInUsdUnit = overTime > 0 ? form.costLimitInUsdUnit : "";

    const rate = parseInt(form.rateLimitOverTime) || 0;
    body.rateLimitOverTime = rate;
    body.rateLimitUnit = rate > 0 ? form.rateLimitUnit : "";

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
      {/* События разбирают по десятку колонок, и в узком окне им тесно: на этой
          вкладке окно растягивается почти на весь экран. */}
      <DialogContent
        className={
          tab === "events"
            ? "flex h-[92vh] w-[96vw] max-w-[96vw] flex-col xl:max-w-screen-2xl"
            : "sm:max-w-3xl"
        }
      >
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

        <Tabs value={tab} onValueChange={setTab} className={tab === "events" ? "flex min-h-0 flex-1 flex-col" : undefined}>
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
              <div>
                <Label>Tags</Label>
                <Input
                  className="mt-1"
                  value={form.tags}
                  onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
                  placeholder="client, internal"
                />
              </div>

              {/* Оконные лимиты. Пустое поле снимает лимит: значение и единица
                  уходят парой, иначе сервер отклоняет обновление целиком. */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Cost Limit Over Time</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.costLimitInUsdOverTime}
                    onChange={(e) => setForm((p) => ({ ...p, costLimitInUsdOverTime: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Unit</Label>
                  <Select
                    value={form.costLimitInUsdUnit}
                    onValueChange={(v) => setForm((p) => ({ ...p, costLimitInUsdUnit: v }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="h">Hour</SelectItem>
                      <SelectItem value="d">Day</SelectItem>
                      <SelectItem value="m">Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Rate Limit Over Time</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    value={form.rateLimitOverTime}
                    onChange={(e) => setForm((p) => ({ ...p, rateLimitOverTime: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Unit</Label>
                  <Select
                    value={form.rateLimitUnit}
                    onValueChange={(v) => setForm((p) => ({ ...p, rateLimitUnit: v }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="h">Hour</SelectItem>
                      <SelectItem value="d">Day</SelectItem>
                      <SelectItem value="m">Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <Label>Log Requests</Label>
                  <Switch
                    checked={form.shouldLogRequest}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, shouldLogRequest: v }))}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Label>Log Responses</Label>
                  <Switch
                    checked={form.shouldLogResponse}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, shouldLogResponse: v }))}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {form.shouldLogRequest || form.shouldLogResponse
                    ? "On: every call of this key stores its whole body in the event history — megabytes per call for image tagging. Switch it off once you are done looking."
                    : "Off: the Events tab shows what was called and what it cost, but not the bodies."}
                </p>
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
            <TabsContent value="events" className="mt-0 flex min-h-0 flex-1 flex-col pt-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Select value={span} onValueChange={(v) => setSpan(v as Span)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="60">Last 60 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                {span === "custom" && <DateRangeField className="w-72" value={range} onChange={setRange} />}

                {/* Каталог и тип медиа приходят от Daminion в X-METADATA. У ключей без
                    него списки пусты, и фильтры просто выключены. */}
                <Select value={catalog} onValueChange={setCatalog} disabled={catalogs.length === 0}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All catalogs</SelectItem>
                    {catalogs.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={mediaType} onValueChange={setMediaType} disabled={mediaTypes.length === 0}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All types</SelectItem>
                    {mediaTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="ml-auto flex items-center gap-4">
                  {!loadingEvents && shown.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {shown.length} requests · {totals.items} items · ${totals.cost.toFixed(4)}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingEvents || shown.length === 0}
                    onClick={() =>
                      downloadCsv(`events-${apiKey.keyId}`, shown, [
                        { header: "Time", value: (e: any) => csvDate(e.created_at) },
                        { header: "Catalog", value: (e: any) => e.daminion.catalog },
                        { header: "Media type", value: (e: any) => e.daminion.mediaType },
                        { header: "Item id", value: (e: any) => e.daminion.itemId },
                        { header: "Item guid", value: (e: any) => e.daminion.itemGuid },
                        { header: "Model", value: (e: any) => e.model },
                        { header: "Status", value: (e: any) => e.status },
                        { header: "Cost USD", value: (e: any) => e.cost_in_usd },
                        { header: "Prompt tokens", value: (e: any) => e.prompt_token_count },
                        { header: "Completion tokens", value: (e: any) => e.completion_token_count },
                        { header: "Latency ms", value: (e: any) => e.latency_in_ms },
                        { header: "Method", value: (e: any) => e.method },
                        { header: "Path", value: (e: any) => e.path },
                      ])
                    }
                  >
                    Export CSV
                  </Button>
                </div>
              </div>

              {loadingEvents ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : span === "custom" && !range?.from ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Pick a period</p>
              ) : shown.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {events.length === 0 ? "No requests in this period" : "No requests match the filters"}
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Click a request to see what was sent and what came back.
                  </p>
                  <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Time</TableHead>
                          <TableHead>Catalog</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead>Endpoint</TableHead>
                          <TableHead>Model</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Took</TableHead>
                          <TableHead>Cost</TableHead>
                          <TableHead>Tokens</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shown.map((e: any) => (
                          <React.Fragment key={e.id}>
                            <TableRow
                              className="cursor-pointer"
                              onClick={() => setOpenEvent((current) => (current === e.id ? null : e.id))}
                            >
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {e.created_at ? new Date(e.created_at * 1000).toLocaleString() : "—"}
                              </TableCell>
                              <TableCell className="text-xs">{e.daminion.catalog || "—"}</TableCell>
                              <TableCell className="text-xs">{e.daminion.mediaType || "—"}</TableCell>
                              {/* Guid длинный и нужен редко: он в подсказке, в карточке события и в CSV. */}
                              <TableCell className="font-mono text-xs" title={e.custom_id || undefined}>
                                {e.daminion.itemId || "—"}
                              </TableCell>
                              {/* Путь показываем хвостом: общий префикс /api/providers/... у всех
                                  одинаковый и только мешает читать. Полный - в подсказке и в CSV. */}
                              <TableCell className="font-mono text-xs" title={`${e.method || ""} ${e.path || ""}`}>
                                {e.path ? `${e.method || ""} ${e.path.replace(/^\/api\/providers\//, "")}` : "—"}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{e.model || "—"}</TableCell>
                              <TableCell
                                className={`font-mono text-xs ${
                                  e.status >= 200 && e.status < 300 ? "text-success" : "text-destructive"
                                }`}
                              >
                                {e.status}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {e.latency_in_ms != null ? `${e.latency_in_ms} ms` : "—"}
                              </TableCell>
                              <TableCell className="text-sm">
                                {e.cost_in_usd != null ? `$${e.cost_in_usd.toFixed(4)}` : "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                ↑{e.prompt_token_count ?? 0} ↓{e.completion_token_count ?? 0}
                              </TableCell>
                            </TableRow>

                            {openEvent === e.id && (
                              <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={10} className="py-0">
                                  <EventDetails eventId={e.id} />
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
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
