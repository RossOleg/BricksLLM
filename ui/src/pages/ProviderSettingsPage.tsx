import React, { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { PageHeader } from "@/components/ui/page-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Copy } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const KNOWN_SETTING_ID = "1746f660-3869-44b1-a06e-f564ced675e4";

const ProviderSettingsPage: React.FC = () => {
  const api = useApi();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ provider: "openai", apikey: "", name: "", allowedModels: "" });

  const handleCreate = async () => {
    if (!api) return;
    try {
      await api.createProviderSetting({
        provider: form.provider,
        setting: { apikey: form.apikey },
        name: form.name,
        allowedModels: form.allowedModels ? form.allowedModels.split(",").map(s => s.trim()) : undefined,
      });
      toast.success("Provider setting created");
      setDialogOpen(false);
      setForm({ provider: "openai", apikey: "", name: "", allowedModels: "" });
    } catch (e: any) { toast.error(e.message); }
  };

  const copyId = () => {
    navigator.clipboard.writeText(KNOWN_SETTING_ID);
    toast.success("ID copied");
  };

  return (
    <div>
      <PageHeader title="Provider Settings" description="Manage LLM provider connections">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-1.5 h-3.5 w-3.5" /> Add Provider</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Provider Setting</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <Label>Provider</Label>
                <Select value={form.provider} onValueChange={v => setForm(p => ({ ...p, provider: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["openai", "anthropic", "azure", "vllm", "deepinfra"].map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Name</Label><Input className="mt-1" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>API Key</Label><Input className="mt-1 font-mono text-sm" type="password" value={form.apikey} onChange={e => setForm(p => ({ ...p, apikey: e.target.value }))} /></div>
              <div><Label>Models (comma-separated)</Label><Input className="mt-1" value={form.allowedModels} onChange={e => setForm(p => ({ ...p, allowedModels: e.target.value }))} placeholder="gpt-4, gpt-3.5-turbo" /></div>
              <Button onClick={handleCreate} className="w-full">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="p-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>ID</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <button onClick={copyId} className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {KNOWN_SETTING_ID} <Copy className="h-3 w-3" />
                  </button>
                </TableCell>
                <TableCell><Badge variant="secondary">Active</Badge></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </motion.div>
        <p className="text-xs text-muted-foreground mt-4">
          Note: The API does not support listing provider settings. The entry above is pre-configured. New settings created via the form will also work but won't appear here.
        </p>
      </div>
    </div>
  );
};

export default ProviderSettingsPage;
