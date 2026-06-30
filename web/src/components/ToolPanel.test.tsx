import { afterEach, it, expect, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToolPanel } from "./ToolPanel";
import { api } from "../api";

vi.mock("../api", () => ({ api: {
  tool: vi.fn(), installTool: vi.fn(), uninstallTool: vi.fn(), testAction: vi.fn(),
} }));

afterEach(cleanup);

const TOOL = { id: "cb", name: "CloakBrowser", type: "cli", description: "d",
  actions: [{ name: "fetch" }], connections: [{ label: "default", configured: false }],
  requires: [], installed: false, permissions: { network: "any" } };

it("renders actions + connections + not-installed", async () => {
  (api.tool as any).mockResolvedValue(TOOL);
  render(<ToolPanel id="cb" />);
  expect(await screen.findByText("fetch")).toBeTruthy();
  expect(screen.getByText("default")).toBeTruthy();
  expect(screen.getByText("not installed")).toBeTruthy();
});

it("install & trust shows permissions then installs", async () => {
  (api.tool as any).mockResolvedValueOnce(TOOL).mockResolvedValueOnce({ ...TOOL, installed: true });
  (api.installTool as any).mockResolvedValue({});
  render(<ToolPanel id="cb" />);
  fireEvent.click(await screen.findByText("Install & trust"));
  expect(screen.getByText("Permissions requested")).toBeTruthy();
  fireEvent.click(screen.getByText("Confirm install"));
  await waitFor(() => expect(api.installTool).toHaveBeenCalledWith("cb"));
  expect(await screen.findByText("installed")).toBeTruthy();
});

it("Test calls the action and shows the result", async () => {
  (api.tool as any).mockResolvedValue(TOOL);
  (api.testAction as any).mockResolvedValue({ status: 200, body: "ok" });
  render(<ToolPanel id="cb" />);
  fireEvent.click(await screen.findByText("Test"));
  await waitFor(() => expect(api.testAction).toHaveBeenCalledWith("cb", "fetch", {}));
});
