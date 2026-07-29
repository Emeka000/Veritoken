import { useState } from "react";
import { PageHeader, Card, Field, Icon } from "../components/ui";
import { CopyButton } from "../components/CopyButton";
import {
  validateIsin,
  validateIpfsHash,
  validateLegalEntity,
  validateGoverningLaw,
  validateVintageYear,
  type ValidationResult,
} from "../lib/metadataValidation";
import {
  DEPLOY_PRESETS,
  buildRwaDeployCommand,
  buildCarbonDeployCommand,
  isDeployReady,
  type RwaDeployParams,
  type CarbonDeployParams,
} from "../lib/contractFactory";
import { validateStellarAddress, isValidContractId } from "../lib/stellar";

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

// ── address/contract-id validators (issue #426) ───────────────────────────────

function validateAdminAddress(value: string): ValidationResult {
  if (!value) return { isValid: false, error: "Admin address is required" };
  if (!validateStellarAddress(value))
    return { isValid: false, error: "Must be a valid Stellar address (G…, 56 chars)" };
  return { isValid: true, error: null };
}

function validateContractAddress(label: string) {
  return (value: string): ValidationResult => {
    if (!value) return { isValid: false, error: `${label} is required` };
    if (!isValidContractId(value))
      return { isValid: false, error: `Must be a valid Soroban contract ID (C…, 56 chars)` };
    return { isValid: true, error: null };
  };
}

const validateKycRegistry = validateContractAddress("KYC registry");
const validateComplianceEngine = validateContractAddress("Compliance engine");

function validateTokenName(value: string): ValidationResult {
  if (!value?.trim()) return { isValid: false, error: "Token name is required" };
  if (value.trim().length > 32)
    return { isValid: false, error: "Token name must be 32 characters or fewer" };
  return { isValid: true, error: null };
}

function validateTokenSymbol(value: string): ValidationResult {
  if (!value?.trim()) return { isValid: false, error: "Symbol is required" };
  if (!/^[A-Z0-9]{1,12}$/.test(value.trim()))
    return { isValid: false, error: "Symbol must be 1–12 uppercase letters/digits" };
  return { isValid: true, error: null };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function FieldError({ result }: { result: ValidationResult }) {
  if (result.isValid || !result.error) return null;
  return <p style={styles.fieldError}>{result.error}</p>;
}

function CommandOutput({ command, ready }: { command: string; ready: boolean }) {
  if (!ready) return null;
  return (
    <div style={styles.outputWrap}>
      <div style={styles.outputHeader}>
        <span style={styles.outputLabel}>Generated deploy command</span>
        <CopyButton text={command} label="Copy deploy command" />
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

  const adminResult = validateAdminAddress(f.admin);
  const nameResult = validateTokenName(f.name);
  const symbolResult = validateTokenSymbol(f.symbol);
  const kycResult = validateKycRegistry(f.kyc_registry);
  const ceResult = validateComplianceEngine(f.compliance_engine);
  const isinResult = validateIsin(f.isin);
  const ipfsResult = validateIpfsHash(f.prospectus_hash);
  const legalResult = validateLegalEntity(f.legal_entity);
  const govResult = validateGoverningLaw(f.governing_law);

  const hasErrors =
    !adminResult.isValid || !nameResult.isValid || !symbolResult.isValid ||
    !kycResult.isValid || !ceResult.isValid ||
    !isinResult.isValid || !ipfsResult.isValid || !legalResult.isValid || !govResult.isValid;
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
        <div>
          <Field label="Admin address *" value={f.admin} onChange={set("admin")} placeholder="G…" />
          <FieldError result={adminResult} />
        </div>
        <div>
          <Field label="Token name *" value={f.name} onChange={set("name")} placeholder="Acme Invoice Token" />
          <FieldError result={nameResult} />
        </div>
        <div>
          <Field label="Token symbol *" value={f.symbol} onChange={set("symbol")} placeholder="IVTK" />
          <FieldError result={symbolResult} />
        </div>
        <div>
          <Field label="KYC registry address *" value={f.kyc_registry} onChange={set("kyc_registry")} placeholder="C…" />
          <FieldError result={kycResult} />
        </div>
        <div>
          <Field label="Compliance engine address *" value={f.compliance_engine} onChange={set("compliance_engine")} placeholder="C…" />
          <FieldError result={ceResult} />
        </div>
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

  const adminResult = validateAdminAddress(f.admin);
  const nameResult = validateTokenName(f.name);
  const symbolResult = validateTokenSymbol(f.symbol);
  const kycResult = validateKycRegistry(f.kyc_registry);
  const ceResult = validateComplianceEngine(f.compliance_engine);
  const isinResult = validateIsin(f.isin);
  const ipfsResult = validateIpfsHash(f.prospectus_hash);
  const legalResult = validateLegalEntity(f.legal_entity);
  const govResult = validateGoverningLaw(f.governing_law);

  const hasErrors =
    !adminResult.isValid || !nameResult.isValid || !symbolResult.isValid ||
    !kycResult.isValid || !ceResult.isValid ||
    !isinResult.isValid || !ipfsResult.isValid || !legalResult.isValid || !govResult.isValid;
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
        <div>
          <Field label="Admin address *" value={f.admin} onChange={set("admin")} placeholder="G…" />
          <FieldError result={adminResult} />
        </div>
        <div>
          <Field label="Token name *" value={f.name} onChange={set("name")} placeholder="123 Main St Token" />
          <FieldError result={nameResult} />
        </div>
        <div>
          <Field label="Token symbol *" value={f.symbol} onChange={set("symbol")} placeholder="PROP" />
          <FieldError result={symbolResult} />
        </div>
        <div>
          <Field label="KYC registry address *" value={f.kyc_registry} onChange={set("kyc_registry")} placeholder="C…" />
          <FieldError result={kycResult} />
        </div>
        <div>
          <Field label="Compliance engine address *" value={f.compliance_engine} onChange={set("compliance_engine")} placeholder="C…" />
          <FieldError result={ceResult} />
        </div>
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

  const adminResult = validateAdminAddress(f.admin);
  const nameResult = validateTokenName(f.name);
  const symbolResult = validateTokenSymbol(f.symbol);
  const kycResult = validateKycRegistry(f.kyc_registry);
  const ceResult = validateComplianceEngine(f.compliance_engine);
  const vintageResult = validateVintageYear(f.vintage_year);

  const hasErrors =
    !adminResult.isValid || !nameResult.isValid || !symbolResult.isValid ||
    !kycResult.isValid || !ceResult.isValid || !vintageResult.isValid;
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
        <div>
          <Field label="Admin address *" value={f.admin} onChange={set("admin")} placeholder="G…" />
          <FieldError result={adminResult} />
        </div>
        <div>
          <Field label="Token name *" value={f.name} onChange={set("name")} placeholder="Acme Carbon Credit" />
          <FieldError result={nameResult} />
        </div>
        <div>
          <Field label="Token symbol *" value={f.symbol} onChange={set("symbol")} placeholder="ACC" />
          <FieldError result={symbolResult} />
        </div>
        <div>
          <Field label="KYC registry address *" value={f.kyc_registry} onChange={set("kyc_registry")} placeholder="C…" />
          <FieldError result={kycResult} />
        </div>
        <div>
          <Field label="Compliance engine address *" value={f.compliance_engine} onChange={set("compliance_engine")} placeholder="C…" />
          <FieldError result={ceResult} />
        </div>
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

};
