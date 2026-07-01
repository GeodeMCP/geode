import { afterEach, it, expect, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToolPanel } from "./ToolPanel";
import { api } from "../api";

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => resolve = r); return { promise, resolve }; }

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

it("ignores a stale load when id changes mid-flight", async () => {
  const defA = deferred<typeof TOOL>(); const defB = deferred<typeof TOOL>();
  (api.tool as any).mockReturnValueOnce(defA.promise).mockReturnValueOnce(defB.promise);
  const { rerender } = render(<ToolPanel id="a" />);
  rerender(<ToolPanel id="b" />);            // second mount-effect run, id=b
  defB.resolve({ ...TOOL, id: "b", name: "Bravo" });
  defA.resolve({ ...TOOL, id: "a", name: "Alpha" });  // stale, resolves LAST
  expect(await screen.findByText("Bravo")).toBeTruthy();
  expect(screen.queryByText("Alpha")).toBeNull();      // stale never shown
});

it("shows the real server error when the tool fails to load", async () => {
  (api.tool as any).mockRejectedValue(new Error('tool cb: action "fetch" — command must be a non-empty array of argv tokens'));
  render(<ToolPanel id="cb" />);
  expect(await screen.findByText(/must be a non-empty array of argv tokens/)).toBeTruthy();
  expect(screen.queryByText(/save the manifest first/)).toBeNull();
});

it("shows an install error in a contained error block", async () => {
  (api.tool as any).mockResolvedValue(TOOL);
  (api.installTool as any).mockRejectedValue(new Error("docker build failed:\nline1\nline2 exit code: 127"));
  const { container } = render(<ToolPanel id="cb" />);
  fireEvent.click(await screen.findByText("Install & trust"));
  fireEvent.click(screen.getByText("Confirm install"));
  expect(await screen.findByText(/docker build failed/)).toBeTruthy();
  expect(container.querySelector(".tp-error")).toBeTruthy();
});

it("keeps the requested permissions legible in the confirm card", async () => {
  (api.tool as any).mockResolvedValue({ ...TOOL, permissions: { network: "any" } });
  const { container } = render(<ToolPanel id="cb" />);
  fireEvent.click(await screen.findByText("Install & trust"));
  const card = screen.getByText("Permissions requested").closest(".card")!;
  expect(card.textContent).toContain("network");
  expect(card.textContent).toContain("any");
  expect(container.querySelector(".card")).toBeTruthy();
});
