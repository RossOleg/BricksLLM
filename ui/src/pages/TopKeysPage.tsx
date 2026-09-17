import React, { useState } from "react";
import { DateRange } from "react-day-picker";
import { subDays } from "date-fns";
import { useApi } from "@/hooks/useApi";
import { PageHeader, EmptyState } from "@/components/ui/page-helpers";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import DateRangeField, { toPeriod } from "@/components/DateRangeField";
import { downloadCsv } from "@/lib/csv";

/**
 * Ключи, отсортированные по расходу за период.
 *
 * Сумма здесь считается по таблице событий, а не по счётчику ключа: это расход
 * именно за выбранный отрезок. Из-за этого он не сойдётся с «Spent» в карточке
 * ключа, который пожизненный и переживает чистку истории, - и это разные
 * вопросы, а не расхождение.
 *
 * Эндпоинт отдаёт только keyId и стоимость, поэтому имена подтягиваются вторым
 * запросом по списку ключей.
 */
const TopKeysPage: React.FC = () => {
  const api = useApi();
  const [range, setRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 29), to: new Date() });
  const [tag, setTag] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const fetchTop = async () => {
    if (!api) return;

    const period = toPeriod(range);
    if (!period) {
      toast.error("Pick a period");
      return;
    }

    setLoading(true);
    try {
      const body: any = { ...period, order: "desc", limit: 100 };
      if (tag.trim()) body.tags = [tag.trim()];

      const result = await api.getTopKeys(body);
      const points: any[] = result?.dataPoints ?? [];

      let named = points;

      if (points.length) {
        try {
          const keys = await api.listKeys({ keyIds: points.map((p) => p.keyId), limit: points.length });
          const list: any[] = Array.isArray(keys) ? keys : keys?.keys ?? [];
          const byId = new Map(list.map((k: any) => [k.keyId, k]));

          named = points.map((p) => ({
            ...p,
            name: byId.get(p.keyId)?.name,
            tags: byId.get(p.keyId)?.tags,
          }));
        } catch {
          // Имена - украшение: без них таблица всё равно осмысленна.
        }
      }

      setRows(named);
      setSearched(true);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const total = rows.reduce((sum, r) => sum + (r.costInUsd || 0), 0);

  return (
    <div>
      <PageHeader title="Top keys" description="Keys ranked by what they spent in a period" />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Period</Label>
            <DateRangeField className="mt-1 w-72" value={range} onChange={setRange} />
          </div>
          <div>
            <Label className="text-xs">Tag</Label>
            <Input className="mt-1 w-44" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="all tags" />
          </div>
          <Button onClick={fetchTop} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Show"}
          </Button>
          {rows.length > 0 && (
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv("top-keys", rows, [
                  { header: "Key id", value: (r: any) => r.keyId },
                  { header: "Name", value: (r: any) => r.name },
                  { header: "Tags", value: (r: any) => r.tags?.join(" ") },
                  { header: "Cost USD", value: (r: any) => r.costInUsd },
                ])
              }
            >
              Export CSV
            </Button>
          )}
        </div>

        {!searched ? (
          <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Pick a period" description="Then press Show" />
        ) : rows.length === 0 ? (
          <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Nothing spent" description="No requests in this period" />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Key id</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right">Cost in period</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r: any) => (
                  <TableRow key={r.keyId}>
                    <TableCell className="font-medium">{r.name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.keyId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.tags?.join(", ") || "—"}</TableCell>
                    <TableCell className="text-right">${(r.costInUsd || 0).toFixed(4)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="font-medium">Total</TableCell>
                  <TableCell className="text-right font-medium">${total.toFixed(4)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default TopKeysPage;
