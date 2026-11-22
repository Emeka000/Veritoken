import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DocsPage from "../DocsPage";

describe("DocsPage heading outline", () => {
  it("exposes one primary heading followed by correctly nested sections", () => {
    render(<DocsPage />);
    const primaryHeadings = screen.getAllByRole("heading", { level: 1 });
    expect(primaryHeadings).toHaveLength(1);
    expect(primaryHeadings[0]).toHaveAccessibleName("Documentation");
    expect(screen.getAllByRole("heading").map((heading) => [heading.tagName, heading.textContent])).toEqual([
      ["H1", "Documentation"],
      ["H2", "Getting Started"],
      ["H2", "KYC Process"],
      ["H2", "Invoice Tokens"],
      ["H2", "Property Tokens"],
      ["H2", "Carbon Credits"],
      ["H2", "Further Reading"],
    ]);
  });
});
