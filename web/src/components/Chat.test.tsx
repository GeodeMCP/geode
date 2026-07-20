import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Chat } from "./Chat";
import { api } from "../api";

vi.mock("../api", () => ({
  api: {
    history: () => Promise.resolve([]), clearHistory: () => Promise.resolve(), upload: vi.fn(),
    attachments: () => Promise.resolve({ files: [] }), clearAttachments: () => Promise.resolve({ ok: true }),
    pendingHosts: vi.fn(() => Promise.resolve([])),
    approveHost: vi.fn(() => Promise.resolve({ approved: [], pending: [] })),
  },
}));

// jsdom doesn't implement scrollIntoView; Chat's auto-scroll effect calls it on every render.
Element.prototype.scrollIntoView = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });

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

describe("Chat host approval card", () => {
  const sendAMessage = () => {
    const textInput = screen.getByPlaceholderText("Talk to your vault…");
    fireEvent.change(textInput, { target: { value: "hello" } });
    fireEvent.keyDown(textInput, { key: "Enter" });
  };

  it("renders a pending host as an approval card after a run completes, and approving it calls the API and removes the card", async () => {
    vi.mocked(api.pendingHosts).mockResolvedValue([{ tool: "moneybird", host: "api.moneybird.nl" }]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Chat onSend={onSend} running={false} dirty={false} onCommit={vi.fn()} onDiscard={vi.fn()} />);

    sendAMessage();

    const approveBtn = await screen.findByText("Approve host");
    expect(screen.getByText("moneybird")).toBeTruthy();
    expect(screen.getByText("api.moneybird.nl")).toBeTruthy();

    fireEvent.click(approveBtn);

    await waitFor(() => expect(api.approveHost).toHaveBeenCalledWith("moneybird", "api.moneybird.nl"));
    await waitFor(() => expect(screen.queryByText("Approve host")).toBeNull());
  });

  it("dismissing an approval card removes it without calling the API", async () => {
    vi.mocked(api.pendingHosts).mockResolvedValue([{ tool: "github", host: "api.github.com" }]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Chat onSend={onSend} running={false} dirty={false} onCommit={vi.fn()} onDiscard={vi.fn()} />);

    sendAMessage();

    fireEvent.click(await screen.findByText("Dismiss"));

    await waitFor(() => expect(screen.queryByText("Approve host")).toBeNull());
    expect(api.approveHost).not.toHaveBeenCalled();
  });
});
