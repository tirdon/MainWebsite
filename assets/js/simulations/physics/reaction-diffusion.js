import { resizeCanvas, isDark, runWhenVisible } from "../../core/runtime.js";
import { webgpuShared, FULLSCREEN_TRIANGLE_VS } from "../../core/webgpu.js";

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
    canvas.addEventListener("simulationresize", resize);
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
    canvas.addEventListener("simulationresize", resize);

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
