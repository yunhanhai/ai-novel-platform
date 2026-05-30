import { describe, expect, it, vi } from "vitest";
import Page from "./page";

const redirect = vi.hoisted(() => vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
}));

vi.mock("next/navigation", () => ({ redirect }));

describe("home page", () => {
  it("redirects to the project list instead of rendering the placeholder", () => {
    expect(() => Page()).toThrow("NEXT_REDIRECT:/projects");
    expect(redirect).toHaveBeenCalledWith("/projects");
  });
});
