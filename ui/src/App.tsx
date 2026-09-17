import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AdminLayout from "@/components/AdminLayout";
import LoginPage from "@/pages/LoginPage";
import KeysPage from "@/pages/KeysPage";
import ProviderSettingsPage from "@/pages/ProviderSettingsPage";
import UsersPage from "@/pages/UsersPage";
import ReportingPage from "@/pages/ReportingPage";
import TopKeysPage from "@/pages/TopKeysPage";
import RoutesPage from "@/pages/RoutesPage";
import CustomProvidersPage from "@/pages/CustomProvidersPage";
import PoliciesPage from "@/pages/PoliciesPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoutes = () => {
  const { isAuthenticated, isFull } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Support-сессии доступна одна страница. Это не защита - её держит сервер, -
  // а просто отсутствие кнопок, которые всё равно вернут 403.
  if (!isFull) {
    return (
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<Navigate to="/keys" replace />} />
          <Route path="keys" element={<KeysPage />} />
          <Route path="*" element={<Navigate to="/keys" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="/keys" replace />} />
        <Route path="keys" element={<KeysPage />} />
        <Route path="provider-settings" element={<ProviderSettingsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="reporting" element={<ReportingPage />} />
        <Route path="top-keys" element={<TopKeysPage />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="custom-providers" element={<CustomProvidersPage />} />
        <Route path="policies" element={<PoliciesPage />} />
      </Route>
    </Routes>
  );
};

const AppRoutes = () => {
  const { isAuthenticated, checking } = useAuth();

  // Сессия живёт в куке, и жива ли она - знает только сервер. Пока он не ответил,
  // не показываем ничего: иначе при каждой перезагрузке мелькал бы экран входа.
  if (checking) return null;

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/keys" replace /> : <LoginPage />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <HashRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </HashRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
