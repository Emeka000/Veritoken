import { useState } from "react";
import { PageHeader, Card, Field, Icon } from "../components/ui";
import {
  validateIsin,
  validateIpfsHash,
  validateLegalEntity,
  validateGoverningLaw,
  validateVintageYear,
  type ValidationResult,
} from "../lib/metadataValidation";
import {
  buildRwaDeployCommand,
  buildCarbonDeployCommand,
  isDeployReady,
  DEPLOY_PRESETS,
  type RwaDeployParams,
  type CarbonDeployParams,
} from "../lib/contractFactory";

// ── types ─────────────────────────────────────────────────────────────────────

interface InvoiceFields {
  admin: string;
  name: string;
  symbol: string;
  kyc_registry: string;
  compliance_engine: string;
  legal_entity: string;
  governing_law: string;
  isin: string;
  prospectus_hash: string;
}

interface CarbonFields {
  admin: string;
  name: string;
  symbol: string;
  kyc_registry: string;
  compliance_engine: string;
  vintage_year: string;
  methodology: string;
  registry: string;
  project_id: string;
}

type AssetTab = "invoice" | "property" | "carbon";

const EMPTY_INVOICE: InvoiceFields = {
  admin: "",
  name: "",
  symbol: "",
  kyc_registry: "",
  compliance_engine: "",
  legal_entity: "",
  governing_law: "",
  isin: "",
  prospectus_hash: "",
};

const EMPTY_CARBON: CarbonFields = {
  admin: "",
  name: "",
  symbol: "",
  kyc_registry: "",
  compliance_engine: "",
  vintage_year: "",
  methodology: "",
  registry: "",
  project_id: "",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function FieldError({ result }: { result: ValidationResult }) {
  if (result.isValid || !result.error) return null;
  return <p style={styles.fieldError}>{result.error}</p>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} style={styles.copyBtn}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CommandOutput({ command, ready }: { command: string; ready: boolean }) {
  if (!ready) return null;
  return (
    <div style={styles.outputWrap}>
      <div style={styles.outputHeader}>
        <span style={styles.outputLabel}>Generated deploy command</span>
        <CopyButton text={command} />
      </div>
      <pre style={styles.pre}>
        <code>{command}</code>
      </pre>
    </div>
  );
}

// ── tabs ──────────────────────────────────────────────────────────────────────

function InvoiceTab() {
  const [f, setF] = useState<InvoiceFields>(EMPTY_INVOICE);
  const set = (k: keyof InvoiceFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const isinResult = validateIsin(f.isin);
  const ipfsResult = validateIpfsHash(f.prospectus_hash);
  const legalResult = validateLegalEntity(f.legal_entity);
  const govResult = validateGoverningLaw(f.governing_law);

  const hasErrors = !isinResult.isValid || !ipfsResult.isValid || !legalResult.isValid || !govResult.isValid;
  const preset = DEPLOY_PRESETS.invoice;
  const ready = !hasErrors && isDeployReady(f as unknown as Record<string, string>, preset);
  const params: RwaDeployParams = f;
  const command = buildRwaDeployCommand(params, preset);

  return (
    <div style={styles.tabContent}>
      <p className="muted" style={{ marginBottom: "1.5rem" }}>
        {preset.description}
      </p>
      <div style={styles.grid}>
        <Field label="Admin address *" value={f.admin} onChange={set("admin")} placeholder="G…" />
        <Field label="Token name *" value={f.name} onChange={set("name")} placeholder="Acme Invoice Token" />
        <Field label="Token symbol *" value={f.symbol} onChange={set("symbol")} placeholder="IVTK" />
        <Field label="KYC registry address *" value={f.kyc_registry} onChange={set("kyc_registry")} placeholder="C…" />
        <Field label="Compliance engine address *" value={f.compliance_engine} onChange={set("compliance_engine")} placeholder="C…" />
        <div>
          <Field label="Legal entity" value={f.legal_entity} onChange={set("legal_entity")} placeholder="Acme Corp LLC" />
          <FieldError result={legalResult} />
        </div>
        <div>
          <Field label="Governing law" value={f.governing_law} onChange={set("governing_law")} placeholder="New York" />
          <FieldError result={govResult} />
        </div>
        <div>
          <Field label="ISIN" value={f.isin} onChange={set("isin")} placeholder="US1234567890" />
          <FieldError result={isinResult} />
        </div>
        <div>
          <Field label="Prospectus hash (IPFS)" value={f.prospectus_hash} onChange={set("prospectus_hash")} placeholder="Qm… or baf…" />
          <FieldError result={ipfsResult} />
        </div>
      </div>
      <CommandOutput command={command} ready={ready} />
    </div>
  );
}

function PropertyTab() {
  const [f, setF] = useState<InvoiceFields>(EMPTY_INVOICE);
  const set = (k: keyof InvoiceFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const isinResult = validateIsin(f.isin);
  const ipfsResult = validateIpfsHash(f.prospectus_hash);
  const legalResult = validateLegalEntity(f.legal_entity);
  const govResult = validateGoverningLaw(f.governing_law);

  const hasErrors = !isinResult.isValid || !ipfsResult.isValid || !legalResult.isValid || !govResult.isValid;
  const preset = DEPLOY_PRESETS.property;
  const ready = !hasErrors && isDeployReady(f as unknown as Record<string, string>, preset);
  const params: RwaDeployParams = f;
  const command = buildRwaDeployCommand(params, preset);

  return (
    <div style={styles.tabContent}>
      <p className="muted" style={{ marginBottom: "1.5rem" }}>
        {preset.description}
      </p>
      <div style={styles.grid}>
        <Field label="Admin address *" value={f.admin} onChange={set("admin")} placeholder="G…" />
        <Field label="Token name *" value={f.name} onChange={set("name")} placeholder="123 Main St Token" />
        <Field label="Token symbol *" value={f.symbol} onChange={set("symbol")} placeholder="PROP" />
        <Field label="KYC registry address *" value={f.kyc_registry} onChange={set("kyc_registry")} placeholder="C…" />
        <Field label="Compliance engine address *" value={f.compliance_engine} onChange={set("compliance_engine")} placeholder="C…" />
        <div>
          <Field label="Legal entity" value={f.legal_entity} onChange={set("legal_entity")} placeholder="Realty Partners LLC" />
          <FieldError result={legalResult} />
        </div>
        <div>
          <Field label="Governing law" value={f.governing_law} onChange={set("governing_law")} placeholder="Delaware" />
          <FieldError result={govResult} />
        </div>
        <div>
          <Field label="ISIN" value={f.isin} onChange={set("isin")} placeholder="US0000000000" />
          <FieldError result={isinResult} />
        </div>
        <div>
          <Field label="Title hash (IPFS)" value={f.prospectus_hash} onChange={set("prospectus_hash")} placeholder="Qm… or baf…" />
          <FieldError result={ipfsResult} />
        </div>
      </div>
      <CommandOutput command={command} ready={ready} />
    </div>
  );
}

function CarbonTab() {
  const [f, setF] = useState<CarbonFields>(EMPTY_CARBON);
  const set = (k: keyof CarbonFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const vintageResult = validateVintageYear(f.vintage_year);

  const hasErrors = !vintageResult.isValid;
  const preset = DEPLOY_PRESETS.carbon;
  const ready = !hasErrors && isDeployReady(f as unknown as Record<string, string>, preset);
  const params: CarbonDeployParams = f;
  const command = buildCarbonDeployCommand(params);

  return (
    <div style={styles.tabContent}>
      <p className="muted" style={{ marginBottom: "1.5rem" }}>
        {preset.description}
      </p>
      <div style={styles.grid}>
        <Field label="Admin address *" value={f.admin} onChange={set("admin")} placeholder="G…" />
        <Field label="Token name *" value={f.name} onChange={set("name")} placeholder="Acme Carbon Credit" />
        <Field label="Token symbol *" value={f.symbol} onChange={set("symbol")} placeholder="ACC" />
        <Field label="KYC registry address *" value={f.kyc_registry} onChange={set("kyc_registry")} placeholder="C…" />
        <Field label="Compliance engine address *" value={f.compliance_engine} onChange={set("compliance_engine")} placeholder="C…" />
        <div>
          <Field label="Vintage year" value={f.vintage_year} onChange={set("vintage_year")} placeholder="2024" />
          <FieldError result={vintageResult} />
        </div>
        <Field label="Methodology" value={f.methodology} onChange={set("methodology")} placeholder="VCS VM0010" />
        <Field label="Registry" value={f.registry} onChange={set("registry")} placeholder="Verra" />
        <Field label="Project ID" value={f.project_id} onChange={set("project_id")} placeholder="VCS-1234" />
      </div>
      <CommandOutput command={command} ready={ready} />
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function DeployPage() {
  const [tab, setTab] = useState<AssetTab>("invoice");

  return (
    <div>
      <PageHeader
        title="Deploy Asset Token"
        description="Generate the Stellar CLI command to deploy a new tokenized asset contract."
        icon={<Icon.admin size={22} />}
      />

      <Card>
        <div style={styles.tabs}>
          {(["invoice", "property", "carbon"] as AssetTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            >
              {t === "invoice" ? "Invoice" : t === "property" ? "Property" : "Carbon Credit"}
            </button>
          ))}
        </div>

        {tab === "invoice" && <InvoiceTab />}
        {tab === "property" && <PropertyTab />}
        {tab === "carbon" && <CarbonTab />}
      </Card>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  tabs: {
    display: "flex",
    gap: "0.25rem",
    borderBottom: "1px solid var(--border)",
    marginBottom: "1.5rem",
    padding: "0.25rem 0.25rem 0",
  },
  tab: {
    background: "none",
    border: "none",
    padding: "0.6rem 1.2rem",
    borderRadius: "8px 8px 0 0",
    color: "var(--text-muted)",
    fontWeight: 500,
    cursor: "pointer",
    fontSize: "0.9rem",
    borderBottom: "2px solid transparent",
    marginBottom: "-1px",
  },
  tabActive: {
    color: "var(--text)",
    background: "var(--surface-2)",
    borderBottom: "2px solid var(--accent)",
  },
  tabContent: {
    paddingTop: "0.5rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "1rem",
    marginBottom: "1.5rem",
  },
  fieldError: {
    margin: "0.25rem 0 0",
    fontSize: "0.78rem",
    color: "var(--error, #e05252)",
  },
  outputWrap: {
    marginTop: "1.5rem",
    borderRadius: 10,
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  outputHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.6rem 1rem",
    background: "var(--surface-2)",
    borderBottom: "1px solid var(--border)",
  },
  outputLabel: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    fontWeight: 500,
  },
  pre: {
    margin: 0,
    padding: "1rem 1.25rem",
    overflowX: "auto",
    fontSize: "0.82rem",
    lineHeight: 1.65,
    background: "var(--surface)",
    color: "var(--text)",
    fontFamily: "var(--font-mono, monospace)",
  },
  copyBtn: {
    fontSize: "0.75rem",
    padding: "0.3rem 0.75rem",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    cursor: "pointer",
  },
};
