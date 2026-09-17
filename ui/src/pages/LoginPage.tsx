import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KeyRound } from "lucide-react";

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) { setError("Admin key is required"); return; }
    setLoading(true);
    setError("");
    try {
      // Проверяет сам сервер. Раньше здесь дёргали /api/health с ключом в
      // заголовке — а health ключ никогда и не смотрел, так что в панель пускало
      // с любой строкой, и дальше всё выглядело просто пустым.
      await login(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 glow-primary">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">BricksLLM Admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">Enter the admin key to open the panel</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5" /> Admin key
            </label>
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="ADMIN_PASS"
              className="bg-muted border-border font-mono text-sm"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Connecting..." : "Sign In"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
};

export default LoginPage;
