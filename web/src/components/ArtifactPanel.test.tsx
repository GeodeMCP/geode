import { afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ArtifactPanel } from "./ArtifactPanel";
import { api } from "../api";
vi.mock("../api", () => ({ api: { artifactDownload: (p: string) => `/api/artifacts/download?path=${p}`, artifactPublicLink: vi.fn() } }));
afterEach(cleanup);

it("shows the path + a download link", () => {
  render(<ArtifactPanel path="sub/b.png" />);
  expect(screen.getByText("sub/b.png")).toBeTruthy();
  const dl = screen.getByText("Download") as HTMLAnchorElement;
  expect(dl.getAttribute("href")).toContain("sub/b.png");
});
it("shares a public link", async () => {
  (api.artifactPublicLink as any).mockResolvedValue({ url: "https://x/share/abc" });
  render(<ArtifactPanel path="a.md" />);
  fireEvent.click(screen.getByText("Share link"));
  await waitFor(() => expect(api.artifactPublicLink).toHaveBeenCalledWith("a.md"));
  expect((await screen.findByDisplayValue("https://x/share/abc"))).toBeTruthy();
});
