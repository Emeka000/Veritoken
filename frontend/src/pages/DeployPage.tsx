import { useState } from "react";
import { PageHeader, Card, Field, Icon } from "../components/ui";
import { CopyButton } from "../components/CopyButton";

type AssetTab = "invoice" | "property" | "carbon";

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

function flag(name: string, value: string) {
  return value.trim() ? ` \\\n  --${name} "${value.trim()}"` : "";
}

function buildRwaCommand(f: InvoiceFields, assetType: string, wasm: string): string {
  let cmd = `stellar contract deploy \\
  --wasm ${wasm} \\
  --source <YOUR_KEYPAIR> \\
  --network testnet \\
  -- \\
  --admin "${f.admin}" \\
  --decimal 7 \\
  --name "${f.name}" \\
  --symbol "${f.symbol}" \\
  --asset_type "${assetType}" \\
  --kyc_registry "${f.kyc_registry}" \\
  --compliance_engine "${f.compliance_engine}"`;

  const pairs: string[] = [];
  if (f.legal_entity.trim()) pairs.push(`legal_entity="${f.legal_entity.trim()}"`);
  if (f.governing_law.trim()) pairs.push(`governing_law="${f.governing_law.trim()}"`);
  if (f.isin.trim()) pairs.push(`isin="${f.isin.trim()}"`);
  if (f.prospectus_hash.trim()) pairs.push(`prospectus_hash="${f.prospectus_hash.trim()}"`);
  if (pairs.length > 0) {
    cmd += ` \\\n  --compliance_metadata '{${pairs.join(", ")}}'`;
  }
  return cmd;
}

function buildCarbonCommand(f: CarbonFields): string {
  return (
    `stellar contract deploy \\
  --wasm carbon_credit_token.wasm \\
  --source <YOUR_KEYPAIR> \\
  --network testnet \\
  -- \\
  --admin "${f.admin}" \\
  --decimal 7 \\
  --name "${f.name}" \\
  --symbol "${f.symbol}" \\
  --kyc_registry "${f.kyc_registry}" \\
  --compliance_engine "${f.compliance_engine}"` +
    flag("vintage_year", f.vintage_year) +
    flag("methodology", f.methodology) +
    flag("registry", f.registry) +
    flag("project_id", f.project_id)
  );
}

function CommandOutput({ command }: { command: string }) {
  const hasContent = Object.values({ command }).some((v) => v.includes('"" ') === false);
  if (!hasContent) return null;
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

function InvoiceTab() {
  const [f, setF] = useState<InvoiceFields>(EMPTY_INVOICE);
  const set = (k: keyof InvoiceFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  const command = buildRwaCommand(f, "invoice", "rwa_token.wasm");

  return (
    <div style={styles.tabContent}>
      <p className="muted" style={{ marginBottom: "1.5rem" }}>
        Deploy an invoice-backed RWA token. Fill in the fields and copy the generated CLI command.
      </p>
      <div style={styles.grid}>
        <Field label="Admin address *" value={f.admin} onChange={set("admin")} placeholder="G…" />
        <Field label="Token name *" value={f.name} onChange={set("name")} placeholder="Acme Invoice Token" />
        <Field label="Token symbol *" value={f.symbol} onChange={set("symbol")} placeholder="IVTK" />
        <Field label="KYC registry address *" value={f.kyc_registry} onChange={set("kyc_registry")} placeholder="C…" />
        <Field label="Compliance engine address *" value={f.compliance_engine} onChange={set("compliance_engine")} placeholder="C…" />
        <Field label="Legal entity" value={f.legal_entity} onChange={set("legal_entity")} placeholder="Acme Corp LLC" />
        <Field label="Governing law" value={f.governing_law} onChange={set("governing_law")} placeholder="New York" />
        <Field label="ISIN" value={f.isin} onChange={set("isin")} placeholder="US1234567890" />
        <Field label="Prospectus hash (IPFS)" value={f.prospectus_hash} onChange={set("prospectus_hash")} placeholder="QmXxx…" />
      </div>
      <CommandOutput command={command} />
    </div>
  );
}

function PropertyTab() {
  const [f, setF] = useState<InvoiceFields>(EMPTY_INVOICE);
  const set = (k: keyof InvoiceFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  const command = buildRwaCommand(f, "property", "rwa_token.wasm");

  return (
    <div style={styles.tabContent}>
      <p className="muted" style={{ marginBottom: "1.5rem" }}>
        Deploy a real-estate property RWA token. Fill in the fields and copy the generated CLI command.
      </p>
      <div style={styles.grid}>
        <Field label="Admin address *" value={f.admin} onChange={set("admin")} placeholder="G…" />
        <Field label="Token name *" value={f.name} onChange={set("name")} placeholder="123 Main St Token" />
        <Field label="Token symbol *" value={f.symbol} onChange={set("symbol")} placeholder="PROP" />
        <Field label="KYC registry address *" value={f.kyc_registry} onChange={set("kyc_registry")} placeholder="C…" />
        <Field label="Compliance engine address *" value={f.compliance_engine} onChange={set("compliance_engine")} placeholder="C…" />
        <Field label="Legal entity" value={f.legal_entity} onChange={set("legal_entity")} placeholder="Realty Partners LLC" />
        <Field label="Governing law" value={f.governing_law} onChange={set("governing_law")} placeholder="Delaware" />
        <Field label="ISIN" value={f.isin} onChange={set("isin")} placeholder="US0000000000" />
        <Field label="Prospectus hash (IPFS)" value={f.prospectus_hash} onChange={set("prospectus_hash")} placeholder="QmXxx…" />
      </div>
      <CommandOutput command={command} />
    </div>
  );
}

function CarbonTab() {
  const [f, setF] = useState<CarbonFields>(EMPTY_CARBON);
  const set = (k: keyof CarbonFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  const command = buildCarbonCommand(f);

  return (
    <div style={styles.tabContent}>
      <p className="muted" style={{ marginBottom: "1.5rem" }}>
        Deploy a carbon credit token. Fill in the fields and copy the generated CLI command.
      </p>
      <div style={styles.grid}>
        <Field label="Admin address *" value={f.admin} onChange={set("admin")} placeholder="G…" />
        <Field label="Token name *" value={f.name} onChange={set("name")} placeholder="Acme Carbon Credit" />
        <Field label="Token symbol *" value={f.symbol} onChange={set("symbol")} placeholder="ACC" />
        <Field label="KYC registry address *" value={f.kyc_registry} onChange={set("kyc_registry")} placeholder="C…" />
        <Field label="Compliance engine address *" value={f.compliance_engine} onChange={set("compliance_engine")} placeholder="C…" />
        <Field label="Vintage year" value={f.vintage_year} onChange={set("vintage_year")} placeholder="2024" />
        <Field label="Methodology" value={f.methodology} onChange={set("methodology")} placeholder="VCS VM0010" />
        <Field label="Registry" value={f.registry} onChange={set("registry")} placeholder="Verra" />
        <Field label="Project ID" value={f.project_id} onChange={set("project_id")} placeholder="VCS-1234" />
      </div>
      <CommandOutput command={command} />
    </div>
  );
}

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
