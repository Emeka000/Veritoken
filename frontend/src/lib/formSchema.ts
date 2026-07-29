/**
 * formSchema.ts — Issue #447
 *
 * A small, contract-metadata-driven description of a form's fields, so pages
 * that collect parameters for a contract call (deploy, KYC update, rule
 * change, …) can render and validate a form from data instead of hand-writing
 * a near-duplicate set of <Field> elements per variant.
 */

import type { ValidationResult } from "./metadataValidation";

export type FieldKind = "text" | "address" | "contract-id" | "number";

export interface FieldSchema {
  /** Key into the form's values object. */
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  placeholder?: string;
  /** Field-specific validator. Absent means "always valid". */
  validate?: (value: string) => ValidationResult;
}

export type FormSchema = FieldSchema[];

const OK: ValidationResult = { isValid: true, error: null };

/** Validate every field in a schema against a values object. */
export function validateForm(
  schema: FormSchema,
  values: Record<string, string>,
): Record<string, ValidationResult> {
  const results: Record<string, ValidationResult> = {};
  for (const field of schema) {
    const value = values[field.key] ?? "";
    results[field.key] = field.validate ? field.validate(value) : OK;
  }
  return results;
}

/** True only if every field in a `validateForm` result is valid. */
export function isFormValid(results: Record<string, ValidationResult>): boolean {
  return Object.values(results).every((r) => r.isValid);
}

/** Build an empty values object with every schema key set to "". */
export function emptyValues(schema: FormSchema): Record<string, string> {
  return Object.fromEntries(schema.map((f) => [f.key, ""]));
}
