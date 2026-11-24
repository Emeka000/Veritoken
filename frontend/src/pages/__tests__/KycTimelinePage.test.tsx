import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import KycTimelinePage, {
  KycHistoryUnavailableError,
  type KycHistoryFetcher,
  type KycTransition,
} from "../../pages/KycTimelinePage";
import { ToastProvider } from "../../lib/toast";

const ADDRESS = "GBQG2SJ7MXUH34SI3MJ2I256I5UMGM2QSQZM77YFX5S6JOHXUQJEPC3A";

const ENTRY: KycTransition = {
  seq: 0,
  kind: "Approve",
  verifier: ADDRESS,
  timestamp: 1_700_000_000,
  tier: 1,
  expiry: 0,
  jurisdiction: "US",
};

function renderPage(fetchHistory?: KycHistoryFetcher) {
  return render(
    <ToastProvider>
      <KycTimelinePage fetchHistory={fetchHistory} />
    </ToastProvider>,
  );
}

function lookup() {
  fireEvent.change(screen.getByPlaceholderText(/Stellar address/i), {
    target: { value: ADDRESS },
  });
  fireEvent.click(screen.getByRole("button", { name: /View Timeline/i }));
}

describe("KycTimelinePage – fetch states", () => {
  it("shows an explicit loading state while history is being fetched", async () => {
    let resolve!: (entries: KycTransition[]) => void;
    const fetchHistory = vi.fn(
      () => new Promise<KycTransition[]>((r) => { resolve = r; }),
    );
    renderPage(fetchHistory);
    lookup();

    expect(await screen.findByText(/Loading KYC history/i)).toBeDefined();
    expect(screen.queryByRole("list", { name: /KYC transition timeline/i })).toBeNull();

    resolve([]);
    await waitFor(() => expect(screen.queryByText(/Loading KYC history/i)).toBeNull());
  });

  it("shows an empty state instead of a blank timeline when no history exists", async () => {
    renderPage(vi.fn().mockResolvedValue([]));
    lookup();

    expect(await screen.findByText(/No KYC record found/i)).toBeDefined();
    expect(screen.queryByRole("list", { name: /KYC transition timeline/i })).toBeNull();
  });

  it("renders the timeline when history is returned", async () => {
    const fetchHistory = vi.fn().mockResolvedValue([ENTRY]);
    renderPage(fetchHistory);
    lookup();

    expect(await screen.findByRole("list", { name: /KYC transition timeline/i })).toBeDefined();
    expect(fetchHistory).toHaveBeenCalledWith(ADDRESS);
  });

  it("shows a recoverable error state when the fetch fails", async () => {
    const fetchHistory = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([ENTRY]);
    renderPage(fetchHistory);
    lookup();

    expect(await screen.findByText(/Failed to fetch KYC history\. Check your connection/i)).toBeDefined();
    expect(screen.queryByRole("list", { name: /KYC transition timeline/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    expect(await screen.findByRole("list", { name: /KYC transition timeline/i })).toBeDefined();
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });

  it("reports that history is unavailable when no client is wired", async () => {
    renderPage();
    lookup();

    expect(await screen.findByText(/lifecycle history is not available/i)).toBeDefined();
    expect(screen.queryByRole("list", { name: /KYC transition timeline/i })).toBeNull();
  });
});

describe("KycTimelinePage – empty vs unavailable history (#1172)", () => {
  it("shows a no-history message, not an error, for a successful empty response", async () => {
    renderPage(vi.fn().mockResolvedValue([]));
    lookup();

    const empty = await screen.findByRole("status", { name: /No KYC transition history/i });
    expect(empty.textContent).toMatch(/No KYC transitions recorded yet/i);
    expect(empty.textContent).toMatch(/responded successfully/i);

    // Not the unavailable/error state.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/lifecycle history is not available/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/i })).toBeNull();

    // No fake transition rows.
    expect(screen.queryByRole("list", { name: /KYC transition timeline/i })).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows the unavailable error, not the no-history message, when the source is unavailable", async () => {
    renderPage(vi.fn().mockRejectedValue(new KycHistoryUnavailableError()));
    lookup();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/lifecycle history is not available/i);

    // Not the empty state.
    expect(screen.queryByRole("status", { name: /No KYC transition history/i })).toBeNull();
    expect(screen.queryByText(/No KYC transitions recorded yet/i)).toBeNull();
    expect(screen.queryByText(/No KYC record found/i)).toBeNull();

    // No fake transition rows.
    expect(screen.queryByRole("list", { name: /KYC transition timeline/i })).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
