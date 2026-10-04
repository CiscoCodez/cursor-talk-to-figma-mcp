// Live export test: new-build MCP server + the real Figma plugin, through the
// live relay on 3055. Exports only; never mutates the document.
// Run: bun run tests/live-export.test.js
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CHANNEL = process.env.FIGMA_TEST_CHANNEL || "figma";
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "figma-live-"));

class Mcp {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const w = this.pending.get(msg.id);
        if (w) {
          this.pending.delete(msg.id);
          w(msg);
        }
      }
    });
  }
  request(method, params, ms = 200000) {
    const id = this.nextId++;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out after ${ms}ms`));
      }, ms);
    });
  }
  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  async call(name, args) {
    const res = await this.request("tools/call", { name, arguments: args });
    return res.result?.content || [];
  }
}

function textOf(blocks) {
  return blocks.filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

// PNG/JPEG dimensions straight from the header, no image library needed.
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), kind: "png" };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), kind: "jpeg" };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return { kind: "unknown" };
}

let failed = 0;
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`  ok   ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

async function joinWithRetry(mcp) {
  let last = "";
  for (let i = 0; i < 24; i++) {
    const blocks = await mcp.call("join_channel", { channel: CHANNEL });
    last = textOf(blocks);
    if (!/Not connected|Failed to join/.test(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`could not join: ${last}`);
}

async function main() {
  console.log(`live export against real Figma (relay 3055, channel ${CHANNEL})`);
  const server = spawn("bun", [path.join(ROOT, "dist", "server.js")], {
    env: { ...process.env, FIGMA_RELAY_PORT: "3055" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const mcp = new Mcp(server);

  try {
    await mcp.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "live-export-test", version: "1" },
    });
    mcp.notify("notifications/initialized", {});
    console.log(`  join: ${await joinWithRetry(mcp)}\n`);

    // find real node ids to work with
    const docText = textOf(await mcp.call("get_document_info", {}));
    console.log(`  document: ${docText.split("\n").slice(0, 6).join(" | ").slice(0, 400)}\n`);

    const ids = [...new Set(docText.match(/\b\d+:\d+\b/g) || [])];
    const infoBlocks = await mcp.call("get_nodes_info", { nodeIds: ids.slice(0, 40) });
    const infoText = textOf(infoBlocks);
    const small = [];
    const imageFilled = [];
    for (const m of infoText.matchAll(
      /(\d+:\d+)[\s\S]{0,400}?(?:width|WIDTH)["']?\s*[:=]\s*([\d.]+)[\s\S]{0,200}?(?:height|HEIGHT)["']?\s*[:=]\s*([\d.]+)/g
    )) {
      const [, id, w, h] = m;
      const size = Number(w) * Number(h);
      if (Number(w) < 1200 && Number(h) < 1200) small.push({ id, w: Number(w), h: Number(h) });
      if (/IMAGE|image/i.test(m[0])) imageFilled.push(id);
    }
    const target = small[0];
    console.log(`  candidates: ${small.length} small nodes, target ${target ? `${target.id} (${target.w}x${target.h})` : "none"}\n`);
    if (!target) throw new Error("no small node found to export");

    let exported;

    await check("PNG export writes a valid file", async () => {
      const out = path.join(OUT_DIR, "a.png");
      const blocks = await mcp.call("export_node_as_image", { nodeId: target.id, format: "PNG", scale: 1, outputPath: out });
      assert.ok(fs.existsSync(out), `no file at ${out}: ${textOf(blocks)}`);
      const size = imageSize(out);
      assert.strictEqual(size.kind, "png", "not a PNG");
      exported = { size, bytes: fs.statSync(out).size };
      return `${size.width}x${size.height}, ${(exported.bytes / 1024).toFixed(0)} KiB`;
    });

    await check("scale actually changes output resolution", async () => {
      const out = path.join(OUT_DIR, "half.png");
      await mcp.call("export_node_as_image", { nodeId: target.id, format: "PNG", scale: 0.5, outputPath: out });
      const size = imageSize(out);
      assert.ok(exported, "run the first export first");
      assert.strictEqual(
        Math.round(size.width),
        Math.round(exported.size.width * 0.5),
        `expected ~${exported.size.width / 2} wide, got ${size.width}`
      );
      return `${size.width}x${size.height} vs ${exported.size.width}x${exported.size.height}`;
    });

    await check("width constraint is honored exactly", async () => {
      const out = path.join(OUT_DIR, "w.png");
      await mcp.call("export_node_as_image", { nodeId: target.id, format: "PNG", width: 320, outputPath: out });
      const size = imageSize(out);
      assert.strictEqual(size.width, 320, `expected 320 wide, got ${size.width}`);
      return `320 requested, ${size.width}x${size.height}`;
    });

    await check("JPG export writes a real JPEG", async () => {
      const out = path.join(OUT_DIR, "a.jpg");
      await mcp.call("export_node_as_image", { nodeId: target.id, format: "JPG", scale: 1, outputPath: out });
      const size = imageSize(out);
      assert.strictEqual(size.kind, "jpeg", "not a JPEG");
      return `${size.width}x${size.height}`;
    });

    await check("SVG export writes real SVG text", async () => {
      const out = path.join(OUT_DIR, "a.svg");
      await mcp.call("export_node_as_image", { nodeId: target.id, format: "SVG", outputPath: out });
      const head = fs.readFileSync(out, "utf8").slice(0, 200);
      assert.ok(/<svg/i.test(head), `not svg: ${head}`);
      return `${(fs.statSync(out).size / 1024).toFixed(0)} KiB`;
    });

    await check("PDF export writes a real PDF", async () => {
      const out = path.join(OUT_DIR, "a.pdf");
      await mcp.call("export_node_as_image", { nodeId: target.id, format: "PDF", outputPath: out });
      const head = fs.readFileSync(out).slice(0, 5).toString();
      assert.strictEqual(head, "%PDF-", `not a pdf: ${head}`);
      return `${(fs.statSync(out).size / 1024).toFixed(0)} KiB`;
    });

    await check("image-filled node exports (the originally reported failure)", async () => {
      // 54:170 is the CiscoCodes sprite from the original bug report
      let checked = 0;
      for (const id of ["54:170", "54:519"]) {
        const out = path.join(OUT_DIR, `sprite-${id.replace(":", "_")}.png`);
        const blocks = await mcp.call(
          "export_node_as_image",
          { nodeId: id, format: "PNG", scale: 1, outputPath: out, inlinePreview: false },
          60000
        );
        if (!fs.existsSync(out)) {
          // the node may have been deleted since the bug report; that is a
          // correct answer, not a failure, so long as it came back fast
          const err = textOf(blocks);
          assert.ok(/Node not found/.test(err), `${id} failed: ${err}`);
          console.log(`         ${id} skipped, no longer in the document`);
          continue;
        }
        const size = imageSize(out);
        assert.strictEqual(size.kind, "png", `${id} is not a PNG`);
        checked++;
        console.log(`         ${id} -> ${size.width}x${size.height}, ${(fs.statSync(out).size / 1024).toFixed(0)} KiB`);
      }
      assert.ok(checked > 0, "no image-filled node was actually exported");
    });

    await check("bad node id errors fast instead of hanging", async () => {
      const started = Date.now();
      const out = path.join(OUT_DIR, "bad.png");
      const blocks = await mcp.call("export_node_as_image", { nodeId: "999:99999", format: "PNG", outputPath: out });
      const elapsed = Date.now() - started;
      assert.ok(/Error exporting/.test(textOf(blocks)), textOf(blocks));
      assert.ok(!fs.existsSync(out), "must not write a file on error");
      assert.ok(elapsed < 30000, `took ${elapsed}ms`);
      return `${elapsed}ms`;
    });

    await check("bridge still healthy after all exports", async () => {
      const res = await mcp.call("get_document_info", {});
      assert.ok(textOf(res).length > 0, "document info came back empty");
      return "get_document_info ok";
    });
  } finally {
    server.kill();
    if (!process.env.FIGMA_TEST_KEEP) fs.rmSync(OUT_DIR, { recursive: true, force: true });
    else console.log(`\nartifacts kept in ${OUT_DIR}`);
  }

  console.log(failed ? `\n${failed} failed` : "\nlive export ok");
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error("harness failure:", error.message);
  process.exit(1);
});