import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../api", () => ({ api: { setup: vi.fn().mockResolvedValue({ ok: true }) } }));
import { api } from "../api";
import { Setup } from "./Setup";
afterEach(cleanup);

test("submits email + password and calls onIn on success", async () => {
  let entered = false;
  render(<Setup onIn={() => (entered = true)} />);
  fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: "me@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "correct-horse" } });
  fireEvent.change(screen.getByPlaceholderText(/confirm/i), { target: { value: "correct-horse" } });
  fireEvent.click(screen.getByRole("button"));
  await vi.waitFor(() => expect((api.setup as any)).toHaveBeenCalledWith("me@example.com", "correct-horse"));
  await vi.waitFor(() => expect(entered).toBe(true));
});

test("blocks mismatched passwords without calling setup", () => {
  render(<Setup onIn={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: "me@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "correct-horse" } });
  fireEvent.change(screen.getByPlaceholderText(/confirm/i), { target: { value: "different-one" } });
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText(/match/i)).toBeTruthy();
});
