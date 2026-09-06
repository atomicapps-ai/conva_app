/* Certification harness — a fake live gateway + static host for dist-web.
 *
 * Serves the pinned web build at /app/ (SPA fallback), answers the BFF session
 * probe as a signed-in beta user, and speaks the live protocol over a zero-dep
 * WebSocket: hello → ready, source.attach → source.attached + credit, PCM16
 * frames counted and measured (never stored), transcript events from the
 * two-channel fixture scheduled against each source's first audio, stop → bye.
 * Everything it learns is content-free statistics for the support-matrix row. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { acceptKey, decodeAudioFrame, decodeFrames, encodeFrame, fixtureEventsFor, summarizeSource } from "./lib.mjs";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
const INITIAL_CREDIT = 10;
const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

export function startGateway({ distDir, port = 0, sessionId = "live_certify", log = () => {} }) {
  const root = resolve(distDir);
  const stats = { sessions_created: 0, sockets: 0, hello: null, sources: new Map(), telemetry: [], ally_requests: 0, control_frames: 0, bad_frames: 0, bye_sent: false, closed_by_client: false, protocol_errors: [] };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (p === "/api/app/session") return json(res, 200, { signed_in: true, configured: true, email: "certify@example.invalid", user_id: "certify-user", provider: "google", expires_at_unix: Math.floor(Date.now() / 1000) + 3600, last_sign_in_at: null, beta_access: true, beta_status: "active" });
    if (p === "/api/live/status") return json(res, 200, { configured: true, provider: "certify", max_sources: 2, sample_rate_hz: 16000, ally: { configured: false, provider: null, model: null, reason: "The certification gateway has no model provider." }, limits: { max_minutes_per_day: 180, max_concurrent_sessions: 1, max_duration_s: 10800, ally_max_requests_per_day: 200 }, library: { embeddings: { configured: false, provider: null, model: null, dim: 384, reason: "certification gateway" } } });
    if (p === "/api/live/sessions" && req.method === "POST") {
      stats.sessions_created += 1;
      return json(res, 201, { session_id: sessionId, ticket: `t-${stats.sessions_created}`, stream_url: "/api/live/stream", expires_at_unix: Math.floor(Date.now() / 1000) + 60, limits: { max_duration_s: 10800, max_sources: 2, remaining_ms_today: 10_800_000 } });
    }
    if (p === "/api/live/usage") return json(res, 200, { day: "2026-01-01", day_start_unix: 0, resets_at_unix: 0, live: { used_ms: 0, audio_ms: 0, limit_ms: 10_800_000, remaining_ms: 10_800_000, sessions: 0, active_sessions: 0, max_concurrent_sessions: 1, max_duration_s: 10800 }, ally: { requests: 0, failed: 0, limit: 200, remaining: 200, input_tokens: 0, output_tokens: 0 }, limits: { max_minutes_per_day: 180, max_concurrent_sessions: 1, max_duration_s: 10800, ally_max_requests_per_day: 200 }, beta_access: true });
    if (p === "/api/live/telemetry" && req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      try {
        stats.telemetry.push(JSON.parse(body));
      } catch {
        /* content-free: ignore */
      }
      return json(res, 202, { ok: true });
    }
    if (p === "/api/live/ally") {
      stats.ally_requests += 1;
      return json(res, 503, { error: "unconfigured", reason: "certification gateway" });
    }
    // Cloud stores: empty and healthy, so console errors stay a real signal.
    if (p === "/api/live/contexts" && req.method === "GET") return json(res, 200, { contexts: [] });
    if (p === "/api/live/conversations" && req.method === "GET") return json(res, 200, { conversations: [] });
    if (p === "/api/live/library" && req.method === "GET") return json(res, 200, { documents: [] });
    if (p.startsWith("/api/live/contexts") || p.startsWith("/api/live/conversations") || p.startsWith("/api/live/library")) return json(res, 503, { error: "unprovisioned", reason: "certification gateway" });
    if (p.startsWith("/api/")) return json(res, 404, { error: "not_found" });
    // static: /app/* from dist-web with SPA fallback
    let rel = p.startsWith("/app/") ? p.slice("/app/".length) : p === "/app" ? "" : null;
    if (rel === null) {
      res.writeHead(302, { Location: "/app/" });
      return res.end();
    }
    let file = join(root, normalize("/" + rel));
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(root, "index.html");
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/api/live/stream" || !url.searchParams.get("ticket")) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    const key = req.headers["sec-websocket-key"];
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
    stats.sockets += 1;
    const send = (obj) => socket.write(encodeFrame(1, JSON.stringify(obj)));
    const timers = new Set();
    const schedule = (ms, fn) => {
      const t = setTimeout(fn, ms);
      timers.add(t);
    };
    const bySource = new Map(); // source_id → runtime state
    let nextIndex = 0;
    let nextSeq = 0;
    let buf = Buffer.alloc(0);
    const usage = {};

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = decodeFrames(buf);
      buf = Buffer.from(rest);
      for (const f of frames) {
        if (f.opcode === 8) {
          stats.closed_by_client = true;
          socket.end(encodeFrame(8, f.payload));
          return;
        }
        if (f.opcode === 9) {
          socket.write(encodeFrame(10, f.payload));
          continue;
        }
        if (f.opcode === 2) {
          const a = decodeAudioFrame(f.payload);
          if (!a) {
            stats.bad_frames += 1;
            continue;
          }
          const src = [...bySource.values()].find((s) => s.index === a.source_index);
          if (!src) {
            stats.protocol_errors.push(`audio for unknown source_index ${a.source_index}`);
            continue;
          }
          if (src.frames > 0 && a.seq !== src.lastSeq + 1) src.seqGaps += 1;
          src.lastSeq = a.seq;
          src.frames += 1;
          src.samples += a.samples;
          src.rmsSum += a.rms;
          if (a.peak > src.peak) src.peak = a.peak;
          if (a.rms > 300) src.voicedFrames += 1;
          usage[src.id] = Math.round((src.samples / 16_000) * 1000);
          src.credit -= 1;
          if (src.credit <= INITIAL_CREDIT / 2) {
            src.credit += INITIAL_CREDIT;
            send({ type: "credit", source_id: src.id, frames: INITIAL_CREDIT });
          }
          if (src.firstAudioAt === null) {
            src.firstAudioAt = Date.now();
            // Transcripts for this channel, timed against the first audio frame.
            const { events, nextSeq: n } = fixtureEventsFor(src.channel, { id: src.id, kind: src.kind }, sessionId, src.epoch, nextSeq, Date.now());
            nextSeq = n;
            for (const e of events) schedule(e.atMs, () => send({ type: "transcript", event: e.event }));
          }
          continue;
        }
        if (f.opcode !== 1) continue;
        stats.control_frames += 1;
        let msg;
        try {
          msg = JSON.parse(f.payload.toString("utf8"));
        } catch {
          stats.bad_frames += 1;
          continue;
        }
        switch (msg.type) {
          case "hello":
            stats.hello = { protocol: msg.protocol, contract_schema_version: msg.contract_schema_version, client_build: msg.client_build };
            send({ type: "ready", protocol: 1, session_id: sessionId, provider: "certify", initial_credit: INITIAL_CREDIT });
            break;
          case "source.attach": {
            const s = { id: msg.source_id, kind: msg.kind, channel: msg.channel, epoch: msg.epoch, sample_rate_hz: msg.sample_rate_hz, format: msg.format, index: nextIndex++, credit: INITIAL_CREDIT, frames: 0, samples: 0, rmsSum: 0, peak: 0, seqGaps: 0, voicedFrames: 0, lastSeq: -1, firstAudioAt: null };
            bySource.set(s.id, s);
            stats.sources.set(s.id, s);
            send({ type: "source.attached", source_id: s.id, source_index: s.index, epoch: s.epoch });
            send({ type: "credit", source_id: s.id, frames: INITIAL_CREDIT });
            send({ type: "source.state", source_id: s.id, state: "capturing" });
            break;
          }
          case "source.detach": {
            const s = bySource.get(msg.source_id);
            if (s) send({ type: "source.state", source_id: s.id, state: "ended", reason: msg.reason });
            break;
          }
          case "ack":
          case "cancel":
            break;
          case "stop":
            stats.bye_sent = true;
            send({ type: "bye", reason: "stopped", usage: { audio_ms_by_source: usage } });
            for (const t of timers) clearTimeout(t);
            socket.end(encodeFrame(8, Buffer.from([0x03, 0xe8])));
            break;
          default:
            stats.protocol_errors.push(`unknown control frame ${String(msg.type)}`);
        }
      }
    });
    socket.on("close", () => {
      for (const t of timers) clearTimeout(t);
    });
    socket.on("error", () => {});
    log("socket open");
  });

  return new Promise((resolveStart) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolveStart({
        port: address.port,
        origin: `http://127.0.0.1:${address.port}`,
        stats,
        summary: () => ({ ...stats, sources: [...stats.sources.values()].map(summarizeSource) }),
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
