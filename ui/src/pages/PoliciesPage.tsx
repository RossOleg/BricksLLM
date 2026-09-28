import React, { useCallback, useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { PageHeader, EmptyState } from "@/components/ui/page-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PolicyDialog from "@/components/PolicyDialog";
import { Shield, Loader2, Search, Plus, Copy } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

/**
 * Политики: правила, по которым шлюз блокирует или вычищает содержимое запросов.
 *
 * Раньше страница искала только по тегам и ничего не показывала, пока их не
 * угадаешь, а создать политику было негде. Теперь список открывается целиком,
 * теги лишь сужают его.
 */
const PoliciesPage: React.FC = () => {
  const api = useApi();
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  // undefined - окно закрыто, null - новая политика, объект - правка.
  const [editing, setEditing] = useState<any | null | undefined>(undefined);

  const fetchData = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const tags = tagsInput.split(",").map((s) => s.trim()).filter(Boolean);
      const list = await api.listPolicies(tags);
      setPolicies(Array.isArray(list) ? list : []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
    // Теги берутся в момент поиска, а не на каждое нажатие клавиши.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success("Policy id copied");
  };

  return (
    <div>
      <PageHeader title="Policies" description="Data filtering and PII handling rules">
        <Button size="sm" onClick={() => setEditing(null)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Create Policy
        </Button>
      </PageHeader>

      <PolicyDialog
        open={editing !== undefined}
        policy={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={fetchData}
      />

      <div className="p-6 space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Filter by tags (comma-separated), empty for all"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchData()}
            className="max-w-md"
          />
          <Button onClick={fetchData} disabled={loading} size="sm">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Search className="mr-1.5 h-3.5 w-3.5" /> Search
              </>
            )}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : policies.length === 0 ? (
          <EmptyState
            icon={<Shield className="h-6 w-6" />}
            title="No policies"
            description={tagsInput.trim() ? "No policies have all of these tags" : "Create the first one"}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-border overflow-hidden"
          >
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Id</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Rules</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => setEditing(p)}>
                    <TableCell className="font-medium">{p.name || "—"}</TableCell>
                    {/* Id нужен, чтобы привязать политику к ключу (policyId). */}
                    <TableCell>
                      <button
                        className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyId(p.id);
                        }}
                        title="Copy id"
                      >
                        {p.id?.slice(0, 8)}… <Copy className="h-3 w-3" />
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {p.tags?.map((t: string) => (
                          <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {t}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.config?.rules ? Object.keys(p.config.rules).length : 0} PII,{" "}
                      {p.regexConfig?.rules?.length || 0} regex
                      {p.customConfig?.rules?.length ? `, ${p.customConfig.rules.length} custom` : ""}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.updatedAt ? new Date(p.updatedAt * 1000).toLocaleString() : "—"}
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

export default PoliciesPage;
