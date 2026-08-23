/**
 * WalletProvider abstraction — issue #545
 *
 * Defines the `WalletProvider` interface and three concrete implementations:
 *  - `FreighterProvider`    — existing @stellar/freighter-api behaviour
 *  - `LedgerProvider`       — Ledger Nano via @ledgerhq/hw-transport-webusb
 *  - `WalletConnectProvider`— WalletConnect v2 via @walletconnect/sign-client
 *
 * All providers share the same interface so `useWallet` can swap between them
 * without caring about the underlying transport.
 */

import {
  getPublicKey,
  signTransaction,
  setAllowed,
  isConnected as freighterIsConnected,
} from "@stellar/freighter-api";

// ── Provider interface ────────────────────────────────────────────────────────

export type ProviderType = "freighter" | "ledger" | "walletconnect";

export interface WalletProvider {
  /** Discriminator for persistence and UI labelling. */
  readonly type: ProviderType;

  /**
   * Connect to the wallet. Resolves with the user's Stellar public key on
   * success. Throws a user-friendly `Error` on failure.
   */
  connect(): Promise<string>;

  /** Disconnect and clean up any open transport / session. */
  disconnect(): Promise<void>;

  /**
   * Sign a base-64–encoded XDR transaction envelope. Resolves with the signed
   * XDR string. Throws when the user rejects or the device is unreachable.
   */
  signXdr(xdr: string): Promise<string>;

  /**
   * Returns `true` when this provider can be used in the current browser
   * context. Called during wallet selector UI construction to filter cards.
   */
  isAvailable(): Promise<boolean>;
}

// ── FreighterProvider ────────────────────────────────────────────────────────

export class FreighterProvider implements WalletProvider {
  readonly type = "freighter" as const;
  private networkPassphrase: string;

  constructor(networkPassphrase: string) {
    this.networkPassphrase = networkPassphrase;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await Promise.race([
        freighterIsConnected(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 400)),
      ]);
      return Boolean(result);
    } catch {
      return false;
    }
  }

  async connect(): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error(
        "Freighter wallet is not installed. Install the Freighter extension and try again.",
      );
    }
    await setAllowed();
    return getPublicKey();
  }

  async disconnect(): Promise<void> {
    // Freighter manages its own session; nothing to tear down from the dapp side.
  }

  async signXdr(xdr: string): Promise<string> {
    return signTransaction(xdr, { networkPassphrase: this.networkPassphrase });
  }
}

// ── LedgerProvider ────────────────────────────────────────────────────────────
//
// Uses @ledgerhq/hw-transport-webusb (Chrome/Edge only) and @ledgerhq/hw-app-str
// to communicate with a connected Ledger device running the Stellar app.
//
// Error types handled:
//   TransportOpenUserCancelled — user dismissed the USB device picker
//   DisconnectedDevice         — device was unplugged after pairing
//
// Only account index 0 is used (per issue scope).

const LEDGER_STELLAR_PATH = "44'/148'/0'";

/** Minimal subset of the hw-transport interface needed here. */
interface LedgerTransport {
  close(): Promise<void>;
}

export class LedgerProvider implements WalletProvider {
  readonly type = "ledger" as const;
  private transport: LedgerTransport | null = null;
  private cachedPublicKey: string | null = null;
  private networkPassphrase: string;

  constructor(networkPassphrase: string) {
    this.networkPassphrase = networkPassphrase;
  }

  /** WebUSB is only available in Chromium-based browsers. */
  async isAvailable(): Promise<boolean> {
    return (
      typeof navigator !== "undefined" &&
      "usb" in navigator &&
      (navigator as Navigator & { usb?: unknown }).usb != null
    );
  }

  async connect(): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error(
        "Ledger hardware wallet requires a Chromium-based browser (Chrome, Edge, Brave) with WebUSB support.",
      );
    }

    try {
      // Dynamic import keeps the Ledger bundles out of the main chunk.
      const TransportWebUSB = await import("@ledgerhq/hw-transport-webusb").then(
        (m) => m.default,
      );
      const Str = await import("@ledgerhq/hw-app-str").then((m) => m.default);
      const { StrKey } = await import("@stellar/stellar-sdk");

      const transport = (await TransportWebUSB.create()) as unknown as LedgerTransport;
      this.transport = transport;

      // hw-app-str accepts the transport as-is; cast to satisfy strict generics.
      const stellar = new Str(transport as unknown as ConstructorParameters<typeof Str>[0]);

      // getPublicKey returns { rawPublicKey: Buffer } — convert to G-address.
      const { rawPublicKey } = await stellar.getPublicKey(LEDGER_STELLAR_PATH);
      const address = StrKey.encodeEd25519PublicKey(rawPublicKey);

      this.cachedPublicKey = address;
      return address;
    } catch (err: unknown) {
      this.transport = null;
      this.cachedPublicKey = null;
      throw LedgerProvider.normaliseError(err);
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Best-effort close
      }
      this.transport = null;
    }
    this.cachedPublicKey = null;
  }

  async signXdr(xdr: string): Promise<string> {
    if (!this.cachedPublicKey) {
      throw new Error("Ledger not connected. Please reconnect your device.");
    }

    try {
      const TransportWebUSB = await import("@ledgerhq/hw-transport-webusb").then(
        (m) => m.default,
      );
      const Str = await import("@ledgerhq/hw-app-str").then((m) => m.default);
      const { TransactionBuilder, Keypair } = await import("@stellar/stellar-sdk");

      // Re-open transport if it was closed after connect (device sleep / unplug).
      if (!this.transport) {
        const transport = (await TransportWebUSB.create()) as unknown as LedgerTransport;
        this.transport = transport;
      }

      const stellar = new Str(this.transport as unknown as ConstructorParameters<typeof Str>[0]);

      // Deserialise the XDR to get the signature base Ledger expects.
      const tx = TransactionBuilder.fromXDR(xdr, this.networkPassphrase);
      // signatureBase() returns the raw bytes the device signs.
      const sigBase = (tx as unknown as { signatureBase(): Buffer }).signatureBase();

      const { signature } = await stellar.signTransaction(LEDGER_STELLAR_PATH, sigBase);

      // Inject the Ledger signature into the envelope and re-serialise.
      const kp = Keypair.fromPublicKey(this.cachedPublicKey);
      (tx as unknown as {
        addSignature(publicKey: string, signature: string): void;
      }).addSignature(kp.publicKey(), signature.toString("base64"));

      return tx.toEnvelope().toXDR("base64");
    } catch (err: unknown) {
      throw LedgerProvider.normaliseError(err);
    }
  }

  /** Converts Ledger transport errors into readable messages. */
  private static normaliseError(err: unknown): Error {
    if (err instanceof Error) {
      const msg = err.message ?? "";
      if (msg.includes("TransportOpenUserCancelled") || msg.includes("cancelled")) {
        return new Error(
          "USB device selection was cancelled. Please try again and select your Ledger device.",
        );
      }
      if (msg.includes("DisconnectedDevice") || msg.includes("disconnected")) {
        return new Error(
          "Ledger device disconnected. Please reconnect your device and try again.",
        );
      }
      if (msg.includes("0x6985") || msg.includes("rejected")) {
        return new Error("Transaction was rejected on the Ledger device.");
      }
      if (msg.includes("Stellar app") || msg.includes("0x6e00") || msg.includes("0x6d00")) {
        return new Error(
          "Please open the Stellar app on your Ledger device before connecting.",
        );
      }
      return err;
    }
    return new Error("An unexpected error occurred communicating with the Ledger device.");
  }
}

// ── WalletConnectProvider ─────────────────────────────────────────────────────
//
// Uses @walletconnect/sign-client.  On connect():
//   1. Creates a SignClient (or reuses a stored session from localStorage).
//   2. Proposes a session with `stellar:testnet` or `stellar:mainnet` namespace.
//   3. Displays the QR code URI via a callback so the UI layer can render it.
//   4. Waits for session approval and extracts the Stellar public key.
//
// signXdr() sends a `stellar_signXDR` JSON-RPC method to the connected wallet.
//
// Sessions are persisted to localStorage under WALLETCONNECT_SESSION_KEY so
// reconnect on page refresh skips the QR step.

const WALLETCONNECT_SESSION_KEY = "veritoken-wc-session";
const WALLETCONNECT_PROJECT_ID: string =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_WALLETCONNECT_PROJECT_ID) ||
  "veritoken-dev";

type SignClientType = Awaited<ReturnType<typeof createSignClient>>;

async function createSignClient(projectId: string) {
  const { SignClient } = await import("@walletconnect/sign-client");
  return SignClient.init({
    projectId,
    metadata: {
      name: "Veritoken",
      description: "RWA Tokenization on Stellar",
      url: typeof window !== "undefined" ? window.location.origin : "https://veritoken.app",
      icons: ["https://avatars.githubusercontent.com/u/VERITOKEN-xx"],
    },
  });
}

export class WalletConnectProvider implements WalletProvider {
  readonly type = "walletconnect" as const;
  private client: SignClientType | null = null;
  private sessionTopic: string | null = null;
  private network: "testnet" | "mainnet";

  /**
   * `onUri` is called with the WalletConnect pairing URI when a new session is
   * being established. The UI layer should render this as a QR code.
   */
  onUri?: (uri: string) => void;

  constructor(
    _networkPassphrase: string,
    network: "testnet" | "mainnet" = "testnet",
  ) {
    this.network = network;
  }

  async isAvailable(): Promise<boolean> {
    // WalletConnect works in all modern browsers that support WebCrypto.
    return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
  }

  async connect(): Promise<string> {
    const client = await createSignClient(WALLETCONNECT_PROJECT_ID);
    this.client = client;

    // Try to restore an existing session first.
    const stored = this.restoreSession();
    if (stored) {
      this.sessionTopic = stored.topic;
      const accounts: string[] = stored.namespaces?.stellar?.accounts ?? [];
      const address = this.extractAddress(accounts);
      if (address) {
        return address;
      }
    }

    // No valid session — initiate a new pairing.
    const stellarNamespace = `stellar:${this.network}`;

    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        stellar: {
          methods: ["stellar_signXDR"],
          chains: [stellarNamespace],
          events: [],
        },
      },
    });

    if (uri && this.onUri) {
      this.onUri(uri);
    }

    const session = await approval();
    this.sessionTopic = session.topic;
    this.persistSession(session);

    const accounts: string[] = session.namespaces?.stellar?.accounts ?? [];
    const address = this.extractAddress(accounts);
    if (!address) {
      throw new Error("WalletConnect session established but no Stellar address was returned.");
    }

    return address;
  }

  async disconnect(): Promise<void> {
    if (this.client && this.sessionTopic) {
      try {
        await this.client.disconnect({
          topic: this.sessionTopic,
          reason: { code: 6000, message: "User disconnected" },
        });
      } catch {
        // Best-effort
      }
    }
    this.sessionTopic = null;
    this.client = null;
    try {
      localStorage.removeItem(WALLETCONNECT_SESSION_KEY);
    } catch {
      // localStorage may be unavailable in SSR / test envs
    }
  }

  async signXdr(xdr: string): Promise<string> {
    if (!this.client || !this.sessionTopic) {
      throw new Error(
        "WalletConnect session not established. Please connect your wallet first.",
      );
    }

    const stellarNamespace = `stellar:${this.network}`;

    try {
      const result = await this.client.request<{ signedXDR: string }>({
        topic: this.sessionTopic,
        chainId: stellarNamespace,
        request: {
          method: "stellar_signXDR",
          params: { xdr },
        },
      });
      return result.signedXDR;
    } catch (err: unknown) {
      // Attempt automatic reconnect on session expiry then re-throw.
      if (err instanceof Error && err.message.includes("expired")) {
        localStorage.removeItem(WALLETCONNECT_SESSION_KEY);
        this.sessionTopic = null;
        throw new Error(
          "WalletConnect session expired. Please reconnect your wallet.",
        );
      }
      throw err;
    }
  }

  // ── Session persistence helpers ───────────────────────────────────────────

  private persistSession(session: unknown): void {
    try {
      localStorage.setItem(WALLETCONNECT_SESSION_KEY, JSON.stringify(session));
    } catch {
      // Ignore
    }
  }

  private restoreSession(): {
    topic: string;
    namespaces?: { stellar?: { accounts?: string[] } };
  } | null {
    try {
      const raw = localStorage.getItem(WALLETCONNECT_SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as {
        topic: string;
        namespaces?: { stellar?: { accounts?: string[] } };
      };
    } catch {
      return null;
    }
  }

  /**
   * Extracts a bare Stellar address from a WalletConnect account string.
   * WalletConnect encodes accounts as `<namespace>:<chain>:<address>`.
   */
  private extractAddress(accounts: string[]): string | null {
    for (const acct of accounts) {
      const parts = acct.split(":");
      if (parts.length >= 3) return parts[parts.length - 1];
    }
    return null;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Instantiates the appropriate provider for `type`. */
export function createProvider(
  type: ProviderType,
  networkPassphrase: string,
  network: "testnet" | "mainnet" = "testnet",
): WalletProvider {
  switch (type) {
    case "freighter":
      return new FreighterProvider(networkPassphrase);
    case "ledger":
      return new LedgerProvider(networkPassphrase);
    case "walletconnect":
      return new WalletConnectProvider(networkPassphrase, network);
  }
}
