// ════════════════════════════════════
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

// ════════════════════════════════════
(() => { // PHYSICS SIM 2: Reaction-Diffusion (Gray-Scott)
  const canvas = document.getElementById("reactionSim");
  if (!canvas) return;

  const GW = 120, GH = 80;
  const Du = 0.16, Dv = 0.08;
  const F = 0.040, K = 0.060;
  const RD_DT = 1.0;
  const SUBSTEPS = 6;
  const SEED_RADIUS = 3;
  const INITIAL_SEEDS = [
    [Math.floor(GW / 2), Math.floor(GH / 2)],
    [Math.floor(GW / 4), Math.floor(GH / 3)],
    [Math.floor((3 * GW) / 4), Math.floor((2 * GH) / 3)],
  ];

  function palette(dark) {
    return dark
      ? { bg: [0, 20, 30], fg: [61, 217, 193] }
      : { bg: [245, 239, 230], fg: [70, 25, 15] };
  }

  let started = false;

  function startCpu() {
    if (started) return;
    started = true;
    const ctx = canvas.getContext("2d");
    let W, H;
    let U, V, nU, nV;
    const off = document.createElement("canvas");
    off.width = GW; off.height = GH;
    const offCtx = off.getContext("2d");

    function resize() { ({ W, H } = resizeCanvas(canvas)); }
    function alloc() {
      U = []; V = []; nU = []; nV = [];
      for (let i = 0; i < GW; i++) {
        U[i] = new Float32Array(GH);
        V[i] = new Float32Array(GH);
        nU[i] = new Float32Array(GH);
        nV[i] = new Float32Array(GH);
        for (let j = 0; j < GH; j++) U[i][j] = 1.0;
      }
    }
    function seed(cx, cy) {
      for (let di = -SEED_RADIUS; di <= SEED_RADIUS; di++) {
        for (let dj = -SEED_RADIUS; dj <= SEED_RADIUS; dj++) {
          const gi = ((cx + di + GW) % GW) | 0;
          const gj = ((cy + dj + GH) % GH) | 0;
          U[gi][gj] = 0.5;
          V[gi][gj] = 0.25 + Math.random() * 0.01;
        }
      }
    }
    resize();
    alloc();
    for (const [sx, sy] of INITIAL_SEEDS) seed(sx, sy);

    let isDragging = false;
    canvas.addEventListener("mousedown", (e) => { isDragging = true; handle(e); });
    canvas.addEventListener("mousemove", (e) => { if (isDragging) handle(e); });
    canvas.addEventListener("mouseup", () => (isDragging = false));
    canvas.addEventListener("mouseleave", () => (isDragging = false));
    canvas.addEventListener("touchstart", (e) => { isDragging = true; handleTouch(e); }, { passive: true });
    canvas.addEventListener("touchmove", (e) => { if (isDragging) handleTouch(e); }, { passive: true });
    canvas.addEventListener("touchend", () => (isDragging = false));
    canvas.addEventListener("touchcancel", () => (isDragging = false));
    function handleSeed(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      seed((((clientX - rect.left) / W) * GW) | 0, (((clientY - rect.top) / H) * GH) | 0);
    }
    function handle(e) { handleSeed(e.clientX, e.clientY); }
    function handleTouch(e) {
      for (let i = 0; i < e.touches.length; i++) {
        handleSeed(e.touches[i].clientX, e.touches[i].clientY);
      }
    }

    function loop() {
      const dark = isDark();
      for (let step = 0; step < SUBSTEPS; step++) {
        for (let i = 0; i < GW; i++) {
          const ip = (i + 1) % GW, im = (i - 1 + GW) % GW;
          for (let j = 0; j < GH; j++) {
            const jp = (j + 1) % GH, jm = (j - 1 + GH) % GH;
            const lapU = U[ip][j] + U[im][j] + U[i][jp] + U[i][jm] - 4 * U[i][j];
            const lapV = V[ip][j] + V[im][j] + V[i][jp] + V[i][jm] - 4 * V[i][j];
            const uvv = U[i][j] * V[i][j] * V[i][j];
            nU[i][j] = U[i][j] + RD_DT * (Du * lapU - uvv + F * (1 - U[i][j]));
            nV[i][j] = V[i][j] + RD_DT * (Dv * lapV + uvv - (F + K) * V[i][j]);
          }
        }
        let t;
        t = U; U = nU; nU = t;
        t = V; V = nV; nV = t;
      }
      const imageData = offCtx.createImageData(GW, GH);
      const data = imageData.data;
      for (let j = 0; j < GH; j++) {
        for (let i = 0; i < GW; i++) {
          const v = V[i][j];
          const idx = (j * GW + i) * 4;
          if (dark) {
            data[idx] = (v * 61) | 0;
            data[idx + 1] = (v * 217 + (1 - v) * 20) | 0;
            data[idx + 2] = (v * 193 + (1 - v) * 30) | 0;
          } else {
            data[idx] = (v * 70 + (1 - v) * 245) | 0;
            data[idx + 1] = (v * 25 + (1 - v) * 239) | 0;
            data[idx + 2] = (v * 15 + (1 - v) * 230) | 0;
          }
          data[idx + 3] = 255;
        }
      }
      offCtx.putImageData(imageData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, W, H);
    }

    window.addEventListener("resize", resize);
    runWhenVisible(canvas, loop);
  }

  function startGpu(device, format) {
    if (started) return;
    const N = GW * GH;
    const STATE_BYTES = N * 8; // vec2<f32> per cell

    const stateA = device.createBuffer({ size: STATE_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const stateB = device.createBuffer({ size: STATE_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    // Initial: U=1.0, V=0.0 everywhere. We write to A; B starts at zero but is
    // overwritten in the first substep.
    const initState = new Float32Array(N * 2);
    for (let k = 0; k < N; k++) initState[k * 2] = 1.0;
    device.queue.writeBuffer(stateA, 0, initState);

    const stepParamsBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    {
      const ab = new ArrayBuffer(48);
      const f32 = new Float32Array(ab);
      const u32 = new Uint32Array(ab);
      u32[0] = GW; u32[1] = GH;
      f32[4] = Du; f32[5] = Dv; f32[6] = F; f32[7] = K;
      f32[8] = RD_DT;
      device.queue.writeBuffer(stepParamsBuf, 0, ab);
    }

    const MAX_SEEDS = 16;
    const seedsBuf = device.createBuffer({ size: MAX_SEEDS * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const seedsCpu = new Uint32Array(MAX_SEEDS * 2);
    const seedParamsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const seedParamsArr = new Uint32Array(4);
    seedParamsArr[0] = GW; seedParamsArr[1] = GH;

    const renderBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const renderArray = new ArrayBuffer(48);
    const renderF32 = new Float32Array(renderArray);
    const renderU32 = new Uint32Array(renderArray);
    renderU32[0] = GW; renderU32[1] = GH;

    const stepWgsl = `
struct P {
  gw: u32, gh: u32, _p0: u32, _p1: u32,
  Du: f32, Dv: f32, F: f32, K: f32,
  dt: f32, _p2: f32, _p3: f32, _p4: f32,
};
@group(0) @binding(0) var<storage, read> src: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> dst: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> p: P;

@compute @workgroup_size(8, 8)
fn cs_step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  if (i >= p.gw || j >= p.gh) { return; }
  let k = i * p.gh + j;
  let ip = (i + 1u) % p.gw;
  let im = (i + p.gw - 1u) % p.gw;
  let jp = (j + 1u) % p.gh;
  let jm = (j + p.gh - 1u) % p.gh;
  let c   = src[k];
  let cp  = src[ip * p.gh + j];
  let cm  = src[im * p.gh + j];
  let cjp = src[i * p.gh + jp];
  let cjm = src[i * p.gh + jm];
  let lap = cp + cm + cjp + cjm - 4.0 * c;
  let uvv = c.x * c.y * c.y;
  let newU = c.x + p.dt * (p.Du * lap.x - uvv + p.F * (1.0 - c.x));
  let newV = c.y + p.dt * (p.Dv * lap.y + uvv - (p.F + p.K) * c.y);
  dst[k] = vec2<f32>(newU, newV);
}
`;
    const seedWgsl = `
struct Seed { x: u32, y: u32 };
struct SP { gw: u32, gh: u32, seedCount: u32, _p: u32 };
@group(0) @binding(0) var<storage, read_write> state: array<vec2<f32>>;
@group(0) @binding(1) var<uniform> sp: SP;
@group(0) @binding(2) var<storage, read> seeds: array<Seed>;

fn hash21(q: vec2<f32>) -> f32 {
  let h = dot(q, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
}

@compute @workgroup_size(7, 7, 1)
fn cs_seed(@builtin(global_invocation_id) gid: vec3<u32>) {
  let s = gid.z;
  if (s >= sp.seedCount) { return; }
  let seed = seeds[s];
  let di = i32(gid.x) - 3;
  let dj = i32(gid.y) - 3;
  let i = u32((i32(seed.x) + di + i32(sp.gw)) % i32(sp.gw));
  let j = u32((i32(seed.y) + dj + i32(sp.gh)) % i32(sp.gh));
  let k = i * sp.gh + j;
  let r = hash21(vec2<f32>(f32(i), f32(j))) * 0.01;
  state[k] = vec2<f32>(0.5, 0.25 + r);
}
`;
    const renderWgsl = `
struct RP {
  gw: u32, gh: u32, fbW: f32, fbH: f32,
  bg: vec4<f32>, fg: vec4<f32>,
};
@group(0) @binding(0) var<storage, read> state: array<vec2<f32>>;
@group(0) @binding(1) var<uniform> rp: RP;

${FULLSCREEN_TRIANGLE_VS}

@fragment
fn fs_main(@builtin(position) fragPos: vec4<f32>) -> @location(0) vec4<f32> {
  let u = clamp(fragPos.x / rp.fbW, 0.0, 1.0);
  let v = clamp(fragPos.y / rp.fbH, 0.0, 1.0);
  let i = min(u32(u * f32(rp.gw)), rp.gw - 1u);
  let j = min(u32(v * f32(rp.gh)), rp.gh - 1u);
  let vv = clamp(state[i * rp.gh + j].y, 0.0, 1.0);
  let color = mix(rp.bg.rgb, rp.fg.rgb, vv);
  return vec4<f32>(color, 1.0);
}
`;
    const stepModule = device.createShaderModule({ code: stepWgsl });
    const seedModule = device.createShaderModule({ code: seedWgsl });
    const renderModule = device.createShaderModule({ code: renderWgsl });

    const stepBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const seedBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    const renderBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const stepPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [stepBgl] }),
      compute: { module: stepModule, entryPoint: "cs_step" },
    });
    const seedPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [seedBgl] }),
      compute: { module: seedModule, entryPoint: "cs_seed" },
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
        { binding: 2, resource: { buffer: stepParamsBuf } },
      ],
    });
    const stepBgBA = device.createBindGroup({
      layout: stepBgl,
      entries: [
        { binding: 0, resource: { buffer: stateB } },
        { binding: 1, resource: { buffer: stateA } },
        { binding: 2, resource: { buffer: stepParamsBuf } },
      ],
    });
    // Seeds always target stateA (the "latest" buffer at frame start).
    const seedBg = device.createBindGroup({
      layout: seedBgl,
      entries: [
        { binding: 0, resource: { buffer: stateA } },
        { binding: 1, resource: { buffer: seedParamsBuf } },
        { binding: 2, resource: { buffer: seedsBuf } },
      ],
    });
    const renderBgA = device.createBindGroup({
      layout: renderBgl,
      entries: [
        { binding: 0, resource: { buffer: stateA } },
        { binding: 1, resource: { buffer: renderBuf } },
      ],
    });

    // Commit canvas only after every fallible setup step succeeded.
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("reactionSim: getContext('webgpu') returned null");
    ctx.configure({ device, format, alphaMode: "premultiplied" });
    started = true;

    let cssW = 0, cssH = 0;
    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = rect.width, H = rect.height;
      const tW = Math.max(1, Math.round(W * dpr));
      const tH = Math.max(1, Math.round(H * dpr));
      if (canvas.width !== tW || Math.abs(canvas.height - tH) >= 150 * dpr || canvas.width === 0) {
        canvas.width = tW;
        canvas.height = tH;
      }
      cssW = W; cssH = H;
    }
    resize();
    window.addEventListener("resize", resize);

    // Queue the initial seeds; the first frame will run cs_seed on stateA.
    const pendingSeeds = INITIAL_SEEDS.map(([x, y]) => ({ x, y }));
    function queueSeed(cx, cy) {
      if (pendingSeeds.length >= MAX_SEEDS) pendingSeeds.shift();
      pendingSeeds.push({ x: cx | 0, y: cy | 0 });
    }
    let isDragging = false;
    canvas.addEventListener("mousedown", (e) => { isDragging = true; handle(e); });
    canvas.addEventListener("mousemove", (e) => { if (isDragging) handle(e); });
    canvas.addEventListener("mouseup", () => (isDragging = false));
    canvas.addEventListener("mouseleave", () => (isDragging = false));
    canvas.addEventListener("touchstart", (e) => { isDragging = true; handleTouch(e); }, { passive: true });
    canvas.addEventListener("touchmove", (e) => { if (isDragging) handleTouch(e); }, { passive: true });
    canvas.addEventListener("touchend", () => (isDragging = false));
    canvas.addEventListener("touchcancel", () => (isDragging = false));
    function handleSeed(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      queueSeed(((clientX - rect.left) / Math.max(1, cssW)) * GW, ((clientY - rect.top) / Math.max(1, cssH)) * GH);
    }
    function handle(e) { handleSeed(e.clientX, e.clientY); }
    function handleTouch(e) {
      for (let i = 0; i < e.touches.length; i++) {
        handleSeed(e.touches[i].clientX, e.touches[i].clientY);
      }
    }

    const dispatchX = Math.ceil(GW / 8);
    const dispatchY = Math.ceil(GH / 8);

    function loop() {
      const seedCount = Math.min(MAX_SEEDS, pendingSeeds.length);
      if (seedCount > 0) {
        for (let i = 0; i < seedCount; i++) {
          seedsCpu[i * 2]     = pendingSeeds[i].x;
          seedsCpu[i * 2 + 1] = pendingSeeds[i].y;
        }
        device.queue.writeBuffer(seedsBuf, 0, seedsCpu, 0, seedCount * 2);
        pendingSeeds.length = 0;
      }
      seedParamsArr[2] = seedCount;
      device.queue.writeBuffer(seedParamsBuf, 0, seedParamsArr);

      const dark = isDark();
      const p = palette(dark);
      renderU32[0] = GW;
      renderU32[1] = GH;
      renderF32[2] = canvas.width;
      renderF32[3] = canvas.height;
      renderF32[4] = p.bg[0] / 255; renderF32[5] = p.bg[1] / 255; renderF32[6] = p.bg[2] / 255; renderF32[7] = 1;
      renderF32[8] = p.fg[0] / 255; renderF32[9] = p.fg[1] / 255; renderF32[10] = p.fg[2] / 255; renderF32[11] = 1;
      device.queue.writeBuffer(renderBuf, 0, renderArray);

      const encoder = device.createCommandEncoder();
      if (seedCount > 0) {
        const cpass = encoder.beginComputePass();
        cpass.setPipeline(seedPipeline);
        cpass.setBindGroup(0, seedBg);
        cpass.dispatchWorkgroups(1, 1, seedCount);
        cpass.end();
      }
      const cpass = encoder.beginComputePass();
      cpass.setPipeline(stepPipeline);
      // 6 substeps end on stateA (even count) so render always reads A.
      for (let s = 0; s < SUBSTEPS; s++) {
        cpass.setBindGroup(0, s % 2 === 0 ? stepBgAB : stepBgBA);
        cpass.dispatchWorkgroups(dispatchX, dispatchY);
      }
      cpass.end();
      const view = ctx.getCurrentTexture().createView();
      const rpass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      rpass.setPipeline(renderPipeline);
      rpass.setBindGroup(0, renderBgA);
      rpass.draw(3);
      rpass.end();
      device.queue.submit([encoder.finish()]);
    }

    runWhenVisible(canvas, loop);
  }

  webgpuShared.ready.then((gpu) => {
    if (!gpu || webgpuShared.lost) { startCpu(); return; }
    try { startGpu(gpu.device, gpu.format); }
    catch (err) {
      console.warn("reactionSim: WebGPU init failed, falling back to 2D", err);
      if (!started) startCpu();
    }
  });
})();

// ════════════════════════════════════
(() => { // PHYSICS SIM 3: Ising Model (2D Spin Lattice)
  const canvas = document.getElementById("isingSim");
  if (!canvas) return;

  const GRID = 64;
  const J_COUPLING = 1;
  const TEMPS = [0.5, 2.27, 5.0]; // cold, critical (Tc ≈ 2.269), hot
  const HOT_T = 5.0;
  const HEAT_RADIUS2 = 1600; // 40 CSS px

  function palette(dark) {
    return dark
      ? { up: [232, 148, 74], down: [26, 26, 46] }
      : { up: [207, 107, 79], down: [245, 239, 230] };
  }

  let started = false;

  function startCpu() {
    if (started) return;
    started = true;
    const ctx = canvas.getContext("2d");
    let W, H;
    const spins = [];
    let tempMode = 1;
    let T = TEMPS[tempMode];
    let mouseX = null, mouseY = null;
    const off = document.createElement("canvas");
    off.width = GRID; off.height = GRID;
    const offCtx = off.getContext("2d");

    function resize() { ({ W, H } = resizeCanvas(canvas)); }
    function init() {
      resize();
      spins.length = 0;
      for (let i = 0; i < GRID; i++) {
        spins[i] = new Int8Array(GRID);
        for (let j = 0; j < GRID; j++) spins[i][j] = Math.random() < 0.5 ? 1 : -1;
      }
    }
    init();

    canvas.addEventListener("click", () => {
      tempMode = (tempMode + 1) % 3;
      T = TEMPS[tempMode];
    });
    function handleMove(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      mouseX = clientX - rect.left;
      mouseY = clientY - rect.top;
    }
    canvas.addEventListener("mousemove", (e) => handleMove(e.clientX, e.clientY));
    canvas.addEventListener("touchstart", (e) => { if(e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    canvas.addEventListener("touchmove", (e) => { if(e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    canvas.addEventListener("mouseleave", () => { mouseX = null; mouseY = null; });
    canvas.addEventListener("touchend", () => { mouseX = null; mouseY = null; });
    canvas.addEventListener("touchcancel", () => { mouseX = null; mouseY = null; });

    function loop() {
      const dark = isDark();
      const cellW = W / GRID;
      const cellH = H / GRID;
      const steps = GRID * GRID;
      for (let s = 0; s < steps; s++) {
        const i = (Math.random() * GRID) | 0;
        const j = (Math.random() * GRID) | 0;
        let localT = T;
        if (mouseX !== null) {
          const dx = (i + 0.5) * cellW - mouseX;
          const dy = (j + 0.5) * cellH - mouseY;
          if (dx * dx + dy * dy < HEAT_RADIUS2) localT = Math.max(localT, HOT_T);
        }
        const spin = spins[i][j];
        const nb = spins[(i + 1) % GRID][j] + spins[(i - 1 + GRID) % GRID][j] +
                   spins[i][(j + 1) % GRID] + spins[i][(j - 1 + GRID) % GRID];
        const dE = 2 * J_COUPLING * spin * nb;
        if (dE <= 0 || Math.random() < Math.exp(-dE / localT)) spins[i][j] = -spin;
      }
      const imageData = offCtx.createImageData(GRID, GRID);
      const data = imageData.data;
      const p = palette(dark);
      const [upR, upG, upB] = p.up;
      const [dnR, dnG, dnB] = p.down;
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const idx = (j * GRID + i) * 4;
          if (spins[i][j] === 1) { data[idx] = upR; data[idx + 1] = upG; data[idx + 2] = upB; }
          else { data[idx] = dnR; data[idx + 1] = dnG; data[idx + 2] = dnB; }
          data[idx + 3] = 255;
        }
      }
      offCtx.putImageData(imageData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, W, H);
    }

    window.addEventListener("resize", resize);
    runWhenVisible(canvas, loop);
  }

  function startGpu(device, format) {
    if (started) return;
    const N = GRID * GRID;

    const spinsBuf = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const initSpins = new Int32Array(N);
    for (let k = 0; k < N; k++) initSpins[k] = Math.random() < 0.5 ? 1 : -1;
    device.queue.writeBuffer(spinsBuf, 0, initSpins);

    // Two parity uniforms so both passes carry their own parity/seed when
    // submitted in a single command buffer.
    const PARAMS_SIZE = 64;
    const paramsBlackBuf = device.createBuffer({ size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const paramsWhiteBuf = device.createBuffer({ size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const paramsArr = new ArrayBuffer(PARAMS_SIZE);
    const pU32 = new Uint32Array(paramsArr);
    const pF32 = new Float32Array(paramsArr);

    const renderBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const renderArray = new ArrayBuffer(48);
    const renderF32 = new Float32Array(renderArray);
    const renderU32 = new Uint32Array(renderArray);
    renderU32[0] = GRID;

    const stepWgsl = `
struct IsingParams {
  grid: u32, parity: u32, _p0: u32, _p1: u32,
  T: f32, J: f32, heatR2: f32, hotT: f32,
  mouseX: f32, mouseY: f32, cellW: f32, cellH: f32,
  seed: f32, _p2: f32, _p3: f32, _p4: f32,
};
@group(0) @binding(0) var<storage, read_write> spins: array<i32>;
@group(0) @binding(1) var<uniform> p: IsingParams;

fn rand(seed: vec3<f32>) -> f32 {
  return fract(sin(dot(seed, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

@compute @workgroup_size(8, 8)
fn cs_step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  if (i >= p.grid || j >= p.grid) { return; }
  if (((i + j) & 1u) != p.parity) { return; }
  var localT = p.T;
  if (p.heatR2 > 0.0) {
    let cx = (f32(i) + 0.5) * p.cellW;
    let cy = (f32(j) + 0.5) * p.cellH;
    let dx = cx - p.mouseX;
    let dy = cy - p.mouseY;
    if (dx * dx + dy * dy < p.heatR2) {
      localT = max(localT, p.hotT);
    }
  }
  let k = i * p.grid + j;
  let spin = spins[k];
  let nb = spins[((i + 1u) % p.grid) * p.grid + j]
         + spins[((i + p.grid - 1u) % p.grid) * p.grid + j]
         + spins[i * p.grid + ((j + 1u) % p.grid)]
         + spins[i * p.grid + ((j + p.grid - 1u) % p.grid)];
  let dE = 2.0 * p.J * f32(spin) * f32(nb);
  let r = rand(vec3<f32>(f32(i) + 0.5, f32(j) + 0.5, p.seed));
  if (dE <= 0.0 || r < exp(-dE / max(localT, 0.0001))) {
    spins[k] = -spin;
  }
}
`;
    const renderWgsl = `
struct RP {
  grid: u32, _p0: u32, fbW: f32, fbH: f32,
  up: vec4<f32>, down: vec4<f32>,
};
@group(0) @binding(0) var<storage, read> spins: array<i32>;
@group(0) @binding(1) var<uniform> rp: RP;

${FULLSCREEN_TRIANGLE_VS}

@fragment
fn fs_main(@builtin(position) fragPos: vec4<f32>) -> @location(0) vec4<f32> {
  let u = clamp(fragPos.x / rp.fbW, 0.0, 1.0);
  let v = clamp(fragPos.y / rp.fbH, 0.0, 1.0);
  let i = min(u32(u * f32(rp.grid)), rp.grid - 1u);
  let j = min(u32(v * f32(rp.grid)), rp.grid - 1u);
  let s = spins[i * rp.grid + j];
  if (s == 1) {
    return vec4<f32>(rp.up.rgb, 1.0);
  }
  return vec4<f32>(rp.down.rgb, 1.0);
}
`;
    const stepModule = device.createShaderModule({ code: stepWgsl });
    const renderModule = device.createShaderModule({ code: renderWgsl });

    const stepBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const renderBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
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

    const stepBgBlack = device.createBindGroup({
      layout: stepBgl,
      entries: [
        { binding: 0, resource: { buffer: spinsBuf } },
        { binding: 1, resource: { buffer: paramsBlackBuf } },
      ],
    });
    const stepBgWhite = device.createBindGroup({
      layout: stepBgl,
      entries: [
        { binding: 0, resource: { buffer: spinsBuf } },
        { binding: 1, resource: { buffer: paramsWhiteBuf } },
      ],
    });
    const renderBg = device.createBindGroup({
      layout: renderBgl,
      entries: [
        { binding: 0, resource: { buffer: spinsBuf } },
        { binding: 1, resource: { buffer: renderBuf } },
      ],
    });

    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("isingSim: getContext('webgpu') returned null");
    ctx.configure({ device, format, alphaMode: "premultiplied" });
    started = true;

    let cssW = 0, cssH = 0;
    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = rect.width, H = rect.height;
      const tW = Math.max(1, Math.round(W * dpr));
      const tH = Math.max(1, Math.round(H * dpr));
      if (canvas.width !== tW || Math.abs(canvas.height - tH) >= 150 * dpr || canvas.width === 0) {
        canvas.width = tW;
        canvas.height = tH;
      }
      cssW = W; cssH = H;
    }
    resize();
    window.addEventListener("resize", resize);

    let tempMode = 1;
    let T = TEMPS[tempMode];
    let mouseActive = false;
    let mouseX = 0, mouseY = 0;
    canvas.addEventListener("click", () => {
      tempMode = (tempMode + 1) % 3;
      T = TEMPS[tempMode];
    });
    function handleMove(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      mouseX = clientX - rect.left;
      mouseY = clientY - rect.top;
      mouseActive = true;
    }
    canvas.addEventListener("mousemove", (e) => handleMove(e.clientX, e.clientY));
    canvas.addEventListener("touchstart", (e) => { if(e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    canvas.addEventListener("touchmove", (e) => { if(e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    canvas.addEventListener("mouseleave", () => { mouseActive = false; });
    canvas.addEventListener("touchend", () => { mouseActive = false; });
    canvas.addEventListener("touchcancel", () => { mouseActive = false; });

    const dispatchN = Math.ceil(GRID / 8);

    function writeParamsBuffer(parity, seed) {
      pU32[0] = GRID;
      pU32[1] = parity;
      pF32[4] = T;
      pF32[5] = J_COUPLING;
      pF32[6] = mouseActive ? HEAT_RADIUS2 : 0;
      pF32[7] = HOT_T;
      pF32[8] = mouseX;
      pF32[9] = mouseY;
      pF32[10] = cssW / GRID;
      pF32[11] = cssH / GRID;
      pF32[12] = seed;
      return paramsArr;
    }

    function loop() {
      // Write the two parity buffers BEFORE encoding so both pass dispatches
      // pick up the correct uniform when the command buffer is submitted.
      const seedBlack = Math.random() * 1000;
      const seedWhite = Math.random() * 1000;
      writeParamsBuffer(0, seedBlack);
      device.queue.writeBuffer(paramsBlackBuf, 0, paramsArr);
      writeParamsBuffer(1, seedWhite);
      device.queue.writeBuffer(paramsWhiteBuf, 0, paramsArr);

      const dark = isDark();
      const p = palette(dark);
      renderU32[0] = GRID;
      renderF32[2] = canvas.width;
      renderF32[3] = canvas.height;
      renderF32[4] = p.up[0] / 255;   renderF32[5] = p.up[1] / 255;   renderF32[6] = p.up[2] / 255;   renderF32[7] = 1;
      renderF32[8] = p.down[0] / 255; renderF32[9] = p.down[1] / 255; renderF32[10] = p.down[2] / 255; renderF32[11] = 1;
      device.queue.writeBuffer(renderBuf, 0, renderArray);

      const encoder = device.createCommandEncoder();
      {
        const cpass = encoder.beginComputePass();
        cpass.setPipeline(stepPipeline);
        cpass.setBindGroup(0, stepBgBlack);
        cpass.dispatchWorkgroups(dispatchN, dispatchN);
        cpass.setBindGroup(0, stepBgWhite);
        cpass.dispatchWorkgroups(dispatchN, dispatchN);
        cpass.end();
      }
      const view = ctx.getCurrentTexture().createView();
      const rpass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      rpass.setPipeline(renderPipeline);
      rpass.setBindGroup(0, renderBg);
      rpass.draw(3);
      rpass.end();
      device.queue.submit([encoder.finish()]);
    }

    runWhenVisible(canvas, loop);
  }

  webgpuShared.ready.then((gpu) => {
    if (!gpu || webgpuShared.lost) { startCpu(); return; }
    try { startGpu(gpu.device, gpu.format); }
    catch (err) {
      console.warn("isingSim: WebGPU init failed, falling back to 2D", err);
      if (!started) startCpu();
    }
  });
})();

// ════════════════════════════════════
(() => { // PHYSICS SIM 4: Lorenz Attractor
  const canvas = document.getElementById("lorenzSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  // Lorenz parameters
  const sigma = 10,
    rho = 28,
    beta = 8 / 3;
  let x = 0.1,
    y = 0,
    z = 0;
  const dt = 0.01;
  let points = [];
  const MAX_POINTS = 800;

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
    points = [];
    x = 0.1;
    y = 0;
    z = 0;
  }

  let isHovered = false;
  canvas.addEventListener("mouseenter", () => (isHovered = true));
  canvas.addEventListener("mouseleave", () => (isHovered = false));
  canvas.addEventListener("touchstart", () => (isHovered = true), { passive: true });
  canvas.addEventListener("touchend", () => (isHovered = false));
  canvas.addEventListener("touchcancel", () => (isHovered = false));

  canvas.addEventListener("click", () => {
    points.length = 0;
    x = (Math.random() - 0.5) * 2;
    y = (Math.random() - 0.5) * 2;
    z = Math.random() * 20;
  });

  function lorenzDerivatives(px, py, pz) {
    return {
      dx: sigma * (py - px),
      dy: px * (rho - pz) - py,
      dz: px * py - beta * pz,
    };
  }

  function stepLorenz(h) {
    const k1 = lorenzDerivatives(x, y, z);
    const k2 = lorenzDerivatives(
      x + k1.dx * h * 0.5,
      y + k1.dy * h * 0.5,
      z + k1.dz * h * 0.5,
    );
    const k3 = lorenzDerivatives(
      x + k2.dx * h * 0.5,
      y + k2.dy * h * 0.5,
      z + k2.dz * h * 0.5,
    );
    const k4 = lorenzDerivatives(
      x + k3.dx * h,
      y + k3.dy * h,
      z + k3.dz * h,
    );
    x += (h / 6) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
    y += (h / 6) * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy);
    z += (h / 6) * (k1.dz + 2 * k2.dz + 2 * k3.dz + k4.dz);
  }

  function loop() {
    const dark = isDark();

    // Run multiple physics steps per frame when hovered to increase speed without losing numerical stability
    const steps = isHovered ? 5 : 1;
    for (let s = 0; s < steps; s++) {
      stepLorenz(dt);
      points.push({ x, y, z });
      if (points.length > MAX_POINTS) points.shift();
    }

    ctx.clearRect(0, 0, W, H);

    if (points.length > 2) {
      ctx.beginPath();
      const scale = Math.min(W, H) * 0.02;
      const ox = W / 2;
      const oy = H / 2;

      ctx.moveTo(ox + points[0].x * scale, oy - (points[0].z - 24) * scale);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(ox + points[i].x * scale, oy - (points[i].z - 24) * scale);
      }

      ctx.strokeStyle = dark
        ? "rgba(91, 242, 155, 0.4)"
        : "rgba(20, 110, 60, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const recentStart = Math.max(0, points.length - 100);
      ctx.beginPath();
      ctx.moveTo(
        ox + points[recentStart].x * scale,
        oy - (points[recentStart].z - 24) * scale,
      );
      for (let i = recentStart + 1; i < points.length; i++) {
        ctx.lineTo(ox + points[i].x * scale, oy - (points[i].z - 24) * scale);
      }
      ctx.strokeStyle = dark
        ? "rgba(91, 242, 155, 1)"
        : "rgba(20, 110, 60, 0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  resize();
  window.addEventListener("resize", resize);
  runWhenVisible(canvas, loop);
})();

// ════════════════════════════════════
(() => { // PHYSICS SIM 5: Elastic Double Pendulum
  const canvas = document.getElementById("springPendSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  const trail = [];
  const MAX_TRAIL = 600;
  const grav = 200;
  const m1 = 1, m2 = 1;
  const k1 = 40, k2 = 40;
  let L1, L2;
  let x1, y1, vx1, vy1, x2, y2, vx2, vy2;
  const substeps = 12;
  const frameDt = 0.016;

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
    trail.length = 0;
  }

  function randomize() {
    L1 = Math.min(W, H) * 0.25;
    L2 = Math.min(W, H) * 0.25;
    const a1 = Math.random() * Math.PI * 2;
    const a2 = Math.random() * Math.PI * 2;
    const r1 = L1 * (0.8 + Math.random() * 0.4);
    const r2 = L2 * (0.8 + Math.random() * 0.4);
    x1 = Math.sin(a1) * r1;
    y1 = Math.cos(a1) * r1;
    x2 = x1 + Math.sin(a2) * r2;
    y2 = y1 + Math.cos(a2) * r2;
    vx1 = vy1 = vx2 = vy2 = 0;
    trail.length = 0;
  }

  canvas.addEventListener("click", randomize);

  function springForce(dx, dy, restLength, springK) {
    const distance = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const magnitude = -springK * (distance - restLength);
    return {
      fx: magnitude * (dx / distance),
      fy: magnitude * (dy / distance),
    };
  }

  function step(h) {
    const dx2 = x2 - x1, dy2 = y2 - y1;
    const pivotSpring = springForce(x1, y1, L1, k1);
    const linkSpring = springForce(dx2, dy2, L2, k2);

    // Forces on mass 1: spring1 + reaction from spring2 + gravity
    const fx1 = pivotSpring.fx - linkSpring.fx;
    const fy1 = pivotSpring.fy - linkSpring.fy + m1 * grav;

    // Forces on mass 2: spring2 + gravity
    const fx2 = linkSpring.fx;
    const fy2 = linkSpring.fy + m2 * grav;

    // Semi-implicit Euler with damping
    vx1 += (fx1 / m1) * h; vy1 += (fy1 / m1) * h;
    vx2 += (fx2 / m2) * h; vy2 += (fy2 / m2) * h;
    const damp = 0.9997;
    vx1 *= damp; vy1 *= damp; vx2 *= damp; vy2 *= damp;
    x1 += vx1 * h; y1 += vy1 * h;
    x2 += vx2 * h; y2 += vy2 * h;
  }

  function drawSpring(ax, ay, bx, by, coils) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const amp = Math.min(4, len * 0.06);
    const entry = 0.08;
    const steps = Math.max(40, coils * 16);

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      const t = entry + u * (1 - 2 * entry);
      const env = Math.sin(Math.PI * u);
      const side = Math.sin(u * coils * Math.PI * 2) * amp * env;
      ctx.lineTo(ax + dx * t + nx * side, ay + dy * t + ny * side);
    }
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  function loop() {
    const dark = isDark();

    for (let i = 0; i < substeps; i++) step(frameDt / substeps);

    const ox = W / 2, oy = H * 0.2;
    const px1 = ox + x1, py1 = oy + y1;
    const px2 = ox + x2, py2 = oy + y2;

    trail.push({ x: px2, y: py2 });
    if (trail.length > MAX_TRAIL) trail.shift();

    ctx.clearRect(0, 0, W, H);

    // Trail
    if (trail.length > 2) {
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
      ctx.strokeStyle = dark ? "rgba(232, 148, 74, 0.25)" : "rgba(207, 107, 79, 0.2)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const rs = Math.max(0, trail.length - 80);
      ctx.beginPath();
      ctx.moveTo(trail[rs].x, trail[rs].y);
      for (let i = rs + 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
      ctx.strokeStyle = dark ? "rgba(232, 148, 74, 0.6)" : "rgba(207, 107, 79, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Springs
    ctx.strokeStyle = dark ? "rgba(255, 255, 255, 0.5)" : "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = 1.5;
    drawSpring(ox, oy, px1, py1, 8);
    drawSpring(px1, py1, px2, py2, 8);

    // Pivot
    ctx.beginPath();
    ctx.arc(ox, oy, 4, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)";
    ctx.fill();

    // Mass 1
    ctx.beginPath();
    ctx.arc(px1, py1, 8, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "#3dd9c1" : "#1e6f5c";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px1, py1, 14, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "rgba(61,217,193,0.12)" : "rgba(30,111,92,0.1)";
    ctx.fill();

    // Mass 2
    ctx.beginPath();
    ctx.arc(px2, py2, 8, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "#e8944a" : "#cf6b4f";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px2, py2, 14, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "rgba(232,148,74,0.12)" : "rgba(207,107,79,0.1)";
    ctx.fill();
  }

  resize();
  randomize();
  window.addEventListener("resize", resize);
  runWhenVisible(canvas, loop);
})();

(() => { // PHYSICS SIM 6: 1D Traffic Flow (Nonlinear Dynamics - Enhanced Bando OV Model)
  const canvas = document.getElementById("trafficSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  let numCars = 22;
  let cars = [];
  const radius = 80;

  let isHovered = false;
  canvas.addEventListener("mouseenter", () => isHovered = true);
  canvas.addEventListener("mouseleave", () => isHovered = false);
  canvas.addEventListener("touchstart", () => isHovered = true, { passive: true });
  canvas.addEventListener("touchend", () => isHovered = false);
  canvas.addEventListener("touchcancel", () => isHovered = false);

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
  }

  function init() {
    resize();
    cars = [];
    const circ = 2 * Math.PI * radius;
    for (let i = 0; i < numCars; i++) {
      cars.push({
        x: (i / numCars) * circ,
        v: i === 0 ? 0 : 0.6 + Math.random() * 0.3, // car 0 starts braked → seeds jam
        prevV: 0.8,
        sens: 0.15 + Math.random() * 0.15,  // low sensitivity → slow reaction → jams persist
        vmax: 1.2 + Math.random() * 0.4,
        braking: false,
      });
    }
  }

  // Bando Optimal Velocity — hc matches average spacing for critical density
  function V_opt(dx, vmax) {
    const hc = 22.0;
    const w = 4.0;
    const norm = 1.0 + Math.tanh(hc / w);
    return (vmax * (Math.tanh((dx - hc) / w) + Math.tanh(hc / w))) / norm;
  }

  // Click to randomly add/remove cars
  canvas.addEventListener("click", () => {
    if (Math.random() < 0.5 && numCars > 5) {
      numCars--;
      cars.splice(Math.floor(Math.random() * numCars), 1);
    } else if (numCars < 50) {
      numCars++;
      const circ = 2 * Math.PI * radius;
      cars.push({
        x: Math.random() * circ,
        v: 0.5,
        prevV: 0.5,
        sens: 0.15 + Math.random() * 0.15,
        vmax: 1.2 + Math.random() * 0.4,
        braking: false,
      });
      cars.sort((a, b) => a.x - b.x);
    }
  });

  function loop() {
    const dark = isDark();
    ctx.clearRect(0, 0, W, H);

    const circ = 2 * Math.PI * radius;
    const dt = 0.4;

    // Multiple physics substeps per frame for smoother dynamics
    for (let sub = 0; sub < 3; sub++) {
      const next = cars.map((c) => ({ ...c }));
      for (let i = 0; i < numCars; i++) {
        const car = cars[i];
        const ahead = cars[(i + 1) % numCars];
        let dx = ahead.x - car.x;
        if (dx < 0) dx += circ;

        const effectiveVmax = isHovered ? car.vmax * 0.25 : car.vmax;
        let accel = car.sens * (V_opt(dx, effectiveVmax) - car.v);

        // Stochastic braking — random perturbations generate phantom jams
        if (Math.random() < 0.006 && car.v > 0.3) accel -= 0.6;

        next[i].prevV = car.v;
        next[i].v = Math.max(0, car.v + accel * dt);
        next[i].x = car.x + next[i].v * dt;
        if (next[i].x > circ) next[i].x -= circ;
        next[i].braking = next[i].v < next[i].prevV - 0.01;
      }
      cars = next.sort((a, b) => a.x - b.x);
    }

    // Render
    ctx.save();
    ctx.translate(W / 2, H / 2);

    // Road surface
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? "#2a2a2a" : "#e0e0e0";
    ctx.lineWidth = 18;
    ctx.stroke();

    // Road edges
    ctx.beginPath();
    ctx.arc(0, 0, radius + 9, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? "#555" : "#bbb";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius - 9, 0, Math.PI * 2);
    ctx.stroke();

    // Dashed center line
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? "#444" : "#ccc";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // Color normalization — rescale against the hover-adjusted vmax
    // so throttled cars still span the full red→green gradient.
    let vRef = 0.1;
    for (let i = 0; i < numCars; i++) {
      const cap = isHovered ? cars[i].vmax * 0.25 : cars[i].vmax;
      if (cap > vRef) vRef = cap;
    }

    // Draw cars
    for (let i = 0; i < numCars; i++) {
      const angle = cars[i].x / radius;
      const cx = Math.cos(angle) * radius;
      const cy = Math.sin(angle) * radius;
      const tangent = angle + Math.PI / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tangent);

      // Car body
      const cw = 5, ch = 10;
      ctx.beginPath();
      ctx.roundRect(-cw / 2, -ch / 2, cw, ch, 2);
      const vRatio = Math.min(cars[i].v / vRef, 1.0);
      const r = Math.floor(255 * (1 - vRatio));
      const g = Math.floor(200 * vRatio);
      ctx.fillStyle = `rgb(${r}, ${g}, 80)`;
      ctx.fill();

      ctx.restore();
    }
    ctx.restore();
  }

  init();
  window.addEventListener("resize", resize);
  runWhenVisible(canvas, loop);
})();
