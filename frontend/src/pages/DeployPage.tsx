import { useState, useEffect, useRef } from "react";
import { PageHeader, Card, Icon } from "../components/ui";
import { CopyButton } from "../components/CopyButton";
import { ContractForm } from "../components/ContractForm";
import { DraftBanner } from "../components/DraftBanner";
import { DEPLOY_PRESETS, isDeployReady, type AssetType } from "../lib/contractFactory";
import { validateForm, isFormValid, emptyValues } from "../lib/formSchema";
import { getDraft, saveDraft, discardDraft, type DraftEntry } from "../lib/drafts";

// ── Draft autosave (issue #450) ────────────────────────────────────────────────

const DRAFT_AUTOSAVE_DEBOUNCE_MS = 600;
const draftFlow = (assetType: AssetType) => `deploy:${assetType}`;

function isStringRecord(v: Record<string, unknown>): v is Record<string, string> {
  return Object.values(v).every((x) => typeof x === "string");
}

// ── Generic asset tab, driven by DEPLOY_PRESETS[assetType].fields (issue #447) ──

function AssetTab({ assetType }: { assetType: AssetType }) {
  const preset = DEPLOY_PRESETS[assetType];
  const flow = draftFlow(assetType);

  // `AssetTab` is remounted (via `key={tab}`) whenever the active tab changes,
  // so these initializers naturally re-run per asset type.
  const [values, setValues] = useState<Record<string, string>>(() => emptyValues(preset.fields));
  const [draft, setDraft] = useState<DraftEntry | undefined>(() => getDraft(flow));
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();

  // Debounced autosave of in-progress values, so the tab can be resumed later.
  useEffect(() => {
    if (draft) return; // don't autosave over an unresolved draft banner
    const hasAnyValue = Object.values(values).some((v) => v.trim().length > 0);
    clearTimeout(autosaveTimer.current);
    if (!hasAnyValue) return;
    autosaveTimer.current = setTimeout(() => {
      saveDraft(flow, values);
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(autosaveTimer.current);
  }, [values, flow, draft]);

  const handleResume = () => {
    if (draft && isStringRecord(draft.values)) {
      const resumedValues = draft.values;
      setValues((prev) => ({ ...prev, ...resumedValues }));
    }
    setDraft(undefined);
  };

  const handleDiscardDraft = () => {
    discardDraft(flow);
    setDraft(undefined);
  };

  const handleCopy = () => {
    discardDraft(flow);
    setDraft(undefined);
  };

  const results = validateForm(preset.fields, values);
  const ready = isFormValid(results) && isDeployReady(values, preset);
  const command = preset.buildCommand(values);

  return (
    <div style={styles.tabContent}>
      {draft && (
        <DraftBanner draft={draft} onResume={handleResume} onDiscard={handleDiscardDraft} />
      )}
      <p className="muted" style={{ marginBottom: "1.5rem" }}>
        {preset.description}
      </p>
      <div style={styles.grid}>
        <ContractForm
          schema={preset.fields}
          values={values}
          onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
        />
      </div>
      <CommandOutput command={command} ready={ready} onCopy={handleCopy} />
    </div>
  );
}

function CommandOutput({ command, ready, onCopy }: { command: string; ready: boolean; onCopy: () => void }) {
  if (!ready) return null;
  return (
    <div style={styles.outputWrap}>
      <div style={styles.outputHeader}>
        <span style={styles.outputLabel}>Generated deploy command</span>
        <CopyButton text={command} label="Copy deploy command" onCopy={onCopy} />
      </div>
      <pre style={styles.pre}>
        <code>{command}</code>
      </pre>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function DeployPage() {
  const [tab, setTab] = useState<AssetType>("invoice");

  return (
    <div>
      <PageHeader
        title="Deploy Asset Token"
        description="Generate the Stellar CLI command to deploy a new tokenized asset contract."
        icon={<Icon.admin size={22} />}
      />

      <Card>
        <div style={styles.tabs}>
          {(["invoice", "property", "carbon"] as AssetType[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            >
              {t === "invoice" ? "Invoice" : t === "property" ? "Property" : "Carbon Credit"}
            </button>
          ))}
        </div>

        <AssetTab key={tab} assetType={tab} />
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
