import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import { useWallet } from "./lib/wallet";
import Dashboard from "./pages/Dashboard";
import InvoicePage from "./pages/InvoicePage";
import PropertyPage from "./pages/PropertyPage";
import CarbonPage from "./pages/CarbonPage";
import KycPage from "./pages/KycPage";
import KycTimelinePage from "./pages/KycTimelinePage";
import AdminPage from "./pages/AdminPage";
import AttestationPage from "./pages/AttestationPage";
import DeployPage from "./pages/DeployPage";
import DocsPage from "./pages/DocsPage";
import ComplianceConfigIOPage from "./pages/ComplianceConfigIOPage";  // #436
import MarketplacePage from "./pages/MarketplacePage";                // #439
import StatusPage from "./pages/StatusPage";                          // #458
import DashboardPage from "./pages/DashboardPage";                    // #547
import BatchPage from "./pages/BatchPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { AdminOnly } from "./components/PermissionGate";
import { ToastProvider } from "./lib/toast";

function AccessDenied({ role }: { role: string }) {
  return (
    <div style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--text-muted)" }}>
      <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Access restricted</p>
      <p style={{ fontSize: "0.875rem" }}>
        You need {role} permissions to view this page.
      </p>
    </div>
  );
}

export default function App() {
  // Restore the last-connected Freighter/WalletConnect session on page load
  // (providerType is persisted in autoReconnect's own localStorage check).
  useEffect(() => {
    useWallet.getState().autoReconnect();
  }, []);

  return (
    <ToastProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
          <Route path="/invoices" element={<ErrorBoundary><InvoicePage /></ErrorBoundary>} />
          <Route path="/property" element={<ErrorBoundary><PropertyPage /></ErrorBoundary>} />
          <Route path="/carbon" element={<ErrorBoundary><CarbonPage /></ErrorBoundary>} />
          <Route path="/kyc" element={<ErrorBoundary><KycPage /></ErrorBoundary>} />
          <Route path="/kyc/timeline" element={<ErrorBoundary><KycTimelinePage /></ErrorBoundary>} />
          <Route
            path="/admin"
            element={
              <ErrorBoundary>
                <AdminOnly fallback={<AccessDenied role="admin" />}>
                  <AdminPage />
                </AdminOnly>
              </ErrorBoundary>
            }
          />
          <Route path="/attestations" element={<ErrorBoundary><AttestationPage /></ErrorBoundary>} />
          <Route
            path="/deploy"
            element={
              <ErrorBoundary>
                <AdminOnly fallback={<AccessDenied role="admin" />}>
                  <DeployPage />
                </AdminOnly>
              </ErrorBoundary>
            }
          />
          <Route path="/docs" element={<ErrorBoundary><DocsPage /></ErrorBoundary>} />
          <Route path="/compliance-config" element={<ErrorBoundary><ComplianceConfigIOPage /></ErrorBoundary>} />
          <Route path="/marketplace" element={<ErrorBoundary><MarketplacePage /></ErrorBoundary>} />
          <Route path="/status" element={<ErrorBoundary><StatusPage /></ErrorBoundary>} />
          <Route path="/dashboard" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
          <Route path="/batch" element={<ErrorBoundary><BatchPage /></ErrorBoundary>} />
        </Routes>
      </Layout>
    </ToastProvider>
  );
}
