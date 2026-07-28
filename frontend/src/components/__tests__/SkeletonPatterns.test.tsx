import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SkeletonCard, SkeletonTableRows, SkeletonText, SkeletonForm } from "../SkeletonPatterns";

describe("SkeletonPatterns", () => {
  it("SkeletonCard renders the correct number of skeleton rows", () => {
    const { container } = render(<SkeletonCard rows={4} />);
    const skeletons = container.querySelectorAll("[style*='pulse']");
    expect(skeletons.length).toBe(5);
  });

  it("SkeletonCard renders with default rows", () => {
    const { container } = render(<SkeletonCard />);
    const skeletons = container.querySelectorAll("[style*='animation']");
    expect(skeletons.length).toBe(5);
  });

  it("SkeletonTableRows renders the correct grid structure", () => {
    const { container } = render(<SkeletonTableRows rows={3} cols={4} />);
    const rowDivs = container.children[0].children;
    expect(rowDivs.length).toBe(3);
    const cells = rowDivs[0].querySelectorAll("[style*='animation']");
    expect(cells.length).toBe(4);
  });

  it("SkeletonText renders the specified number of lines", () => {
    const { container } = render(<SkeletonText lines={3} />);
    const lines = container.querySelectorAll("[style*='animation']");
    expect(lines.length).toBe(3);
  });

  it("SkeletonForm renders the specified number of fields", () => {
    const { container } = render(<SkeletonForm fields={2} />);
    const fields = container.querySelectorAll("[style*='animation']");
    expect(fields.length).toBe(4);
  });

  it("SkeletonForm renders a label and input skeleton per field", () => {
    const { container } = render(<SkeletonForm fields={2} />);
    const groups = container.children[0].children;
    expect(groups.length).toBe(2);
    const firstGroupSkeletons = groups[0].querySelectorAll("[style*='animation']");
    expect(firstGroupSkeletons.length).toBe(2);
  });
});
