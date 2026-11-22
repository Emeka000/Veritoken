/**
 * WalletGuard — updated for issue #545 multi-wallet provider abstraction.
 *
 * When no wallet is connected, shows `WalletSelectorModal` which presents
 * cards for every detected provider (Freighter, Ledger, WalletConnect).
 * The previous inline "Freighter not detected" error path is gone.
 *
 * Handles the WalletConnect pairing URI callback by displaying a QR code
 * directly in the modal until the session is established.
 */

import { type ReactNode, useCallback, useRef, useState } from "react";
import { useWallet } from "../lib/wallet";
import { describeWalletError } from "../lib/walletErrors";
import type { ProviderType, WalletProvider } from "../lib/walletProvider";
import { WalletConnectProvider } from "../lib/walletProvider";
import { NETWORK_PASSPHRASE } from "../lib/stellar";
import WalletSelectorModal from "./WalletSelectorModal";
import { WalletStatus } from "./WalletStatus";

export default function WalletGuard({
  children,
  message: _message,
}: {
  children: ReactNode;
  /** @deprecated — no longer rendered; kept for API compatibility. */
  message?: string;
}) {
  const { connected, selectProvider } = useWallet();
  const [selectorOpen, setSelectorOpen] = useState(true);
  const [connectingType, setConnectingType] = useState<ProviderType | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [wcUri, setWcUri] = useState<string | null>(null);

  // Keep a ref to the WalletConnectProvider instance so we can attach the
  // onUri callback before calling connect().
  const wcProviderRef = useRef<WalletConnectProvider | null>(null);

  const handleSelect = useCallback(
    async (type: ProviderType) => {
      setConnectError(null);
      setConnectingType(type);
      setWcUri(null);

      try {
        if (type === "walletconnect") {
          // Create the provider manually so we can hook into the URI callback
          // before connect() is called — the modal renders the QR code in-place.
          const wc = new WalletConnectProvider(NETWORK_PASSPHRASE);
          wc.onUri = (uri) => setWcUri(uri);
          wcProviderRef.current = wc;

          const address = await wc.connect();
          setWcUri(null);

          // Inject the already-connected provider into the store.
          // We call selectProvider which also handles persistence.
          // Since the provider is already connected, we patch the store directly
          // via the selectProvider path — but selectProvider will re-create the
          // instance. To avoid a double-connect we use the provider directly.
          useWallet.setState({
            provider: wc as unknown as WalletProvider,
            providerType: "walletconnect",
            address,
            connected: true,
            freighterAvailable: false,
          });

          // Persist the type for auto-reconnect.
          try {
            localStorage.setItem("veritoken-wallet-provider", "walletconnect");
          } catch {
            // Ignore
          }
        } else {
          await selectProvider(type);
        }
      } catch (err: unknown) {
        setWcUri(null);
        // Keep the raw error for developers; show only the user-safe message.
        console.error("[wallet] connection failed", type, err);
        setConnectError(describeWalletError(err));
      } finally {
        setConnectingType(null);
      }
    },
    [selectProvider],
  );

  if (!connected) {
    return (
      <div>
        {/* Textual wallet state (issue #1072) — announced politely on change. */}
        <p
          role="status"
          aria-live="polite"
          className="muted"
          style={{ textAlign: "center", fontSize: "0.85rem", margin: "0 0 0.5rem" }}
        >
          <WalletStatus
            status={connectingType || wcUri ? "pending" : "disconnected"}
            visibleLabel
          />
        </p>
        {selectorOpen ? (
          <WalletSelectorModal
            onSelect={handleSelect}
            onClose={() => setSelectorOpen(false)}
            connectingType={connectingType}
            walletConnectUri={wcUri}
          />
        ) : (
          <button type="button" autoFocus onClick={() => setSelectorOpen(true)}>
            Choose wallet
          </button>
        )}
        {connectError && (
          <p
            role="alert"
            style={{
              textAlign: "center",
              color: "#ef4444",
              fontSize: "0.85rem",
              marginTop: "0.75rem",
            }}
          >
            {connectError}
          </p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
