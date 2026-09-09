import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarEditor } from "@/components/profile/AvatarEditor";
import * as avatarCrop from "@/lib/image/avatarCrop";

// jsdom doesn't implement the Blob URL registry at all.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
});

function makeFile() {
  return new File(["fake-bytes"], "photo.png", { type: "image/png" });
}

/** jsdom never actually decodes the image, so `onLoad` never fires and
 *  `naturalWidth/Height` stay 0 unless set explicitly first. */
function loadImage(img: HTMLImageElement, w = 800, h = 400) {
  Object.defineProperty(img, "naturalWidth", { value: w, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: h, configurable: true });
  fireEvent.load(img);
}

describe("AvatarEditor", () => {
  it("shows the picked image, a zoom slider, and Save/Cancel", () => {
    const { container } = render(<AvatarEditor file={makeFile()} onCancel={() => {}} onSave={() => {}} />);
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("disables Save until the image has actually loaded (no natural size yet)", () => {
    render(<AvatarEditor file={makeFile()} onCancel={() => {}} onSave={() => {}} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<AvatarEditor file={makeFile()} onCancel={onCancel} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("moving the zoom slider updates its value", () => {
    render(<AvatarEditor file={makeFile()} onCancel={() => {}} onSave={() => {}} />);
    const slider = screen.getByLabelText("Zoom") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "2.5" } });
    expect(slider.value).toBe("2.5");
  });

  it("Save exports the current crop and hands the resulting blob to onSave", async () => {
    const fakeBlob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    const exportSpy = vi.spyOn(avatarCrop, "exportAvatarBlob").mockResolvedValue(fakeBlob);
    const onSave = vi.fn();

    const { container } = render(<AvatarEditor file={makeFile()} onCancel={() => {}} onSave={onSave} />);
    loadImage(container.querySelector("img")!);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Save" }); // settles past "Saving…"
    expect(onSave).toHaveBeenCalledWith(fakeBlob);
    expect(exportSpy).toHaveBeenCalledTimes(1);
  });

  it("shows an error and re-enables Save if export fails, without calling onSave", async () => {
    vi.spyOn(avatarCrop, "exportAvatarBlob").mockRejectedValue(new Error("boom"));
    const onSave = vi.fn();

    const { container } = render(<AvatarEditor file={makeFile()} onCancel={() => {}} onSave={onSave} />);
    loadImage(container.querySelector("img")!);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Couldn't process that image/);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });
});
