// Probe the live plugin: is it running the new or old export handler?
const { spawn } = require("node:child_process");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");

class Mcp {
  constructor(child) {
    this.child = child; this.nextId = 1; this.pending = new Map(); this.buffer = "";
    child.stderr.resume();
    child.stdout.on("data", (c) => {
      this.buffer += c; let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).trim(); this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        const w = this.pending.get(m.id);
        if (w) { this.pending.delete(m.id); w(m); }
      }
    });
  }
  request(method, params, ms = 200000) {
    const id = this.nextId++;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((res, rej) => { this.pending.set(id, res);
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error("timeout")); }, ms); });
  }
  async call(name, args, ms) { return (await this.request("tools/call", { name, arguments: args }, ms)).result?.content || []; }
  static text(b) { return b.filter((c) => c.type === "text").map((c) => c.text).join("\n"); }
}

async function main() {
  const server = spawn("bun", [path.join(ROOT, "dist", "server.js")], {
    env: { ...process.env, FIGMA_RELAY_PORT: "3055" }, stdio: ["pipe", "pipe", "pipe"],
  });
  const mcp = new Mcp(server);
  await mcp.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } });
  mcp.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  for (let i = 0; i < 20; i++) {
    const t = Mcp.text(await mcp.call("join_channel", { channel: "figma" }));
    if (!/Not connected/.test(t)) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const args = process.argv.slice(2);
  const name = args[0];
  const params = JSON.parse(args[1] || "{}");
  const ms = Number(args[2] || 60000);
  const started = Date.now();
  try {
    const blocks = await mcp.call(name, params, ms);
    console.log(`\n${name} -> ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log("RAW:", JSON.stringify(blocks).slice(0, 600));
  } catch (e) {
    console.log(`\n${name} -> ${((Date.now() - started) / 1000).toFixed(1)}s  HARNESS: ${e.message}`);
  }
  server.kill();
  process.exit(0);
}
main();