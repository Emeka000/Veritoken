import { useState } from "react";
import { useWallet } from "../lib/wallet";
import { PageHeader, Card, Icon } from "../components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type StepStatus = "complete" | "active" | "pending";

interface ChecklistStep {
  id: string;
  title: string;
  description: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS: ChecklistStep[] = [
  {
    id: "prereqs",
    title: "Install prerequisites",
    description: "You need Rust with the wasm32-unknown-unknown target, Stellar CLI, and Node.js ≥ 20.",
    action: { label: "Rust install guide", href: "https://rustup.rs" },
  },
  {
    id: "clone",
    title: "Clone the repository",
    description: "Fork or clone Veritoken and install frontend dependencies.",
  },
  {
    id: "identity",
    title: "Create a testnet identity",
    description: "Run the setup script to generate and fund a Stellar testnet keypair via Friendbot.",
  },
  {
    id: "deploy",
    title: "Deploy contracts to testnet",
    description: "Build all Soroban contracts and deploy them. The deploy script writes contract IDs to frontend/.env automatically.",
    action: { label: "Open Deploy page", href: "/deploy" },
  },
  {
    id: "wallet",
    title: "Connect your wallet",
    description: "Install the Freighter browser extension and connect it to Testnet. Then connect it here using the button in the header.",
  },
  {
    id: "kyc",
    title: "Approve your first investor",
    description: "Navigate to the KYC Registry and approve an address as a verifier. Choose tier, jurisdiction, and expiry.",
    action: { label: "Go to KYC", href: "/kyc" },
  },
  {
    id: "compliance",
    title: "Configure compliance rules",
    description: "Set transfer limits, holding periods, and jurisdiction policies in the Admin panel.",
    action: { label: "Go to Admin", href: "/admin" },
  },
  {
    id: "token",
    title: "Issue your first asset token",
    description: "Create an invoice, property share, or carbon credit token from the respective pages.",
    action: { label: "Create invoice", href: "/invoices" },
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { connected, connect } = useWallet();
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setCompleted((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const progress = Math.round((completed.size / STEPS.length) * 100);

  // Auto-complete wallet step when connected
  const effectiveCompleted = new Set(completed);
  if (connected) effectiveCompleted.add("wallet");

  const getStatus = (index: number): StepStatus => {
    const step = STEPS[index];
    if (effectiveCompleted.has(step.id)) return "complete";
    const prevDone = index === 0 || effectiveCompleted.has(STEPS[index - 1].id);
    return prevDone ? "active" : "pending";
  };

  return (
    <div className="form-narrow">
      <PageHeader
        eyebrow="Getting Started"
        icon={<Icon.arrow size={22} />}
        title="Onboarding Checklist"
        description="Follow these steps to go from a fresh clone to your first deployed asset on Stellar testnet."
      />

      {/* Progress bar */}
      <Card style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Setup progress</span>
          <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
            {effectiveCompleted.size} / {STEPS.length} steps
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 999, transition: "width 0.4s ease",
            width: `${Math.round((effectiveCompleted.size / STEPS.length) * 100)}%`,
            background: progress === 100 ? "#22c55e" : "var(--accent-2)",
          }} role="progressbar" aria-valuenow={effectiveCompleted.size} aria-valuemin={0} aria-valuemax={STEPS.length} aria-label="Onboarding progress" />
        </div>
        {effectiveCompleted.size === STEPS.length && (
          <p style={{ marginTop: "0.75rem", color: "#22c55e", fontWeight: 600, fontSize: "0.875rem" }}>
            ✓ All steps complete — you're ready to go.
          </p>
        )}
      </Card>

      {/* Steps */}
      <Card title="Setup Steps">
        <ol aria-label="Onboarding checklist" style={{ listStyle: "none", margin: 0, padding: 0, position: "relative" }}>
          <div style={{
            position: "absolute", left: 11, top: 14, bottom: 14,
            width: 2, background: "var(--border)", borderRadius: 1,
          }} aria-hidden="true" />

          {STEPS.map((step, i) => {
            const status = getStatus(i);
            const done = effectiveCompleted.has(step.id);
            const dotColor = done ? "#22c55e" : status === "active" ? "var(--accent-2)" : "var(--surface-2)";
            const dotBorder = done ? "#22c55e" : status === "active" ? "var(--accent-2)" : "var(--border)";

            return (
              <li key={step.id} style={{ display: "flex", gap: "1.25rem", position: "relative", marginBottom: "1.5rem", opacity: status === "pending" ? 0.5 : 1, transition: "opacity 0.2s" }}>
                {/* Dot / checkmark */}
                <button
                  onClick={() => toggle(step.id)}
                  disabled={step.id === "wallet"}
                  aria-label={done ? `Mark ${step.title} incomplete` : `Mark ${step.title} complete`}
                  style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    background: dotColor, border: `2px solid ${dotBorder}`,
                    display: "grid", placeItems: "center", cursor: step.id === "wallet" ? "default" : "pointer",
                    marginTop: 2, zIndex: 1, transition: "background 0.2s, border-color 0.2s",
                    padding: 0,
                  }}
                >
                  {done && (
                    <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </button>

                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.9rem", textDecoration: done ? "line-through" : "none", color: done ? "var(--text-muted)" : "var(--text)" }}>
                      {i + 1}. {step.title}
                    </span>
                    {status === "active" && !done && (
                      <span style={{ fontSize: "0.68rem", padding: "0.15rem 0.55rem", borderRadius: 999, background: "color-mix(in srgb, var(--accent-2) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--accent-2) 30%, transparent)", color: "var(--accent-2)", fontWeight: 600 }}>
                        Up next
                      </span>
                    )}
                  </div>

                  <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0.3rem 0 0", lineHeight: 1.55 }}>
                    {step.description}
                  </p>

                  {/* Special inline code snippets */}
                  {step.id === "clone" && (
                    <CodeBlock>{`git clone https://github.com/abore9769/Veritoken\ncd Veritoken\nnpm install --prefix frontend`}</CodeBlock>
                  )}
                  {step.id === "identity" && (
                    <CodeBlock>{`bash scripts/setup-identity.sh veritoken-dev`}</CodeBlock>
                  )}
                  {step.id === "deploy" && (
                    <CodeBlock>{`bash scripts/deploy.sh veritoken-dev`}</CodeBlock>
                  )}
                  {step.id === "prereqs" && (
                    <CodeBlock>{`rustup target add wasm32-unknown-unknown\ncargo install --locked stellar-cli --features opt`}</CodeBlock>
                  )}

                  {/* Action link / button */}
                  {step.action && (
                    <div style={{ marginTop: "0.6rem" }}>
                      {step.id === "wallet" && !connected ? (
                        <button className="btn-ghost" style={{ fontSize: "0.8rem", padding: "0.35rem 0.85rem" }} onClick={connect}>
                          Connect Wallet
                        </button>
                      ) : step.action.href ? (
                        <a
                          href={step.action.href}
                          target={step.action.href.startsWith("http") ? "_blank" : undefined}
                          rel={step.action.href.startsWith("http") ? "noopener noreferrer" : undefined}
                          style={{ fontSize: "0.8rem", color: "var(--accent-2)", textDecoration: "underline" }}
                        >
                          {step.action.label} →
                        </a>
                      ) : null}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CodeBlock({ children }: { children: string }) {
  return (
    <pre style={{
      marginTop: "0.5rem", padding: "0.65rem 0.85rem", borderRadius: 8,
      background: "var(--surface)", border: "1px solid var(--border)",
      fontSize: "0.78rem", lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre",
    }}>
      <code>{children}</code>
    </pre>
  );
}
