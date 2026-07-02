import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../api", () => ({ api: { mcpStatus: vi.fn() } }));
import { McpStatus } from "./McpStatus";
import { api } from "../api";

afterEach(cleanup);

test("shows 'no calls yet' when there is no activity", async () => {
  vi.mocked(api.mcpStatus).mockResolvedValue({ lastAt: null, lastTool: null, count: 0 });
  render(<McpStatus />);
  expect(await screen.findByText(/no calls yet/i)).toBeTruthy();
});

test("shows a relative time and the tool when there is activity", async () => {
  vi.mocked(api.mcpStatus).mockResolvedValue({ lastAt: new Date().toISOString(), lastTool: "query", count: 3 });
  render(<McpStatus />);
  const chip = await screen.findByText(/MCP ·/);
  expect(chip.textContent).toContain("query");
});

test("renders nothing when the fetch rejects (defensive)", async () => {
  vi.mocked(api.mcpStatus).mockRejectedValue(new Error("500"));
  const { container } = render(<McpStatus />);
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector(".chip.mcp")).toBeNull();
});
