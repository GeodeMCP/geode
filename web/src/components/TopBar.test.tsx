import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, vi, it, expect } from "vitest";
import { TopBar } from "./TopBar";

// TopBar mounts NeedsAttention, which fetches its badge data on mount.
vi.mock("../api", () => ({
  api: {
    status: vi.fn().mockResolvedValue({ modified: [], created: [] }),
    tools: vi.fn().mockResolvedValue([]),
    gaps: vi.fn().mockResolvedValue({ gaps: [] }),
  },
}));

afterEach(cleanup);

it("renders Connect as a top-right pill, not a left-nav tab", () => {
  const onNav = vi.fn();
  const { container } = render(<TopBar view="Vault" onNav={onNav} hasTools={false} onLogout={() => {}} />);
  // Connect is NOT inside the left <nav>
  const nav = container.querySelector("nav")!;
  expect(nav.textContent).not.toContain("Connect");
  expect(nav.textContent).toContain("Vault");
  // Connect pill exists and navigates
  const pill = screen.getByRole("button", { name: /connect/i });
  expect(pill.className).toContain("pill");
  fireEvent.click(pill);
  expect(onNav).toHaveBeenCalledWith("Connect");
});

it("marks the pill active only on the Connect view", () => {
  const { rerender } = render(<TopBar view="Vault" onNav={() => {}} hasTools={false} onLogout={() => {}} />);
  expect(screen.getByRole("button", { name: /connect/i }).className).not.toContain("active");
  rerender(<TopBar view="Connect" onNav={() => {}} hasTools={false} onLogout={() => {}} />);
  expect(screen.getByRole("button", { name: /connect/i }).className).toContain("active");
});

it("still shows Secrets in the left nav when hasTools", () => {
  const { container } = render(<TopBar view="Vault" onNav={() => {}} hasTools={true} onLogout={() => {}} />);
  expect(container.querySelector("nav")!.textContent).toContain("Secrets");
});
