import { beforeEach, describe, expect, it } from "vitest";

import {
  CLAIM_SNAPSHOT_CONTRACT_VERSION,
  type ClaimSnapshotEvent,
} from "@/lib/ipc";
import {
  shouldAcceptClaimSnapshot,
  useAllyStore,
} from "@/state/ally";
import { useTranscriptStore } from "@/state/transcript";

function snapshot(
  revision: number,
  overrides: Partial<ClaimSnapshotEvent> = {},
): ClaimSnapshotEvent {
  return {
    contract_version: CLAIM_SNAPSHOT_CONTRACT_VERSION,
    session_id: "session-1",
    epoch: 1,
    revision,
    claims: [],
    ...overrides,
  };
}

describe("versioned claim snapshots", () => {
  beforeEach(() => {
    useAllyStore.getState().clear();
    useTranscriptStore.getState().setSession({
      state: "listening",
      session_id: "session-1",
      started_at_unix_ms: 1,
    });
  });

  it("accepts only a newer revision for the active session and epoch", () => {
    const apply = useAllyStore.getState().applyClaimSnapshot;
    apply(snapshot(2));
    apply(snapshot(2));
    apply(snapshot(1));
    apply(snapshot(3, { session_id: "another-session" }));
    apply(snapshot(3, { contract_version: 2 }));

    expect(useAllyStore.getState().claimSnapshot).toEqual(snapshot(2));

    apply(snapshot(3));
    expect(useAllyStore.getState().claimSnapshot?.revision).toBe(3);
  });

  it("accepts the first revision of a newer producer epoch", () => {
    const apply = useAllyStore.getState().applyClaimSnapshot;
    apply(snapshot(20));
    apply(snapshot(1, { epoch: 2 }));

    expect(useAllyStore.getState().claimSnapshot).toEqual(
      snapshot(1, { epoch: 2 }),
    );
  });

  it("rejects an older producer epoch regardless of its revision", () => {
    expect(
      shouldAcceptClaimSnapshot(
        snapshot(1, { epoch: 2 }),
        snapshot(999, { epoch: 1 }),
        "session-1",
      ),
    ).toBe(false);
  });

  it("clear removes the accepted snapshot", () => {
    useAllyStore.getState().applyClaimSnapshot(snapshot(1));
    useAllyStore.getState().clear();
    expect(useAllyStore.getState().claimSnapshot).toBeNull();
  });
});
