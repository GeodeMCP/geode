import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Chat } from "./Chat";

vi.mock("../api", () => ({ api: { history: () => Promise.resolve([]), clearHistory: () => Promise.resolve(), upload: vi.fn() } }));

// jsdom doesn't implement scrollIntoView; Chat's auto-scroll effect calls it on every render.
Element.prototype.scrollIntoView = vi.fn();

describe("Chat composer", () => {
  it("stages a selected file as a removable chip", async () => {
    render(<Chat onSend={vi.fn()} running={false} dirty={false} onCommit={vi.fn()} onDiscard={vi.fn()} />);
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.md")] } });
    expect(await screen.findByText("notes.md")).toBeTruthy();
  });
});
