import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Card, Field, Select, PageHeader, Skeleton } from "../ui";

// ── Card ──────────────────────────────────────────────────────────────────────

describe("Card", () => {
  it("renders children", () => {
    render(<Card>hello card</Card>);
    expect(screen.getByText("hello card")).toBeDefined();
  });

  it("renders a title when provided", () => {
    render(<Card title="My Card">content</Card>);
    expect(screen.getByText("My Card")).toBeDefined();
  });

  it("renders a subtitle when provided", () => {
    render(<Card title="T" subtitle="Admin only">content</Card>);
    expect(screen.getByText("Admin only")).toBeDefined();
  });

  it("has role='region' and aria-labelledby pointing at the title", () => {
    const { container } = render(<Card title="Dashboard">content</Card>);
    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    const labelId = region!.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const heading = container.querySelector(`#${labelId}`);
    expect(heading?.textContent).toBe("Dashboard");
  });

  it("does not render a heading when no title is given", () => {
    render(<Card>plain</Card>);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

// ── Field ─────────────────────────────────────────────────────────────────────

describe("Field", () => {
  it("renders a label and input", () => {
    render(<Field label="Amount" value="" onChange={vi.fn()} />);
    expect(screen.getByText("Amount")).toBeDefined();
    expect(screen.getByRole("textbox")).toBeDefined();
  });

  it("shows the required asterisk when required=true", () => {
    const { container } = render(
      <Field label="Email" value="" onChange={vi.fn()} required />,
    );
    const asterisk = container.querySelector('[aria-hidden="true"]');
    expect(asterisk?.textContent).toBe("*");
  });

  it("renders an error message when error prop is set", () => {
    render(
      <Field
        label="Amount"
        value="abc"
        onChange={vi.fn()}
        error="Amount must be a valid number"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Amount must be a valid number");
  });

  it("sets aria-invalid on the input when error is present", () => {
    render(
      <Field label="Amount" value="abc" onChange={vi.fn()} error="Invalid" />,
    );
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("does not set aria-invalid when there is no error", () => {
    render(<Field label="Amount" value="100" onChange={vi.fn()} />);
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("calls onChange handler when value changes", () => {
    const onChange = vi.fn();
    render(<Field label="Name" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renders a number input when type='number'", () => {
    const { container } = render(
      <Field label="Amount" type="number" value="" onChange={vi.fn()} />,
    );
    const input = container.querySelector('input[type="number"]');
    expect(input).not.toBeNull();
  });
});

// ── Select ────────────────────────────────────────────────────────────────────

describe("Select", () => {
  const options = [
    { value: "0", label: "Basic" },
    { value: "1", label: "Accredited" },
    { value: "2", label: "Institutional" },
  ];

  it("renders a label and combobox", () => {
    render(<Select label="KYC Tier" value="0" onChange={vi.fn()} options={options} />);
    expect(screen.getByText("KYC Tier")).toBeDefined();
    expect(screen.getByRole("combobox")).toBeDefined();
  });

  it("renders all provided options", () => {
    render(<Select label="Tier" value="0" onChange={vi.fn()} options={options} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.options.length).toBe(3);
  });

  it("reflects the current value", () => {
    render(<Select label="Tier" value="1" onChange={vi.fn()} options={options} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("1");
  });

  it("calls onChange when a different option is selected", () => {
    const onChange = vi.fn();
    render(<Select label="Tier" value="0" onChange={onChange} options={options} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

// ── PageHeader ────────────────────────────────────────────────────────────────

describe("PageHeader", () => {
  it("renders the title as an h1", () => {
    render(<PageHeader title="Invoice Token" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Invoice Token");
  });

  it("renders the eyebrow when provided", () => {
    render(<PageHeader title="T" eyebrow="Asset Module" />);
    expect(screen.getByText("Asset Module")).toBeDefined();
  });

  it("renders the description when provided", () => {
    render(<PageHeader title="T" description="My description text" />);
    expect(screen.getByText("My description text")).toBeDefined();
  });

  it("renders an icon node when provided", () => {
    const { container } = render(
      <PageHeader title="T" icon={<svg data-testid="test-icon" />} />,
    );
    expect(container.querySelector('[data-testid="test-icon"]')).not.toBeNull();
  });

  it("does not render description when omitted", () => {
    const { container } = render(<PageHeader title="T" />);
    const paras = container.querySelectorAll("p");
    expect(paras.length).toBe(0);
  });
});

// ── Skeleton ──────────────────────────────────────────────────────────────────

describe("Skeleton", () => {
  it("renders a div with a pulse animation style", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.animation).toMatch(/pulse/i);
  });

  it("applies custom width and height", () => {
    const { container } = render(<Skeleton width="80%" height="2rem" />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("80%");
    expect(el.style.height).toBe("2rem");
  });

  it("defaults to 100% width and 1rem height", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("100%");
    expect(el.style.height).toBe("1rem");
  });
});
