/* A single review page for a scenario run: every scenario with its recording (when one was kept), its matrix rows, and each step's result, so a run can be watched without opening any other file. Written next to the JSON report as `report.html` (open it in a browser; the videos load from the folders beside it) and reused to publish a hosted copy. Pure: a report object in, an HTML string out. */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const OUTCOME = {
  pass: { label: "Passed", cls: "pass" },
  "known-failing": { label: "Known problem", cls: "known" },
  fail: { label: "Failed", cls: "fail" },
  "unexpected-pass": { label: "Known problem now passes", cls: "fail" },
};

const CSS = `
:root{--bg:#f6f7f9;--surface:#fff;--ink:#14181f;--muted:#5b6573;--line:#dfe3e9;--accent:#1f5fd6;--pass:#157a3d;--pass-bg:#e4f4ea;--known:#8a5a00;--known-bg:#fbf0d9;--fail:#b3261e;--fail-bg:#fbe5e3;--video:#0b0e13;--font:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0d1117;--surface:#151b24;--ink:#e6eaf0;--muted:#98a3b3;--line:#273140;--accent:#6aa3ff;--pass:#5fd08a;--pass-bg:#12301f;--known:#f2c46b;--known-bg:#3a2d10;--fail:#ff8a80;--fail-bg:#3d1a18;--video:#05070a;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0d1117;--surface:#151b24;--ink:#e6eaf0;--muted:#98a3b3;--line:#273140;--accent:#6aa3ff;--pass:#5fd08a;--pass-bg:#12301f;--known:#f2c46b;--known-bg:#3a2d10;--fail:#ff8a80;--fail-bg:#3d1a18;--video:#05070a;color-scheme:dark}
body{background:var(--bg);color:var(--ink);font-family:var(--font);line-height:1.5;padding-inline:max(16px,3vw);padding-block:28px 56px}
.wrap{max-width:1180px;margin-inline:auto;display:flex;flex-direction:column;gap:28px}
header{display:flex;flex-direction:column;gap:10px}
h1{font-size:1.7rem;line-height:1.15;margin:0;text-wrap:balance;font-weight:600}
.meta{color:var(--muted);font-size:.9rem;display:flex;flex-wrap:wrap;gap:6px 18px;font-family:var(--mono)}
.tally{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 11px;font-size:.82rem;font-weight:600;white-space:nowrap}
.pill.pass{background:var(--pass-bg);color:var(--pass)}.pill.known{background:var(--known-bg);color:var(--known)}.pill.fail{background:var(--fail-bg);color:var(--fail)}
.legend{color:var(--muted);font-size:.9rem;max-width:68ch;margin:0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:0;overflow:hidden}
.card>*{min-width:0}
.vid{background:var(--video);display:flex;align-items:center;justify-content:center;min-height:200px}
.vid video{width:100%;aspect-ratio:16/10;display:block;background:var(--video)}
.vid .none{color:var(--muted);padding:24px;font-size:.9rem;text-align:center;max-width:36ch}
.body{padding:18px 20px;display:flex;flex-direction:column;gap:12px}
.top{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between}
.id{font-family:var(--mono);font-size:.8rem;color:var(--muted)}
h2{font-size:1.08rem;margin:0;line-height:1.3;text-wrap:balance;font-weight:600}
.rows{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-family:var(--mono);font-size:.74rem;border:1px solid var(--line);border-radius:5px;padding:1px 7px;color:var(--muted)}
ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
li{display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:8px;font-size:.88rem;align-items:start}
li .mk{font-weight:700;text-align:center;font-family:var(--mono)}
li.ok .mk{color:var(--pass)}li.known .mk{color:var(--known)}li.bad .mk{color:var(--fail)}li.skip{color:var(--muted)}
li .ms{font-family:var(--mono);font-size:.74rem;color:var(--muted);font-variant-numeric:tabular-nums}
.note{display:block;margin-top:2px;font-size:.8rem;padding:5px 8px;border-radius:5px}
li.known .note{background:var(--known-bg);color:var(--known)}li.bad .note{background:var(--fail-bg);color:var(--fail)}
footer{color:var(--muted);font-size:.85rem}
code{font-family:var(--mono);font-size:.85em}
a{color:var(--accent)}
@media (max-width:820px){.card{grid-template-columns:minmax(0,1fr)}}
`;

function stepRow(s) {
  const cls = s.skipped ? "skip" : s.ok ? "ok" : s.known ? "known" : "bad";
  const mark = s.skipped ? "–" : s.ok ? "✓" : s.known ? "●" : "✗";
  const label = s.skipped ? "skipped" : s.ok ? "passed" : s.known ? "known problem" : "failed";
  const note = !s.ok && !s.skipped ? `<span class="note">${s.known ? `Known: ${esc(s.known)}` : ""}${s.known && s.error ? "<br>" : ""}${s.error ? `Saw: ${esc(s.error)}` : ""}</span>` : s.ok && s.known ? `<span class="note">Known problem now passes: ${esc(s.known)}</span>` : "";
  return `<li class="${cls}"><span class="mk" title="${label}" aria-label="${label}">${mark}</span><span>${esc(s.name)}${note}</span><span class="ms">${s.ms ? `${(s.ms / 1000).toFixed(1)}s` : ""}</span></li>`;
}

function card(r, videoSrc) {
  const o = OUTCOME[r.outcome] ?? { label: r.outcome, cls: "fail" };
  const src = videoSrc(r);
  const media = src
    ? `<video controls preload="metadata" playsinline src="${esc(src)}"></video>`
    : `<div class="none">No recording kept: a clean pass keeps nothing. Run <code>npm run scenarios:web -- --keep</code> to keep every video.</div>`;
  return `<article class="card" id="${esc(r.id)}"><div class="vid">${media}</div><div class="body"><div class="top"><span class="id">${esc(r.id)}</span><span class="pill ${o.cls}">${o.label}</span></div><h2>${esc(r.title)}</h2><div class="rows">${(r.matrix ?? []).map((m) => `<span class="chip">${esc(m)}</span>`).join("")}</div><ol>${r.steps.map(stepRow).join("")}</ol></div></article>`;
}

/** `report` is the JSON the runner writes; `videoSrc(scenario)` returns the video URL or null. `standalone` wraps a full document (for the local file); the published copy supplies its own skeleton. */
export function renderReport(report, { videoSrc = () => null, standalone = false, title = "App flow recordings" } = {}) {
  const count = (o) => report.scenarios.filter((r) => r.outcome === o).length;
  const bad = count("fail") + count("unexpected-pass");
  const when = new Date(report.ran_at);
  const meta = [`${esc(when.toISOString().slice(0, 16).replace("T", " "))} UTC`, `${esc(report.browser?.requested ?? "browser")}${report.browser?.version ? ` ${esc(report.browser.version)}` : ""}`, `${esc(report.os?.platform ?? "")} ${esc(report.os?.arch ?? "")}`].filter(Boolean);
  const head = `<title>${esc(title)}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"><style>${CSS}</style>`;
  const body = `<div class="wrap"><header><h1>${esc(title)}</h1><div class="meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div><div class="tally"><span class="pill pass">${count("pass")} passed</span><span class="pill known">${count("known-failing")} known problems</span><span class="pill fail">${bad} failed</span></div><p class="legend">Each card is one scenario run in a real browser against the demo workspace. A known problem is an open issue the test documents on purpose; it turns into a failure when it starts passing, so the note gets removed.</p></header>${report.scenarios.map((r) => card(r, videoSrc)).join("")}<footer>${report.scenarios.length} scenarios, ${esc((report.scenarios.reduce((n, r) => n + r.ms, 0) / 1000).toFixed(0))}s of test time.</footer></div>`;
  if (!standalone) return `${head}${body}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}</head><body>${body}</body></html>`;
}
