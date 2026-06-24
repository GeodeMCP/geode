import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../api", () => ({
  api: {
    connect: vi.fn().mockResolvedValue({
      mcpUrl: "http://localhost:8794/mcp",
      authToken: "secret-token-123",
      tools: [
        { name: "query", description: "Ask your vault.", params: [{ name: "instruction", type: "string", required: true }] },
        { name: "remember", description: "Save a note.", params: [] },
        { name: "list_capabilities", description: "List capabilities.", params: [] },
        { name: "invoke", description: "Run an action.", params: [] },
      ],
    }),
  },
}));

import { Connect } from "./Connect";

afterEach(cleanup);

test("renders the tools, the mcpUrl, and masks the token until revealed", async () => {
  const { container } = render(<Connect />);
  expect(await screen.findByText("query")).toBeTruthy();
  const toolNames = [...container.querySelectorAll(".tname")].map((el) => el.textContent);
  for (const t of ["query", "remember", "list_capabilities", "invoke"]) expect(toolNames).toContain(t);
  expect(screen.getAllByText(/localhost:8794\/mcp/).length).toBeGreaterThan(0);
  // token hidden initially
  expect(screen.queryByText(/secret-token-123/)).toBeNull();
  fireEvent.click(screen.getByText(/reveal/i));
  expect(screen.getAllByText(/secret-token-123/).length).toBeGreaterThan(0);
});
