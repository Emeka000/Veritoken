import { describe, it, expect } from "vitest";
import { validateForm, isFormValid, emptyValues, type FormSchema } from "../formSchema";
import { validateTokenName, validateTokenSymbol } from "../metadataValidation";

const SCHEMA: FormSchema = [
  { key: "name", label: "Name", kind: "text", required: true, validate: validateTokenName },
  { key: "symbol", label: "Symbol", kind: "text", required: true, validate: validateTokenSymbol },
  { key: "note", label: "Note", kind: "text" },
];

describe("emptyValues", () => {
  it("builds an empty string for every schema key", () => {
    expect(emptyValues(SCHEMA)).toEqual({ name: "", symbol: "", note: "" });
  });
});

describe("validateForm / isFormValid", () => {
  it("reports every field valid when values are all good", () => {
    const results = validateForm(SCHEMA, { name: "Acme", symbol: "ACM", note: "" });
    expect(results.name.isValid).toBe(true);
    expect(results.symbol.isValid).toBe(true);
    expect(isFormValid(results)).toBe(true);
  });

  it("surfaces a per-field error for an invalid value", () => {
    const results = validateForm(SCHEMA, { name: "", symbol: "not-valid!", note: "" });
    expect(results.name.isValid).toBe(false);
    expect(results.name.error).toMatch(/required/i);
    expect(results.symbol.isValid).toBe(false);
    expect(isFormValid(results)).toBe(false);
  });

  it("treats a field with no validator as always valid", () => {
    const results = validateForm(SCHEMA, { name: "Acme", symbol: "ACM", note: "anything at all" });
    expect(results.note.isValid).toBe(true);
  });

  it("treats a missing value as an empty string", () => {
    const results = validateForm(SCHEMA, {});
    expect(results.name.isValid).toBe(false);
  });
});
