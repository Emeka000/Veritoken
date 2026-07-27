import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import InvoicePage from "./pages/InvoicePage";
import PropertyPage from "./pages/PropertyPage";
import CarbonPage from "./pages/CarbonPage";
import KycPage from "./pages/KycPage";
import AdminPage from "./pages/AdminPage";
import AttestationPage from "./pages/AttestationPage";
import DeployPage from "./pages/DeployPage";
import DocsPage from "./pages/DocsPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./lib/toast";

export default function App() {
  return (
    <ToastProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
          <Route path="/invoices" element={<ErrorBoundary><InvoicePage /></ErrorBoundary>} />
          <Route path="/property" element={<ErrorBoundary><PropertyPage /></ErrorBoundary>} />
          <Route path="/carbon" element={<ErrorBoundary><CarbonPage /></ErrorBoundary>} />
          <Route path="/kyc" element={<ErrorBoundary><KycPage /></ErrorBoundary>} />
          <Route path="/admin" element={<ErrorBoundary><AdminPage /></ErrorBoundary>} />
          <Route path="/attestations" element={<ErrorBoundary><AttestationPage /></ErrorBoundary>} />
          <Route path="/deploy" element={<ErrorBoundary><DeployPage /></ErrorBoundary>} />
          <Route path="/docs" element={<ErrorBoundary><DocsPage /></ErrorBoundary>} />
        </Routes>
      </Layout>
    </ToastProvider>
  );
}
