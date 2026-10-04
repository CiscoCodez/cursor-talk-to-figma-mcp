// Automated export checks for the Figma plugin handler.
// Run: bun run tests/plugin-export.test.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const code = fs.readFileSync(
  path.join(__dirname, "..", "src", "cursor_mcp_plugin", "code.js"),
  "utf8"
);

function pngBytes(sizeBytes) {
  const bytes = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) bytes[i] = i % 251;
  return bytes;
}

function stubFigma(nodes) {
  return {
    command: "show-ui",
    showUI() {},
    notify() {},
    closePlugin() {},
    clientStorage: { getAsync: async () => ({}), setAsync: async () => {} },
    ui: { postMessage() {}, hide() {}, show() {}, onmessage: null },
    on() {},
    currentPage: { selection: [] },
    getNodeByIdAsync: async (id) => nodes[id] ?? null,
  };
}

// Load code.js against a stubbed Figma global and hand back exportNodeAsImage.
function loadExport(nodes) {
  const load = new Function(
    "figma",
    "__html__",
    `${code}\nreturn exportNodeAsImage;`
  );
  return load(stubFigma(nodes), "");
}

// Node whose exportAsync records the settings it was handed.
function recordingNode(bytesFactory) {
  const node = {
    settings: null,
    exportAsync: async (settings) => {
      node.settings = settings;
      return bytesFactory();
    },
  };
  return node;
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

async function main() {
  console.log("plugin export handler");

  await check("format is honored (PNG/JPG/JPEG/SVG/PDF)", async () => {
    const formats = ["PNG", "JPG", "JPEG", "SVG", "PDF"];
    const nodes = {};
    for (const f of formats) nodes[f] = recordingNode(() => pngBytes(64));

    const expected = ["PNG", "JPG", "JPG", "SVG_STRING", "PDF"];
    const expectedResult = ["PNG", "JPG", "JPG", "SVG", "PDF"];
    for (let i = 0; i < formats.length; i++) {
      const exportNodeAsImage = loadExport(nodes);
      const res = await exportNodeAsImage({ nodeId: formats[i], format: formats[i] });
      assert.strictEqual(
        nodes[formats[i]].settings.format,
        expected[i],
        `${formats[i]} must not silently fall back to PNG`
      );
      assert.strictEqual(res.format, expectedResult[i], `${formats[i]} reported format`);
    }
  });

  await check("mime types and extensions are right", async () => {
    const want = {
      PNG: ["image/png", "png"],
      JPG: ["image/jpeg", "jpg"],
      SVG: ["image/svg+xml", "svg"],
      PDF: ["application/pdf", "pdf"],
    };
    for (const [format, [mime, ext]] of Object.entries(want)) {
      const nodes = { a: recordingNode(() => pngBytes(16)) };
      const exportNodeAsImage = loadExport(nodes);
      const res = await exportNodeAsImage({ nodeId: "a", format });
      assert.strictEqual(res.mimeType, mime, `${format} mime`);
      assert.strictEqual(res.extension, ext, `${format} extension`);
    }
  });

  await check("defaults to PNG at scale 1", async () => {
    const nodes = { a: recordingNode(() => pngBytes(8)) };
    const exportNodeAsImage = loadExport(nodes);
    const res = await exportNodeAsImage({ nodeId: "a" });
    assert.strictEqual(nodes.a.settings.format, "PNG");
    assert.deepStrictEqual(nodes.a.settings.constraint, { type: "SCALE", value: 1 });
    assert.strictEqual(res.encoding, "base64");
  });

  await check("scale / width / height constraints, correct precedence", async () => {
    const nodes = { a: recordingNode(() => pngBytes(8)) };
    const exportNodeAsImage = loadExport(nodes);

    await exportNodeAsImage({ nodeId: "a", scale: 0.25 });
    assert.deepStrictEqual(nodes.a.settings.constraint, { type: "SCALE", value: 0.25 });

    await exportNodeAsImage({ nodeId: "a", width: 800, height: 400, scale: 2 });
    assert.deepStrictEqual(nodes.a.settings.constraint, { type: "WIDTH", value: 800 });

    await exportNodeAsImage({ nodeId: "a", height: 400 });
    assert.deepStrictEqual(nodes.a.settings.constraint, { type: "HEIGHT", value: 400 });
  });

  await check("suffix only reaches image formats", async () => {
    const nodes = { a: recordingNode(() => pngBytes(8)) };
    const exportNodeAsImage = loadExport(nodes);

    await exportNodeAsImage({ nodeId: "a", suffix: "-hero" });
    assert.strictEqual(nodes.a.settings.suffix, "-hero");

    await exportNodeAsImage({ nodeId: "a", format: "PDF" });
    assert.ok(!("suffix" in nodes.a.settings), "PDF must not carry suffix");

    await exportNodeAsImage({ nodeId: "a", format: "SVG" });
    assert.ok(!("suffix" in nodes.a.settings), "SVG must not carry suffix");
  });

  await check("useAbsoluteBounds reaches SVG and PDF only", async () => {
    const nodes = { a: recordingNode(() => pngBytes(8)) };
    const exportNodeAsImage = loadExport(nodes);

    for (const format of ["SVG", "PDF"]) {
      await exportNodeAsImage({ nodeId: "a", format, useAbsoluteBounds: true });
      assert.strictEqual(nodes.a.settings.useAbsoluteBounds, true, format);
    }
    for (const format of ["PNG", "JPG"]) {
      await exportNodeAsImage({ nodeId: "a", format, useAbsoluteBounds: true });
      assert.ok(!("useAbsoluteBounds" in nodes.a.settings), `${format} must ignore it`);
    }
  });

  await check("SVG_STRING returns text, not base64", async () => {
    const svg = '<svg width="10" height="10"></svg>';
    const nodes = { a: recordingNode(() => svg) };
    const exportNodeAsImage = loadExport(nodes);
    const res = await exportNodeAsImage({ nodeId: "a", format: "SVG" });
    assert.strictEqual(res.encoding, "utf8");
    assert.strictEqual(res.data, svg);
    assert.strictEqual(res.byteSize, svg.length);
  });

  await check("1 MiB base64 payload round-trips byte-exact", async () => {
    const nodes = { a: recordingNode(() => pngBytes(1024 * 1024)) };
    const exportNodeAsImage = loadExport(nodes);
    const res = await exportNodeAsImage({ nodeId: "a", format: "PNG", scale: 1 });
    assert.strictEqual(res.byteSize, 1024 * 1024);
    assert.deepStrictEqual(
      Buffer.from(res.data, "base64"),
      Buffer.from(pngBytes(1024 * 1024))
    );
  });

  await check("bogus node id errors immediately, no hang", async () => {
    const exportNodeAsImage = loadExport({});
    const started = Date.now();
    await assert.rejects(() => exportNodeAsImage({ nodeId: "9:999" }), /Node not found/);
    assert.ok(Date.now() - started < 1000, "must not hang");
  });

  await check("missing nodeId and unsupported format error", async () => {
    const nodes = { a: recordingNode(() => pngBytes(8)) };
    const exportNodeAsImage = loadExport(nodes);
    await assert.rejects(() => exportNodeAsImage({}), /Missing nodeId/);
    await assert.rejects(
      () => exportNodeAsImage({ nodeId: "a", format: "WEBP" }),
      /Unsupported export format/
    );
  });

  await check("oversized export errors instead of hanging", async () => {
    // fake the ceiling breach without allocating 256 MiB
    const nodes = {
      a: { exportAsync: async () => ({ byteLength: 512 * 1024 * 1024 }) },
    };
    const exportNodeAsImage = loadExport(nodes);
    await assert.rejects(
      () => exportNodeAsImage({ nodeId: "a" }),
      /over the .* byte plugin limit/
    );
  });

  await check("node that cannot be exported reports clearly", async () => {
    const exportNodeAsImage = loadExport({ a: {} });
    await assert.rejects(
      () => exportNodeAsImage({ nodeId: "a" }),
      /does not support exporting/
    );
  });

  await check("Section fails fast for raster formats, SVG still allowed", async () => {
    const nodes = {
      s: { type: "SECTION", name: "AstralSwords", exportAsync: async () => pngBytes(8) },
      f: { type: "FRAME", name: "Cover", exportAsync: async () => pngBytes(8) },
    };
    const exportNodeAsImage = loadExport(nodes);
    for (const format of ["PNG", "JPG", "PDF"]) {
      const started = Date.now();
      await assert.rejects(
        () => exportNodeAsImage({ nodeId: "s", format }),
        /is a Section, which Figma cannot export as/,
        format
      );
      assert.ok(Date.now() - started < 1000, `${format} must not hang`);
    }
    // SVG is allowed on a section
    await exportNodeAsImage({ nodeId: "s", format: "SVG" });
    // and ordinary frames are untouched
    const res = await exportNodeAsImage({ nodeId: "f", format: "PNG" });
    assert.strictEqual(res.format, "PNG");
  });

  await check("dispatcher routes export_node_as_image to the handler", async () => {
    const nodes = { a: recordingNode(() => pngBytes(8)) };
    const handleCommand = new Function(
      "figma",
      "__html__",
      `${code}\nreturn handleCommand;`
    )(stubFigma(nodes), "");
    const res = await handleCommand("export_node_as_image", {
      nodeId: "a",
      format: "JPG",
    });
    assert.strictEqual(res.format, "JPG");
    assert.strictEqual(nodes.a.settings.format, "JPG");
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main();