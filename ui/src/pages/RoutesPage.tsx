import React, { useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { PageHeader, EmptyState } from "@/components/ui/page-helpers";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GitBranch, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const RoutesPage: React.FC = () => {
  const api = useApi();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!api) return;
    setLoading(true);
    try { setRoutes(await api.listRoutes() || []); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [api]);

  const handleDelete = async (id: string) => {
    if (!api) return;
    try {
      await api.deleteRoute(id);
      toast.success("Route deleted");
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader title="Routes" description="Proxy route configurations" />
      <div className="p-6">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : routes.length === 0 ? (
          <EmptyState icon={<GitBranch className="h-6 w-6" />} title="No routes" description="No routes configured" />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.path}</TableCell>
                    <TableCell className="text-sm">{r.retryStrategy || "—"}</TableCell>
                    <TableCell className="text-sm">{r.steps?.length || 0}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
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
