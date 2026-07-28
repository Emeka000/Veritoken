/**
 * Snapshot tests for core UI components.
 *
 * These tests capture the rendered HTML structure of shared components so that
 * unintentional structural, label, or layout regressions surface clearly during
 * code review. Update snapshots intentionally with `vitest -u` when a change is
 * deliberate.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { Card, Field, Select, PageHeader, Skeleton } from "../ui";
import { SkeletonCard, SkeletonForm, SkeletonTableRows, SkeletonText } from "../SkeletonPatterns";
import ConfirmDialog from "../ConfirmDialog";
import { CopyButton } from "../CopyButton";

// ── Card ──────────────────────────────────────────────────────────────────────

describe("Card snapshots", () => {
  it("matches snapshot: no title", () => {
    const { container } = render(<Card>Plain content</Card>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: with title", () => {
    const { container } = render(<Card title="My Card">Content here</Card>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: with title and subtitle", () => {
    const { container } = render(
      <Card title="Compliance Rules" subtitle="Admin only">
        Body text
      </Card>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ── Field ─────────────────────────────────────────────────────────────────────

describe("Field snapshots", () => {
  it("matches snapshot: basic text field", () => {
    const { container } = render(
      <Field label="Invoice ID" value="" onChange={vi.fn()} />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: required field", () => {
    const { container } = render(
      <Field label="Amount" value="" onChange={vi.fn()} required />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: field with validation error", () => {
    const { container } = render(
      <Field
        label="Amount"
        value="abc"
        onChange={vi.fn()}
        error="Amount must be a valid number"
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: number field with placeholder", () => {
    const { container } = render(
      <Field
        label="Shares"
        type="number"
        value="1000"
        onChange={vi.fn()}
        placeholder="Enter number of shares"
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ── Select ────────────────────────────────────────────────────────────────────

describe("Select snapshots", () => {
  const kycOptions = [
    { value: "0", label: "0 — Basic" },
    { value: "1", label: "1 — Accredited Investor" },
    { value: "2", label: "2 — Institutional" },
  ];

  it("matches snapshot: default selection", () => {
    const { container } = render(
      <Select label="KYC Tier" value="0" onChange={vi.fn()} options={kycOptions} />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: non-default selection", () => {
    const { container } = render(
      <Select label="KYC Tier" value="2" onChange={vi.fn()} options={kycOptions} />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ── PageHeader ────────────────────────────────────────────────────────────────

describe("PageHeader snapshots", () => {
  it("matches snapshot: title only", () => {
    const { container } = render(<PageHeader title="Invoice Token" />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: full header with eyebrow, icon, and description", () => {
    const { container } = render(
      <PageHeader
        eyebrow="Asset Module"
        title="Invoice Token"
        description="Tokenize accounts-receivable invoices."
        icon={<svg viewBox="0 0 24 24" data-testid="icon" />}
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ── Skeleton ──────────────────────────────────────────────────────────────────

describe("Skeleton snapshots", () => {
  it("matches snapshot: default props", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: custom dimensions", () => {
    const { container } = render(<Skeleton width="60%" height="2rem" />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ── SkeletonPatterns ──────────────────────────────────────────────────────────

describe("SkeletonCard snapshots", () => {
  it("matches snapshot: default rows", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: 2 rows", () => {
    const { container } = render(<SkeletonCard rows={2} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("SkeletonForm snapshots", () => {
  it("matches snapshot: 3 fields", () => {
    const { container } = render(<SkeletonForm fields={3} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("SkeletonTableRows snapshots", () => {
  it("matches snapshot: 3 rows × 4 cols", () => {
    const { container } = render(<SkeletonTableRows rows={3} cols={4} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

describe("SkeletonText snapshots", () => {
  it("matches snapshot: 3 lines", () => {
    const { container } = render(<SkeletonText lines={3} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

describe("ConfirmDialog snapshots", () => {
  it("matches snapshot: default state", () => {
    const { container } = render(
      <ConfirmDialog
        title="Settle Invoice"
        description="This will mark the invoice as settled and open redemption for all holders."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: custom confirm label", () => {
    const { container } = render(
      <ConfirmDialog
        title="Retire Credits"
        description="Credits will be permanently burned."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmLabel="Retire (Permanent)"
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it("matches snapshot: loading state", () => {
    const { container } = render(
      <ConfirmDialog
        title="Processing"
        description="Please wait…"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        loading
      />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ── CopyButton ────────────────────────────────────────────────────────────────

describe("CopyButton snapshots", () => {
  it("matches snapshot: default state", () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const { container } = render(
      <CopyButton text="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" />,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
