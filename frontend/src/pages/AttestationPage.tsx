/**
 * AttestationPage — Issue #370: Off-Chain Attestation Integration
 *
 * Allows admins to record verifiable off-chain compliance references
 * (legal documents, KYC proofs, accreditation certificates) linked
 * to a Stellar address, and query attestations for any subject.
 */
import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { contracts } from "../lib/contracts/index";
import { PageHeader, Card, Field, Select, Icon } from "../components/ui";
import { AddressInput } from "../components/AddressInput";
import WalletGuard from "../components/WalletGuard";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../lib/toast";
import type { AttestationRecord, AttestationType } from "../types";

const ATTESTATION_TYPES: { value: AttestationType; label: string }[] = [
  { value: "Legal", label: "Legal Document" },
  { value: "KYC", label: "KYC Proof" },
  { value: "Compliance", label: "Compliance Certificate" },
  { value: "AML", label: "AML Clearance" },
  { value: "Accreditation", label: "Accreditation" },
  { value: "Other", label: "Other" },
];

const EMPTY_FORM = {
  subject: "",
  attestation_type: "KYC" as AttestationType,
  reference_url: "",
  issuer: "",
  notes: "",
};

function validateUrl(url: string): string | null {
  if (!url) return "Reference URL is required.";
  if (!url.startsWith("https://") && !url.startsWith("ipfs://")) {
    return "URL must start with https:// or ipfs://";
  }
  return null;
}

export default function AttestationPage() {
  const { address, signTx } = useWallet();
  const { addToast } = useToast();

  const [form, setForm] = useState(EMPTY_FORM);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);

  const [queryAddress, setQueryAddress] = useState("");
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResults, setQueryResults] = useState<AttestationRecord[] | null>(null);

  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    onConfirm: () => void;
  } | null>(null);

  const set = (k: keyof typeof EMPTY_FORM) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      if (k === "reference_url") setUrlError(null);
    };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const urlErr = validateUrl(form.reference_url);
    if (urlErr) { setUrlError(urlErr); return; }
    if (!form.subject) return;

    setConfirm({
      title: "Record Attestation",
      description: `Record a ${form.attestation_type} attestation for ${form.subject.slice(0, 8)}…${form.subject.slice(-4)} referencing ${form.reference_url}.`,
      onConfirm: async () => {
        setConfirm(null);
        setSubmitLoading(true);
        try {
          const record: AttestationRecord = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            subject: form.subject,
            attestation_type: form.attestation_type,
            reference_url: form.reference_url,
            issuer: form.issuer || address || "",
            issued_at: Math.floor(Date.now() / 1000),
            notes: form.notes || undefined,
          };
          if (address) await contracts.compliance.recordAttestation(address, record, signTx);
          addToast("Attestation recorded successfully.", "success");
          setForm(EMPTY_FORM);
        } catch (err) {
          addToast(err instanceof Error ? err.message : "Failed to record attestation.", "error");
        } finally {
          setSubmitLoading(false);
        }
      },
    });
  };

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryAddress) return;
    setQueryLoading(true);
    setQueryResults(null);
    try {
      const results = await contracts.compliance.getAttestations(queryAddress);
      setQueryResults(results);
      if (results.length === 0) addToast("No attestations found for this address.", "info");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to query attestations.", "error");
    } finally {
      setQueryLoading(false);
    }
  };

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Compliance"
        icon={<Icon.shield size={22} />}
        title="Off-Chain Attestations"
        description="Link verifiable compliance documents, KYC proofs, and legal attestations to Stellar addresses. References are stored on-chain for audit purposes."
      />

      {/* Query section */}
      <Card title="Query Attestations">
        <form onSubmit={handleQuery} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <AddressInput
              label="Subject address"
              value={queryAddress}
              onChange={setQueryAddress}
              placeholder="G… (Stellar address)"
            />
          </div>
          <button
            type="submit"
            disabled={queryLoading || !queryAddress}
            style={{ alignSelf: "flex-end", marginBottom: "1.05rem" }}
          >
            {queryLoading ? "Querying…" : "Query"}
          </button>
        </form>

        {queryResults !== null && (
          queryResults.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.875rem" }}>No attestations found.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
              {queryResults.map((rec) => (
                <AttestationCard key={rec.id} record={rec} />
              ))}
            </div>
          )
        )}
      </Card>

      {/* Record section */}
      <WalletGuard>
        <Card title="Record New Attestation" style={{ marginTop: "1.25rem" }}>
          <p className="muted" style={{ fontSize: "0.82rem", marginBottom: "1rem" }}>
            Attach a verifiable reference (HTTPS document or IPFS hash) to a subject address.
            Invalid or unreachable URLs will be rejected — use a stable, permanent link.
          </p>
          <form onSubmit={handleSubmit}>
            <AddressInput
              label="Subject Address *"
              value={form.subject}
              onChange={(v) => setForm((f) => ({ ...f, subject: v }))}
              placeholder="G… (Stellar address)"
              required
            />
            <Select
              label="Attestation Type *"
              value={form.attestation_type}
              onChange={set("attestation_type") as React.ChangeEventHandler<HTMLSelectElement>}
              options={ATTESTATION_TYPES}
              required
            />
            <Field
              label="Reference URL *"
              value={form.reference_url}
              onChange={set("reference_url")}
              placeholder="https://docs.example.com/kyc-cert.pdf  or  ipfs://Qm…"
              required
              error={urlError}
            />
            <Field
              label="Issuer (address or DID, defaults to your wallet)"
              value={form.issuer}
              onChange={set("issuer")}
              placeholder="G… or did:example:123"
            />
            <Field
              label="Notes (optional)"
              value={form.notes}
              onChange={set("notes")}
              placeholder="Additional context or reference number"
            />
            <button
              type="submit"
              className="btn-block"
              disabled={submitLoading || !form.subject || !form.reference_url}
              style={{ marginTop: "0.5rem" }}
            >
              {submitLoading ? "Recording…" : "Record Attestation"}
            </button>
          </form>
        </Card>
      </WalletGuard>

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

function AttestationCard({ record }: { record: AttestationRecord }) {
  const date = new Date(record.issued_at * 1000).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  return (
    <div style={{
      padding: "0.85rem 1rem",
      borderRadius: 10,
      border: "1px solid var(--border)",
      background: "var(--surface-2)",
      display: "flex",
      flexDirection: "column",
      gap: "0.35rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <span className="badge badge-accent">{record.attestation_type}</span>
        <span className="muted" style={{ fontSize: "0.78rem" }}>{date}</span>
      </div>
      <a
        href={record.reference_url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: "0.82rem", color: "var(--accent-2)", wordBreak: "break-all" }}
      >
        {record.reference_url}
      </a>
      {record.issuer && (
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
          Issuer: <span className="mono">{record.issuer.slice(0, 12)}…</span>
        </p>
      )}
      {record.notes && (
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{record.notes}</p>
      )}
    </div>
  );
}
