import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.fn().mockResolvedValue(undefined);
const signinPassword = vi.fn();

vi.mock("@/lib/backend", () => ({
  useBackend: () => ({ auth: { start, signinPassword } }),
  useOperationAvailability: () => ({ state: "available" }),
}));

vi.mock("@/lib/backend/webAuth", () => ({
  consumeSigninFailure: () => null,
}));

import { WebSignIn } from "@/components/web/WebSignIn";

describe("WebSignIn", () => {
  beforeEach(() => {
    start.mockClear();
    signinPassword.mockClear();
  });

  it("uses the public-site brand and Google sign-in treatment", () => {
    render(<WebSignIn />);

    const brand = screen.getByRole("img", { name: "conva" });
    expect(brand.querySelector(".web-brand-wordmark-a")).toHaveTextContent("A");

    const google = screen.getByRole("button", { name: "Continue with Google" });
    expect(google).toHaveClass("bg-white", "text-[#3c4043]");
    expect(google.querySelector('path[fill="#4285F4"]')).not.toBeNull();
    expect(google.querySelector('path[fill="#34A853"]')).not.toBeNull();
    expect(google.querySelector('path[fill="#FBBC05"]')).not.toBeNull();
    expect(google.querySelector('path[fill="#EA4335"]')).not.toBeNull();

    fireEvent.click(google);
    expect(start).toHaveBeenCalledWith("google");
  });
});
