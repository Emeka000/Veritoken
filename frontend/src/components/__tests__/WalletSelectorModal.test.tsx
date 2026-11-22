import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WalletGuard from "../WalletGuard";

vi.mock("../../lib/stellar", () => ({ NETWORK_PASSPHRASE: "Test SDF Network ; September 2015" }));
vi.mock("../../lib/sep7", () => ({ generateQrDataUrl: vi.fn() }));

const { selectProvider } = vi.hoisted(() => ({ selectProvider: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../../lib/wallet", () => ({
  useWallet: Object.assign(() => ({ connected: false, selectProvider }), { setState: vi.fn() }),
}));

vi.mock("../../lib/walletProvider", () => ({
  FreighterProvider: class { async isAvailable() { return true; } },
  LedgerProvider: class { async isAvailable() { return false; } },
  WalletConnectProvider: class { async isAvailable() { return false; } },
}));

describe("Wallet selector keyboard navigation", () => {
  it("opens from its trigger, activates a wallet, and dismisses using only the keyboard", async () => {
    const user = userEvent.setup();
    selectProvider.mockClear();
    render(<WalletGuard><p>Protected content</p></WalletGuard>);

    // WalletGuard initially presents the selector. Dismiss it to reach the
    // real reopen trigger, then exercise opening without a pointer.
    expect(screen.getByRole("dialog", { name: "Select a wallet to connect" })).toHaveFocus();
    await user.keyboard("{Escape}");
    const trigger = screen.getByRole("button", { name: "Choose wallet" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Select a wallet to connect" });
    expect(dialog).toHaveFocus();
    const freighter = within(dialog).getByRole("group", { name: "Freighter wallet option" });
    const connect = await within(freighter).findByRole("button", { name: "Connect", exact: true });
    await waitFor(() => expect(connect).toBeEnabled());

    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Close wallet selector" })).toHaveFocus();
    await user.tab();
    expect(connect).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(selectProvider).toHaveBeenCalledTimes(1);
    expect(selectProvider).toHaveBeenCalledWith("freighter");
    await waitFor(() => expect(connect).toBeEnabled());

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose wallet" })).toHaveFocus();
  });
});
