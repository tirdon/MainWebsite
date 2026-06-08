// Single shared WebGPU device. All sims and the mountain backdrop await this
// instead of each requesting their own adapter/device. Resolves to
// { device, format } once, or null if WebGPU is unavailable.
const webgpuShared = (() => {
  if (!navigator.gpu) return { ready: Promise.resolve(null) };
  const ready = (async () => {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const format = navigator.gpu.getPreferredCanvasFormat();
      // If the device is lost we want every consumer to fall back gracefully.
      device.lost.then(() => {
        webgpuShared.lost = true;
      }).catch(() => {});
      return { device, format };
    } catch {
      return null;
    }
  })();
  return { ready, lost: false };
})();

// Helper: fullscreen-triangle vertex shader source shared by every sim that
// renders a 2D grid to a canvas. Emits a single triangle covering NDC.
const FULLSCREEN_TRIANGLE_VS = `
@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(pos[idx], 0.0, 1.0);
}
`;

// ════════════════════════════════════
(() => { // BACKDROP: WebGPU procedurally generated mountain (FBM noise)
  const canvas = document.getElementById("mountainBg");
  const particleCanvas = document.getElementById("mountainParticles");
  if (!canvas) return;

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const setMountainOpacity = (v) => {
    document.documentElement.style.setProperty("--mountain-bg-opacity", v.toFixed(3));
  };
  // Below this fade level the mountain is effectively invisible — skip all
  // GPU work while the user is reading sections outside the backdrop's range.
  const FADE_THRESHOLD = 0.005;

  // Map document scroll into two phases:
  //   p1: 0 at top-of-#skills → 1 at top-of-#education (fade-in + zoom-out)
  //   p2: 0 at top-of-#education → 1 at bottom-of-#hobbies (orbit + season)
  // Reference point is the viewport center so the transition tracks where the
  // viewer's eye actually is.
  function getScrollPhases() {
    const skills = document.getElementById("skills");
    const education = document.getElementById("education");
    const hobbies = document.getElementById("hobbies");
    if (!skills || !education || !hobbies) return { p1: 0, p2: 0 };
    const ref = window.scrollY + stableInnerHeight * 0.5;
    const skillsTop = skills.getBoundingClientRect().top + window.scrollY;
    const educationTop = education.getBoundingClientRect().top + window.scrollY;
    const hobbiesBot = hobbies.getBoundingClientRect().bottom + window.scrollY;
    const p1 = clamp01((ref - skillsTop) / Math.max(1, educationTop - skillsTop));
    const p2 = clamp01((ref - educationTop) / Math.max(1, hobbiesBot - educationTop));
    return { p1, p2 };
  }

  // Column-major 4x4 matrix helpers. Perspective targets WebGPU clip space
  // (z in [0, 1]) — different from the OpenGL convention.
  function mat4Perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, far * nf, -1,
      0, 0, near * far * nf, 0,
    ]);
  }
  function mat4LookAt(eye, target, up) {
    const fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
    const fl = 1 / Math.hypot(fx, fy, fz);
    const f = [fx * fl, fy * fl, fz * fl];
    const sx = f[1] * up[2] - f[2] * up[1];
    const sy = f[2] * up[0] - f[0] * up[2];
    const sz = f[0] * up[1] - f[1] * up[0];
    const sl = 1 / Math.hypot(sx, sy, sz);
    const s = [sx * sl, sy * sl, sz * sl];
    const u = [
      s[1] * f[2] - s[2] * f[1],
      s[2] * f[0] - s[0] * f[2],
      s[0] * f[1] - s[1] * f[0],
    ];
    return new Float32Array([
      s[0], u[0], -f[0], 0,
      s[1], u[1], -f[1], 0,
      s[2], u[2], -f[2], 0,
      -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]),
      -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]),
      f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2],
      1,
    ]);
  }
  function mat4Mul(a, b) {
    const r = new Float32Array(16);
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += a[i + k * 4] * b[k + j * 4];
        r[i + j * 4] = v;
      }
    }
    return r;
  }

  // ── JS mirrors of the WGSL noise — used only for CPU-side tree placement.
  // Float precision differs slightly from the GPU, so we leave a small
  // y-offset when seating trees on the terrain.
  function jsHash21(x, y) {
    const h = x * 127.1 + y * 311.7;
    const s = Math.sin(h) * 43758.5453;
    return s - Math.floor(s);
  }
  function jsVnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = jsHash21(ix, iy);
    const b = jsHash21(ix + 1, iy);
    const c = jsHash21(ix, iy + 1);
    const d = jsHash21(ix + 1, iy + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }
  function jsFbm(x, y) {
    let v = 0, amp = 0.55, px = x, py = y;
    for (let i = 0; i < 6; i++) {
      v += amp * jsVnoise(px, py);
      const nx = px * 2.03 + 11.1;
      const ny = py * 2.03 + 7.3;
      px = nx; py = ny;
      amp *= 0.5;
    }
    return v;
  }
  function jsRidge(x, y) { return 1 - Math.abs(jsVnoise(x, y) * 2 - 1); }
  function jsRidgedFbm(x, y) {
    let v = 0, amp = 0.6, px = x, py = y;
    for (let i = 0; i < 5; i++) {
      v += amp * jsRidge(px, py);
      const nx = px * 2.07 + 3.7;
      const ny = py * 2.07 + 9.1;
      px = nx; py = ny;
      amp *= 0.5;
    }
    return v;
  }
  function jsMountainHeight(x, z) {
    const r2 = x * x + z * z;
    const base = Math.exp(-r2 * 0.04) * 2.6;
    const ridges = jsRidgedFbm(x * 0.5, z * 0.5);
    const baseN = jsFbm(x * 0.4, z * 0.4);
    return base + ridges * 0.8 + baseN * 0.5 - 0.4;
  }

  let fallbackStarted = false;
  function startMountainFallback2d() {
    if (fallbackStarted) return;
    fallbackStarted = true;
    let fallbackCanvas = canvas;
    let ctx2d = fallbackCanvas.getContext("2d");
    if (!ctx2d) {
      fallbackCanvas = canvas.cloneNode(false);
      canvas.replaceWith(fallbackCanvas);
      ctx2d = fallbackCanvas.getContext("2d");
    }
    if (!ctx2d) {
      fallbackCanvas.style.display = "none";
      if (particleCanvas) particleCanvas.style.display = "none";
      return;
    }
    if (particleCanvas) particleCanvas.style.display = "none";

    function fract(v) { return v - Math.floor(v); }
    function fallbackHash(v) { return fract(Math.sin(v * 12.9898) * 43758.5453); }
    function ridgeY(t, w, h, layer) {
      const x = t * 2 - 1;
      const peak = Math.exp(-x * x * (2.8 + layer * 0.7)) * h * (0.42 - layer * 0.07);
      const shoulder = Math.exp(-Math.pow(x + 0.42, 2) * 8.5) * h * (0.12 - layer * 0.02);
      const ripple =
        Math.sin(t * Math.PI * (5.0 + layer) + layer * 1.7) * h * 0.018 +
        Math.sin(t * Math.PI * (13.0 + layer * 2.0)) * h * 0.010;
      return h * (0.78 + layer * 0.075) - peak - shoulder + ripple;
    }
    function drawRidge(ctx, w, h, layer, fill) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i <= 180; i++) {
        const t = i / 180;
        ctx.lineTo(t * w, ridgeY(t, w, h, layer));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    function drawPine(ctx, x, y, size, dark, seasonT) {
      const snow = 1 - seasonT;
      ctx.fillStyle = dark ? "#21180f" : "#3b2414";
      ctx.fillRect(x - size * 0.045, y - size * 0.62, size * 0.09, size * 0.64);
      const rootW = size * 0.22;
      ctx.beginPath();
      ctx.moveTo(x - rootW, y + size * 0.02);
      ctx.lineTo(x, y - size * 0.07);
      ctx.lineTo(x + rootW, y + size * 0.02);
      ctx.closePath();
      ctx.fill();
      const tiers = 6;
      for (let i = 0; i < tiers; i++) {
        const tierY = y - size * (0.10 + i * 0.13);
        const width = size * (0.62 - i * 0.075);
        const height = size * (0.24 - i * 0.012);
        const grad = ctx.createLinearGradient(x - width, tierY, x + width, tierY);
        if (dark) {
          grad.addColorStop(0, "#1c3b2e");
          grad.addColorStop(0.52, "#3a7448");
          grad.addColorStop(1, "#152e26");
        } else {
          grad.addColorStop(0, "#2e5638");
          grad.addColorStop(0.52, "#5b9847");
          grad.addColorStop(1, "#274932");
        }
        ctx.beginPath();
        ctx.moveTo(x, tierY - height);
        ctx.quadraticCurveTo(x - width * 0.48, tierY - height * 0.12, x - width, tierY + height * 0.30);
        ctx.quadraticCurveTo(x - width * 0.18, tierY + height * 0.10, x, tierY + height * 0.18);
        ctx.quadraticCurveTo(x + width * 0.18, tierY + height * 0.10, x + width, tierY + height * 0.30);
        ctx.quadraticCurveTo(x + width * 0.48, tierY - height * 0.12, x, tierY - height);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = dark ? "rgba(125, 174, 121, 0.20)" : "rgba(176, 210, 112, 0.24)";
        ctx.lineWidth = Math.max(1, size * 0.010);
        for (let s = -2; s <= 2; s++) {
          ctx.beginPath();
          ctx.moveTo(x, tierY - height * 0.46);
          ctx.lineTo(x + s * width * 0.22, tierY + height * (0.10 + Math.abs(s) * 0.06));
          ctx.stroke();
        }
        if (snow > 0.18) {
          ctx.strokeStyle = `rgba(232, 240, 245, ${0.42 * snow})`;
          ctx.lineWidth = Math.max(1, size * 0.022);
          ctx.beginPath();
          ctx.moveTo(x - width * 0.74, tierY + height * 0.22);
          ctx.quadraticCurveTo(x, tierY + height * 0.04, x + width * 0.74, tierY + height * 0.22);
          ctx.stroke();
        }
      }
    }
    function resizeFallback() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(window.innerWidth * dpr));
      const h = Math.max(1, Math.floor(stableInnerHeight * dpr));
      if (fallbackCanvas.width === w && fallbackCanvas.height === h) return;
      fallbackCanvas.width = w;
      fallbackCanvas.height = h;
    }
    function drawFallback(now) {
      resizeFallback();
      const w = fallbackCanvas.width;
      const h = fallbackCanvas.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { p1, p2 } = getScrollPhases();
      const fade = p1;
      const seasonT = Math.min(1, p2 / 0.7);
      const dark = isDark();
      setMountainOpacity(fade);

      ctx2d.clearRect(0, 0, w, h);
      ctx2d.save();
      ctx2d.globalAlpha = fade;
      drawRidge(ctx2d, w, h, 2, dark ? "#111927" : "#c7d2c0");
      drawRidge(ctx2d, w, h, 1, dark ? "#172134" : "#9eb58f");
      drawRidge(ctx2d, w, h, 0, dark ? "#203044" : "#668460");

      ctx2d.globalAlpha = fade * (1 - seasonT) * 0.74;
      ctx2d.beginPath();
      for (let i = 28; i <= 152; i++) {
        const t = i / 180;
        const y = ridgeY(t, w, h, 0);
        if (i === 28) ctx2d.moveTo(t * w, y);
        else ctx2d.lineTo(t * w, y);
      }
      ctx2d.lineTo(w * 0.54, h * 0.47);
      ctx2d.lineTo(w * 0.36, h * 0.50);
      ctx2d.closePath();
      ctx2d.fillStyle = dark ? "#d9e4f2" : "#edf4f4";
      ctx2d.fill();

      ctx2d.globalAlpha = fade;
      for (let i = 0; i < 88; i++) {
        const t = fallbackHash(i * 4.71 + 0.2);
        const layer = fallbackHash(i * 3.13) < 0.34 ? 1 : 0;
        const y = ridgeY(t, w, h, layer) + (5 + fallbackHash(i + 8) * 16) * dpr;
        const size = (18 + fallbackHash(i + 4) * 30) * dpr * (layer ? 0.78 : 1);
        if (y < h * 0.48 || y > h * 0.92) continue;
        drawPine(ctx2d, t * w, y, size, dark, seasonT);
      }

      ctx2d.globalAlpha = fade * seasonT * 0.72;
      ctx2d.strokeStyle = dark ? "#5f946f" : "#5d8a4f";
      for (let i = 0; i < 220; i++) {
        const t = fallbackHash(i * 2.37 + 6.0);
        const y = ridgeY(t, w, h, 0) + (18 + fallbackHash(i) * 42) * dpr;
        if (y < h * 0.68 || y > h) continue;
        const blade = (6 + fallbackHash(i + 19) * 10) * dpr;
        const lean = (fallbackHash(i + now * 0.00005) - 0.5) * 7 * dpr;
        ctx2d.beginPath();
        ctx2d.moveTo(t * w, y);
        ctx2d.quadraticCurveTo(t * w + lean, y - blade * 0.55, t * w + lean * 0.7, y - blade);
        ctx2d.stroke();
      }
      ctx2d.restore();
      requestAnimationFrame(drawFallback);
    }
    requestAnimationFrame(drawFallback);
  }

  // Tiny deterministic PRNG factory — used by both tree and grass generators.
  function makePRNG(seed) {
    let s = ((seed | 0) * 0x9E3779B1) >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Tree mesh primitives. Vertex stride = 10 floats:
  // [px, py, pz, cx, cy, cz, nx, ny, nz, isLeaf]
  // The per-vertex (cx, cy, cz) is the "growth center" — the shader lerps
  // each vertex from its center toward its full position as the season grows
  // leaves in. Stem vertices set center=self so they never move; leaf-cluster
  // vertices set center=cluster origin so the cluster expands from a point
  // into a full sphere over the season transition.
  function makeMeshBuilder() {
    const verts = [];
    function addTri(p0, p1, p2, c0, c1, c2, isLeaf) {
      const ex = p1[0] - p0[0], ey = p1[1] - p0[1], ez = p1[2] - p0[2];
      const fx = p2[0] - p0[0], fy = p2[1] - p0[1], fz = p2[2] - p0[2];
      let nx = ey * fz - ez * fy;
      let ny = ez * fx - ex * fz;
      let nz = ex * fy - ey * fx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      verts.push(p0[0], p0[1], p0[2], c0[0], c0[1], c0[2], nx, ny, nz, isLeaf);
      verts.push(p1[0], p1[1], p1[2], c1[0], c1[1], c1[2], nx, ny, nz, isLeaf);
      verts.push(p2[0], p2[1], p2[2], c2[0], c2[1], c2[2], nx, ny, nz, isLeaf);
    }
    // Cylinder / cone (r1 may be 0). All vertices use center=self, so this
    // shape is fixed at full size regardless of leafGrow.
    function cylinder(p0, p1, r0, r1, sides, isLeaf) {
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const al = Math.hypot(ax, ay, az) || 1;
      const ux = ax / al, uy = ay / al, uz = az / al;
      let tx, ty, tz;
      if (Math.abs(uy) < 0.95) { tx = 0; ty = 1; tz = 0; }
      else { tx = 1; ty = 0; tz = 0; }
      let px = uy * tz - uz * ty;
      let py = uz * tx - ux * tz;
      let pz = ux * ty - uy * tx;
      const pl = Math.hypot(px, py, pz) || 1;
      px /= pl; py /= pl; pz /= pl;
      const qx = uy * pz - uz * py;
      const qy = uz * px - ux * pz;
      const qz = ux * py - uy * px;
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2;
        const a1 = ((i + 1) / sides) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        const v00 = [p0[0] + (c0 * px + s0 * qx) * r0, p0[1] + (c0 * py + s0 * qy) * r0, p0[2] + (c0 * pz + s0 * qz) * r0];
        const v01 = [p0[0] + (c1 * px + s1 * qx) * r0, p0[1] + (c1 * py + s1 * qy) * r0, p0[2] + (c1 * pz + s1 * qz) * r0];
        const v10 = [p1[0] + (c0 * px + s0 * qx) * r1, p1[1] + (c0 * py + s0 * qy) * r1, p1[2] + (c0 * pz + s0 * qz) * r1];
        const v11 = [p1[0] + (c1 * px + s1 * qx) * r1, p1[1] + (c1 * py + s1 * qy) * r1, p1[2] + (c1 * pz + s1 * qz) * r1];
        addTri(v00, v10, v01, v00, v10, v01, isLeaf);
        addTri(v01, v10, v11, v01, v10, v11, isLeaf);
      }
    }
    function pineWhorl(y, radius, drop, width, count, phase, isLeaf) {
      for (let i = 0; i < count; i++) {
        const a = phase + (i / count) * Math.PI * 2 + Math.sin((i + 1) * 6.17 + y * 4.8) * 0.045;
        const wobble = 0.92 + 0.16 * Math.sin((i + 1) * 12.9898 + y * 19.19 + phase);
        const dirX = Math.cos(a), dirZ = Math.sin(a);
        const sideX = -dirZ, sideZ = dirX;
        const trunkR = Math.max(width * 0.7, 0.018);
        const len = radius * wobble;
        const base = [dirX * trunkR, y + width * 0.10, dirZ * trunkR];
        const mid = [dirX * len * 0.50, y - drop * 0.26 + width * 0.24, dirZ * len * 0.50];
        const tip = [dirX * len, y - drop * (0.92 + 0.08 * wobble), dirZ * len];
        const crown = [dirX * len * 0.28, y + width * 0.55, dirZ * len * 0.28];
        const baseW = width * 0.58;
        const midW = width * (1.14 + 0.16 * wobble);
        const tipW = width * 0.16;
        const baseL = [base[0] + sideX * baseW, base[1], base[2] + sideZ * baseW];
        const baseR = [base[0] - sideX * baseW, base[1], base[2] - sideZ * baseW];
        const midL = [mid[0] + sideX * midW, mid[1], mid[2] + sideZ * midW];
        const midR = [mid[0] - sideX * midW, mid[1], mid[2] - sideZ * midW];
        const tipL = [tip[0] + sideX * tipW, tip[1], tip[2] + sideZ * tipW];
        const tipR = [tip[0] - sideX * tipW, tip[1], tip[2] - sideZ * tipW];

        addTri(baseL, crown, baseR, baseL, crown, baseR, isLeaf);
        addTri(baseL, midL, crown, baseL, midL, crown, isLeaf);
        addTri(crown, midR, baseR, crown, midR, baseR, isLeaf);
        addTri(midL, tipL, midR, midL, tipL, midR, isLeaf);
        addTri(midR, tipL, tipR, midR, tipL, tipR, isLeaf);

        for (let s = 0; s < 3; s++) {
          const t = 0.38 + s * 0.20;
          const cx = base[0] * (1 - t) + tip[0] * t;
          const cy = base[1] * (1 - t) + tip[1] * t - drop * 0.07 * t;
          const cz = base[2] * (1 - t) + tip[2] * t;
          const sprayW = width * (0.86 - s * 0.16);
          const sprayLen = width * (1.25 - s * 0.14);
          const c = [cx, cy, cz];
          const outL = [cx + sideX * sprayW, cy - width * 0.10, cz + sideZ * sprayW];
          const outR = [cx - sideX * sprayW, cy - width * 0.10, cz - sideZ * sprayW];
          const down = [cx + dirX * sprayLen, cy - width * (0.55 + s * 0.12), cz + dirZ * sprayLen];
          addTri(c, outL, down, c, outL, down, isLeaf);
          addTri(c, down, outR, c, down, outR, isLeaf);
        }
      }
    }
    function leafEllipsoid(cx, cy, cz, rx, ry, rz, isLeaf) {
      const t = (1 + Math.sqrt(5)) / 2;
      const k = 1 / Math.sqrt(1 + t * t);
      const V = [
        [-k,  k*t, 0], [k,  k*t, 0], [-k, -k*t, 0], [k, -k*t, 0],
        [0, -k, k*t], [0, k, k*t], [0, -k, -k*t], [0, k, -k*t],
        [k*t, 0, -k], [k*t, 0, k], [-k*t, 0, -k], [-k*t, 0, k],
      ];
      const F = [
        [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
        [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
        [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
        [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
      ];
      const C = [cx, cy, cz];
      const p = (idx) => [V[idx][0] * rx + cx, V[idx][1] * ry + cy, V[idx][2] * rz + cz];
      for (const [a, b, c] of F) addTri(p(a), p(b), p(c), C, C, C, isLeaf);
    }
    // Icosahedron leaf cluster. center = (cx,cy,cz) is shared by all
    // vertices, so seasonGrow can collapse / grow the whole cluster.
    function icoSphere(cx, cy, cz, r, isLeaf) {
      const t = (1 + Math.sqrt(5)) / 2;
      const k = 1 / Math.sqrt(1 + t * t);
      const V = [
        [-k,  k*t, 0], [k,  k*t, 0], [-k, -k*t, 0], [k, -k*t, 0],
        [0, -k, k*t], [0, k, k*t], [0, -k, -k*t], [0, k, -k*t],
        [k*t, 0, -k], [k*t, 0, k], [-k*t, 0, -k], [-k*t, 0, k],
      ];
      const F = [
        [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
        [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
        [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
        [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
      ];
      const C = [cx, cy, cz];
      for (const [a, b, c] of F) {
        addTri(
          [V[a][0]*r + cx, V[a][1]*r + cy, V[a][2]*r + cz],
          [V[b][0]*r + cx, V[b][1]*r + cy, V[b][2]*r + cz],
          [V[c][0]*r + cx, V[c][1]*r + cy, V[c][2]*r + cz],
          C, C, C, isLeaf,
        );
      }
    }
    return { verts, cylinder, icoSphere, leafEllipsoid, pineWhorl };
  }

  // Broadleaf tree: root flare, segmented trunk, primary limbs, side twigs,
  // and overlapping ellipsoid canopy clusters.
  function makeTree(seed) {
    const rand = makePRNG(seed);
    const mb = makeMeshBuilder();

    const baseLeanX = (rand() - 0.5) * 0.06;
    const baseLeanZ = (rand() - 0.5) * 0.06;
    mb.cylinder([0, 0, 0], [baseLeanX * 0.45, 0.55, baseLeanZ * 0.45], 0.095, 0.066, 8, 0);
    mb.cylinder([baseLeanX * 0.45, 0.52, baseLeanZ * 0.45], [baseLeanX, 1.08, baseLeanZ], 0.066, 0.034, 7, 0);

    const rootCount = 5;
    for (let i = 0; i < rootCount; i++) {
      const a = (i / rootCount) * Math.PI * 2 + rand() * 0.35;
      const rootLen = 0.16 + rand() * 0.10;
      mb.cylinder(
        [0, 0.035, 0],
        [Math.cos(a) * rootLen, -0.012, Math.sin(a) * rootLen],
        0.028,
        0.010,
        5,
        0,
      );
    }

    const branchCount = 7 + Math.floor(rand() * 3);
    for (let i = 0; i < branchCount; i++) {
      const phi = (i / branchCount) * Math.PI * 2 + rand() * 0.55;
      const len = 0.27 + rand() * 0.30;
      const baseY = 0.43 + rand() * 0.55;
      const tipX = baseLeanX * 0.55 + Math.cos(phi) * len;
      const tipY = baseY + 0.12 + rand() * 0.30;
      const tipZ = baseLeanZ * 0.55 + Math.sin(phi) * len;
      const base = [baseLeanX * (baseY / 1.08), baseY, baseLeanZ * (baseY / 1.08)];
      const tip = [tipX, tipY, tipZ];
      mb.cylinder(base, tip, 0.036 - Math.min(i, 4) * 0.003, 0.014, 5, 0);

      const side = phi + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.45);
      const twigBase = [
        base[0] * 0.35 + tipX * 0.65,
        baseY * 0.35 + tipY * 0.65,
        base[2] * 0.35 + tipZ * 0.65,
      ];
      const twigTip = [
        twigBase[0] + Math.cos(side) * (0.10 + rand() * 0.11),
        twigBase[1] + 0.05 + rand() * 0.12,
        twigBase[2] + Math.sin(side) * (0.10 + rand() * 0.11),
      ];
      mb.cylinder(twigBase, twigTip, 0.017, 0.007, 4, 0);

      const puff = 0.12 + rand() * 0.055;
      mb.leafEllipsoid(tipX, tipY + 0.035, tipZ, puff * 1.25, puff * 0.88, puff, 1);
      if (rand() > 0.35) {
        mb.leafEllipsoid(twigTip[0], twigTip[1] + 0.025, twigTip[2], puff * 0.85, puff * 0.62, puff * 0.78, 1);
      }
    }
    mb.leafEllipsoid(baseLeanX * 0.75, 1.08, baseLeanZ * 0.75, 0.28 + rand() * 0.05, 0.21, 0.24, 1);
    mb.leafEllipsoid(baseLeanX * 0.3 - 0.13, 1.22 + rand() * 0.04, baseLeanZ * 0.3 + 0.08, 0.20, 0.16, 0.18, 1);
    mb.leafEllipsoid(baseLeanX * 0.3 + 0.13, 1.20 + rand() * 0.06, baseLeanZ * 0.3 - 0.06, 0.18, 0.15, 0.17, 1);
    return new Float32Array(mb.verts);
  }

  // Pine tree: tapered trunk, staggered cone masses, and drooping whorled
  // branches. Needle vertices use center=self so pines stay evergreen in
  // silhouette while their colour shifts with the season.
  function makePine(seed) {
    const rand = makePRNG(seed);
    const mb = makeMeshBuilder();
    const j = () => (rand() - 0.5) * 0.04;
    const phase = rand() * Math.PI * 2;
    mb.cylinder([0, -0.015, 0], [0, 1.38, 0], 0.060, 0.014, 8, 0);
    const rootCount = 6;
    for (let i = 0; i < rootCount; i++) {
      const a = phase + (i / rootCount) * Math.PI * 2 + rand() * 0.18;
      mb.cylinder(
        [0, 0.030, 0],
        [Math.cos(a) * (0.12 + rand() * 0.06), -0.018, Math.sin(a) * (0.12 + rand() * 0.06)],
        0.022,
        0.007,
        5,
        0,
      );
    }

    // Conifer "skirt" silhouette: wide droopy bottom whorls, dense layering,
    // sharply tapered top. Slightly more branches per tier than before so
    // gaps between whorls aren't visible.
    const tiers = [
      { y: 0.16, r: 0.62, d: 0.34, w: 0.062, n: 14 },
      { y: 0.30, r: 0.54, d: 0.29, w: 0.056, n: 13 },
      { y: 0.44, r: 0.46, d: 0.24, w: 0.049, n: 12 },
      { y: 0.58, r: 0.38, d: 0.19, w: 0.043, n: 11 },
      { y: 0.72, r: 0.30, d: 0.15, w: 0.037, n: 10 },
      { y: 0.86, r: 0.23, d: 0.11, w: 0.031, n: 9 },
      { y: 1.00, r: 0.16, d: 0.08, w: 0.025, n: 8 },
      { y: 1.14, r: 0.10, d: 0.055, w: 0.019, n: 6 },
      { y: 1.26, r: 0.05, d: 0.035, w: 0.013, n: 5 },
    ];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      mb.pineWhorl(t.y + j(), t.r, t.d, t.w, t.n, phase + i * 0.63, 1);
    }

    mb.cylinder([0, 0.15 + j(), 0], [0, 0.56 + j(), 0], 0.32, 0.072, 10, 1);
    mb.cylinder([0, 0.36 + j(), 0], [0, 0.80 + j(), 0], 0.27, 0.058, 10, 1);
    mb.cylinder([0, 0.58 + j(), 0], [0, 1.04 + j(), 0], 0.20, 0.042, 9, 1);
    mb.cylinder([0, 0.82 + j(), 0], [0, 1.26 + j(), 0], 0.14, 0.026, 8, 1);
    mb.cylinder([0, 1.06 + j(), 0], [0, 1.46 + j(), 0], 0.075, 0.0, 7, 1);
    // Sharp evergreen leader / steeple at the top.
    mb.cylinder([0, 1.24, 0], [0, 1.62, 0], 0.025, 0.0, 6, 1);
    mb.cylinder([0, 1.27, 0], [0, 1.56, 0], 0.014, 0.0, 6, 0);
    return new Float32Array(mb.verts);
  }

  // ── L-system expander: applies rules iteratively to an axiom string.
  function lsystem(axiom, rules, iterations) {
    let s = axiom;
    for (let it = 0; it < iterations; it++) {
      let next = "";
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        next += rules[c] !== undefined ? rules[c] : c;
      }
      s = next;
    }
    return s;
  }

  // ── Grass tuft as a compact line mesh: curved blades, mixed heights, and
  // a few seed heads. Output is a line-list:
  // [x, y, z, tipT] per vertex (tipT 0->1 gives blade-base -> blade-tip colour).
  function makeGrass(seed) {
    const rand = makePRNG(seed);
    const verts = [];

    function addLine(a, ta, b, tb) {
      verts.push(a[0], a[1], a[2], ta, b[0], b[1], b[2], tb);
    }

    const bladeCount = 18;
    const segmentCount = 3;
    for (let i = 0; i < bladeCount; i++) {
      const a = rand() * Math.PI * 2;
      const rootR = Math.sqrt(rand()) * 0.020;
      const root = [Math.cos(a) * rootR, 0, Math.sin(a) * rootR];
      const leanA = a + (rand() - 0.5) * 1.6;
      const lean = 0.030 + rand() * 0.055;
      const height = 0.075 + Math.pow(rand(), 1.7) * 0.105;
      let prev = root;
      for (let s = 1; s <= segmentCount; s++) {
        const t = s / segmentCount;
        const bend = lean * t * t;
        const twist = Math.sin((t + rand()) * Math.PI) * 0.012 * t;
        const next = [
          root[0] + Math.cos(leanA) * bend + Math.cos(leanA + Math.PI / 2) * twist,
          height * (1 - Math.pow(1 - t, 1.35)),
          root[2] + Math.sin(leanA) * bend + Math.sin(leanA + Math.PI / 2) * twist,
        ];
        addLine(prev, (s - 1) / segmentCount, next, t);
        prev = next;
      }
    }

    const seedCount = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < seedCount; i++) {
      const a = rand() * Math.PI * 2;
      const h = 0.13 + rand() * 0.075;
      const lean = 0.025 + rand() * 0.035;
      const base = [0, 0, 0];
      const tip = [Math.cos(a) * lean, h, Math.sin(a) * lean];
      addLine(base, 0.15, tip, 1.08);
      for (let k = 0; k < 3; k++) {
        const pa = a + ((k / 3) * Math.PI * 2) + rand() * 0.4;
        const head = [
          tip[0] + Math.cos(pa) * (0.010 + rand() * 0.007),
          tip[1] - 0.004 + rand() * 0.010,
          tip[2] + Math.sin(pa) * (0.010 + rand() * 0.007),
        ];
        addLine(tip, 1.08, head, 1.18);
      }
    }

    return new Float32Array(verts);
  }

  // ── Tree placement helpers. Instance stride 6 floats:
  // [worldX, worldY, worldZ, scale, yRotation, treeType]  (treeType 0 = broadleaf, 1 = pine)
  function rejectionSample(opts) {
    const out = [];
    let attempts = 0;
    const maxAttempts = opts.count * 14;
    while (out.length / 6 < opts.count && attempts < maxAttempts) {
      attempts++;
      const rx = (opts.rnd() * 2 - 1) * opts.extent * (opts.spanFrac || 0.92);
      const rz = (opts.rnd() * 2 - 1) * opts.extent * (opts.spanFrac || 0.92);
      const h = jsMountainHeight(rx, rz);
      if (h < opts.hMin || h > opts.hMax) continue;
      const eps = 0.06;
      const hx = jsMountainHeight(rx + eps, rz) - jsMountainHeight(rx - eps, rz);
      const hz = jsMountainHeight(rx, rz + eps) - jsMountainHeight(rx, rz - eps);
      const slope = Math.hypot(hx, hz) / (2 * eps);
      if (slope > opts.slopeMax) continue;
      const scale = opts.scaleFn(opts.rnd);
      const rot = opts.rnd() * Math.PI * 2;
      const settle = opts.settleFn ? opts.settleFn(scale, slope, h) : opts.yOffset;
      out.push(rx, h + settle, rz, scale, rot, opts.type);
    }
    return new Float32Array(out);
  }
  function placeTrees(count, extent, rnd) {
    return rejectionSample({
      count, extent, rnd,
      hMin: 0.20, hMax: 1.10, slopeMax: 1.4,
      yOffset: -0.006, type: 0.0,
      scaleFn: (r) => 0.12 + Math.pow(r(), 1.6) * 0.22,
      settleFn: (scale, slope) => -0.003 - slope * scale * 0.012,
    });
  }
  function placePines(count, extent, rnd) {
    // Above the broadleaf band and into the lower snow line, leaving the
    // steepest summit bare.
    return rejectionSample({
      count, extent, rnd,
      hMin: 0.88, hMax: 1.62, slopeMax: 1.85,
      yOffset: -0.004, type: 1.0,
      scaleFn: (r) => 0.17 + Math.pow(r(), 1.35) * 0.24,
      settleFn: (scale, slope) => -0.002 - slope * scale * 0.010,
    });
  }

  // ── Grass placement: dense valley and lower-foothill band, allowing
  // slightly steeper slopes where trees thin out.
  function placeGrass(count, extent, rnd) {
    const out = [];
    let attempts = 0;
    const maxAttempts = count * 10;
    while (out.length / 5 < count && attempts < maxAttempts) {
      attempts++;
      const rx = (rnd() * 2 - 1) * extent * 0.96;
      const rz = (rnd() * 2 - 1) * extent * 0.96;
      const h = jsMountainHeight(rx, rz);
      if (h < -0.22 || h > 1.08) continue;
      const eps = 0.06;
      const hx = jsMountainHeight(rx + eps, rz) - jsMountainHeight(rx - eps, rz);
      const hz = jsMountainHeight(rx, rz + eps) - jsMountainHeight(rx, rz - eps);
      const slope = Math.hypot(hx, hz) / (2 * eps);
      if (slope > 2.25) continue;
      const scale = 0.34 + rnd() * 0.38;
      const rot = rnd() * Math.PI * 2;
      out.push(rx, h - 0.018, rz, scale, rot);
    }
    return new Float32Array(out);
  }

  (async () => {
    const shared = await webgpuShared.ready;
    if (!shared || webgpuShared.lost) {
      startMountainFallback2d();
      return;
    }
    const { device, format } = shared;

    const ctx = canvas.getContext("webgpu");
    if (!ctx) {
      startMountainFallback2d();
      return;
    }
    ctx.configure({ device, format, alphaMode: "premultiplied" });
    const particleCtx = particleCanvas ? particleCanvas.getContext("webgpu") : null;
    if (particleCanvas && !particleCtx) particleCanvas.style.display = "none";
    if (particleCtx) particleCtx.configure({ device, format, alphaMode: "premultiplied" });

    // ── Grid mesh: (GRID x GRID) vertices spanning [-EXTENT, EXTENT] in XZ.
    // Vertex shader displaces Y from a fractal noise of the XZ coord.
    const GRID = 192;
    const EXTENT = 8.0;
    const verts = new Float32Array(GRID * GRID * 2);
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const i = (z * GRID + x) * 2;
        verts[i]     = (x / (GRID - 1)) * 2 * EXTENT - EXTENT;
        verts[i + 1] = (z / (GRID - 1)) * 2 * EXTENT - EXTENT;
      }
    }
    const indices = new Uint32Array((GRID - 1) * (GRID - 1) * 6);
    let idx = 0;
    for (let z = 0; z < GRID - 1; z++) {
      for (let x = 0; x < GRID - 1; x++) {
        const a = z * GRID + x;
        const b = a + 1;
        const c = a + GRID;
        const d = c + 1;
        // CCW when viewed from +Y (upward-facing side is the front face)
        indices[idx++] = a; indices[idx++] = c; indices[idx++] = b;
        indices[idx++] = b; indices[idx++] = c; indices[idx++] = d;
      }
    }
    const vertexBuffer = device.createBuffer({
      size: verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, verts);
    const indexBuffer = device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, indices);

    // ── Uniform layout (112 bytes, std140-style):
    //   off  0  mat4x4f  viewProj
    //   off 64  vec3f    cameraPos
    //   off 76  f32      time
    //   off 80  vec3f    sunDir
    //   off 92  f32      seasonT      (0 = winter snow, 1 = green forest)
    //   off 96  f32      fade         (0 = invisible, 1 = full)
    //   off 100 f32      themeDark    (0 = light, 1 = dark)
    //   off 104 vec2f    canvasSize   (CSS display W,H in CSS pixels)
    const UNIFORM_SIZE = 112;
    const uniformBuffer = device.createBuffer({
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const uniformData = new Float32Array(UNIFORM_SIZE / 4);

    const wgsl = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  sunDir: vec3<f32>,
  seasonT: f32,
  fade: f32,
  themeDark: f32,
  canvasSize: vec2<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash21(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
}
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}
fn fbm(p: vec2<f32>) -> f32 {
  var v: f32 = 0.0;
  var amp: f32 = 0.55;
  var pp: vec2<f32> = p;
  for (var i: i32 = 0; i < 6; i = i + 1) {
    v = v + amp * vnoise(pp);
    pp = pp * 2.03 + vec2<f32>(11.1, 7.3);
    amp = amp * 0.5;
  }
  return v;
}
fn ridge(p: vec2<f32>) -> f32 {
  return 1.0 - abs(vnoise(p) * 2.0 - 1.0);
}
fn ridgedFbm(p: vec2<f32>) -> f32 {
  var v: f32 = 0.0;
  var amp: f32 = 0.6;
  var pp: vec2<f32> = p;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + amp * ridge(pp);
    pp = pp * 2.07 + vec2<f32>(3.7, 9.1);
    amp = amp * 0.5;
  }
  return v;
}
fn mountainHeight(pos: vec2<f32>) -> f32 {
  // Single central peak (radial bump) + sharp ridges + soft foothills.
  let r2 = dot(pos, pos);
  let base = exp(-r2 * 0.04) * 2.6;
  let ridges = ridgedFbm(pos * 0.5);
  let baseN = fbm(pos * 0.4);
  return base + ridges * 0.8 + baseN * 0.5 - 0.4;
}

struct VOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) height: f32,
  @location(3) slope: f32,
};

@vertex
fn vs_main(@location(0) xz: vec2<f32>) -> VOut {
  let h = mountainHeight(xz);
  let world = vec3<f32>(xz.x, h, xz.y);

  // Analytic normal via finite differences (no separate normal attribute).
  let eps = 0.06;
  let hx1 = mountainHeight(xz + vec2<f32>(eps, 0.0));
  let hx0 = mountainHeight(xz - vec2<f32>(eps, 0.0));
  let hz1 = mountainHeight(xz + vec2<f32>(0.0, eps));
  let hz0 = mountainHeight(xz - vec2<f32>(0.0, eps));
  let n = normalize(vec3<f32>(hx0 - hx1, 2.0 * eps, hz0 - hz1));

  var o: VOut;
  o.clipPos = u.viewProj * vec4<f32>(world, 1.0);
  o.worldPos = world;
  o.normal = n;
  o.height = h;
  o.slope = 1.0 - n.y;
  return o;
}

@fragment
fn fs_main(v: VOut) -> @location(0) vec4<f32> {
  let n = normalize(v.normal);
  let viewDir = normalize(v.worldPos - u.cameraPos);
  let l = normalize(u.sunDir);
  let ndl = max(0.0, dot(n, l));
  let halfV = normalize(l - viewDir);
  let spec = pow(max(0.0, dot(n, halfV)), 24.0) * 0.18;
  let lit = 0.35 + ndl * 0.9 + spec;

  // Two palettes, mixed by seasonT. In dark theme snow tilts toward a
  // moody alpine-night gray-blue instead of pure white so it doesn't blow
  // out against the page; rock and valley pick up a matching cool dim.
  let snowW   = mix(vec3<f32>(0.94, 0.96, 1.00), vec3<f32>(0.30, 0.36, 0.46), u.themeDark);
  let rockW   = mix(vec3<f32>(0.55, 0.55, 0.62), vec3<f32>(0.20, 0.22, 0.28), u.themeDark);
  let valleyW = mix(vec3<f32>(0.78, 0.82, 0.88), vec3<f32>(0.24, 0.28, 0.34), u.themeDark);
  let snowS   = mix(vec3<f32>(0.86, 0.85, 0.78), vec3<f32>(0.24, 0.26, 0.30), u.themeDark);
  let rockS   = mix(vec3<f32>(0.52, 0.45, 0.34), vec3<f32>(0.18, 0.17, 0.16), u.themeDark);
  let valleyS = mix(vec3<f32>(0.26, 0.52, 0.22), vec3<f32>(0.10, 0.20, 0.12), u.themeDark);

  let t = u.seasonT;
  let snowC   = mix(snowW,   snowS,   t);
  let rockC   = mix(rockW,   rockS,   t);
  let valleyC = mix(valleyW, valleyS, t);

  // Snow descends further in winter; valley line is higher in summer.
  let snowLine   = mix(0.7, 1.6, t);
  let valleyLine = mix(0.0, 0.15, t);

  let h = v.height;
  var color: vec3<f32>;
  if (h < valleyLine) {
    color = valleyC;
  } else if (h < snowLine) {
    color = mix(valleyC, rockC, smoothstep(valleyLine, snowLine, h));
  } else {
    color = mix(rockC, snowC, smoothstep(snowLine, snowLine + 0.4, h));
  }

  // Steep faces expose darker rock regardless of band.
  let slopeFactor = smoothstep(0.32, 0.72, v.slope);
  color = mix(color, rockC * 0.75, slopeFactor * 0.65);

  color = color * lit;

  // Atmospheric depth blends into a sky tint that also drifts with season.
  let dist = length(v.worldPos - u.cameraPos);
  let fog = clamp((dist - 3.5) / 14.0, 0.0, 0.85);
  let skyW = mix(vec3<f32>(0.78, 0.84, 0.95), vec3<f32>(0.12, 0.14, 0.20), u.themeDark);
  let skyS = mix(vec3<f32>(0.88, 0.82, 0.70), vec3<f32>(0.14, 0.13, 0.18), u.themeDark);
  let skyColor = mix(skyW, skyS, t);
  color = mix(color, skyColor, fog);

  // Premultiplied alpha (matches ctx.configure alphaMode).
  return vec4<f32>(color * u.fade, u.fade);
}

// ── Trees: trunk vertices stay at full size (so the mountain "appears" with
// stems already visible, snow-white at first); leaf-cluster vertices use a
// shared cluster center so broadleaf crowns grow in across the season.
// Pine needles keep their evergreen silhouette and recolour by season.
struct TreeVOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) isLeaf: f32,
  @location(3) treeType: f32,
};

@vertex
fn tree_vs(@location(0) localPos: vec3<f32>,
           @location(1) localCenter: vec3<f32>,
           @location(2) localNormal: vec3<f32>,
           @location(3) isLeaf: f32,
           @location(4) instOrigin: vec3<f32>,
           @location(5) instData: vec3<f32>) -> TreeVOut {
  let instScale = instData.x;
  let r = instData.y;
  let treeType = instData.z;

  // Leaves on broadleaf trees expand from the cluster center as season
  // grows. For stems (center=self) and pine cones (center=self) the offset
  // is zero so leafScale has no effect.
  let seasonGrow = smoothstep(0.18, 0.55, u.seasonT);
  let leafScale = mix(1.0, seasonGrow, isLeaf);
  let local = localCenter + (localPos - localCenter) * leafScale;
  let scaled = local * (instScale * u.fade);

  let cr = cos(r);
  let sr = sin(r);
  let rotated = vec3<f32>(
    cr * scaled.x + sr * scaled.z,
    scaled.y,
    -sr * scaled.x + cr * scaled.z,
  );
  let world = rotated + instOrigin;
  let n = vec3<f32>(
    cr * localNormal.x + sr * localNormal.z,
    localNormal.y,
    -sr * localNormal.x + cr * localNormal.z,
  );

  var o: TreeVOut;
  o.clipPos = u.viewProj * vec4<f32>(world, 1.0);
  o.worldPos = world;
  o.normal = n;
  o.isLeaf = isLeaf;
  o.treeType = treeType;
  return o;
}

@fragment
fn tree_fs(v: TreeVOut) -> @location(0) vec4<f32> {
  let n = normalize(v.normal);
  let l = normalize(u.sunDir);
  let ndl = max(0.0, dot(n, l));
  let lit = 0.45 + ndl * 0.7;

  // Stems start snow-white when the mountain first appears and fade to
  // varied bark over the season.
  let barkTint = fract(sin(dot(v.worldPos.xz, vec2<f32>(21.73, 67.19))) * 43758.5453);
  let bark = mix(vec3<f32>(0.23, 0.14, 0.08), vec3<f32>(0.38, 0.24, 0.13), barkTint);
  let stem = mix(vec3<f32>(0.94, 0.96, 0.99), bark, u.seasonT);

  // Broadleaf canopy: mixed warm/cool greens with slight height variation.
  let wobble = fract(sin(dot(v.worldPos.xz, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let leafHeight = smoothstep(0.55, 1.55, v.worldPos.y);
  let broadWinter = mix(vec3<f32>(0.84, 0.88, 0.78), vec3<f32>(0.66, 0.74, 0.62), wobble);
  let broadSummer = mix(vec3<f32>(0.10, 0.30, 0.12), vec3<f32>(0.34, 0.50, 0.16), wobble);
  var broadLeaf = mix(broadWinter, broadSummer, u.seasonT);
  broadLeaf = mix(broadLeaf, broadLeaf * vec3<f32>(1.14, 1.08, 0.88), leafHeight * 0.25);

  // Pine needles keep their evergreen mass but vary by tree and light angle.
  // Two scaled-noise samples give per-tree variation AND a finer per-branch
  // variation so the canopy reads as clusters of needles rather than a flat mass.
  let pineTint = fract(sin(dot(v.worldPos.xz, vec2<f32>(41.17, 19.31))) * 43758.5453);
  let needleNoise = fract(sin(dot(v.worldPos.xyz * 7.3, vec3<f32>(12.9898, 78.233, 33.71))) * 43758.5453);
  let pineBand = fract(v.worldPos.y * 9.7 + pineTint * 3.1);
  let upwardNeedle = smoothstep(-0.18, 0.72, n.y);
  let pineWinter = mix(vec3<f32>(0.78, 0.88, 0.92), vec3<f32>(0.46, 0.62, 0.58), pineTint);
  // Deeper, more saturated evergreen for summer with a hint of blue-green variation.
  let pineSummerDark  = vec3<f32>(0.050, 0.150, 0.080);
  let pineSummerMid   = vec3<f32>(0.160, 0.350, 0.135);
  let pineSummerBlue  = vec3<f32>(0.100, 0.280, 0.180);
  let pineSummer = mix(
    mix(pineSummerDark, pineSummerMid, pineTint),
    pineSummerBlue,
    needleNoise * 0.35,
  );
  var pineLeaf = mix(pineWinter, pineSummer, u.seasonT);
  // Light-facing (top) needles glow brighter; underside needles stay shadowed.
  pineLeaf = mix(pineLeaf * vec3<f32>(0.62, 0.78, 0.70), pineLeaf * vec3<f32>(1.22, 1.10, 0.86), upwardNeedle);
  // Faint horizontal banding picks out the whorls.
  pineLeaf = mix(pineLeaf, pineLeaf * vec3<f32>(0.84, 0.94, 0.82), step(0.76, pineBand) * 0.22);
  // Snow dust on top-facing needles in winter. Tinted toward a cool blue-gray
  // in dark theme so the dust matches the mountain palette.
  let pineSnow = mix(vec3<f32>(0.92, 0.96, 0.99), vec3<f32>(0.40, 0.46, 0.56), u.themeDark);
  pineLeaf = mix(pineLeaf, pineSnow, (1.0 - u.seasonT) * upwardNeedle * 0.30);
  // Final dark-theme dim so the canopy reads moodier without losing definition.
  let pineDarkMul = mix(1.0, 0.55, u.themeDark);
  pineLeaf = pineLeaf * pineDarkMul;

  let leaf = mix(broadLeaf, pineLeaf, v.treeType);
  var color = mix(stem, leaf, v.isLeaf) * lit;

  let dist = length(v.worldPos - u.cameraPos);
  let fog = clamp((dist - 3.5) / 14.0, 0.0, 0.85);
  let skyW = mix(vec3<f32>(0.78, 0.84, 0.95), vec3<f32>(0.12, 0.14, 0.20), u.themeDark);
  let skyS = mix(vec3<f32>(0.88, 0.82, 0.70), vec3<f32>(0.14, 0.13, 0.18), u.themeDark);
  let skyColor = mix(skyW, skyS, u.seasonT);
  color = mix(color, skyColor, fog);

  let alpha = u.fade;
  return vec4<f32>(color * alpha, alpha);
}

// ── Grass: instanced curved-blade line tufts.
struct GrassVOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) tipT: f32,
};

@vertex
fn grass_vs(@location(0) localPos: vec3<f32>,
            @location(1) tipT: f32,
            @location(2) instOrigin: vec3<f32>,
            @location(3) instScaleRot: vec2<f32>) -> GrassVOut {
  let seasonGrow = smoothstep(0.20, 0.55, u.seasonT);
  let s = instScaleRot.x * seasonGrow * u.fade;
  let r = instScaleRot.y;
  let cr = cos(r);
  let sr = sin(r);
  var sp = localPos * s;
  let tuftRand = fract(sin(dot(instOrigin.xz, vec2<f32>(53.1, 17.7))) * 43758.5453);
  let bend = (tuftRand - 0.5) * 0.060 * tipT * tipT * u.seasonT;
  sp.x = sp.x + bend;
  sp.z = sp.z + (0.5 - tuftRand) * 0.035 * tipT * tipT * u.seasonT;
  let rotated = vec3<f32>(
    cr * sp.x + sr * sp.z,
    sp.y,
    -sr * sp.x + cr * sp.z,
  );
  let world = rotated + instOrigin;

  var o: GrassVOut;
  o.clipPos = u.viewProj * vec4<f32>(world, 1.0);
  o.worldPos = world;
  o.tipT = tipT;
  return o;
}

@fragment
fn grass_fs(v: GrassVOut) -> @location(0) vec4<f32> {
  let bladeT = clamp(v.tipT, 0.0, 1.0);
  let winterBase = vec3<f32>(0.58, 0.64, 0.52);
  let winterTip  = vec3<f32>(0.78, 0.82, 0.66);
  let summerBase = vec3<f32>(0.18, 0.34, 0.12);
  let summerTip  = vec3<f32>(0.55, 0.64, 0.20);
  let base = mix(winterBase, summerBase, u.seasonT);
  let tip = mix(winterTip, summerTip, u.seasonT);
  var color = mix(base, tip, bladeT);
  let seedHead = smoothstep(1.02, 1.16, v.tipT);
  color = mix(color, vec3<f32>(0.74, 0.58, 0.24), seedHead * (0.35 + 0.65 * u.seasonT));

  let dist = length(v.worldPos - u.cameraPos);
  let fog = clamp((dist - 3.5) / 14.0, 0.0, 0.85);
  let skyW = mix(vec3<f32>(0.78, 0.84, 0.95), vec3<f32>(0.12, 0.14, 0.20), u.themeDark);
  let skyS = mix(vec3<f32>(0.88, 0.82, 0.70), vec3<f32>(0.14, 0.13, 0.18), u.themeDark);
  let skyColor = mix(skyW, skyS, u.seasonT);
  color = mix(color, skyColor, fog);

  let alpha = u.fade;
  return vec4<f32>(color * alpha, alpha);
}

struct ParticleUniforms {
  viewport: vec2<f32>,
  time: f32,
  seasonT: f32,
  fade: f32,
  themeDark: f32,
};
@group(0) @binding(1) var<uniform> p: ParticleUniforms;

fn hash11(n: f32) -> f32 {
  return fract(sin(n) * 43758.5453123);
}

fn rotate2(v: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);
}

struct ParticleOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) leafKeep: f32,
  @location(2) flakeSeed: f32,
};

@vertex
fn particle_vs(@builtin(vertex_index) vid: u32,
               @builtin(instance_index) iid: u32) -> ParticleOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let q = corners[vid % 6u];
  let id = f32(iid);
  let s0 = hash11(id * 12.9898 + 0.17);
  let s1 = hash11(id * 78.233 + 1.91);
  let s2 = hash11(id * 37.719 + 4.71);
  let s3 = hash11(id * 91.113 + 8.33);
  let s4 = hash11(id * 53.337 + 2.23);

  let snowPhase = 1.0 - smoothstep(0.18, 0.52, p.seasonT);
  let leafPhase = smoothstep(0.55, 0.86, p.seasonT);
  let leafMix = leafPhase / max(0.001, snowPhase + leafPhase);

  let snowCycle = fract(s1 + p.time * (0.035 + s2 * 0.026));
  let snowFall = snowCycle * snowCycle;
  var snowX = s0 * 2.42 - 1.21 + sin(p.time * (0.55 + s4) + s3 * 6.28318) * 0.065 + p.time * 0.012;
  snowX = fract((snowX + 1.21) / 2.42) * 2.42 - 1.21;
  let snowY = 1.18 - snowFall * 2.36;

  let leafCycle = fract(s3 + p.time * (0.012 + s4 * 0.012));
  let leafFall = leafCycle * 0.62 + 0.38 * leafCycle * leafCycle;
  var leafX = s0 * 2.48 - 1.24 + sin(p.time * (1.10 + s2) + s1 * 6.28318) * 0.16 + p.time * (0.012 + s2 * 0.020);
  leafX = fract((leafX + 1.24) / 2.48) * 2.48 - 1.24;
  let leafY = 1.16 - leafFall * 2.32 + sin(p.time * 3.1 + s0 * 6.28318) * 0.020 * leafPhase;

  let pos = mix(vec2<f32>(snowX, snowY), vec2<f32>(leafX, leafY), leafMix);
  let snowPx = 4.2 + s2 * 5.4;
  let leafPx = 5.5 + s4 * 5.0;
  let pxSize = mix(vec2<f32>(snowPx, snowPx), vec2<f32>(leafPx * 1.65, leafPx * 0.72), leafMix);
  let angle = leafMix * (p.time * (1.8 + s2 * 2.8) + s1 * 6.28318 + sin(p.time * 2.2 + s3 * 6.28318) * 0.65);
  let local = rotate2(q * pxSize / p.viewport * 2.0, angle);

  var o: ParticleOut;
  o.clipPos = vec4<f32>(pos + local, 0.0, 1.0);
  o.uv = q;
  o.leafKeep = 1.0 - step(0.30, s4);
  o.flakeSeed = s3;
  return o;
}

fn lineMask(uv: vec2<f32>, dir: vec2<f32>, halfWidth: f32, endAt: f32) -> f32 {
  let along = abs(dot(uv, dir));
  let dist = abs(uv.x * dir.y - uv.y * dir.x);
  let stroke = 1.0 - smoothstep(halfWidth, halfWidth * 1.85, dist);
  let cap = 1.0 - smoothstep(endAt * 0.78, endAt, along);
  return stroke * cap;
}

@fragment
fn particle_fs(v: ParticleOut) -> @location(0) vec4<f32> {
  let snowPhase = 1.0 - smoothstep(0.18, 0.52, p.seasonT);
  let leafPhase = smoothstep(0.55, 0.86, p.seasonT);
  let r = length(v.uv);
  let d0 = vec2<f32>(1.0, 0.0);
  let d1 = vec2<f32>(0.5, 0.8660254);
  let d2 = vec2<f32>(-0.5, 0.8660254);
  var flake = 1.0 - smoothstep(0.08, 0.24, r);
  flake = max(flake, lineMask(v.uv, d0, 0.030, 0.92));
  flake = max(flake, lineMask(v.uv, d1, 0.030, 0.92));
  flake = max(flake, lineMask(v.uv, d2, 0.030, 0.92));
  let branchA = 0.54 + v.flakeSeed * 0.10;
  flake = max(flake, lineMask(v.uv - d0 * 0.40, normalize(d1), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv + d0 * 0.40, normalize(d2), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv - d1 * 0.40, normalize(d2), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv + d1 * 0.40, normalize(d0), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv - d2 * 0.40, normalize(d0), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv + d2 * 0.40, normalize(d1), 0.018, branchA) * 0.72);
  let snowAlpha = flake * (1.0 - smoothstep(0.96, 1.18, r)) * snowPhase;
  let leafShape = (1.0 - smoothstep(0.18, 1.0, abs(v.uv.x))) * (1.0 - smoothstep(0.08, 1.0, abs(v.uv.y)));
  let leafVein = 1.0 - smoothstep(0.03, 0.11, abs(v.uv.x));
  let leafAlpha = leafShape * leafPhase * v.leafKeep;
  let snowColor = vec3<f32>(0.92, 0.97, 1.0);
  let leafT = 0.5 + 0.5 * v.uv.y;
  var lightLeaf = mix(vec3<f32>(0.28, 0.55, 0.24), vec3<f32>(0.78, 0.86, 0.28), leafT);
  lightLeaf = mix(lightLeaf, vec3<f32>(0.90, 0.94, 0.42), leafVein * 0.24);
  var darkLeaf = mix(vec3<f32>(0.10, 0.30, 0.11), vec3<f32>(0.48, 0.55, 0.12), leafT);
  darkLeaf = mix(darkLeaf, vec3<f32>(0.62, 0.68, 0.20), leafVein * 0.18);
  let leafColor = mix(lightLeaf, darkLeaf, p.themeDark);
  let combinedAlpha = max(snowAlpha, leafAlpha) * p.fade;
  let color = (snowColor * snowAlpha + leafColor * leafAlpha) / max(0.001, snowAlpha + leafAlpha);
  return vec4<f32>(color * combinedAlpha, combinedAlpha);
}
`;
    const shaderModule = device.createShaderModule({ code: wgsl });

    // Explicit pipeline layout so the mountain and tree pipelines share the
    // same uniform bind group rather than two auto-generated layouts.
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      }],
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    const blendPremul = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };

    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: 8,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
        }],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{ format, blend: blendPremul }],
      },
      primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
    });

    // Shared placement PRNG so the forest stays the same across reloads.
    let placementSeed = 0xC0FFEE;
    const placementRand = () => {
      placementSeed = (placementSeed * 1664525 + 1013904223) >>> 0;
      return placementSeed / 4294967296;
    };

    // ── Tree pipeline + geometry. Vertex stride 40 (3 pos + 3 center +
    // 3 normal + 1 isLeaf), instance stride 24 (3 origin + 3 [scale,rot,type]).
    const treeGeom = makeTree(11);
    const treeVertCount = treeGeom.length / 10;
    const treeVertBuffer = device.createBuffer({
      size: treeGeom.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(treeVertBuffer, 0, treeGeom);

    const treeInstanceData = placeTrees(900, EXTENT, placementRand);
    const treeInstanceCount = treeInstanceData.length / 6;
    const treeInstanceBuffer = device.createBuffer({
      size: treeInstanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(treeInstanceBuffer, 0, treeInstanceData);

    // Pine geometry uses the same vertex layout, so the same pipeline draws it.
    const pineGeom = makePine(31);
    const pineVertCount = pineGeom.length / 10;
    const pineVertBuffer = device.createBuffer({
      size: pineGeom.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(pineVertBuffer, 0, pineGeom);

    const pineInstanceData = placePines(560, EXTENT, placementRand);
    const pineInstanceCount = pineInstanceData.length / 6;
    const pineInstanceBuffer = device.createBuffer({
      size: pineInstanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(pineInstanceBuffer, 0, pineInstanceData);

    const treePipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "tree_vs",
        buffers: [
          {
            arrayStride: 40,
            attributes: [
              { shaderLocation: 0, offset: 0,  format: "float32x3" }, // localPos
              { shaderLocation: 1, offset: 12, format: "float32x3" }, // localCenter
              { shaderLocation: 2, offset: 24, format: "float32x3" }, // normal
              { shaderLocation: 3, offset: 36, format: "float32"   }, // isLeaf
            ],
          },
          {
            arrayStride: 24,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 4, offset: 0,  format: "float32x3" }, // origin
              { shaderLocation: 5, offset: 12, format: "float32x3" }, // scale, rot, type
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "tree_fs",
        targets: [{ format, blend: blendPremul }],
      },
      primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
    });

    // ── Grass: curved blade tuft, instanced densely on the valley /
    // low-slope band. Stride 16: 12B position + 4B tipT.
    const grassGeom = makeGrass(23);
    const grassVertCount = grassGeom.length / 4;
    const grassVertBuffer = device.createBuffer({
      size: grassGeom.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(grassVertBuffer, 0, grassGeom);

    const grassInstanceData = placeGrass(11000, EXTENT, placementRand);
    const grassInstanceCount = grassInstanceData.length / 5;
    const grassInstanceBuffer = device.createBuffer({
      size: grassInstanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(grassInstanceBuffer, 0, grassInstanceData);

    // ── CPU frustum culling. The mountain only re-renders on scroll/theme/
    // resize, so a per-render linear scan of ~12.5k instances is cheap.
    // Sphere/plane test rejects instances completely outside the view.
    // We rewrite the same instance buffer each frame with only the visible
    // prefix, and pass the surviving count to draw().
    const culledTreeData = new Float32Array(treeInstanceData.length);
    const culledPineData = new Float32Array(pineInstanceData.length);
    const culledGrassData = new Float32Array(grassInstanceData.length);
    let culledTreeCount = treeInstanceCount;
    let culledPineCount = pineInstanceCount;
    let culledGrassCount = grassInstanceCount;
    const frustumPlanes = new Float32Array(24); // 6 planes × 4 floats

    // Extract the 6 frustum planes from a column-major viewProj matrix that
    // targets WebGPU clip space (z in [0, 1]). Each plane is normalized so
    // signed distance to a point is `a*x + b*y + c*z + d`; positive = inside.
    function extractFrustumPlanes(m, out) {
      // Left: row3 + row0
      out[ 0] = m[ 3] + m[ 0]; out[ 1] = m[ 7] + m[ 4]; out[ 2] = m[11] + m[ 8]; out[ 3] = m[15] + m[12];
      // Right: row3 - row0
      out[ 4] = m[ 3] - m[ 0]; out[ 5] = m[ 7] - m[ 4]; out[ 6] = m[11] - m[ 8]; out[ 7] = m[15] - m[12];
      // Bottom: row3 + row1
      out[ 8] = m[ 3] + m[ 1]; out[ 9] = m[ 7] + m[ 5]; out[10] = m[11] + m[ 9]; out[11] = m[15] + m[13];
      // Top: row3 - row1
      out[12] = m[ 3] - m[ 1]; out[13] = m[ 7] - m[ 5]; out[14] = m[11] - m[ 9]; out[15] = m[15] - m[13];
      // Near (D3D-style z >= 0): row2
      out[16] = m[ 2];          out[17] = m[ 6];          out[18] = m[10];          out[19] = m[14];
      // Far: row3 - row2
      out[20] = m[ 3] - m[ 2]; out[21] = m[ 7] - m[ 6]; out[22] = m[11] - m[10]; out[23] = m[15] - m[14];
      for (let p = 0; p < 6; p++) {
        const o = p * 4;
        const a = out[o], b = out[o + 1], c = out[o + 2];
        const inv = 1 / Math.max(1e-8, Math.hypot(a, b, c));
        out[o] = a * inv; out[o + 1] = b * inv; out[o + 2] = c * inv; out[o + 3] = out[o + 3] * inv;
      }
    }

    function cullStride6(src, total, planes, centerYMul, radiusMul, out) {
      let count = 0;
      for (let i = 0; i < total; i++) {
        const off = i * 6;
        const x = src[off], yb = src[off + 1], z = src[off + 2], scale = src[off + 3];
        const cy = yb + centerYMul * scale;
        const r = radiusMul * scale;
        let inside = true;
        for (let p = 0; p < 6; p++) {
          const o = p * 4;
          if (planes[o] * x + planes[o + 1] * cy + planes[o + 2] * z + planes[o + 3] < -r) {
            inside = false;
            break;
          }
        }
        if (inside) {
          const o2 = count * 6;
          out[o2]     = x;
          out[o2 + 1] = yb;
          out[o2 + 2] = z;
          out[o2 + 3] = scale;
          out[o2 + 4] = src[off + 4];
          out[o2 + 5] = src[off + 5];
          count++;
        }
      }
      return count;
    }

    function cullStride5(src, total, planes, centerYMul, radiusMul, out) {
      let count = 0;
      for (let i = 0; i < total; i++) {
        const off = i * 5;
        const x = src[off], yb = src[off + 1], z = src[off + 2], scale = src[off + 3];
        const cy = yb + centerYMul * scale;
        const r = radiusMul * scale;
        let inside = true;
        for (let p = 0; p < 6; p++) {
          const o = p * 4;
          if (planes[o] * x + planes[o + 1] * cy + planes[o + 2] * z + planes[o + 3] < -r) {
            inside = false;
            break;
          }
        }
        if (inside) {
          const o2 = count * 5;
          out[o2]     = x;
          out[o2 + 1] = yb;
          out[o2 + 2] = z;
          out[o2 + 3] = scale;
          out[o2 + 4] = src[off + 4];
          count++;
        }
      }
      return count;
    }

    const grassPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "grass_vs",
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0,  format: "float32x3" }, // localPos
              { shaderLocation: 1, offset: 12, format: "float32"   }, // tipT
            ],
          },
          {
            arrayStride: 20,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 2, offset: 0,  format: "float32x3" }, // origin
              { shaderLocation: 3, offset: 12, format: "float32x2" }, // scale + rot
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "grass_fs",
        targets: [{ format, blend: blendPremul }],
      },
      primitive: { topology: "line-list" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
    });

    const particleBindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      }],
    });
    const particlePipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [particleBindGroupLayout],
    });
    const PARTICLE_COUNT = 256;
    const particleUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const particleUniformData = new Float32Array(8);
    const particleBindGroup = device.createBindGroup({
      layout: particleBindGroupLayout,
      entries: [{ binding: 1, resource: { buffer: particleUniformBuffer } }],
    });
    const particlePipeline = particleCtx ? device.createRenderPipeline({
      layout: particlePipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "particle_vs",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "particle_fs",
        targets: [{ format, blend: blendPremul }],
      },
      primitive: { topology: "triangle-list" },
    }) : null;

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    let depthTex = null;
    let depthView = null;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(window.innerWidth * dpr));
      const h = Math.max(1, Math.floor(stableInnerHeight * dpr));
      const particleSized = !particleCanvas || (particleCanvas.width === w && particleCanvas.height === h);
      if (canvas.width === w && canvas.height === h && particleSized && depthTex) return;
      canvas.width = w;
      canvas.height = h;
      if (particleCanvas) {
        particleCanvas.width = w;
        particleCanvas.height = h;
      }
      if (depthTex) depthTex.destroy();
      depthTex = device.createTexture({
        size: [w, h],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      depthView = depthTex.createView();
    }
    resize();

    function render(nowSeconds) {
      const { p1, p2 } = getScrollPhases();

      // Phase 1 → close-up to wider framing ("zoom out" as fade comes in).
      const radius = 3.6 + 4.0 * p1;
      // Phase 2 → one full revolution around the peak, with a gentle vertical bob.
      const angle = 0.18 * Math.PI + p2 * Math.PI * 2;
      const camY = 1.85 + 0.55 * Math.sin(p2 * Math.PI * 2);
      const eye = [Math.sin(angle) * radius, camY, Math.cos(angle) * radius];
      const target = [0, 0.9, 0];
      const up = [0, 1, 0];

      const fade = p1;
      const seasonT = Math.min(1, p2 / 0.7);
      setMountainOpacity(fade);

      // The canvas buffer is kept at a stable device-pixel size so dynamic
      // browser chrome doesn't trigger expensive resizes, but the CSS display
      // size can differ (e.g. buffer = svh, display = lvh on mobile). Drive
      // the perspective aspect from the on-screen display rect so the browser's
      // buffer-to-display stretch lands at the intended scene aspect ratio.
      const displayRect = canvas.getBoundingClientRect();
      const displayW = displayRect.width || canvas.width;
      const displayH = displayRect.height || canvas.height;
      const aspect = displayW / displayH;
      const proj = mat4Perspective(Math.PI / 3, aspect, 0.1, 80);
      const viewMat = mat4LookAt(eye, target, up);
      const vp = mat4Mul(proj, viewMat);

      const sunDir = [0.45, 0.80, 0.35];

      uniformData.set(vp, 0);
      uniformData[16] = eye[0]; uniformData[17] = eye[1]; uniformData[18] = eye[2];
      uniformData[19] = nowSeconds;
      uniformData[20] = sunDir[0]; uniformData[21] = sunDir[1]; uniformData[22] = sunDir[2];
      uniformData[23] = seasonT;
      uniformData[24] = fade;
      uniformData[25] = isDark() ? 1 : 0;
      uniformData[26] = displayW;
      uniformData[27] = displayH;
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      // Frustum-cull instances before uploading. The bounding-sphere radii
      // are deliberately generous to cover the tallest tree/widest droop;
      // popping at the edge of view is more jarring than the cost saved.
      extractFrustumPlanes(vp, frustumPlanes);
      culledTreeCount  = cullStride6(treeInstanceData,  treeInstanceCount,  frustumPlanes, 0.70, 1.30, culledTreeData);
      culledPineCount  = cullStride6(pineInstanceData,  pineInstanceCount,  frustumPlanes, 0.85, 1.55, culledPineData);
      culledGrassCount = cullStride5(grassInstanceData, grassInstanceCount, frustumPlanes, 0.05, 0.18, culledGrassData);
      if (culledTreeCount > 0)  device.queue.writeBuffer(treeInstanceBuffer,  0, culledTreeData,  0, culledTreeCount  * 6);
      if (culledPineCount > 0)  device.queue.writeBuffer(pineInstanceBuffer,  0, culledPineData,  0, culledPineCount  * 6);
      if (culledGrassCount > 0) device.queue.writeBuffer(grassInstanceBuffer, 0, culledGrassData, 0, culledGrassCount * 5);

      const tex = ctx.getCurrentTexture();
      const cmd = device.createCommandEncoder();
      const pass = cmd.beginRenderPass({
        colorAttachments: [{
          view: tex.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      pass.setBindGroup(0, bindGroup);
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setIndexBuffer(indexBuffer, "uint32");
      pass.drawIndexed(indices.length);
      // Foliage shares the same depth buffer.
      pass.setPipeline(treePipeline);
      pass.setVertexBuffer(0, treeVertBuffer);
      pass.setVertexBuffer(1, treeInstanceBuffer);
      if (culledTreeCount > 0) pass.draw(treeVertCount, culledTreeCount);
      // Pines reuse the same pipeline (same vertex layout) but their own
      // geometry and instance band higher up the mountain.
      pass.setVertexBuffer(0, pineVertBuffer);
      pass.setVertexBuffer(1, pineInstanceBuffer);
      if (culledPineCount > 0) pass.draw(pineVertCount, culledPineCount);
      pass.setPipeline(grassPipeline);
      pass.setVertexBuffer(0, grassVertBuffer);
      pass.setVertexBuffer(1, grassInstanceBuffer);
      if (culledGrassCount > 0) pass.draw(grassVertCount, culledGrassCount);
      pass.end();
      device.queue.submit([cmd.finish()]);
    }

    function renderParticles(nowSeconds) {
      if (!particleCtx || !particlePipeline || !particleCanvas) return;

      const { p1, p2 } = getScrollPhases();
      // Use the CSS display rect so particle pixel sizes stay consistent on
      // screen even when the buffer was sized to a different (stable) height.
      const particleRect = particleCanvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      particleUniformData[0] = (particleRect.width || particleCanvas.width / dpr) * dpr;
      particleUniformData[1] = (particleRect.height || particleCanvas.height / dpr) * dpr;
      particleUniformData[2] = nowSeconds;
      particleUniformData[3] = Math.min(1, p2 / 0.7);
      particleUniformData[4] = p1;
      particleUniformData[5] = isDark() ? 1 : 0;
      device.queue.writeBuffer(particleUniformBuffer, 0, particleUniformData);

      const tex = particleCtx.getCurrentTexture();
      const cmd = device.createCommandEncoder();
      const pass = cmd.beginRenderPass({
        colorAttachments: [{
          view: tex.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(particlePipeline);
      pass.setBindGroup(0, particleBindGroup);
      pass.draw(6, PARTICLE_COUNT);
      pass.end();
      device.queue.submit([cmd.finish()]);
    }

    // The mountain surface only redraws on scroll/resize/theme. The particle
    // canvas re-renders each frame, but only while the backdrop's content
    // range is in view — outside that range we skip every GPU submission.
    let needsRender = true;
    let mountainVisible = false;
    let rafQueued = false;
    function ensureTick() {
      if (rafQueued || !mountainVisible) return;
      rafQueued = true;
      requestAnimationFrame(tick);
    }
    function schedule() {
      needsRender = true;
      ensureTick();
    }
    function tick(now) {
      rafQueued = false;
      if (!mountainVisible) return;
      const nowSeconds = now * 0.001;
      const phases = getScrollPhases();
      if (phases.p1 < FADE_THRESHOLD) {
        // Section is in view (IntersectionObserver says so) but the fade
        // mapping puts the mountain at zero opacity — drop GPU work.
        setMountainOpacity(0);
        ensureTick();
        return;
      }
      if (needsRender) {
        needsRender = false;
        render(nowSeconds);
      }
      renderParticles(nowSeconds);
      ensureTick();
    }
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", () => { resize(); schedule(); });

    const visibleSections = new Set();
    const visObserver = new IntersectionObserver((entries) => {
      const wasVisible = mountainVisible;
      for (const e of entries) {
        if (e.isIntersecting) visibleSections.add(e.target);
        else visibleSections.delete(e.target);
      }
      mountainVisible = visibleSections.size > 0;
      if (mountainVisible && !wasVisible) {
        needsRender = true;
        ensureTick();
      }
    }, { rootMargin: "200px 0px 200px 0px" });
    const observedSections = ["skills", "education", "hobbies"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (observedSections.length === 0) {
      mountainVisible = true;
      ensureTick();
    } else {
      for (const sec of observedSections) visObserver.observe(sec);
    }
  })().catch(() => {
    startMountainFallback2d();
  });
})();
