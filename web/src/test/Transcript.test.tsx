import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Transcript } from "../components/Transcript";

describe("Transcript", () => {
  it("shows a placeholder when there are no lines yet", () => {
    render(<Transcript lines={[]} />);
    expect(screen.getByText(/press record/i)).toBeInTheDocument();
  });

  it("renders final lines without the partial styling hook", () => {
    render(<Transcript lines={[{ id: 1, kind: "final", text: "Hello there." }]} />);
    const node = screen.getByText(/Hello there\./);
    expect(node).toHaveAttribute("data-kind", "final");
    expect(node.className).toContain("transcript-final");
  });

  it("renders the in-progress partial with the partial styling hook", () => {
    render(<Transcript lines={[{ id: 1, kind: "partial", text: "hel" }]} />);
    const node = screen.getByText(/hel/);
    expect(node).toHaveAttribute("data-kind", "partial");
    expect(node.className).toContain("transcript-partial");
  });

  it("renders finals and the trailing partial together, in order", () => {
    render(
      <Transcript
        lines={[
          { id: 1, kind: "final", text: "First sentence." },
          { id: 2, kind: "partial", text: "second" },
        ]}
      />
    );
    const final = screen.getByText(/First sentence\./);
    const partial = screen.getByText(/second/);
    expect(final).toHaveAttribute("data-kind", "final");
    expect(partial).toHaveAttribute("data-kind", "partial");
  });
});
