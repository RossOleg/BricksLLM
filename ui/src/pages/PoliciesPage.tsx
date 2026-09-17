import React, { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { PageHeader, EmptyState } from "@/components/ui/page-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const PoliciesPage: React.FC = () => {
  const api = useApi();
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [searched, setSearched] = useState(false);

  const fetchData = async () => {
    if (!api) return;
    if (!tagsInput.trim()) { toast.error("Please enter tags to search"); return; }
    setLoading(true);
    setSearched(true);
    try {
      const tags = tagsInput.split(",").map(s => s.trim()).filter(Boolean);
      setPolicies(await api.listPolicies(tags) || []);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <PageHeader title="Policies" description="Data filtering and PII handling rules" />
      <div className="p-6 space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Tags to search (comma-separated)"
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && fetchData()}
            className="max-w-md"
          />
          <Button onClick={fetchData} disabled={loading} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="mr-1.5 h-3.5 w-3.5" /> Search</>}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : policies.length === 0 ? (
          <EmptyState
            icon={<Shield className="h-6 w-6" />}
            title={searched ? "No results" : "Search policies"}
            description={searched ? "No policies found with the specified tags" : "Enter tags to search for policies"}
          />
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Rules</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {p.tags?.map((t: string) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.config?.rules ? Object.keys(p.config.rules).length : 0} PII, {p.regexConfig?.rules?.length || 0} regex
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.created_at ? new Date(p.created_at * 1000).toLocaleDateString() : "—"}</TableCell>
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

export default PoliciesPage;
