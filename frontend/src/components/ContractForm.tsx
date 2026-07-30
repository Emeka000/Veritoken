/**
 * ContractForm — Issue #447
 *
 * Renders a set of inputs from a `FormSchema` (see `lib/formSchema.ts`)
 * instead of a page hand-writing one <Field> per contract parameter. Address
 * and contract-id fields get the address-book-aware `AddressInput`; everything
 * else renders as a plain `Field` from `components/ui.tsx`.
 */

import { Field } from "./ui";
import { AddressInput } from "./AddressInput";
import { validateForm, type FormSchema } from "../lib/formSchema";

interface ContractFormProps {
  schema: FormSchema;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

export function ContractForm({ schema, values, onChange }: ContractFormProps) {
  const results = validateForm(schema, values);

  return (
    <>
      {schema.map((field) => {
        const value = values[field.key] ?? "";
        const result = results[field.key];
        const error = result.isValid ? null : result.error;

        if (field.kind === "address" || field.kind === "contract-id") {
          return (
            <div key={field.key}>
              <AddressInput
                label={field.required ? `${field.label} *` : field.label}
                value={value}
                onChange={(v) => onChange(field.key, v)}
                placeholder={field.placeholder}
                required={field.required}
              />
              {error && (
                <p role="alert" style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--error, #e05252)" }}>
                  {error}
                </p>
              )}
            </div>
          );
        }

        return (
          <div key={field.key}>
            <Field
              label={field.label}
              name={field.key}
              type={field.kind === "number" ? "number" : "text"}
              value={value}
              onChange={(e) => onChange(field.key, e.target.value)}
              required={field.required}
              placeholder={field.placeholder}
              error={error}
            />
          </div>
        );
      })}
    </>
  );
}
