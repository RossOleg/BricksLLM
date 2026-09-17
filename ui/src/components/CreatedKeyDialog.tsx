import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

/**
 * Окно с только что выписанным ключом.
 *
 * Закрыть его можно лишь подтвердив, что ключ сохранён, и мимо него — щелчком
 * вне окна или Esc — не выйти. Это единственный момент, когда ключ показан
 * целиком: дальше он остаётся у клиента, а не в панели.
 */
const CreatedKeyDialog: React.FC<{ value: string | null; onClose: () => void }> = ({ value, onClose }) => {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (value) {
      setConfirmed(false);
      setCopied(false);
    }
  }, [value]);

  const copy = async () => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Key copied");
    } catch {
      // Буфер обмена недоступен без https или без разрешения - ключ на экране,
      // так что это не тупик.
      toast.error("Could not copy, select the key and copy it by hand");
    }
  };

  return (
    <Dialog open={!!value}>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideClose
      >
        <DialogHeader>
          <DialogTitle>Key created</DialogTitle>
          <DialogDescription>
            Copy it now and hand it to the customer. Close this window only once you have it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <code className="flex-1 select-all break-all rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm">
            {value}
          </code>
          <Button variant="outline" size="icon" onClick={copy} title="Copy">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
          I have saved this key
        </label>

        <Button className="w-full" disabled={!confirmed} onClick={onClose}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default CreatedKeyDialog;
