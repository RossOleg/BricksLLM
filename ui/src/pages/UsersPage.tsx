import React, { useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { PageHeader, EmptyState, StatusBadge } from "@/components/ui/page-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Users, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const UsersPage: React.FC = () => {
  const api = useApi();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", userId: "", tags: "", costLimitInUsd: "" });

  const fetchData = async () => {
    if (!api) return;
    setLoading(true);
    try { setUsers(await api.listUsers() || []); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [api]);

  const handleCreate = async () => {
    if (!api) return;
    try {
      const body: any = { name: form.name, userId: form.userId };
      if (form.tags) body.tags = form.tags.split(",").map(s => s.trim());
      if (form.costLimitInUsd) body.costLimitInUsd = parseFloat(form.costLimitInUsd);
      await api.createUser(body);
      toast.success("User created");
      setDialogOpen(false);
      setForm({ name: "", userId: "", tags: "", costLimitInUsd: "" });
      fetchData();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader title="Users" description="Manage proxy users">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1.5 h-3.5 w-3.5" /> Create User</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New User</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              <div><Label>Name</Label><Input className="mt-1" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>User ID</Label><Input className="mt-1 font-mono text-sm" value={form.userId} onChange={e => setForm(p => ({ ...p, userId: e.target.value }))} /></div>
              <div><Label>Tags (comma-separated)</Label><Input className="mt-1" value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} /></div>
              <div><Label>Cost Limit (USD)</Label><Input className="mt-1" type="number" value={form.costLimitInUsd} onChange={e => setForm(p => ({ ...p, costLimitInUsd: e.target.value }))} /></div>
              <Button onClick={handleCreate} className="w-full">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="p-6">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : users.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No users" description="Create your first user to get started" />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Limit (USD)</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{u.userId || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {u.tags?.map((t: string) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>)}
                      </div>
                    </TableCell>
                    <TableCell>{u.costLimitInUsd != null ? `$${u.costLimitInUsd}` : "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={u.revoked ? "revoked" : "active"}>
                        {u.revoked ? "Revoked" : "Active"}
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

export default UsersPage;
