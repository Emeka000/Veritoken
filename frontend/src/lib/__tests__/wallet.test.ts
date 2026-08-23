/**
 * Tests for the refactored useWallet Zustand store — issue #545.
 *
 * Covers:
 *  - Initial state
 *  - Legacy connect() / disconnect() / signTx() (Freighter shortcut) — preserves
 *    all pre-existing test expectations
 *  - selectProvider() — switching between providers
 *  - autoReconnect() — restores persisted provider on page refresh
 *  - Provider type persistence to/from localStorage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

// ── Stellar mock ─────────────────────────────────────────────────────────────

vi.mock("../stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  getNetwork: () => "testnet",
  getRpcUrl: () => "https://soroban-testnet.stellar.org",
  getNetworkPassphrase: () => "Test SDF Network ; September 2015",
  server: {},
  CONTRACT_IDS: {},
  validateStellarAddress: (addr: string) => /^G[A-Z2-7]{55}$/.test(addr),
}));

// ── WalletConnect / Ledger mocks (prevent real network/USB calls) ────────────

vi.mock("@walletconnect/sign-client", () => ({
  SignClient: { init: vi.fn() },
}));

vi.mock("@ledgerhq/hw-transport-webusb", () => ({
  default: { create: vi.fn() },
}));

vi.mock("@ledgerhq/hw-app-str", () => ({
  default: vi.fn(),
}));

// ── localStorage stub ─────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string): string | null => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

import { useWallet } from "../wallet";

const TEST_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function resetStore() {
  useWallet.setState({
    address: null,
    connected: false,
    provider: null,
    providerType: null,
    freighterAvailable: false,
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  localStorageMock.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────────────────────

describe("useWallet initial state", () => {
  it("starts disconnected with no address", () => {
    const { address, connected } = useWallet.getState();
    expect(address).toBeNull();
    expect(connected).toBe(false);
  });

  it("starts with no provider", () => {
    expect(useWallet.getState().provider).toBeNull();
    expect(useWallet.getState().providerType).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy connect() — Freighter shortcut
// ─────────────────────────────────────────────────────────────────────────────

describe("useWallet.connect (legacy Freighter shortcut)", () => {
  it("throws if Freighter is not installed", async () => {
    mockIsConnected.mockResolvedValue(false);
    await expect(useWallet.getState().connect()).rejects.toThrow(
      /Freighter wallet is not installed/i,
    );
  });

  it("sets address and connected=true on success", async () => {
    mockIsConnected.mockResolvedValue(true);
    mockSetAllowed.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue(TEST_ADDRESS);

    await useWallet.getState().connect();

    const { address, connected, providerType } = useWallet.getState();
    expect(connected).toBe(true);
    expect(address).toBe(TEST_ADDRESS);
    expect(providerType).toBe("freighter");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// disconnect()
// ─────────────────────────────────────────────────────────────────────────────

describe("useWallet.disconnect", () => {
  it("clears address, provider, and sets connected=false", async () => {
    // First connect via legacy path
    mockIsConnected.mockResolvedValue(true);
    mockSetAllowed.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue(TEST_ADDRESS);
    await useWallet.getState().connect();
    expect(useWallet.getState().connected).toBe(true);

    await useWallet.getState().disconnect();

    const { address, connected, provider, providerType } = useWallet.getState();
    expect(address).toBeNull();
    expect(connected).toBe(false);
    expect(provider).toBeNull();
    expect(providerType).toBeNull();
  });

  it("removes persisted provider type from localStorage", async () => {
    mockIsConnected.mockResolvedValue(true);
    mockSetAllowed.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue(TEST_ADDRESS);
    await useWallet.getState().connect();

    await useWallet.getState().disconnect();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("veritoken-wallet-provider");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signTx
// ─────────────────────────────────────────────────────────────────────────────

describe("useWallet.signTx", () => {
  it("throws if wallet is not connected", async () => {
    await expect(useWallet.getState().signTx("some-xdr")).rejects.toThrow(
      /Wallet not connected/i,
    );
  });

  it("calls provider.signXdr and returns signed XDR", async () => {
    // Directly inject a mock provider
    const mockProvider = {
      type: "freighter" as const,
      connect: vi.fn(),
      disconnect: vi.fn(),
      signXdr: vi.fn().mockResolvedValue("signed-xdr-result"),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    useWallet.setState({
      address: TEST_ADDRESS,
      connected: true,
      provider: mockProvider,
      providerType: "freighter",
    });

    const result = await useWallet.getState().signTx("input-xdr");
    expect(result).toBe("signed-xdr-result");
    expect(mockProvider.signXdr).toHaveBeenCalledWith("input-xdr");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("useWallet.selectProvider", () => {
  it("sets providerType to 'freighter' and stores it in localStorage", async () => {
    mockIsConnected.mockResolvedValue(true);
    mockSetAllowed.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue(TEST_ADDRESS);

    await useWallet.getState().selectProvider("freighter");

    expect(useWallet.getState().providerType).toBe("freighter");
    expect(useWallet.getState().connected).toBe(true);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "veritoken-wallet-provider",
      "freighter",
    );
  });

  it("disconnects previous provider before switching", async () => {
    const mockDisconnect = vi.fn().mockResolvedValue(undefined);
    const existingProvider = {
      type: "freighter" as const,
      connect: vi.fn(),
      disconnect: mockDisconnect,
      signXdr: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
    useWallet.setState({
      address: TEST_ADDRESS,
      connected: true,
      provider: existingProvider,
      providerType: "freighter",
    });

    // Switch to a new freighter connection
    mockIsConnected.mockResolvedValue(true);
    mockSetAllowed.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue(TEST_ADDRESS);

    await useWallet.getState().selectProvider("freighter");
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it("throws if the chosen provider is unavailable", async () => {
    // Patch navigator to remove usb so LedgerProvider.isAvailable() returns false.
    Object.defineProperty(navigator, "usb", {
      value: null,
      writable: true,
      configurable: true,
    });

    await expect(useWallet.getState().selectProvider("ledger")).rejects.toThrow(
      /Chrome|Edge|Brave|WebUSB/i,
    );

    // Restore for subsequent tests
    Object.defineProperty(navigator, "usb", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// autoReconnect
// ─────────────────────────────────────────────────────────────────────────────

describe("useWallet.autoReconnect", () => {
  it("does nothing when no provider type is persisted", async () => {
    localStorageMock.getItem.mockReturnValue(null);
    await useWallet.getState().autoReconnect();
    expect(useWallet.getState().connected).toBe(false);
  });

  it("reconnects Freighter automatically when persisted", async () => {
    localStorageMock.getItem.mockReturnValue("freighter");
    mockIsConnected.mockResolvedValue(true);
    mockSetAllowed.mockResolvedValue(undefined);
    mockGetPublicKey.mockResolvedValue(TEST_ADDRESS);

    await useWallet.getState().autoReconnect();

    const { connected, providerType, address } = useWallet.getState();
    expect(connected).toBe(true);
    expect(providerType).toBe("freighter");
    expect(address).toBe(TEST_ADDRESS);
  });

  it("skips Ledger auto-reconnect (requires re-plug confirmation)", async () => {
    localStorageMock.getItem.mockReturnValue("ledger");
    // Even if WebUSB is present, Ledger should be skipped
    Object.defineProperty(navigator, "usb", {
      value: {},
      writable: true,
      configurable: true,
    });

    await useWallet.getState().autoReconnect();
    expect(useWallet.getState().connected).toBe(false);
  });

  it("silently catches connect errors during auto-reconnect", async () => {
    localStorageMock.getItem.mockReturnValue("freighter");
    mockIsConnected.mockResolvedValue(true);
    mockSetAllowed.mockResolvedValue(undefined);
    mockGetPublicKey.mockRejectedValue(new Error("Extension unavailable"));

    // Should not throw
    await expect(useWallet.getState().autoReconnect()).resolves.toBeUndefined();
    expect(useWallet.getState().connected).toBe(false);
  });
});
