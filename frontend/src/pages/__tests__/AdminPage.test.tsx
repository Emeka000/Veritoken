import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AdminPage from "../../pages/AdminPage";
import { ToastProvider } from "../../lib/toast";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../../lib/wallet", () => ({
  useWallet: () => ({
    connected: true,
    address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    signTx: vi.fn(),
  }),
}));

vi.mock("../../lib/stellar", () => ({
  CONTRACT_IDS: { complianceEngine: "CTEST123" },
  fetchContractEvents: vi.fn().mockResolvedValue([]),
  server: { simulateTransaction: vi.fn().mockRejectedValue(new Error("sim error")) },
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

vi.mock("../../lib/contracts/index", () => ({
  contracts: {
    compliance: {
      getBlocklist: vi.fn().mockResolvedValue([]),
      blocklistCount: vi.fn().mockResolvedValue(0),
      addToBlocklist: vi.fn().mockResolvedValue(undefined),
      removeFromBlocklist: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock("../../components/WalletGuard", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderAdminPage() {
  return render(
    <ToastProvider>
      <AdminPage />
    </ToastProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AdminPage – compliance rules form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the compliance rules heading", () => {
    renderAdminPage();
    expect(screen.getByText("Compliance Rules")).toBeDefined();
  });

  it("renders all four rule fields", () => {
    renderAdminPage();
    expect(screen.getByText(/Max Transfer Amount/i)).toBeDefined();
    expect(screen.getByText(/Min Holding Period/i)).toBeDefined();
    expect(screen.getByText(/Max Holders/i)).toBeDefined();
    expect(screen.getByText(/same jurisdiction/i)).toBeDefined();
  });

  it("renders the Save Rules button", () => {
    renderAdminPage();
    expect(screen.getByRole("button", { name: /Save Rules/i })).toBeDefined();
  });

  it("shows a confirmation dialog when Save Rules is submitted", async () => {
    renderAdminPage();
    const btn = screen.getByRole("button", { name: /Save Rules/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
    });
  });

  it("confirmation dialog contains max transfer and holding period details", async () => {
    renderAdminPage();
    const btn = screen.getByRole("button", { name: /Save Rules/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
    });
    expect(screen.getByText(/Max transfer/i)).toBeDefined();
    expect(screen.getByText(/Min holding/i)).toBeDefined();
  });

  it("cancelling the dialog removes it from the DOM", async () => {
    renderAdminPage();
    const btn = screen.getByRole("button", { name: /Save Rules/i });
    fireEvent.click(btn);
    await waitFor(() => screen.getByRole("dialog"));
    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

describe("AdminPage – emergency controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the emergency controls section", () => {
    renderAdminPage();
    expect(screen.getByText("Emergency Controls")).toBeDefined();
  });

  it("renders Pause and Unpause buttons", () => {
    renderAdminPage();
    expect(screen.getByRole("button", { name: /Pause All Transfers/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Unpause Transfers/i })).toBeDefined();
  });

  it("clicking Pause opens a confirmation dialog", async () => {
    renderAdminPage();
    fireEvent.click(screen.getByRole("button", { name: /Pause All Transfers/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText(/Pause All Transfers/i)).toBeDefined();
    });
  });

  it("clicking Unpause opens a confirmation dialog", async () => {
    renderAdminPage();
    fireEvent.click(screen.getByRole("button", { name: /Unpause Transfers/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText(/Unpause Transfers/i)).toBeDefined();
    });
  });
});

describe("AdminPage – blocklist management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Blocklist Management section", () => {
    renderAdminPage();
    expect(screen.getByText("Blocklist Management")).toBeDefined();
  });

  it("shows empty state when blocklist is empty", async () => {
    renderAdminPage();
    await waitFor(() => {
      expect(screen.getByText(/No addresses are currently blocked/i)).toBeDefined();
    });
  });

  it("renders the Add to Blocklist form", () => {
    renderAdminPage();
    expect(screen.getByRole("button", { name: /Add to Blocklist/i })).toBeDefined();
  });

  it("Add to Blocklist button is disabled when input is empty", () => {
    renderAdminPage();
    const btn = screen.getByRole("button", { name: /Add to Blocklist/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Add to Blocklist button becomes enabled when an address is entered", async () => {
    renderAdminPage();
    const input = screen.getByPlaceholderText(/G… \(Stellar address\)/i);
    fireEvent.change(input, {
      target: {
        value: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      },
    });
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Add to Blocklist/i });
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
