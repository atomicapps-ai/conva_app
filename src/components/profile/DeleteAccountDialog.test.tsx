import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";
import { RESUME_KEY } from "@/lib/accountDeletion";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { AuthStatus } from "@/lib/ipc";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

const EMAIL = "alice@example.com";
const at = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();
const status = (agoMs: number | null): AuthStatus => ({
  signed_in: true,
  email: EMAIL,
  user_id: "u1",
  expires_at_unix: null,
  last_sign_in_at: agoMs === null ? null : at(agoMs),
  configured: true,
});

function setup(opts: {
  open: AuthStatus;
  web?: boolean;
  startAt?: 1 | 2;
  latest?: AuthStatus;
  deleteAccount?: ReturnType<typeof vi.fn>;
  signinPassword?: ReturnType<typeof vi.fn>;
}) {
  const auth = {
    status: vi.fn().mockResolvedValue(opts.latest ?? opts.open),
    start: vi.fn().mockResolvedValue(undefined),
    signinPassword: opts.signinPassword ?? vi.fn(),
    deleteAccount: opts.deleteAccount ?? vi.fn().mockResolvedValue({ reference: "DEL-ABCD-2345" }),
  };
  const backend = { auth, subscribe: vi.fn().mockResolvedValue(() => {}) } as unknown as ConvaBackend;
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  render(
    <BackendProvider backend={backend}>
      <DeleteAccountDialog status={opts.open} web={opts.web ?? false} startAt={opts.startAt} onClose={onClose} onDeleted={onDeleted} />
    </BackendProvider>,
  );
  return { auth, onClose, onDeleted };
}

const toStep2 = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }));
const typeEmail = (v: string) => fireEvent.change(screen.getByLabelText(/Type your email to confirm/), { target: { value: v } });
const deleteBtn = () => screen.getByRole("button", { name: /Delete my account|Deleting/ });

describe("DeleteAccountDialog", () => {
  it("step 1 says what is deleted and what is not, that it is immediate, and names no backup length until it is known", () => {
    const { onClose } = setup({ open: status(60 * 60_000) });
    const dlg = screen.getByRole("dialog", { name: /Delete your Conva account\?/ });
    expect(dlg).toHaveTextContent("Deleted from Conva's servers");
    expect(dlg).toHaveTextContent("Conversations, Library and Contexts saved to the cloud");
    expect(dlg).toHaveTextContent("Copies at AI providers, under their terms (Anthropic: up to 30 days)");
    expect(dlg).toHaveTextContent("Data on your computers (erase it in Settings → Privacy)");
    expect(screen.getByTestId("delete-warning")).toHaveTextContent(/deleted straight away.*can.t be undone/i);
    expect(dlg).not.toHaveTextContent(/within 30 days|up to \d+ more day/i);
    expect(dlg).not.toHaveTextContent(/email you/i); // no mailer exists, so no such promise
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("the web wording does not mention erasing this browser", () => {
    setup({ open: status(60 * 60_000), web: true });
    expect(screen.getByRole("dialog")).toHaveTextContent(/any computer where you use the desktop app/);
  });

  it("an old sign-in is Not confirmed and Delete stays off, even with the right email", () => {
    setup({ open: status(60 * 60_000) });
    toStep2();
    expect(screen.getByTestId("reauth-status")).toHaveTextContent("Not confirmed");
    typeEmail(EMAIL);
    expect(deleteBtn()).toBeDisabled();
  });

  it("a sign-in from seconds ago is Confirmed, but Delete still needs the email typed exactly (case ignored)", () => {
    setup({ open: status(30_000) });
    toStep2();
    expect(screen.getByTestId("reauth-status")).toHaveTextContent("Confirmed");
    expect(deleteBtn()).toBeDisabled();
    typeEmail("bob@example.com");
    expect(deleteBtn()).toBeDisabled();
    typeEmail("  Alice@Example.COM ");
    expect(deleteBtn()).toBeEnabled();
  });

  it("Sign in with Google starts the provider flow; on the web it first marks the resume flag for the redirect", async () => {
    const { auth } = setup({ open: status(60 * 60_000), web: true });
    toStep2();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(auth.start).toHaveBeenCalledWith("google"));
    expect(window.sessionStorage.getItem(RESUME_KEY)).not.toBeNull();
  });

  it("on desktop it does not set the resume flag, and a new sign-in landing (window refocus) turns Confirmed on", async () => {
    const fresh = status(5_000);
    const { auth } = setup({ open: status(60 * 60_000), latest: fresh });
    toStep2();
    expect(screen.getByTestId("reauth-status")).toHaveTextContent("Not confirmed");
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(auth.start).toHaveBeenCalled());
    expect(window.sessionStorage.getItem(RESUME_KEY)).toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(screen.getByTestId("reauth-status")).toHaveTextContent("Confirmed"));
  });

  it("the password route confirms with a fresh sign-in, and a wrong password is reported without confirming", async () => {
    const signinPassword = vi.fn().mockRejectedValueOnce(new Error("Invalid login credentials")).mockResolvedValueOnce(status(2_000));
    setup({ open: status(60 * 60_000), signinPassword });
    toStep2();
    fireEvent.click(screen.getByRole("button", { name: "Use my password instead" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(screen.getByTestId("reauth-status")).toHaveTextContent("Not confirmed");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "right" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm password" }));
    await waitFor(() => expect(screen.getByTestId("reauth-status")).toHaveTextContent("Confirmed"));
    expect(signinPassword).toHaveBeenLastCalledWith(EMAIL, "right");
  });

  it("deleting shows the reference and what remains, calls onDeleted once, and clears the resume flag", async () => {
    window.sessionStorage.setItem(RESUME_KEY, String(Date.now()));
    const { onDeleted, auth } = setup({ open: status(10_000) });
    toStep2();
    typeEmail(EMAIL);
    fireEvent.click(deleteBtn());
    expect(await screen.findByRole("dialog", { name: /Your account is deleted/ })).toBeInTheDocument();
    expect(auth.deleteAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("delete-reference")).toHaveTextContent("DEL-ABCD-2345");
    expect(screen.getByRole("dialog")).toHaveTextContent("Data on this computer is still here");
    expect(onDeleted).toHaveBeenCalledWith({ reference: "DEL-ABCD-2345" });
    expect(window.sessionStorage.getItem(RESUME_KEY)).toBeNull();
  });

  it("on the web the done step says there is nothing to erase in the browser", async () => {
    setup({ open: status(10_000), web: true });
    toStep2();
    typeEmail(EMAIL);
    fireEvent.click(deleteBtn());
    expect(await screen.findByText(/Nothing on this browser needs erasing/)).toBeInTheDocument();
  });

  it("when the server refuses a stale sign-in, it says so and demands a DIFFERENT sign-in before Delete works again", async () => {
    const deleteAccount = vi.fn().mockRejectedValue("recent_sign_in_required");
    setup({ open: status(10_000), deleteAccount });
    toStep2();
    typeEmail(EMAIL);
    fireEvent.click(deleteBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent(/too old\. Sign in again/);
    expect(screen.getByTestId("reauth-status")).toHaveTextContent("Not confirmed");
    expect(deleteBtn()).toBeDisabled();
  });

  it("any other failure keeps the dialog on the confirm step and says nothing was deleted", async () => {
    const deleteAccount = vi.fn().mockRejectedValue(new Error("storage_cleanup_failed"));
    const { onDeleted } = setup({ open: status(10_000), deleteAccount });
    toStep2();
    typeEmail(EMAIL);
    fireEvent.click(deleteBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent(/nothing was deleted/i);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(deleteBtn()).toBeEnabled(); // the person can simply retry
  });

  it("starts at the confirm step when reopened after the web sign-in redirect, and Back returns to step 1", () => {
    setup({ open: status(5_000), web: true, startAt: 2 });
    expect(screen.getByRole("dialog", { name: /Confirm it.s you/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: /Delete your Conva account\?/ })).toBeInTheDocument();
  });

  it("Escape closes steps 1 and 2", () => {
    const { onClose } = setup({ open: status(5_000) });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    toStep2();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
