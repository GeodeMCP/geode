import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Chat } from "./Chat";
import { api } from "../api";

vi.mock("../api", () => ({ api: { history: () => Promise.resolve([]), clearHistory: () => Promise.resolve(), upload: vi.fn(), attachments: () => Promise.resolve({ files: [] }), clearAttachments: () => Promise.resolve({ ok: true }) } }));

// jsdom doesn't implement scrollIntoView; Chat's auto-scroll effect calls it on every render.
Element.prototype.scrollIntoView = vi.fn();
afterEach(cleanup);

describe("Chat composer", () => {
  it("stages a selected file as a removable chip", async () => {
    render(<Chat onSend={vi.fn()} running={false} dirty={false} onCommit={vi.fn()} onDiscard={vi.fn()} />);
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.md")] } });
    expect(await screen.findByText("notes.md")).toBeTruthy();
  });

  it("surfaces an error and does not send when upload fails", async () => {
    vi.mocked(api.upload).mockRejectedValue(new Error("boom"));
    const onSend = vi.fn();
    render(<Chat onSend={onSend} running={false} dirty={false} onCommit={vi.fn()} onDiscard={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "notes.md")] } });
    await screen.findByText("notes.md");

    const textInput = screen.getByPlaceholderText("Talk to your vault…");
    fireEvent.change(textInput, { target: { value: "hello" } });
    fireEvent.keyDown(textInput, { key: "Enter" });

    expect(await screen.findByText(/Upload failed: boom/)).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
  });
});
