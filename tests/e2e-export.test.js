// End-to-end export test: real relay + real built MCP server over stdio,
// with a fake Figma peer standing in for the plugin.
// Run: bun run tests/e2e-export.test.js
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

const ROOT = path.join(__dirname, "..");
const PORT = 3307;
const CHANNEL = "exporttest";
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figma-export-e2e-"));

// A real 1x1 PNG, so the saved file can be sniffed as an actual image.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

function startRelay() {
  const child = spawn("bun", [path.join(ROOT, "src", "socket.ts")], {
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

// Minimal MCP client over stdio.
class McpClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const waiter = this.pending.get(msg.id);
        if (waiter) {
          this.pending.delete(msg.id);
          waiter(msg);
        }
      }
    });
  }
  request(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    this.child.stdin.write(payload);
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30000);
    });
  }
  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
}

function startServer() {
  const child = spawn("bun", [path.join(ROOT, "dist", "server.js")], {
    env: { ...process.env, FIGMA_RELAY_PORT: String(PORT) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  return child;
}

// Fake Figma plugin peer: joins the channel and answers export commands.
function startFakeFigma() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${PORT}`);
    const received = [];
    socket.on("error", reject);
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "join", channel: CHANNEL, clientType: "figma" }));
    });
    socket.on("message", (raw) => {
      const parsed = JSON.parse(String(raw));
      const msg = parsed?.message;
      if (!msg?.command) return;
      received.push(msg);
      if (msg.command === "join") {
        socket.send(
          JSON.stringify({
            type: "message",
            channel: CHANNEL,
            message: { id: msg.id, result: { channel: CHANNEL } },
          })
        );
        return;
      }
      if (msg.command !== "export_node_as_image") return;

      const p = msg.params;
      // stand in for the plugin rejecting a bad node id
      if (p.nodeId === "9:999") {
        socket.send(
          JSON.stringify({
            type: "message",
            channel: CHANNEL,
            message: { id: msg.id, error: "Node not found with ID: 9:999" },
          })
        );
        return;
      }
      const isSvg = String(p.format).toUpperCase() === "SVG";
      const payload = isSvg
        ? { format: "SVG", extension: "svg", mimeType: "image/svg+xml", encoding: "utf8", byteSize: SVG_TEXT.length, data: SVG_TEXT }
        : { format: "PNG", extension: "png", mimeType: "image/png", encoding: "base64", byteSize: PNG_1PX.length, data: PNG_1PX.toString("base64") };

      socket.send(
        JSON.stringify({
          type: "message",
          channel: CHANNEL,
          message: { id: msg.id, result: { nodeId: p.nodeId, ...payload } },
        })
      );
    });
    resolve({ socket, received });
  });
}

function textOf(response) {
  return (response.result?.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
function blocksOf(response, type) {
  return (response.result?.content || []).filter((c) => c.type === type);
}

// The server connects to the relay asynchronously at startup, so the first
// join_channel can land before the socket is open. Retry like a real client.
async function joinWithRetry(mcp, attempts = 20) {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    const res = await mcp.request("tools/call", {
      name: "join_channel",
      arguments: { channel: CHANNEL },
    });
    last = textOf(res);
    if (!/Not connected|Failed to join/.test(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`could not join channel: ${last}`);
}

async function main() {
  console.log("end-to-end export (real relay + real MCP server, fake Figma peer)");
  const relay = await startRelay();
  const figma = await startFakeFigma();
  const server = startServer();
  const mcp = new McpClient(server);

  let failed = 0;
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (error) {
      failed++;
      console.log(`  FAIL ${name}\n       ${error.message}`);
    }
  };

  try {
    await mcp.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1" },
    });
    mcp.notify("notifications/initialized", {});

    await check("tool advertises the new export options", async () => {
      const res = await mcp.request("tools/list", {});
      const tool = res.result.tools.find((t) => t.name === "export_node_as_image");
      assert.ok(tool, "tool missing");
      const props = Object.keys(tool.inputSchema.properties);
      for (const p of ["format", "scale", "width", "height", "suffix", "useAbsoluteBounds", "outputPath", "inlinePreview"]) {
        assert.ok(props.includes(p), `missing param ${p}`);
      }
      assert.ok(/JPEG/.test(JSON.stringify(tool.inputSchema)), "JPEG not accepted");
      assert.ok(/Detailed/.test(tool.description), "resampling limitation not stated");
    });

    await joinWithRetry(mcp);

    await check("export writes a real PNG file to disk", async () => {
      const outputPath = path.join(OUT_DIR, "nested", "shot.png");
      const res = await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: { nodeId: "54:170", format: "PNG", scale: 1, outputPath },
      });
      assert.ok(fs.existsSync(outputPath), `file not written to ${outputPath}`);
      assert.ok(fs.readFileSync(outputPath).equals(PNG_1PX), "bytes differ from what Figma sent");
      assert.ok(textOf(res).includes(outputPath), "path missing from response text");
    });

    await check("small export also comes back inline as an image", async () => {
      const res = await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: { nodeId: "54:170", format: "PNG", outputPath: path.join(OUT_DIR, "inline.png") },
      });
      const images = blocksOf(res, "image");
      assert.strictEqual(images.length, 1, "expected one inline image block");
      assert.strictEqual(images[0].mimeType, "image/png");
      assert.ok(Buffer.from(images[0].data, "base64").equals(PNG_1PX));
    });

    await check("inlinePreview false returns text only", async () => {
      const res = await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: { nodeId: "54:170", outputPath: path.join(OUT_DIR, "noinline.png"), inlinePreview: false },
      });
      assert.strictEqual(blocksOf(res, "image").length, 0, "inline image should be suppressed");
      assert.ok(textOf(res).length > 0);
    });

    await check("SVG export is written as utf8 text", async () => {
      const outputPath = path.join(OUT_DIR, "shot.svg");
      const res = await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: { nodeId: "54:519", format: "SVG", outputPath },
      });
      assert.strictEqual(fs.readFileSync(outputPath, "utf8"), SVG_TEXT);
      assert.strictEqual(blocksOf(res, "image").length, 0, "SVG should not inline");
    });

    await check("default output lands in ~/Downloads/figma-exports", async () => {
      const res = await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: { nodeId: "55:1", format: "PNG", inlinePreview: false },
      });
      const expected = path.join(os.homedir(), "Downloads", "figma-exports", "55_1.png");
      assert.ok(textOf(res).includes(expected), `expected ${expected} in: ${textOf(res)}`);
      assert.ok(fs.existsSync(expected), "default file was not created");
    });

    await check("suffix and nodeId sanitizing reach the filename", async () => {
      const outputPath = path.join(OUT_DIR, "with-suffix.png");
      await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: { nodeId: "a b:c*d", suffix: "-hero", outputPath },
      });
      assert.ok(fs.existsSync(outputPath), "suffix lost when outputPath given");
      const res = await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: { nodeId: "a b:c*d", suffix: "-hero", inlinePreview: false },
      });
      assert.ok(
        textOf(res).includes(path.join("figma-exports", "a_b_c_d-hero.png")),
        `unsanitized name: ${textOf(res)}`
      );
    });

    await check("params reach the plugin unchanged", async () => {
      figma.received.length = 0;
      await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: {
          nodeId: "54:170", format: "JPG", scale: 0.25, suffix: "-x",
          useAbsoluteBounds: true, outputPath: path.join(OUT_DIR, "p.png"),
        },
      });
      const cmd = figma.received.find((m) => m.command === "export_node_as_image");
      assert.ok(cmd, "plugin never received the command");
      assert.strictEqual(cmd.params.format, "JPG");
      assert.strictEqual(cmd.params.scale, 0.25);
      assert.strictEqual(cmd.params.suffix, "-x");
      assert.strictEqual(cmd.params.useAbsoluteBounds, true);
    });

    await check("plugin error surfaces as a message, not a hang", async () => {
      const started = Date.now();
      const res = await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: { nodeId: "9:999" },
      });
      assert.ok(/Error exporting node/.test(textOf(res)), textOf(res));
      assert.ok(/Node not found/.test(textOf(res)), textOf(res));
      assert.ok(!fs.existsSync(path.join(OUT_DIR, "nope.png")), "must not write a file on error");
      assert.ok(Date.now() - started < 20000, "error path should not wait for a timeout");
    });

    await check("unknown replies are ignored, connection stays usable", async () => {
      figma.socket.send(
        JSON.stringify({
          type: "message",
          channel: CHANNEL,
          message: { id: "does-not-exist", error: "stale reply" },
        })
      );
      const res = await mcp.request("tools/call", {
        name: "export_node_as_image",
        arguments: { nodeId: "54:170", outputPath: path.join(OUT_DIR, "after-stale.png") },
      });
      assert.ok(fs.existsSync(path.join(OUT_DIR, "after-stale.png")), "next export failed");
    });

    await check("other tools still work over the same relay", async () => {
      const res = await mcp.request("tools/call", { name: "join_channel", arguments: { channel: CHANNEL } });
      assert.ok(!/error/i.test(JSON.stringify(res.result)), JSON.stringify(res.result));
    });
  } finally {
    relay.kill();
    server.kill();
    figma.socket.close();
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }

  console.log(failed ? `\n${failed} failed` : "\nend-to-end export ok");
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error("harness failure:", error);
  process.exit(1);
});