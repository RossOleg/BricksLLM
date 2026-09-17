import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { toast } from "sonner";

/**
 * Повышение прав со «только выписывать ключи» до полной админки.
 *
 * Второй пароль проверяет сервер и выдаёт новую куку — панель здесь ничего не
 * решает. Она и не может: спрятанная кнопка никого не останавливает, тот же
 * человек открывает консоль и зовёт API напрямую. Ограничение живёт в мидлвари
 * шлюза, а это окно — только способ его попросить.
 */
const UnlockDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({
  open,
  onOpenChange,
}) => {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError("");

    try {
      const role = await login(password);

      if (role !== "full") {
        // Пароль подошёл, но это снова support: уровень не вырос.
        setError("That password does not grant full access");
        return;
      }

      setPassword("");
      onOpenChange(false);
      toast.success("Full access unlocked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Unlock full access
          </DialogTitle>
          <DialogDescription>
            Enter the full admin password to manage providers, routes, policies and users.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Full admin password"
            className="bg-muted border-border font-mono text-sm"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Unlocking..." : "Unlock"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default UnlockDialog;
