import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContractForm } from "../ContractForm";
import type { FormSchema } from "../../lib/formSchema";

const SCHEMA: FormSchema = [
  {
    key: "name",
    label: "Token name",
    kind: "text",
    required: true,
    placeholder: "Acme Token",
    validate: (v) => (v.trim() ? { isValid: true, error: null } : { isValid: false, error: "Token name is required" }),
  },
  {
    key: "admin",
    label: "Admin address",
    kind: "address",
    required: true,
    placeholder: "G…",
    validate: (v) => (v ? { isValid: true, error: null } : { isValid: false, error: "Admin address is required" }),
  },
];

describe("ContractForm", () => {
  it("renders one input per schema field with its label", () => {
    render(<ContractForm schema={SCHEMA} values={{ name: "", admin: "" }} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Token name/)).toBeDefined();
    expect(screen.getByLabelText(/Admin address/)).toBeDefined();
  });

  it("calls onChange with the field key and new value", () => {
    const onChange = vi.fn();
    render(<ContractForm schema={SCHEMA} values={{ name: "", admin: "" }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/Token name/), { target: { value: "Acme" } });
    expect(onChange).toHaveBeenCalledWith("name", "Acme");
  });

  it("shows a validation error for an invalid value", () => {
    render(<ContractForm schema={SCHEMA} values={{ name: "", admin: "GADDR" }} onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Token name is required");
  });

  it("shows no error once the field is valid", () => {
    render(<ContractForm schema={SCHEMA} values={{ name: "Acme", admin: "GADDR" }} onChange={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
