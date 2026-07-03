import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, vi, it, expect } from "vitest";

vi.mock("../api", () => ({
  api: {
    status: vi.fn().mockResolvedValue({ modified: ["a.md"], created: ["b.md"] }),
    tools: vi.fn().mockResolvedValue([
      { id: "moneybird", name: "Moneybird", type: "http", description: "", actions: [{ name: "list", params: [] }], connections: [{ label: "roverm", configured: false }], requires: ["api-token"], installed: true, permissions: undefined },
    ]),
    gaps: vi.fn().mockResolvedValue({ gaps: [{ title: "Add CRM tool", kind: "tool", description: "need X", path: "backlog.md" }] }),
    commit: vi.fn().mockResolvedValue({ commit: "abc" }),
    discard: vi.fn().mockResolvedValue({ ok: true }),
    secretLink: vi.fn(),
    tool: vi.fn(),
    testAction: vi.fn(),
  },
}));

import { NeedsAttention } from "./NeedsAttention";
import { api } from "../api";

afterEach(cleanup);

it("shows the total pending count (files + connections + gaps) on the bell badge", async () => {
  render(<NeedsAttention onOpenSettings={() => {}} />);
  expect(await screen.findByText("4")).toBeTruthy(); // 2 files + 1 connection + 1 gap
});

it("opens the drawer and lists an item from each of the three groups", async () => {
  render(<NeedsAttention onOpenSettings={() => {}} />);
  await screen.findByText("4");
  fireEvent.click(screen.getByRole("button", { name: /needs attention/i }));
  expect(await screen.findByText(/2 files changed by the agent/)).toBeTruthy();
  expect(screen.getByText("moneybird")).toBeTruthy(); // tool name, bold, in the connection card
  expect(screen.getByText(/roverm/)).toBeTruthy();    // connection label
  expect(screen.getByText(/Add CRM tool/)).toBeTruthy();
});

it("commit re-fetches and clears the pending-changes item", async () => {
  render(<NeedsAttention onOpenSettings={() => {}} />);
  await screen.findByText("4");
  fireEvent.click(screen.getByRole("button", { name: /needs attention/i }));
  await screen.findByText(/2 files changed by the agent/);
  vi.mocked(api.status).mockResolvedValueOnce({ modified: [], created: [] });
  fireEvent.click(screen.getByText("Commit"));
  // empty groups are hidden now, so the pending-changes item disappears entirely
  await waitFor(() => expect(screen.queryByText(/files changed by the agent/)).toBeNull());
  expect(api.commit).toHaveBeenCalled();
});

it("Esc closes the drawer", async () => {
  render(<NeedsAttention onOpenSettings={() => {}} />);
  await screen.findByText("4");
  fireEvent.click(screen.getByRole("button", { name: /needs attention/i }));
  await screen.findByText("Needs attention");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByText("Needs attention")).toBeNull();
});
