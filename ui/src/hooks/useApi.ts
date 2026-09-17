import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { BricksApi } from "@/lib/api";

export const useApi = () => {
  const { isAuthenticated } = useAuth();
  return useMemo(() => (isAuthenticated ? new BricksApi() : null), [isAuthenticated]);
};
