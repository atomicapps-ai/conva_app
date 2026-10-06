import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConsentGate } from "@/components/ConsentGate";
import { useAppStore } from "@/state/app";

afterEach(cleanup);

describe("ConsentGate", () => {
  it("tells the user what leaves the computer once an AI key is added, and how to stop it", () => {
    useAppStore.setState({ config: { consent_acknowledged: false } as never });
    render(<ConsentGate />);
    const note = screen.getByTestId("consent-ai-disclosure");
    expect(note).toHaveTextContent(/until you add an ai key, conversation text is not sent to any ai provider/i);
    expect(note).toHaveTextContent(/both sides/i);
    expect(note).toHaveTextContent(/clear the key/i);
    // It must not claim a full off switch exists in Settings.
    expect(note).toHaveTextContent(/switch off part of that/i);
  });

  it("renders nothing once consent is acknowledged", () => {
    useAppStore.setState({ config: { consent_acknowledged: true } as never });
    const { container } = render(<ConsentGate />);
    expect(container).toBeEmptyDOMElement();
  });
});
