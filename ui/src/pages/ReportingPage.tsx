import React, { useState } from "react";
import { DateRange } from "react-day-picker";
import { subDays } from "date-fns";
import { useApi } from "@/hooks/useApi";
import { PageHeader, DataCard, EmptyState } from "@/components/ui/page-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import DateRangeField, { toPeriod } from "@/components/DateRangeField";
import { downloadCsv, csvDate } from "@/lib/csv";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ReportingPage: React.FC = () => {
  const api = useApi();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [range, setRange] = useState<DateRange | undefined>({ from: subDays(new Date(), 6), to: new Date() });
  const [increment, setIncrement] = useState("3600");

  const fetchMetrics = async () => {
    if (!api) return;

    const period = toPeriod(range);
    if (!period) {
      toast.error("Pick a period");
      return;
    }

    setLoading(true);
    try {
      const result = await api.getMetrics({
        ...period,
        increment: parseInt(increment),
      });
      setData(result);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const totalCost = data?.dataPoints?.reduce((s: number, d: any) => s + (d.costInUsd || 0), 0) || 0;
  const totalRequests = data?.dataPoints?.reduce((s: number, d: any) => s + (d.numberOfRequests || 0), 0) || 0;
  const totalTokens = data?.dataPoints?.reduce((s: number, d: any) => s + (d.promptTokenCount || 0) + (d.completionTokenCount || 0), 0) || 0;

  return (
    <div>
      <PageHeader title="Reporting" description="Aggregated usage metrics" />
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label className="text-xs">Period</Label>
            <DateRangeField className="mt-1 w-72" value={range} onChange={setRange} />
          </div>
          <div>
            <Label className="text-xs">Interval</Label>
            <Select value={increment} onValueChange={setIncrement}>
              <SelectTrigger className="mt-1 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="300">5 minutes</SelectItem>
                <SelectItem value="3600">Hour</SelectItem>
                <SelectItem value="86400">Day</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={fetchMetrics} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load"}
          </Button>
          {data?.dataPoints?.length > 0 && (
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv("reporting", data.dataPoints, [
                  { header: "Time", value: (d: any) => csvDate(d.timeStamp) },
                  { header: "Requests", value: (d: any) => d.numberOfRequests },
                  { header: "Successful", value: (d: any) => d.successCount },
                  { header: "Cost USD", value: (d: any) => d.costInUsd },
                  { header: "Prompt tokens", value: (d: any) => d.promptTokenCount },
                  { header: "Completion tokens", value: (d: any) => d.completionTokenCount },
                  { header: "Latency ms", value: (d: any) => d.latencyInMs },
                ])
              }
            >
              Export CSV
            </Button>
          )}
        </div>

        {data ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DataCard label="Total Cost" value={`$${totalCost.toFixed(4)}`} />
              <DataCard label="Total Requests" value={totalRequests} />
              <DataCard label="Total Tokens" value={totalTokens.toLocaleString()} />
              <DataCard label="Median Latency" value={data.latencyInMsMedian ? `${data.latencyInMsMedian.toFixed(0)}ms` : "—"} />
            </div>

            {data.dataPoints?.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium">Data Points ({data.dataPoints.length})</h3>
                <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
                  {data.dataPoints.map((dp: any, i: number) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">{new Date(dp.timeStamp * 1000).toLocaleString()}</span>
                      <div className="flex gap-4">
                        <span>{dp.numberOfRequests} req</span>
                        <span className="text-primary">${(dp.costInUsd || 0).toFixed(4)}</span>
                        <span className="text-muted-foreground">{dp.latencyInMs}ms</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ) : !loading ? (
          <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Select a period" description="Choose dates and load metrics" />
        ) : null}
      </div>
    </div>
  );
};

export default ReportingPage;
