import React, { useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Создание и правка политики.
 *
 * Поля повторяют policy.Policy на сервере: PII-правила - это словарь
 * "тип данных -> действие", regex-правила - список "выражение + действие".
 * Своих (custom) правил форма не трогает: при правке они не отправляются и
 * остаются как были.
 */
const ACTIONS = [
  { value: "block", label: "Block" },
  { value: "allow_but_redact", label: "Redact" },
  { value: "allow_but_warn", label: "Warn" },
  { value: "allow", label: "Allow" },
];

// Типы PII, которые понимает сервер (internal/policy/policy.go).
const PII_RULES = [
  "address", "age", "all", "aws_access_key", "aws_secret_key", "bank_account_number", "bank_routing",
  "ca_health_number", "ca_social_insurance_number", "credit_debit_cvv", "credit_debit_expiry",
  "credit_debit_number", "date_time", "driver_id", "email", "in_aadhaar", "in_nrega",
  "in_permanent_account_number", "in_voter_number", "international_bank_account_number", "ip_address",
  "license_plate", "mac_address", "name", "passport_number", "password", "phone", "pin", "ssn",
  "swift_code", "uk_national_health_service_number", "uk_national_insurance_number",
  "uk_unique_taxpayer_reference_number", "url", "us_individual_tax_identification_number", "username",
  "vehicle_identification_number",
];

/** Правило выключено - его просто нет в словаре. */
const OFF = "__off__";

type RegexRule = { definition: string; action: string };

const PolicyDialog: React.FC<{
  open: boolean;
  /** null - новая политика. */
  policy: any | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, policy, onClose, onSaved }) => {
  const api = useApi();
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [pii, setPii] = useState<Record<string, string>>({});
  const [regex, setRegex] = useState<RegexRule[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(policy?.name || "");
    setTags((policy?.tags || []).join(", "));
    setPii({ ...(policy?.config?.rules || {}) });
    setRegex((policy?.regexConfig?.rules || []).map((r: RegexRule) => ({ ...r })));
  }, [open, policy]);

  const save = async () => {
    if (!api) return;
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    // Пустое выражение сервер скомпилирует и будет срабатывать на всём подряд.
    const rules = regex.filter((r) => r.definition.trim());
    for (const [i, r] of rules.entries()) {
      try {
        new RegExp(r.definition);
      } catch {
        toast.error(`Regex rule ${i + 1} does not compile`);
        return;
      }
    }

    const body: any = {
      name: name.trim(),
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      config: { rules: pii },
      regexConfig: { rules },
    };

    setSaving(true);
    try {
      if (policy?.id) {
        await api.updatePolicy(policy.id, body);
        toast.success("Policy updated");
      } else {
        await api.createPolicy(body);
        toast.success("Policy created");
      }
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const setRule = (rule: string, action: string) =>
    setPii((current) => {
      const next = { ...current };
      if (action === OFF) delete next[rule];
      else next[rule] = action;
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{policy?.id ? `Policy ${policy.name || ""}` : "New Policy"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
          {policy?.id && (
            <p className="text-xs text-muted-foreground">
              Id <span className="font-mono">{policy.id}</span> — set it as the key's policyId to apply the policy.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name *</Label>
              <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Tags</Label>
              <Input
                className="mt-1"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="client, internal"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Regex rules</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRegex((r) => [...r, { definition: "", action: "block" }])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {regex.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No regex rules.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {regex.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      className="font-mono text-xs"
                      value={r.definition}
                      placeholder="\b\d{16}\b"
                      onChange={(e) =>
                        setRegex((all) => all.map((x, j) => (j === i ? { ...x, definition: e.target.value } : x)))
                      }
                    />
                    <Select
                      value={r.action}
                      onValueChange={(v) => setRegex((all) => all.map((x, j) => (j === i ? { ...x, action: v } : x)))}
                    >
                      <SelectTrigger className="w-32 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIONS.map((a) => (
                          <SelectItem key={a.value} value={a.value}>
                            {a.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setRegex((all) => all.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>PII rules</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Detected by the PII scanner configured on the gateway (AWS Comprehend). Without it these rules have no
              effect; regex rules work regardless.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {PII_RULES.map((rule) => (
                <div key={rule} className="flex items-center justify-between gap-2">
                  <span className={`truncate font-mono text-xs ${pii[rule] ? "" : "text-muted-foreground"}`}>
                    {rule}
                  </span>
                  <Select value={pii[rule] || OFF} onValueChange={(v) => setRule(rule, v)}>
                    <SelectTrigger className="h-7 w-28 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OFF}>Off</SelectItem>
                      {ACTIONS.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        </div>

        <Button className="w-full" onClick={save} disabled={saving}>
          {saving ? "Saving..." : policy?.id ? "Save" : "Create"}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default PolicyDialog;
