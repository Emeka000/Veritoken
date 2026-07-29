import { useState, useEffect } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACT_IDS, fetchContractEvents } from "../lib/stellar";
import { useAddressValidation } from "../lib/useAddressValidation";
import { PageHeader, Card, Field, Select, Icon } from "../components/ui";
import { EventFeed } from "../components/EventFeed";
import WalletGuard from "../components/WalletGuard";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../lib/toast";
import { recordSessionAction } from "../lib/sessionHistory";
import type { ContractEvent } from "../types";

export default function KycPage() {
  const {} = useWallet();
  const { addToast } = useToast();
  const [lookup, setLookup] = useState("");
  const [approveForm, setApproveForm] = useState({
    subject: "",
    tier: "0",
    jurisdiction: "",
    expiry_days: "365",
  });
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  // Validation for both address fields
  const lookupValidation = useAddressValidation(lookup);
  const subjectValidation = useAddressValidation(approveForm.subject);

  const set =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setApproveForm((f) => ({ ...f, [k]: e.target.value }));

  const fetchEvents = async () => {
    if (!CONTRACT_IDS.kycRegistry) return;
    try {
      const fetched = await fetchContractEvents(CONTRACT_IDS.kycRegistry, 10);
      setEvents(fetched);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setEventsLoading(true);
    fetchEvents().finally(() => setEventsLoading(false));
  }, []);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupValidation.isValid) {
      addToast("Please enter a valid Stellar address", "error");
      return;
    }
    recordSessionAction("form_submission", "KYC status lookup submitted", lookup, lookup);
    addToast(`Querying KYC status for ${lookup}`, "info");
  };

  const handleApprove = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectValidation.isValid) {
      addToast("Please enter a valid Stellar address for the subject", "error");
      return;
    }
    const tierLabel = ["Basic", "Accredited Investor", "Institutional"][Number(approveForm.tier)] ?? approveForm.tier;
    setConfirm({
      title: "Approve KYC",
      description: `You are about to approve KYC for ${approveForm.subject.slice(0, 8)}…${approveForm.subject.slice(-4)} at tier ${tierLabel} (${approveForm.jurisdiction}).`,
      onConfirm: () => {
        recordSessionAction(
          "form_submission",
          "KYC approval submitted",
          `Tier ${tierLabel}, jurisdiction ${approveForm.jurisdiction}`,
          approveForm.subject,
        );
        addToast(`KYC approved for ${approveForm.subject} at tier ${approveForm.tier}`, "success");
        setApproveForm({ subject: "", tier: "0", jurisdiction: "", expiry_days: "365" });
        setConfirm(null);
      },
    });
  };

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Compliance"
        icon={<Icon.kyc size={22} />}
        title="KYC Registry"
        description="Manage investor KYC approvals. Only authorized verifiers can approve or revoke status — every token transfer is gated by this registry."
      />

      <Card title="Check KYC Status">
        <form
          onSubmit={handleLookup}
          style={{ display: "flex", gap: "0.75rem" }}
        >
          <div style={{ flex: 1 }}>
            <label htmlFor="kyc-lookup-address" className="sr-only">
              Stellar address to look up
            </label>
            <input
              id="kyc-lookup-address"
              placeholder="Stellar address (G…)"
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              aria-invalid={!lookupValidation.isValid && lookup.length > 0 ? "true" : undefined}
              aria-describedby={lookupValidation.error && lookup.length > 0 ? "kyc-lookup-error" : undefined}
              style={{
                width: "100%",
                boxSizing: "border-box",
                borderColor:
                  !lookupValidation.isValid && lookup.length > 0
                    ? "#ef4444"
                    : undefined,
              }}
            />
            {lookupValidation.error && lookup.length > 0 && (
              <div
                id="kyc-lookup-error"
                role="alert"
                style={{
                  color: "#ef4444",
                  fontSize: "0.8rem",
                  marginTop: "0.25rem",
                }}
              >
                {lookupValidation.error}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!lookupValidation.isValid && lookup.length > 0}
          >
            Lookup
          </button>
        </form>
      </Card>

      <WalletGuard>
        <Card
          title="Approve KYC"
          subtitle="Verifier only"
          style={{ marginTop: "1.25rem" }}
        >
          <form onSubmit={handleApprove}>
            <Field
              label="Subject Address"
              value={approveForm.subject}
              onChange={set("subject")}
              required
              placeholder="G…"
              error={subjectValidation.error}
            />
            <Select
              label="KYC Tier"
              value={approveForm.tier}
              onChange={set("tier")}
              options={[
                { value: "0", label: "0 — Basic" },
                { value: "1", label: "1 — Accredited Investor" },
                { value: "2", label: "2 — Institutional" },
              ]}
            />
            <Field
              label="Jurisdiction"
              value={approveForm.jurisdiction}
              onChange={set("jurisdiction")}
              required
              placeholder="US, EU, NG …"
            />
            <Field
              label="Validity (days)"
              type="number"
              value={approveForm.expiry_days}
              onChange={set("expiry_days")}
            />
            <button
              type="submit"
              className="btn-success btn-block"
              style={{ marginTop: "0.5rem" }}
              disabled={approveForm.subject.length > 0 && !subjectValidation.isValid}
            >
              Approve KYC
            </button>
          </form>
        </Card>
      </WalletGuard>

      <EventFeed
        events={events}
        loading={eventsLoading}
        onRefresh={fetchEvents}
        title="Recent KYC Activity"
        autoRefreshInterval={30000}
      />

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}


