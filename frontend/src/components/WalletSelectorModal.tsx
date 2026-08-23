/**
 * WalletSelectorModal — issue #545
 *
 * Displays wallet provider cards filtered by availability.  Shown by
 * WalletGuard when no wallet is connected, replacing the previous inline
 * "Freighter not detected" error.
 *
 * Each card renders:
 *  - Provider icon (SVG inline)
 *  - Name and one-line description
 *  - Availability status
 *  - Connect button (disabled when unavailable)
 */

import { useEffect, useState } from "react";
import type { ProviderType } from "../lib/walletProvider";
import { FreighterProvider, LedgerProvider, WalletConnectProvider } from "../lib/walletProvider";
import { NETWORK_PASSPHRASE } from "../lib/stellar";
import { generateQrDataUrl } from "../lib/sep7";
import { Card } from "./ui";

// ── Provider meta ─────────────────────────────────────────────────────────────

interface ProviderMeta {
  type: ProviderType;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const PROVIDERS: ProviderMeta[] = [
  {
    type: "freighter",
    name: "Freighter",
    description: "Official Stellar browser extension wallet",
    icon: (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        aria-hidden="true"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="40" height="40" rx="10" fill="#6366F1" />
        <path
          d="M20 10L10 26H30L20 10Z"
          fill="white"
          fillOpacity="0.9"
        />
      </svg>
    ),
  },
  {
    type: "ledger",
    name: "Ledger",
    description: "Hardware wallet (Nano X / Nano S+) via USB — Chrome only",
    icon: (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        aria-hidden="true"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="40" height="40" rx="10" fill="#1A1A2E" />
        <rect x="10" y="15" width="20" height="14" rx="2" stroke="white" strokeWidth="2" />
        <rect x="14" y="19" width="4" height="6" rx="1" fill="white" fillOpacity="0.6" />
      </svg>
    ),
  },
  {
    type: "walletconnect",
    name: "WalletConnect",
    description: "Scan QR code from a mobile Stellar wallet (LOBSTR, xBull)",
    icon: (
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        aria-hidden="true"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="40" height="40" rx="10" fill="#3B99FC" />
        <path
          d="M13 22C16 19 24 19 27 22L29 20C25 16 15 16 11 20L13 22Z"
          fill="white"
        />
        <path
          d="M16 25C17.5 23.5 22.5 23.5 24 25L26 23C23.5 20.5 16.5 20.5 14 23L16 25Z"
          fill="white"
          fillOpacity="0.8"
        />
        <circle cx="20" cy="27" r="2" fill="white" fillOpacity="0.6" />
      </svg>
    ),
  },
];

// ── Availability check ────────────────────────────────────────────────────────

async function checkAvailability(type: ProviderType): Promise<boolean> {
  const provider =
    type === "freighter"
      ? new FreighterProvider(NETWORK_PASSPHRASE)
      : type === "ledger"
        ? new LedgerProvider(NETWORK_PASSPHRASE)
        : new WalletConnectProvider(NETWORK_PASSPHRASE);
  return provider.isAvailable();
}

// ── WalletConnect QR panel ────────────────────────────────────────────────────

function WalletConnectQrPanel({ uri }: { uri: string }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    generateQrDataUrl(uri)
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [uri]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable
    }
  }

  return (
    <div style={{ textAlign: "center", marginTop: "1rem" }}>
      <p
        style={{
          fontSize: "0.85rem",
          color: "var(--text-muted, #6b7280)",
          marginBottom: "0.75rem",
        }}
      >
        Scan with your Stellar mobile wallet
      </p>
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="WalletConnect QR code — scan with your mobile Stellar wallet"
          width={200}
          height={200}
          style={{
            borderRadius: 8,
            border: "1px solid var(--border, #e2e8f0)",
            display: "block",
            margin: "0 auto 0.75rem",
          }}
        />
      ) : (
        <div
          aria-label="Generating QR code…"
          style={{
            width: 200,
            height: 200,
            borderRadius: 8,
            background: "var(--surface-2, #f1f5f9)",
            margin: "0 auto 0.75rem",
            display: "grid",
            placeItems: "center",
            fontSize: "0.8rem",
            color: "var(--text-muted, #6b7280)",
          }}
        >
          Generating QR…
        </div>
      )}
      <button
        className="btn-secondary"
        onClick={handleCopy}
        style={{ fontSize: "0.8rem", padding: "0.35rem 0.9rem" }}
      >
        {copied ? "Copied!" : "Copy URI"}
      </button>
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────

interface ProviderCardProps {
  meta: ProviderMeta;
  available: boolean | null;
  connecting: boolean;
  onSelect: (type: ProviderType) => void;
}

function ProviderCard({ meta, available, connecting, onSelect }: ProviderCardProps) {
  const loading = available === null;
  const disabled = loading || available === false || connecting;

  return (
    <div
      role="group"
      aria-label={`${meta.name} wallet option`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: "0.875rem 1rem",
        borderRadius: 10,
        border: "1px solid var(--border, #e2e8f0)",
        background: disabled
          ? "var(--surface-2, #f8fafc)"
          : "var(--surface, #ffffff)",
        opacity: available === false ? 0.55 : 1,
        transition: "opacity 0.2s",
      }}
    >
      {/* Icon */}
      <div aria-hidden="true">{meta.icon}</div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: "0.95rem",
            color: "var(--text-primary, #0f172a)",
          }}
        >
          {meta.name}
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted, #6b7280)",
            marginTop: 2,
          }}
        >
          {meta.description}
        </div>
        {available === false && (
          <div
            role="status"
            style={{
              fontSize: "0.75rem",
              color: "#ef4444",
              marginTop: 3,
            }}
          >
            {meta.type === "freighter"
              ? "Extension not detected"
              : meta.type === "ledger"
                ? "Requires Chrome / Edge / Brave"
                : "Unavailable"}
          </div>
        )}
      </div>

      {/* Connect button */}
      <button
        className="btn-secondary"
        onClick={() => onSelect(meta.type)}
        disabled={disabled}
        aria-busy={connecting}
        style={{
          fontSize: "0.85rem",
          padding: "0.4rem 1rem",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {loading ? "Checking…" : connecting ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export interface WalletSelectorModalProps {
  /**
   * Called with the chosen provider type when the user clicks Connect.
   * The parent is responsible for calling `useWallet().selectProvider(type)`.
   */
  onSelect: (type: ProviderType) => void;

  /** Optional connecting state — shows spinner on the active card. */
  connectingType?: ProviderType | null;

  /** WalletConnect pairing URI — when set, renders the QR code panel. */
  walletConnectUri?: string | null;
}

export default function WalletSelectorModal({
  onSelect,
  connectingType = null,
  walletConnectUri = null,
}: WalletSelectorModalProps) {
  const [availability, setAvailability] = useState<
    Record<ProviderType, boolean | null>
  >({
    freighter: null,
    ledger: null,
    walletconnect: null,
  });

  // Probe all providers concurrently on mount.
  useEffect(() => {
    for (const meta of PROVIDERS) {
      checkAvailability(meta.type).then((available) => {
        setAvailability((prev) => ({ ...prev, [meta.type]: available }));
      });
    }
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Select a wallet to connect"
      style={{ display: "flex", justifyContent: "center", marginTop: "3rem" }}
    >
      <Card style={{ maxWidth: 440, width: "100%" }}>
        <h2
          style={{
            fontSize: "1.1rem",
            fontWeight: 600,
            marginBottom: "1.25rem",
            color: "var(--text-primary, #0f172a)",
          }}
        >
          Connect a wallet
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {PROVIDERS.map((meta) => (
            <ProviderCard
              key={meta.type}
              meta={meta}
              available={availability[meta.type]}
              connecting={connectingType === meta.type}
              onSelect={onSelect}
            />
          ))}
        </div>

        {/* WalletConnect QR code panel */}
        {walletConnectUri && <WalletConnectQrPanel uri={walletConnectUri} />}

        <p
          style={{
            fontSize: "0.78rem",
            color: "var(--text-muted, #6b7280)",
            marginTop: "1.25rem",
            textAlign: "center",
          }}
        >
          Don't have a wallet?{" "}
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent-2, #6366f1)" }}
          >
            Install Freighter
          </a>{" "}
          for the best desktop experience.
        </p>
      </Card>
    </div>
  );
}
