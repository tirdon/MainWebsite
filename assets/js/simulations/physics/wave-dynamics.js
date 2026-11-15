import { resizeCanvas, isDark, runWhenVisible } from "../../core/runtime.js";
import { webgpuShared, FULLSCREEN_TRIANGLE_VS } from "../../core/webgpu.js";

(() => { // PHYSICS SIM 1: 2D Wave Dynamics
  const canvas = document.getElementById("waveSim");
  if (!canvas) return;

  const COLS = 200, ROWS = 130;
  const N = COLS * ROWS;
  const DAMPING = 0.996;
  const COURANT2 = 0.5; // (1/sqrt(2))^2

  const SOURCE_X = 4;
  const FREQ = 0.22;
  const AMP = 60;

  // Wall layout matches CPU index convention: walls[i * ROWS + j].
  const walls = new Uint8Array(N);
  (function buildWalls() {
    const wallX = Math.floor(COLS * 0.45);
    const slit1 = Math.floor(ROWS * 0.38);
    const slit2 = Math.floor(ROWS * 0.62);
    const half = 3;
    for (let j = 0; j < ROWS; j++) {
      const open = Math.abs(j - slit1) <= half || Math.abs(j - slit2) <= half;
      if (!open) {
        walls[wallX * ROWS + j] = 1;
        walls[(wallX + 1) * ROWS + j] = 1;
      }
    }
  })();

  function palette(dark) {
    return dark
      ? { bg: [18, 22, 30], pos: [232, 148, 74], neg: [61, 217, 193], wall: [70, 70, 78] }
      : { bg: [247, 244, 238], pos: [207, 107, 79], neg: [30, 111, 92], wall: [150, 150, 150] };
  }

  let started = false;

  function startCpu() {
    if (started) return;
    started = true;
    const ctx = canvas.getContext("2d");
    let W, H;
    let curr = new Float32Array(N);
    let prev = new Float32Array(N);
    const off = document.createElement("canvas");
    off.width = COLS; off.height = ROWS;
    const offCtx = off.getContext("2d");
    const imageData = offCtx.createImageData(COLS, ROWS);
    const pixels = new Uint32Array(imageData.data.buffer);
    let time = 0;

    function resize() { ({ W, H } = resizeCanvas(canvas)); }
    function drop(cx, cy, radius, force) {
      const r2 = radius * radius;
      const xmin = Math.max(1, cx - radius), xmax = Math.min(COLS - 1, cx + radius);
      const ymin = Math.max(1, cy - radius), ymax = Math.min(ROWS - 1, cy + radius);
      for (let x = xmin; x < xmax; x++) {
        for (let y = ymin; y < ymax; y++) {
          const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
          if (d2 < r2 && !walls[x * ROWS + y]) {
            curr[x * ROWS + y] += force * Math.exp(-d2 / (r2 * 0.4));
          }
        }
      }
    }
    let isDown = false;
    canvas.addEventListener("mousedown", (e) => { isDown = true; handleMouse(e); });
    canvas.addEventListener("mousemove", (e) => { if (isDown) handleMouse(e); });
    canvas.addEventListener("mouseup", () => (isDown = false));
    canvas.addEventListener("mouseleave", () => (isDown = false));
    canvas.addEventListener("touchstart", (e) => { isDown = true; handleTouch(e); }, { passive: true });
    canvas.addEventListener("touchmove", (e) => { if (isDown) handleTouch(e); }, { passive: true });
    canvas.addEventListener("touchend", () => (isDown = false));
    canvas.addEventListener("touchcancel", () => (isDown = false));
    function handleDrop(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const mx = ((clientX - rect.left) / W) * COLS;
      const my = ((clientY - rect.top) / H) * ROWS;
      drop(mx | 0, my | 0, 5, -90);
    }
    function handleMouse(e) { handleDrop(e.clientX, e.clientY); }
    function handleTouch(e) {
      for (let i = 0; i < e.touches.length; i++) {
        handleDrop(e.touches[i].clientX, e.touches[i].clientY);
      }
    }

    function loop() {
      const dark = isDark();
      time += 1;
      for (let i = 1; i < COLS - 1; i++) {
        const base = i * ROWS;
        const left = (i - 1) * ROWS;
        const right = (i + 1) * ROWS;
        for (let j = 1; j < ROWS - 1; j++) {
          const k = base + j;
          if (walls[k]) { curr[k] = 0; continue; }
          const lap = prev[left + j] + prev[right + j] + prev[base + j - 1] + prev[base + j + 1] - 4 * prev[k];
          curr[k] = (2 * prev[k] - curr[k] + COURANT2 * lap) * DAMPING;
        }
      }
      const ramp = Math.min(1, time / 120);
      const s = Math.sin(time * FREQ) * AMP * ramp;
      for (let j = 2; j < ROWS - 2; j++) curr[SOURCE_X * ROWS + j] = s;
      const p = palette(dark);
      const [bgR, bgG, bgB] = p.bg;
      const [pR, pG, pB] = p.pos;
      const [nR, nG, nB] = p.neg;
      const [wR, wG, wB] = p.wall;
      const wallColor = 0xff000000 | (wB << 16) | (wG << 8) | wR;
      for (let j = 0; j < ROWS; j++) {
        for (let i = 0; i < COLS; i++) {
          const k = i * ROWS + j;
          const pIdx = j * COLS + i;
          if (walls[k]) { pixels[pIdx] = wallColor; continue; }
          const v = curr[k];
          const mag = Math.min(1, Math.sqrt(Math.abs(v) / 80));
          let r, g, b;
          if (v >= 0) { r = bgR + (pR - bgR) * mag; g = bgG + (pG - bgG) * mag; b = bgB + (pB - bgB) * mag; }
          else { r = bgR + (nR - bgR) * mag; g = bgG + (nG - bgG) * mag; b = bgB + (nB - bgB) * mag; }
          pixels[pIdx] = 0xff000000 | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
        }
      }
      offCtx.putImageData(imageData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(off, 0, 0, W, H);
      const temp = prev; prev = curr; curr = temp;
    }
    resize();
    window.addEventListener("resize", resize);
    runWhenVisible(canvas, loop);
  }

  function startGpu(device, format) {
    if (started) return;

    // Build everything before touching the canvas context, so a failure here
    // still leaves the canvas free for the 2D fallback.
    const stateA = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const stateB = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const wallsBuf = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const wallsU32 = new Uint32Array(N);
    for (let k = 0; k < N; k++) wallsU32[k] = walls[k];
    device.queue.writeBuffer(wallsBuf, 0, wallsU32);

    const MAX_DROPS = 32;
    const dropsBuf = device.createBuffer({ size: MAX_DROPS * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const dropsCpu = new Float32Array(MAX_DROPS * 4);

    // StepParams: 10 scalars padded to 12 for 16-byte tail alignment.
    const stepBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const stepArray = new ArrayBuffer(48);
    const stepF32 = new Float32Array(stepArray);
    const stepU32 = new Uint32Array(stepArray);

    // RenderParams: 4 scalars (16B) + 4 × vec4 (64B) = 80B.
    const renderBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const renderArray = new ArrayBuffer(80);
    const renderF32 = new Float32Array(renderArray);
    const renderU32 = new Uint32Array(renderArray);
    renderU32[0] = COLS;
    renderU32[1] = ROWS;

    const stepWgsl = `
struct StepParams {
  cols: u32, rows: u32, sourceX: u32, dropCount: u32,
  time: f32, freq: f32, amp: f32, ramp: f32,
  damping: f32, courant2: f32, _p0: f32, _p1: f32,
};
struct Drop { x: f32, y: f32, radius: f32, force: f32 };
@group(0) @binding(0) var<storage, read> srcState: array<f32>;
@group(0) @binding(1) var<storage, read_write> dstState: array<f32>;
@group(0) @binding(2) var<storage, read> walls: array<u32>;
@group(0) @binding(3) var<uniform> sp: StepParams;
@group(0) @binding(4) var<storage, read> drops: array<Drop>;

@compute @workgroup_size(8, 8)
fn cs_step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  if (i >= sp.cols || j >= sp.rows) { return; }
  let k = i * sp.rows + j;
  if (i == 0u || j == 0u || i + 1u >= sp.cols || j + 1u >= sp.rows) {
    dstState[k] = 0.0;
    return;
  }
  if (walls[k] != 0u) {
    dstState[k] = 0.0;
    return;
  }
  var currOld = dstState[k];
  for (var d: u32 = 0u; d < sp.dropCount; d = d + 1u) {
    let dp = drops[d];
    let dx = f32(i) - dp.x;
    let dy = f32(j) - dp.y;
    let d2 = dx * dx + dy * dy;
    let r2 = dp.radius * dp.radius;
    if (d2 < r2) {
      currOld = currOld + dp.force * exp(-d2 / (r2 * 0.4));
    }
  }
  let prevK = srcState[k];
  let lap = srcState[(i - 1u) * sp.rows + j]
          + srcState[(i + 1u) * sp.rows + j]
          + srcState[i * sp.rows + (j - 1u)]
          + srcState[i * sp.rows + (j + 1u)]
          - 4.0 * prevK;
  var newVal = (2.0 * prevK - currOld + sp.courant2 * lap) * sp.damping;
  if (i == sp.sourceX && j >= 2u && j + 2u < sp.rows) {
    newVal = sin(sp.time * sp.freq) * sp.amp * sp.ramp;
  }
  dstState[k] = newVal;
}
`;
    const renderWgsl = `
struct RenderParams {
  cols: u32, rows: u32, fbW: f32, fbH: f32,
  bg: vec4<f32>, pos: vec4<f32>, neg: vec4<f32>, wall: vec4<f32>,
};
@group(0) @binding(0) var<storage, read> state: array<f32>;
@group(0) @binding(1) var<storage, read> walls: array<u32>;
@group(0) @binding(2) var<uniform> rp: RenderParams;

${FULLSCREEN_TRIANGLE_VS}

@fragment
fn fs_main(@builtin(position) fragPos: vec4<f32>) -> @location(0) vec4<f32> {
  let u = clamp(fragPos.x / rp.fbW, 0.0, 1.0);
  let v = clamp(fragPos.y / rp.fbH, 0.0, 1.0);
  let gxf = u * f32(rp.cols) - 0.5;
  let gyf = v * f32(rp.rows) - 0.5;
  let gx = clamp(gxf, 0.0, f32(rp.cols - 1u));
  let gy = clamp(gyf, 0.0, f32(rp.rows - 1u));
  let i0 = u32(floor(gx));
  let j0 = u32(floor(gy));
  let i1 = min(i0 + 1u, rp.cols - 1u);
  let j1 = min(j0 + 1u, rp.rows - 1u);
  let fx = gx - floor(gx);
  let fy = gy - floor(gy);
  let v00 = state[i0 * rp.rows + j0];
  let v10 = state[i1 * rp.rows + j0];
  let v01 = state[i0 * rp.rows + j1];
  let v11 = state[i1 * rp.rows + j1];
  let val = mix(mix(v00, v10, fx), mix(v01, v11, fx), fy);
  let ii = u32(round(gx));
  let jj = u32(round(gy));
  if (walls[ii * rp.rows + jj] != 0u) {
    return vec4<f32>(rp.wall.rgb, 1.0);
  }
  let mag = min(1.0, sqrt(abs(val) / 80.0));
  var color: vec3<f32>;
  if (val >= 0.0) {
    color = mix(rp.bg.rgb, rp.pos.rgb, mag);
  } else {
    color = mix(rp.bg.rgb, rp.neg.rgb, mag);
  }
  return vec4<f32>(color, 1.0);
}
`;
    const stepModule = device.createShaderModule({ code: stepWgsl });
    const renderModule = device.createShaderModule({ code: renderWgsl });

    const stepBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    const renderBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const stepPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [stepBgl] }),
      compute: { module: stepModule, entryPoint: "cs_step" },
    });
    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBgl] }),
      vertex: { module: renderModule, entryPoint: "vs_main" },
      fragment: { module: renderModule, entryPoint: "fs_main", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    const stepBgAB = device.createBindGroup({
      layout: stepBgl,
      entries: [
        { binding: 0, resource: { buffer: stateA } },
        { binding: 1, resource: { buffer: stateB } },
        { binding: 2, resource: { buffer: wallsBuf } },
        { binding: 3, resource: { buffer: stepBuf } },
        { binding: 4, resource: { buffer: dropsBuf } },
      ],
    });
    const stepBgBA = device.createBindGroup({
      layout: stepBgl,
      entries: [
        { binding: 0, resource: { buffer: stateB } },
        { binding: 1, resource: { buffer: stateA } },
        { binding: 2, resource: { buffer: wallsBuf } },
        { binding: 3, resource: { buffer: stepBuf } },
        { binding: 4, resource: { buffer: dropsBuf } },
      ],
    });
    const renderBgA = device.createBindGroup({
      layout: renderBgl,
      entries: [
        { binding: 0, resource: { buffer: stateA } },
        { binding: 1, resource: { buffer: wallsBuf } },
        { binding: 2, resource: { buffer: renderBuf } },
      ],
    });
    const renderBgB = device.createBindGroup({
      layout: renderBgl,
      entries: [
        { binding: 0, resource: { buffer: stateB } },
        { binding: 1, resource: { buffer: wallsBuf } },
        { binding: 2, resource: { buffer: renderBuf } },
      ],
    });

    // Commit the canvas to webgpu only after every other resource succeeded.
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("waveSim: getContext('webgpu') returned null");
    ctx.configure({ device, format, alphaMode: "premultiplied" });
    started = true;

    let cssW = 0, cssH = 0;
    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = rect.width, H = rect.height;
      const targetW = Math.max(1, Math.round(W * dpr));
      const targetH = Math.max(1, Math.round(H * dpr));
      if (canvas.width !== targetW || Math.abs(canvas.height - targetH) >= 150 * dpr || canvas.width === 0) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      cssW = W; cssH = H;
    }
    resize();
    window.addEventListener("resize", resize);

    // Drop queue (mouse drag).
    const pendingDrops = [];
    function queueDrop(cx, cy) {
      if (pendingDrops.length >= MAX_DROPS) pendingDrops.shift();
      pendingDrops.push({ x: cx, y: cy, radius: 5, force: -90 });
    }
    let isDown = false;
    canvas.addEventListener("mousedown", (e) => { isDown = true; handleMouse(e); });
    canvas.addEventListener("mousemove", (e) => { if (isDown) handleMouse(e); });
    canvas.addEventListener("mouseup", () => (isDown = false));
    canvas.addEventListener("mouseleave", () => (isDown = false));
    canvas.addEventListener("touchstart", (e) => { isDown = true; handleTouch(e); }, { passive: true });
    canvas.addEventListener("touchmove", (e) => { if (isDown) handleTouch(e); }, { passive: true });
    canvas.addEventListener("touchend", () => (isDown = false));
    canvas.addEventListener("touchcancel", () => (isDown = false));
    function handleDrop(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const mx = ((clientX - rect.left) / Math.max(1, cssW)) * COLS;
      const my = ((clientY - rect.top) / Math.max(1, cssH)) * ROWS;
      queueDrop(mx | 0, my | 0);
    }
    function handleMouse(e) { handleDrop(e.clientX, e.clientY); }
    function handleTouch(e) {
      for (let i = 0; i < e.touches.length; i++) {
        handleDrop(e.touches[i].clientX, e.touches[i].clientY);
      }
    }

    let time = 0;
    let parity = 0; // 0 → src=A, dst=B. 1 → src=B, dst=A.
    const dispatchX = Math.ceil(COLS / 8);
    const dispatchY = Math.ceil(ROWS / 8);

    function loop() {
      time += 1;
      const dropCount = pendingDrops.length;
      if (dropCount > 0) {
        for (let i = 0; i < dropCount; i++) {
          const d = pendingDrops[i];
          dropsCpu[i * 4]     = d.x;
          dropsCpu[i * 4 + 1] = d.y;
          dropsCpu[i * 4 + 2] = d.radius;
          dropsCpu[i * 4 + 3] = d.force;
        }
        device.queue.writeBuffer(dropsBuf, 0, dropsCpu, 0, dropCount * 4);
        pendingDrops.length = 0;
      }
      stepU32[0] = COLS;
      stepU32[1] = ROWS;
      stepU32[2] = SOURCE_X;
      stepU32[3] = dropCount;
      stepF32[4] = time;
      stepF32[5] = FREQ;
      stepF32[6] = AMP;
      stepF32[7] = Math.min(1, time / 120);
      stepF32[8] = DAMPING;
      stepF32[9] = COURANT2;
      device.queue.writeBuffer(stepBuf, 0, stepArray);

      const dark = isDark();
      const p = palette(dark);
      renderU32[0] = COLS;
      renderU32[1] = ROWS;
      renderF32[2] = canvas.width;
      renderF32[3] = canvas.height;
      // bg, pos, neg, wall at offsets 4, 8, 12, 16 (f32 indices)
      renderF32[4] = p.bg[0] / 255;   renderF32[5] = p.bg[1] / 255;   renderF32[6] = p.bg[2] / 255;   renderF32[7] = 1;
      renderF32[8] = p.pos[0] / 255;  renderF32[9] = p.pos[1] / 255;  renderF32[10] = p.pos[2] / 255; renderF32[11] = 1;
      renderF32[12] = p.neg[0] / 255; renderF32[13] = p.neg[1] / 255; renderF32[14] = p.neg[2] / 255; renderF32[15] = 1;
      renderF32[16] = p.wall[0] / 255; renderF32[17] = p.wall[1] / 255; renderF32[18] = p.wall[2] / 255; renderF32[19] = 1;
      device.queue.writeBuffer(renderBuf, 0, renderArray);

      const stepBg = parity === 0 ? stepBgAB : stepBgBA;
      const renderBg = parity === 0 ? renderBgB : renderBgA;

      const encoder = device.createCommandEncoder();
      const cpass = encoder.beginComputePass();
      cpass.setPipeline(stepPipeline);
      cpass.setBindGroup(0, stepBg);
      cpass.dispatchWorkgroups(dispatchX, dispatchY);
      cpass.end();
      const view = ctx.getCurrentTexture().createView();
      const rpass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      rpass.setPipeline(renderPipeline);
      rpass.setBindGroup(0, renderBg);
      rpass.draw(3);
      rpass.end();
      device.queue.submit([encoder.finish()]);

      parity ^= 1;
    }

    runWhenVisible(canvas, loop);
  }

  webgpuShared.ready.then((gpu) => {
    if (!gpu || webgpuShared.lost) { startCpu(); return; }
    try { startGpu(gpu.device, gpu.format); }
    catch (err) {
      console.warn("waveSim: WebGPU init failed, falling back to 2D", err);
      if (!started) startCpu();
    }
  });
})();
