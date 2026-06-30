import { afterEach, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VaultHome } from "./VaultHome";

vi.mock("../components/Chat", () => ({ Chat: () => <div data-testid="chat" /> }));
vi.mock("../components/Viewer", () => ({ Viewer: () => <div data-testid="viewer" /> }));
vi.mock("../api", () => ({
  api: {
    tree: vi.fn().mockResolvedValue([{ name: "note.md", path: "note.md", type: "file" }]),
    status: vi.fn().mockResolvedValue({ modified: [], created: [] }),
    artifacts: vi.fn().mockRejectedValue(new Error("500")),
  },
}));
afterEach(cleanup);

it("still renders the vault tree when /api/artifacts fails", async () => {
  render(<VaultHome />);
  expect(await screen.findByText("note.md")).toBeTruthy();
});
