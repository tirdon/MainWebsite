import { resizeCanvas, isDark, runWhenVisible } from "../../core/runtime.js";
import { webgpuShared, FULLSCREEN_TRIANGLE_VS } from "../../core/webgpu.js";

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
        let flip = false;
        if (dE < 0) flip = true;
        else if (dE === 0) flip = Math.random() < 0.5;
        else flip = Math.random() < Math.exp(-dE / localT);
        if (flip) spins[i][j] = -spin;
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
    canvas.addEventListener("simulationresize", resize);
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

fn pcg_hash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn rand(seed: vec3<f32>) -> f32 {
  let sx = bitcast<u32>(seed.x);
  let sy = bitcast<u32>(seed.y);
  let sz = bitcast<u32>(seed.z);
  let h = pcg_hash(sx ^ pcg_hash(sy ^ pcg_hash(sz)));
  return f32(h) * (1.0 / 4294967296.0);
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
  var flip = false;
  if (dE < 0.0) {
    flip = true;
  } else if (dE == 0.0) {
    flip = r < 0.5;
  } else {
    flip = r < exp(-dE / max(localT, 0.0001));
  }
  if (flip) {
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
    canvas.addEventListener("simulationresize", resize);

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
        let cpass = encoder.beginComputePass();
        cpass.setPipeline(stepPipeline);
        cpass.setBindGroup(0, stepBgBlack);
        cpass.dispatchWorkgroups(dispatchN, dispatchN);
        cpass.end();

        cpass = encoder.beginComputePass();
        cpass.setPipeline(stepPipeline);
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
