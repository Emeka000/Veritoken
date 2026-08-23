/**
 * Unit tests for the WalletProvider abstraction — issue #545.
 *
 * Covers:
 *  - FreighterProvider: connect, signXdr, isAvailable, error paths
 *  - LedgerProvider:    connect, signXdr, isAvailable (mocked WebUSB transport)
 *  - WalletConnectProvider: connect (new session + restore), signXdr, disconnect,
 *                           session expiry, isAvailable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Freighter mocks ──────────────────────────────────────────────────────────

const mockIsConnected = vi.hoisted(() => vi.fn());
const mockGetPublicKey = vi.hoisted(() => vi.fn());
const mockSignTransaction = vi.hoisted(() => vi.fn());
const mockSetAllowed = vi.hoisted(() => vi.fn());

vi.mock("@stellar/freighter-api", () => ({
  isConnected: mockIsConnected,
  getPublicKey: mockGetPublicKey,
  signTransaction: mockSignTransaction,
  setAllowed: mockSetAllowed,
}));

// ── Ledger mocks ─────────────────────────────────────────────────────────────

const mockTransportCreate = vi.hoisted(() => vi.fn());
const mockGetPublicKeyLedger = vi.hoisted(() => vi.fn());
const mockSignTransactionLedger = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn());

vi.mock("@ledgerhq/hw-transport-webusb", () => ({
  default: { create: mockTransportCreate },
}));

vi.mock("@ledgerhq/hw-app-str", () => ({
  default: vi.fn().mockImplementation(() => ({
    getPublicKey: mockGetPublicKeyLedger,
    signTransaction: mockSignTransactionLedger,
  })),
}));

// ── WalletConnect mocks ───────────────────────────────────────────────────────

const mockWcConnect = vi.hoisted(() => vi.fn());
const mockWcRequest = vi.hoisted(() => vi.fn());
const mockWcDisconnect = vi.hoisted(() => vi.fn());
const mockSignClientInit = vi.hoisted(() => vi.fn());

vi.mock("@walletconnect/sign-client", () => ({
  SignClient: {
    init: mockSignClientInit,
  },
}));

// ── Stellar SDK mock (for Ledger XDR signing) ────────────────────────────────

vi.mock("@stellar/stellar-sdk", () => {
  const fakeAddSignature = vi.fn();
  const fakeToXDR = vi.fn().mockReturnValue(Buffer.from("signed-bytes"));
  const fakeToEnvelope = vi.fn().mockReturnValue({
    toXDR: fakeToXDR,
  });
  const fakeTx = {
    addSignature: fakeAddSignature,
    toEnvelope: fakeToEnvelope,
    signatureBase: vi.fn().mockReturnValue(Buffer.from("sig-base")),
  };
  return {
    TransactionBuilder: {
      fromXDR: vi.fn().mockReturnValue(fakeTx),
    },
    Keypair: {
      fromPublicKey: vi.fn().mockReturnValue({ publicKey: () => "MOCK_PUBLIC_KEY" }),
    },
    StrKey: {
      encodeEd25519PublicKey: vi.fn().mockReturnValue("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"),
    },
  };
});

import {
  FreighterProvider,
  LedgerProvider,
  WalletConnectProvider,
  createProvider,
} from "../walletProvider";

const TEST_PASSPHRASE = "Test SDF Network ; September 2015";
const TEST_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// ── localStorage stub ─────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// ── navigator.usb stub ────────────────────────────────────────────────────────

function enableWebUsb(enable: boolean) {
  Object.defineProperty(navigator, "usb", {
    value: enable ? {} : undefined,
    writable: true,
    configurable: true,
  });
}

// ── crypto.subtle stub ────────────────────────────────────────────────────────

Object.defineProperty(globalThis, "crypto", {
  value: { subtle: {} },
  writable: true,
  configurable: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// FreighterProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("FreighterProvider", () => {
  let provider: FreighterProvider;

  beforeEach(() => {
    provider = new FreighterProvider(TEST_PASSPHRASE);
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it("type is 'freighter'", () => {
    expect(provider.type).toBe("freighter");
  });

  it("isAvailable returns true when freighter is connected", async () => {
    mockIsConnected.mockResolvedValue(true);
    expect(await provider.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when freighter is absent", async () => {
    mockIsConnected.mockResolvedValue(false);
    expect(await provider.isAvailable()).toBe(false);
  });

  it("isAvailable returns false on timeout (400 ms race)", async () => {
    mockIsConnected.mockImplementation(
      () => new Promise<boolean>((r) => setTimeout(() => r(true), 1000)),
    );
    const result = await provider.isAvailable();
    expect(result).toBe(false);
  });

  it("isAvailable returns false when freighter throws", async () => {
    mockIsConnected.mockRejectedValue(new Error("extension error"));
    expect(await provider.isAvailable()).toBe(false);
  });

  it("connect throws when freighter is not available", async () => {
    mockIsConnected.mockResolvedValue(false);
    await expect(provider.connect()).rejects.toThrow(/Freighter wallet is not installed/i);
  });

  it("connect returns public key on success", async () => {
    mockIsConnected.mockResolvedValue(true);
    mockSetAllowed.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue(TEST_ADDRESS);

    const address = await provider.connect();
    expect(address).toBe(TEST_ADDRESS);
    expect(mockSetAllowed).toHaveBeenCalledOnce();
  });

  it("signXdr calls freighter signTransaction", async () => {
    mockSignTransaction.mockResolvedValue("signed-xdr");
    const result = await provider.signXdr("raw-xdr");
    expect(result).toBe("signed-xdr");
    expect(mockSignTransaction).toHaveBeenCalledWith("raw-xdr", {
      networkPassphrase: TEST_PASSPHRASE,
    });
  });

  it("disconnect resolves without error", async () => {
    await expect(provider.disconnect()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LedgerProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("LedgerProvider", () => {
  let provider: LedgerProvider;
  const fakeTransport = { close: mockClose };

  beforeEach(() => {
    provider = new LedgerProvider(TEST_PASSPHRASE);
    vi.clearAllMocks();
    enableWebUsb(true);
    mockTransportCreate.mockResolvedValue(fakeTransport);
    mockClose.mockResolvedValue(undefined);
    mockGetPublicKeyLedger.mockResolvedValue({ publicKey: TEST_ADDRESS });
    mockSignTransactionLedger.mockResolvedValue({
      signature: Buffer.from("mock-signature"),
    });
  });

  afterEach(() => {
    enableWebUsb(false);
  });

  it("type is 'ledger'", () => {
    expect(provider.type).toBe("ledger");
  });

  it("isAvailable returns true when navigator.usb is present", async () => {
    enableWebUsb(true);
    expect(await provider.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when navigator.usb is absent", async () => {
    enableWebUsb(false);
    expect(await provider.isAvailable()).toBe(false);
  });

  it("connect throws when WebUSB is unavailable", async () => {
    enableWebUsb(false);
    await expect(provider.connect()).rejects.toThrow(/Chromium-based browser/i);
  });

  it("connect returns public key from Ledger device", async () => {
    const address = await provider.connect();
    expect(address).toBe(TEST_ADDRESS);
    expect(mockTransportCreate).toHaveBeenCalledOnce();
    expect(mockGetPublicKeyLedger).toHaveBeenCalledWith("44'/148'/0'");
  });

  it("connect translates TransportOpenUserCancelled into friendly message", async () => {
    mockTransportCreate.mockRejectedValue(new Error("TransportOpenUserCancelled"));
    await expect(provider.connect()).rejects.toThrow(/USB device selection was cancelled/i);
  });

  it("connect translates DisconnectedDevice into friendly message", async () => {
    mockTransportCreate.mockRejectedValue(new Error("DisconnectedDevice"));
    await expect(provider.connect()).rejects.toThrow(/Ledger device disconnected/i);
  });

  it("connect translates 0x6e00 into Stellar app not open message", async () => {
    mockTransportCreate.mockRejectedValue(new Error("0x6e00"));
    await expect(provider.connect()).rejects.toThrow(/Stellar app/i);
  });

  it("disconnect closes the transport", async () => {
    await provider.connect();
    await provider.disconnect();
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("signXdr throws when not connected", async () => {
    await expect(provider.signXdr("some-xdr")).rejects.toThrow(/Ledger not connected/i);
  });

  it("signXdr calls Ledger signTransaction and returns base64 XDR", async () => {
    await provider.connect();
    const result = await provider.signXdr("some-xdr");
    expect(result).toBeTruthy();
    expect(mockSignTransactionLedger).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WalletConnectProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("WalletConnectProvider", () => {
  let provider: WalletConnectProvider;

  const fakeSession = {
    topic: "test-topic-123",
    namespaces: {
      stellar: {
        accounts: ["stellar:testnet:GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"],
      },
    },
  };

  const fakeClient = {
    connect: mockWcConnect,
    request: mockWcRequest,
    disconnect: mockWcDisconnect,
  };

  beforeEach(() => {
    provider = new WalletConnectProvider(TEST_PASSPHRASE, "testnet");
    vi.clearAllMocks();
    localStorageMock.clear();

    mockSignClientInit.mockResolvedValue(fakeClient);
    mockWcDisconnect.mockResolvedValue(undefined);
  });

  it("type is 'walletconnect'", () => {
    expect(provider.type).toBe("walletconnect");
  });

  it("isAvailable returns true when crypto.subtle is present", async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it("connect initiates new session and returns address", async () => {
    mockWcConnect.mockResolvedValue({
      uri: "wc:abc123@2?relay-protocol=irn",
      approval: vi.fn().mockResolvedValue(fakeSession),
    });

    const uris: string[] = [];
    provider.onUri = (uri) => uris.push(uri);

    const address = await provider.connect();

    expect(address).toBe(TEST_ADDRESS);
    expect(uris).toContain("wc:abc123@2?relay-protocol=irn");
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it("connect restores a persisted session without showing QR", async () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify(fakeSession));

    const uris: string[] = [];
    provider.onUri = (uri) => uris.push(uri);

    const address = await provider.connect();

    expect(address).toBe(TEST_ADDRESS);
    expect(mockWcConnect).not.toHaveBeenCalled(); // skipped pairing
    expect(uris).toHaveLength(0);
  });

  it("signXdr sends stellar_signXDR request", async () => {
    // Set up a connected state.
    localStorageMock.getItem.mockReturnValue(JSON.stringify(fakeSession));
    await provider.connect();

    mockWcRequest.mockResolvedValue({ signedXDR: "signed-xdr-result" });

    const result = await provider.signXdr("raw-xdr");
    expect(result).toBe("signed-xdr-result");
    expect(mockWcRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "test-topic-123",
        request: expect.objectContaining({
          method: "stellar_signXDR",
          params: { xdr: "raw-xdr" },
        }),
      }),
    );
  });

  it("signXdr throws when no session is active", async () => {
    await expect(provider.signXdr("xdr")).rejects.toThrow(/WalletConnect session not established/i);
  });

  it("signXdr throws friendly message on session expiry", async () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify(fakeSession));
    await provider.connect();

    mockWcRequest.mockRejectedValue(new Error("Session expired"));
    await expect(provider.signXdr("xdr")).rejects.toThrow(/session expired/i);
    expect(localStorageMock.removeItem).toHaveBeenCalled();
  });

  it("disconnect clears session and localStorage", async () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify(fakeSession));
    await provider.connect();
    await provider.disconnect();

    expect(mockWcDisconnect).toHaveBeenCalled();
    expect(localStorageMock.removeItem).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createProvider factory
// ─────────────────────────────────────────────────────────────────────────────

describe("createProvider", () => {
  it("creates FreighterProvider for 'freighter'", () => {
    const p = createProvider("freighter", TEST_PASSPHRASE);
    expect(p.type).toBe("freighter");
  });

  it("creates LedgerProvider for 'ledger'", () => {
    const p = createProvider("ledger", TEST_PASSPHRASE);
    expect(p.type).toBe("ledger");
  });

  it("creates WalletConnectProvider for 'walletconnect'", () => {
    const p = createProvider("walletconnect", TEST_PASSPHRASE);
    expect(p.type).toBe("walletconnect");
  });
});
