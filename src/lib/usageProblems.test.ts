import { describe, expect, it } from "vitest";
import { usageProblemTitle } from "./usageProblems";

describe("usageProblemTitle", () => {
  it("is undefined when nothing went wrong, including for old buckets without the counters", () => {
    expect(usageProblemTitle({ failed_requests: 0 })).toBeUndefined();
  });

  it("lists every kind of problem", () => {
    const title = usageProblemTitle({
      failed_requests: 1,
      cut_off_requests: 2,
      refused_requests: 3,
      unusable_replies: 4,
    });
    expect(title).toContain("1 failed");
    expect(title).toContain("2 cut off");
    expect(title).toContain("3 declined");
    expect(title).toContain("4 replies could not be used");
  });
});
