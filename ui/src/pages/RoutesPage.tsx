import React, { useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { PageHeader, EmptyState } from "@/components/ui/page-helpers";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import RouteDialog from "@/components/RouteDialog";
import { GitBranch, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const RoutesPage: React.FC = () => {
  const api = useApi();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchData = async () => {
    if (!api) return;
    setLoading(true);
    try { setRoutes(await api.listRoutes() || []); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [api]);

  const handleDelete = async (r: any) => {
    if (!api) return;
    // Удаление сразу обрывает запросы всех ключей, что ходят этим маршрутом.
    if (!window.confirm(`Delete route ${r.name || r.path}? Keys calling it will start getting errors.`)) return;
    const id = r.id;
    try {
      await api.deleteRoute(id);
      toast.success("Route deleted");
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader title="Routes" description="Proxy route configurations">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Create Route
        </Button>
      </PageHeader>

      <RouteDialog open={creating} onClose={() => setCreating(false)} onSaved={fetchData} />
      <div className="p-6">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : routes.length === 0 ? (
          <EmptyState icon={<GitBranch className="h-6 w-6" />} title="No routes" description="A route sends one proxy path through a chain of models with fallbacks. Create the first one." />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Keys</TableHead>
                  <TableHead>Cache</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">/api/routes{r.path}</TableCell>
                    <TableCell className="text-sm">{r.retryStrategy || "—"}</TableCell>
                    <TableCell className="font-mono text-xs" title={r.steps?.map((s: any) => `${s.provider}/${s.model}`).join(" → ")}>
                      {r.steps?.map((s: any) => s.model).join(" → ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm" title={r.keyIds?.join(", ")}>{r.keyIds?.length || 0}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.cacheConfig?.enabled ? r.cacheConfig.ttl || "on" : "off"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(r)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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

export default RoutesPage;
