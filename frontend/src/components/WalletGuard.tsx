import { type ReactNode, useEffect, useState } from "react";
import { useWallet } from "../lib/wallet";
import { isFreighterAvailable, isMobile, buildSep7Uri, generateQrDataUrl } from "../lib/sep7";
import { Card } from "./ui";
import { NETWORK_PASSPHRASE } from "../lib/stellar";

// ── QR code panel shown to desktop users without Freighter ──────────────────

function Sep7QrPanel() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  // Build a SEP-7 URI with placeholder XDR so users can see the scheme and
  // scan it with any Stellar-compatible QR reader.
  const placeholderUri = buildSep7Uri({
    xdr: "AAAAAAAAAA==",  // minimal valid-looking placeholder
    networkPassphrase: NETWORK_PASSPHRASE,
    msg: "Sign with your mobile Stellar wallet",
  });

  useEffect(() => {
    generateQrDataUrl(placeholderUri)
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [placeholderUri]);

  async function copyUri() {
    await navigator.clipboard.writeText(placeholderUri);
    setCopying(true);
    setTimeout(() => setCopying(false), 1500);
  }

  return (
    <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)", marginBottom: "0.75rem" }}>
        Or scan with a Stellar mobile wallet (LOBSTR, xBull…)
      </p>
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="SEP-7 QR code — scan with your mobile Stellar wallet"
          style={{
            width: 180,
            height: 180,
            borderRadius: 8,
            border: "1px solid var(--border, #e2e8f0)",
            display: "block",
            margin: "0 auto 0.75rem",
          }}
        />
      ) : (
        <div
          style={{
            width: 180,
            height: 180,
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
        onClick={copyUri}
        style={{ fontSize: "0.8rem", padding: "0.35rem 0.9rem" }}
      >
        {copying ? "Copied!" : "Copy SEP-7 URI"}
      </button>
    </div>
  );
}

// ── Mobile deep-link panel ───────────────────────────────────────────────────

function Sep7MobilePanel() {
  const { signTxSep7 } = useWallet();

  function handleOpenWallet() {
    // Open a SEP-7 URI with a minimal placeholder so the user's wallet app
    // launches.  Real transaction signing happens when the app calls back with
    // the prepared XDR.
    signTxSep7("AAAAAAAAAA==", { msg: "Connect your Stellar wallet" });
  }

  return (
    <div style={{ marginTop: "1.25rem" }}>
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)", marginBottom: "0.75rem" }}>
        Freighter is a desktop browser extension. On mobile, use a SEP-7
        compatible wallet like LOBSTR or xBull.
      </p>
      <button className="btn-block" onClick={handleOpenWallet}>
        Sign with mobile wallet
      </button>
    </div>
  );
}

// ── No-wallet panel (detects Freighter availability on mount) ────────────────

function NoWalletPanel({ onConnect }: { onConnect: () => void }) {
  const [mobile] = useState(() => isMobile());
  const [freighterPresent, setFreighterPresent] = useState<boolean | null>(null);

  useEffect(() => {
    isFreighterAvailable().then(setFreighterPresent);
  }, []);

  const loading = freighterPresent === null;

  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: "3rem" }}>
      <Card style={{ textAlign: "center", maxWidth: 400 }}>
        <p style={{ marginBottom: "1.25rem", fontSize: "0.95rem" }}>
          {loading
            ? "Detecting wallet…"
            : freighterPresent
              ? "Connect your Freighter wallet to continue"
              : mobile
                ? "No browser wallet detected"
                : "Freighter not detected"}
        </p>

        {/* Freighter connect button — shown when the extension is available */}
        {!loading && freighterPresent && (
          <button className="btn-block" onClick={onConnect}>
            Connect Freighter
          </button>
        )}

        {/* Mobile deep-link fallback */}
        {!loading && !freighterPresent && mobile && <Sep7MobilePanel />}

        {/* Desktop QR fallback when Freighter is absent */}
        {!loading && !freighterPresent && !mobile && (
          <>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted, #6b7280)" }}>
              Install the{" "}
              <a
                href="https://freighter.app"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent-2, #6366f1)" }}
              >
                Freighter extension
              </a>{" "}
              for the full desktop experience, or scan the QR code below with
              your mobile Stellar wallet.
            </p>
            <Sep7QrPanel />
          </>
        )}
      </Card>
    </div>
  );
}

// ── Main guard ───────────────────────────────────────────────────────────────

export default function WalletGuard({ children }: { children: ReactNode }) {
  const { connected, connect } = useWallet();

  if (!connected) {
    return <NoWalletPanel onConnect={() => connect().catch(() => {})} />;
  }

  return <>{children}</>;
}
