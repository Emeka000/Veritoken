import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionHistory } from "../SessionHistory";
import { useSessionHistory, recordSessionAction } from "../../lib/sessionHistory";

beforeEach(() => {
  useSessionHistory.getState().clear();
  sessionStorage.clear();
});

describe("SessionHistory", () => {
  it("shows an empty state when no actions have been recorded", () => {
    render(<SessionHistory />);
    expect(screen.getByText(/No actions recorded yet this session/i)).toBeDefined();
  });

  it("renders recorded actions", () => {
    recordSessionAction("wallet", "Wallet connected", "GADDR...", "GADDR");
    render(<SessionHistory />);
    expect(screen.getByText("Wallet connected")).toBeDefined();
    expect(screen.getByText("Wallet")).toBeDefined();
  });

  it("respects the limit prop", () => {
    for (let i = 0; i < 5; i++) recordSessionAction("other", `action-${i}`);
    render(<SessionHistory limit={2} />);
    expect(screen.getByText(/5 actions? recorded this session/)).toBeDefined();
    expect(screen.getByText("action-4")).toBeDefined();
    expect(screen.getByText("action-3")).toBeDefined();
    expect(screen.queryByText("action-2")).toBeNull();
  });

  it("clears history when the clear button is clicked", () => {
    recordSessionAction("wallet", "Wallet connected");
    render(<SessionHistory />);
    expect(screen.getByText("Wallet connected")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /clear session history/i }));

    expect(screen.getByText(/No actions recorded yet this session/i)).toBeDefined();
  });

  it("disables the clear button when there is nothing to clear", () => {
    render(<SessionHistory />);
    expect(screen.getByRole("button", { name: /clear session history/i })).toBeDisabled();
  });
});
