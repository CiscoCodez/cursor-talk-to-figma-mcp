// Verifies the relay carries export-sized payloads intact.
// Run: bun run tests/relay.test.js
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const WebSocket = require("ws");

const RELAY = path.join(__dirname, "..", "src", "socket.ts");
const PORT = 3301;
const CHANNEL = "relaytest";
const SIZES_MB = [8, 20, 60];

function startRelay() {
  const child = spawn("bun", [RELAY], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("relay did not start")), 10000);
    child.stdout.on("data", (d) => {
      if (String(d).includes("WebSocket server running")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on("error", reject);
  });
}

function open() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${PORT}`);
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

function join(socket, clientType) {
  return new Promise((resolve) => {
    socket.on("message", (raw) => {
      const data = JSON.parse(String(raw));
      if (data.type === "system" && data.message?.result?.channel) resolve();
    });
    socket.send(JSON.stringify({ type: "join", channel: CHANNEL, clientType }));
  });
}

// Ship a base64 payload through the relay and verify it arrives byte-identical.
function roundTrip(bytes) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "timed out" }), 60000);

    (async () => {
      const sender = await open();
      const receiver = await open();
      await join(sender, "figma");
      await join(receiver, "mcp");

      receiver.on("message", (raw) => {
        const data = JSON.parse(String(raw))?.message?.data;
        if (typeof data !== "string") return;
        clearTimeout(timer);
        const got = Buffer.from(data, "base64");
        finish({ ok: got.equals(bytes), received: got.length });
        sender.close();
        receiver.close();
      });

      sender.send(
        JSON.stringify({
          type: "message",
          channel: CHANNEL,
          message: { data: bytes.toString("base64") },
        })
      );
    })().catch((error) => finish({ ok: false, reason: error.message }));
  });
}

async function main() {
  console.log("relay payload handling");
  const relay = await startRelay();
  let failed = 0;

  for (const mb of SIZES_MB) {
    // Random bytes: real PNG/JPG exports are barely compressible.
    const payload = crypto.randomBytes(mb * 1024 * 1024);
    const result = await roundTrip(payload);
    if (result.ok) {
      console.log(`  ok   ${mb} MiB payload delivered intact (${result.received} bytes)`);
    } else {
      failed++;
      console.log(`  FAIL ${mb} MiB payload lost: ${result.reason}`);
    }
  }

  relay.kill();
  console.log(failed ? `\n${failed} failed` : "\nrelay payload handling ok");
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error("harness failure:", error);
  process.exit(1);
});