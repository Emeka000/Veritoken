import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import KycPage from "../../pages/KycPage";
import { ToastProvider } from "../../lib/toast";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../../lib/wallet", () => ({
  useWallet: () => ({
    connected: false,
    address: null,
    signTx: vi.fn(),
  }),
}));

vi.mock("../../lib/stellar", () => ({
  CONTRACT_IDS: { kycRegistry: "" },
  fetchContractEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../components/WalletGuard", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderKycPage() {
  return render(
    <ToastProvider>
      <KycPage />
    </ToastProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KycPage – lookup form", () => {
  it("renders the address lookup input", () => {
    renderKycPage();
    expect(
      screen.getByPlaceholderText(/Stellar address/i),
    ).toBeDefined();
  });

  it("shows a validation error for a malformed address when submitted", async () => {
    renderKycPage();
    const input = screen.getByPlaceholderText(/Stellar address/i);
    fireEvent.change(input, { target: { value: "not-a-valid-address" } });
    const btn = screen.getByRole("button", { name: /Lookup/i });
    fireEvent.click(btn);
    // The lookup button should be disabled for invalid addresses
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not show an error when the input is empty", () => {
    renderKycPage();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an inline error message when the address is invalid", async () => {
    renderKycPage();
    const input = screen.getByPlaceholderText(/Stellar address/i);
    fireEvent.change(input, { target: { value: "BADADDRESS" } });
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
  });
});

describe("KycPage – approve form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the subject address, tier, jurisdiction and expiry fields", () => {
    renderKycPage();
    // Subject address — identified by label text
    expect(screen.getByText("Subject Address")).toBeDefined();
    expect(screen.getByText("KYC Tier")).toBeDefined();
    expect(screen.getByText("Jurisdiction")).toBeDefined();
    expect(screen.getByText(/Validity/i)).toBeDefined();
  });

  it("blocks submission when subject address is invalid", async () => {
    renderKycPage();
    const inputs = screen.getAllByRole("textbox");
    // The subject input is the second textbox (after lookup)
    const subjectInput = inputs.find(
      (el) => (el as HTMLInputElement).placeholder === "G…",
    );
    if (!subjectInput) throw new Error("subject input not found");
    fireEvent.change(subjectInput, { target: { value: "invalid" } });
    const btn = screen.getByRole("button", { name: /Approve KYC/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables submission when a valid address is entered", async () => {
    renderKycPage();
    const subjectInput = screen.getAllByRole("textbox").find(
      (el) => (el as HTMLInputElement).placeholder === "G…",
    );
    if (!subjectInput) throw new Error("subject input not found");
    fireEvent.change(subjectInput, {
      target: {
        value: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      },
    });
    const btn = screen.getByRole("button", { name: /Approve KYC/i });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders three tier options", () => {
    renderKycPage();
    const select = screen.getByRole("combobox");
    const options = (select as HTMLSelectElement).options;
    expect(options.length).toBe(3);
    expect(options[0].textContent).toMatch(/Basic/i);
    expect(options[1].textContent).toMatch(/Accredited/i);
    expect(options[2].textContent).toMatch(/Institutional/i);
  });

  it("shows a confirmation dialog when a valid form is submitted", async () => {
    renderKycPage();
    const subjectInput = screen.getAllByRole("textbox").find(
      (el) => (el as HTMLInputElement).placeholder === "G…",
    );
    if (!subjectInput) throw new Error("subject input not found");
    fireEvent.change(subjectInput, {
      target: {
        value: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      },
    });
    // Fill jurisdiction
    const jurisdictionInputs = screen
      .getAllByRole("textbox")
      .filter((el) => (el as HTMLInputElement).placeholder?.includes("US"));
    if (jurisdictionInputs.length > 0) {
      fireEvent.change(jurisdictionInputs[0], { target: { value: "US" } });
    }
    const btn = screen.getByRole("button", { name: /Approve KYC/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeDefined();
    });
  });
});
