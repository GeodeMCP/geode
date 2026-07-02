import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../api", () => ({
  api: {
    connect: vi.fn().mockResolvedValue({
      mcpUrl: "http://localhost:8794/mcp",
      authToken: "secret-token-123",
      publicBaseUrl: null,
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
import { api } from "../api";

const TOOLS = [
  { name: "query", description: "Ask your vault.", params: [{ name: "instruction", type: "string", required: true }] },
  { name: "remember", description: "Save a note.", params: [] },
  { name: "list_capabilities", description: "List capabilities.", params: [] },
  { name: "invoke", description: "Run an action.", params: [] },
];

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

test("with a public base URL the Add-with-a-URL card goes live", async () => {
  vi.mocked(api.connect).mockResolvedValueOnce({
    mcpUrl: "http://localhost:8794/mcp",
    authToken: "secret-token-123",
    publicBaseUrl: "https://v.example.com",
    tools: TOOLS,
  });
  render(<Connect />);
  expect(await screen.findByText("query")).toBeTruthy();
  // the live public /mcp URL is shown
  expect(screen.getAllByText("https://v.example.com/mcp").length).toBeGreaterThan(0);
  // not in the disabled / "Setup required" state
  expect(screen.queryByText(/Setup required/i)).toBeNull();
  expect(screen.queryByText(/Set up a public tunnel/i)).toBeNull();
  // no managed-tunnel teaser when live
  expect(screen.queryByText(/managed tunnel/i)).toBeNull();
});

test("on localhost the Add-with-a-URL card shows the managed-tunnel teaser, CTA stays disabled", async () => {
  vi.mocked(api.connect).mockResolvedValueOnce({
    mcpUrl: "http://localhost:8794/mcp",
    authToken: "secret-token-123",
    publicBaseUrl: null,
    tools: TOOLS,
  });
  render(<Connect />);
  expect(await screen.findByText("query")).toBeTruthy();
  // the managed-tunnel / premium teaser is present (button label + localhost note)
  expect(screen.getAllByText(/managed tunnel/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/premium/i)).toBeTruthy();
  // the CTA button stays disabled
  const button = screen.getByRole("button", { name: /managed tunnel/i });
  expect((button as HTMLButtonElement).disabled).toBe(true);
});

test("defaults to Claude Code with an http config and the one-liner", async () => {
  render(<Connect />);
  await screen.findByText("query");
  expect(screen.getAllByText(/"type": "http"/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/claude mcp add --transport http geode/).length).toBeGreaterThan(0);
});

test("VS Code uses the servers key", async () => {
  render(<Connect />);
  await screen.findByText("query");
  fireEvent.click(screen.getByRole("tab", { name: "VS Code" }));
  expect(screen.getAllByText(/"servers":/).length).toBeGreaterThan(0);
});

test("Claude Desktop shows the mcp-remote bridge with --allow-http", async () => {
  render(<Connect />);
  await screen.findByText("query");
  fireEvent.click(screen.getByRole("tab", { name: "Claude Desktop" }));
  expect(screen.getAllByText(/mcp-remote/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/--allow-http/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/AUTH_HEADER/).length).toBeGreaterThan(0);
});

test("Other shows the raw URL and both config shapes", async () => {
  render(<Connect />);
  await screen.findByText("query");
  fireEvent.click(screen.getByRole("tab", { name: "Other MCP client" }));
  expect(screen.getAllByText(/localhost:8794\/mcp/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/"type": "http"/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/mcp-remote/).length).toBeGreaterThan(0);
});

test("Copy sends the real (unmasked) config to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<Connect />);
  await screen.findByText("query");
  expect(screen.queryByText(/secret-token-123/)).toBeNull(); // masked on screen
  fireEvent.click(screen.getAllByText("Copy")[0]);
  expect(writeText).toHaveBeenCalled();
  expect(writeText.mock.calls[0][0]).toContain("secret-token-123");
});
