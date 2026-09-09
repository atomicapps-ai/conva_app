import { describe, expect, it } from "vitest";

import { mergeEnv, parseEnv } from "./env-merge.mjs";

describe("env-merge", () => {
  it("replaces existing keys in place and appends missing ones", () => {
    const target = "# dev\nCONVA_SUPABASE_URL=https://<conva-core-dev-project-ref>.supabase.co\nOTHER=keep\n";
    const source = "CONVA_SUPABASE_URL=https://maxpilxnmcbrebxjjbrp.supabase.co\nCONVA_SUPABASE_ANON_KEY=abc\n";
    expect(mergeEnv(target, source)).toBe(
      "# dev\nCONVA_SUPABASE_URL=https://maxpilxnmcbrebxjjbrp.supabase.co\nOTHER=keep\nCONVA_SUPABASE_ANON_KEY=abc\n",
    );
  });

  it("leaves comments, blank lines and unrelated keys untouched", () => {
    const target = "A=1\n\n# note\nB=2\n";
    expect(mergeEnv(target, "B=3\n")).toBe("A=1\n\n# note\nB=3\n");
  });

  it("preserves CRLF newlines (Windows checkouts) and a file without a trailing newline", () => {
    expect(mergeEnv("A=1\r\nB=2\r\n", "B=9\nC=3")).toBe("A=1\r\nB=9\r\nC=3\r\n");
    expect(mergeEnv("A=1", "A=2")).toBe("A=2\n");
  });

  it("only the first occurrence of a duplicated key is rewritten", () => {
    expect(mergeEnv("K=old\nK=older\n", "K=new\n")).toBe("K=new\nK=older\n");
  });

  it("ignores comment lines in the source", () => {
    expect(parseEnv("# X=1\nY=2\n")).toEqual({ Y: "2" });
  });
});
