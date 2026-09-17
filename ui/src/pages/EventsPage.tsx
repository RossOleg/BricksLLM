import React, { useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { PageHeader, EmptyState } from "@/components/ui/page-helpers";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const EventsPage: React.FC = () => {
  const api = useApi();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) return;
    setLoading(true);
    api.listEvents()
      .then(d => setEvents(d || []))
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [api]);

  return (
    <div>
      <PageHeader title="Events" description="Proxy request logs" />
      <div className="p-6">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : events.length === 0 ? (
          <EmptyState icon={<Activity className="h-6 w-6" />} title="No events" description="Events will appear after the first proxy requests" />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Time</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground">{e.created_at ? new Date(e.created_at * 1000).toLocaleString() : "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{e.model || "—"}</TableCell>
                    <TableCell><span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{e.provider}</span></TableCell>
                    <TableCell>
                      <span className={`font-mono text-xs ${e.status >= 200 && e.status < 300 ? "text-success" : "text-destructive"}`}>
                        {e.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{e.cost_in_usd != null ? `$${e.cost_in_usd.toFixed(4)}` : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.latency_in_ms ? `${e.latency_in_ms}ms` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.prompt_token_count != null ? `↑${e.prompt_token_count} ↓${e.completion_token_count}` : "—"}
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

export default EventsPage;
