// ────────────────────────────────────
// Dark / Light Theme Toggle
// ────────────────────────────────────
(() => {
  const toggle = document.getElementById("themeToggle");
  const html = document.documentElement;
  const saved = localStorage.getItem("theme");
  if (saved) html.setAttribute("data-theme", saved);
  else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    html.setAttribute("data-theme", "dark");
  }
  toggle.addEventListener("click", () => {
    const current = html.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });
})();

// ────────────────────────────────────
// Shared Simulation Helpers
// ────────────────────────────────────
function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = rect.width;
  const H = rect.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W, H };
}

// ────────────────────────────────────
// Navbar Scroll Enhancement
// ────────────────────────────────────
(() => {
  const nav = document.querySelector(".container");
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        nav.classList.toggle("scrolled", window.scrollY > 60);
        ticking = false;
      });
      ticking = true;
    }
  });
})();

// ────────────────────────────────────
// Scroll-Reveal & ScrollSpy & Skill Bar Animation
// ────────────────────────────────────
(function () {
  const reveals = document.querySelectorAll(".reveal");
  const bars = document.querySelectorAll(".skill-bar-fill");
  const navLinks = document.querySelectorAll(".container nav ul li a");

  let barsAnimated = false;

  // Intersection Observer for Scroll-Reveal & Skill Bars
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");

          // Animate skill bars when skills section is visible
          if (!barsAnimated && entry.target.id === "skills") {
            barsAnimated = true;
            bars.forEach((bar, i) => {
              setTimeout(() => {
                bar.style.width = bar.dataset.width + "%";
              }, i * 60);
            });
          }
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -50px 0px" },
  );

  reveals.forEach((el) => revealObserver.observe(el));

  // Intersection Observer for ScrollSpy (Active Nav Link)
  const spyObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute("id");
          navLinks.forEach((link) => {
            link.classList.remove("active");
            if (link.getAttribute("href") === `#${id}`) {
              link.classList.add("active");
            }
          });
        }
      });
    },
    { threshold: 0.05, rootMargin: "-10% 0px -70% 0px" }
  );

  const sections = document.querySelectorAll(".main-content > div[id], footer h2[id='contact']");
  sections.forEach((section) => spyObserver.observe(section));
})();

// ────────────────────────────────────
// Hero Scroll Reveal (name + word cascade)
// ────────────────────────────────────
(function () {
  const section = document.getElementById("about");
  if (!section) return;

  const nameEl = document.getElementById("name");
  const textEl = section.querySelector(".text-reveal");
  if (!textEl) return;

  // Split paragraph into word spans (spaced via CSS margin-right)
  const words = textEl.textContent.trim().split(/\s+/);
  textEl.innerHTML = "";
  const wordSpans = words.map((word) => {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = word;
    textEl.appendChild(span);
    return span;
  });

  const N = wordSpans.length;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // Word cascade: each word's reveal window overlaps neighbors so multiple
  // words are in flight at once, creating a smooth cascade rather than a
  // discrete one-word-at-a-time transition.
  const WORD_RANGE_START = 0.25;
  const WORD_RANGE_END = 0.92;
  const PER_WORD_DURATION = 0.14;
  const wordSpacing = Math.max(
    0,
    (WORD_RANGE_END - WORD_RANGE_START - PER_WORD_DURATION) / Math.max(1, N - 1),
  );

  let isInView = false;
  let ticking = false;

  function schedule() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }

  function update() {
    ticking = false;

    const rect = section.getBoundingClientRect();
    const totalScrollable = Math.max(1, section.offsetHeight - window.innerHeight);
    const p = clamp01(-rect.top / totalScrollable);

    // Name: 0 → 0.3 scroll progress
    const nameP = easeOutCubic(clamp01(p / 0.3));
    nameEl.style.setProperty("--name-opacity", nameP);
    nameEl.style.setProperty("--name-scale", 1.2 - 0.2 * nameP);
    nameEl.style.setProperty("--name-ty", 50 * (1 - nameP) + "px");
    nameEl.style.setProperty("--name-blur", 14 * (1 - nameP) + "px");

    // Text block: 0.15 → 0.35 scroll progress
    const blockP = easeOutQuart(clamp01((p - 0.15) / 0.2));
    textEl.style.setProperty("--text-block-opacity", blockP);
    textEl.style.setProperty("--text-block-ty", 24 * (1 - blockP) + "px");

    // Per-word cascade
    for (let i = 0; i < N; i++) {
      const wordStart = WORD_RANGE_START + i * wordSpacing;
      const wp = easeOutCubic(clamp01((p - wordStart) / PER_WORD_DURATION));
      const span = wordSpans[i];
      span.style.opacity = 0.1 + 0.9 * wp;
      span.style.filter = `blur(${(1 - wp) * 6}px)`;
      span.style.transform = `translateY(${(1 - wp) * 10}px)`;
    }
  }

  const viewObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        isInView = entry.isIntersecting;
        if (isInView) schedule();
      });
    },
    { threshold: 0 },
  );
  viewObserver.observe(section);

  window.addEventListener("scroll", () => { if (isInView) schedule(); }, { passive: true });
  window.addEventListener("resize", schedule);
  requestAnimationFrame(update);
})();



// ────────────────────────────────────
// Mobile Hamburger Menu
// ────────────────────────────────────
(function () {
  const btn = document.getElementById("menuToggle");
  const nav = document.getElementById("mainNav");
  const overlay = document.getElementById("navOverlay");

  function close() {
    btn.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    nav.classList.remove("open");
    overlay.classList.remove("visible");
    document.body.style.overflow = "";
  }

  btn.addEventListener("click", () => {
    const opening = !nav.classList.contains("open");
    if (opening) {
      btn.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      nav.classList.add("open");
      overlay.classList.add("visible");
      document.body.style.overflow = "hidden";
    } else {
      close();
    }
  });

  overlay.addEventListener("click", close);

  // Close menu when a nav link is clicked
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", close);
  });

  // Close on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("open")) close();
  });
})();

// ────────────────────────────────────
// Smooth Scroll for Nav (fallback)
// ────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// ════════════════════════════════════
// PHYSICS SIM 1: 2D Wave Dynamics
// ════════════════════════════════════
(function () {
  const canvas = document.getElementById("waveSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  const COLS = 200, ROWS = 130;
  const N = COLS * ROWS;
  let curr = new Float32Array(N);
  let prev = new Float32Array(N);
  const walls = new Uint8Array(N);
  const DAMPING = 0.996;

  const SOURCE_X = 4;
  const FREQ = 0.22;
  const AMP = 60;

  const off = document.createElement("canvas");
  off.width = COLS;
  off.height = ROWS;
  const offCtx = off.getContext("2d");
  const imageData = offCtx.createImageData(COLS, ROWS);
  const pixels = new Uint32Array(imageData.data.buffer);

  let time = 0;

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
  }

  function setupWalls() {
    walls.fill(0);
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
  }

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

  function handleMouse(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / W) * COLS;
    const my = ((e.clientY - rect.top) / H) * ROWS;
    drop(mx | 0, my | 0, 5, -90);
  }

  function loop() {
    const dark = isDark();
    time += 1;

    // Wave step: curr holds u_{n-1}, prev holds u_n; write u_{n+1} into curr
    for (let i = 1; i < COLS - 1; i++) {
      const base = i * ROWS;
      const left = (i - 1) * ROWS;
      const right = (i + 1) * ROWS;
      for (let j = 1; j < ROWS - 1; j++) {
        const k = base + j;
        if (walls[k]) { curr[k] = 0; continue; }
        const n = (prev[left + j] + prev[right + j] + prev[base + j - 1] + prev[base + j + 1]) * 0.5 - curr[k];
        curr[k] = n * DAMPING;
      }
    }

    // Coherent plane-wave source (ramped in)
    const ramp = Math.min(1, time / 120);
    const s = Math.sin(time * FREQ) * AMP * ramp;
    for (let j = 2; j < ROWS - 2; j++) {
      curr[SOURCE_X * ROWS + j] = s;
    }

    // Palette
    let bgR, bgG, bgB, pR, pG, pB, nR, nG, nB, wR, wG, wB;
    if (dark) {
      bgR = 18; bgG = 22; bgB = 30;
      pR = 232; pG = 148; pB = 74;    // orange crest
      nR = 61;  nG = 217; nB = 193;   // teal trough
      wR = 70;  wG = 70;  wB = 78;
    } else {
      bgR = 247; bgG = 244; bgB = 238;
      pR = 207;  pG = 107;  pB = 79;
      nR = 30;   nG = 111;  nB = 92;
      wR = 150;  wG = 150;  wB = 150;
    }
    const wallColor = 0xff000000 | (wB << 16) | (wG << 8) | wR;

    // Render with sqrt magnitude mapping for dynamic range
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const k = i * ROWS + j;
        const p = j * COLS + i;
        if (walls[k]) { pixels[p] = wallColor; continue; }
        const v = curr[k];
        const mag = Math.min(1, Math.sqrt(Math.abs(v) / 80));
        let r, g, b;
        if (v >= 0) {
          r = bgR + (pR - bgR) * mag;
          g = bgG + (pG - bgG) * mag;
          b = bgB + (pB - bgB) * mag;
        } else {
          r = bgR + (nR - bgR) * mag;
          g = bgG + (nG - bgG) * mag;
          b = bgB + (nB - bgB) * mag;
        }
        pixels[p] = 0xff000000 | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
      }
    }
    offCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, W, H);

    const temp = prev; prev = curr; curr = temp;

    requestAnimationFrame(loop);
  }

  resize();
  setupWalls();
  window.addEventListener("resize", resize);
  loop();
})();

// ════════════════════════════════════
// PHYSICS SIM 2: Elastic Double Pendulum
// ════════════════════════════════════
(function () {
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

  function step(h) {
    // Spring 1: pivot (0,0) to mass 1
    const d1 = Math.sqrt(x1 * x1 + y1 * y1) || 0.001;
    const sf1 = -k1 * (d1 - L1);

    // Spring 2: mass 1 to mass 2
    const dx2 = x2 - x1, dy2 = y2 - y1;
    const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 0.001;
    const sf2 = -k2 * (d2 - L2);

    // Forces on mass 1: spring1 + reaction from spring2 + gravity
    const fx1 = sf1 * (x1 / d1) - sf2 * (dx2 / d2);
    const fy1 = sf1 * (y1 / d1) - sf2 * (dy2 / d2) + m1 * grav;

    // Forces on mass 2: spring2 + gravity
    const fx2 = sf2 * (dx2 / d2);
    const fy2 = sf2 * (dy2 / d2) + m2 * grav;

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

    requestAnimationFrame(loop);
  }

  resize();
  randomize();
  window.addEventListener("resize", resize);
  loop();
})();

// ════════════════════════════════════
// PHYSICS SIM 3: Lorenz Attractor
// ════════════════════════════════════
(function () {
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

  canvas.addEventListener("click", () => {
    points.length = 0;
    x = (Math.random() - 0.5) * 2;
    y = (Math.random() - 0.5) * 2;
    z = Math.random() * 20;
  });

  function loop() {
    const dark = isDark();

    // Run multiple physics steps per frame when hovered to increase speed without losing numerical stability
    const steps = isHovered ? 5 : 1;
    for (let s = 0; s < steps; s++) {
      const dx = sigma * (y - x) * dt;
      const dy = (x * (rho - z) - y) * dt;
      const dz = (x * y - beta * z) * dt;

      x += dx;
      y += dy;
      z += dz;

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

    requestAnimationFrame(loop);
  }
  resize();
  window.addEventListener("resize", resize);
  loop();
})();

// ════════════════════════════════════
// PHYSICS SIM 4: Reaction-Diffusion (Gray-Scott)
// ════════════════════════════════════
(function () {
  const canvas = document.getElementById("reactionSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  const GW = 120, GH = 80;
  let U, V, nU, nV;
  const Du = 0.16, Dv = 0.08;
  const f = 0.040, k = 0.060;

  const off = document.createElement("canvas");
  off.width = GW;
  off.height = GH;
  const offCtx = off.getContext("2d");

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
  }

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
    for (let di = -3; di <= 3; di++) {
      for (let dj = -3; dj <= 3; dj++) {
        const gi = ((cx + di + GW) % GW) | 0;
        const gj = ((cy + dj + GH) % GH) | 0;
        U[gi][gj] = 0.5;
        V[gi][gj] = 0.25 + Math.random() * 0.01;
      }
    }
  }

  function init() {
    resize();
    alloc();
    seed(GW / 2, GH / 2);
    seed(GW / 4, GH / 3);
    seed((3 * GW) / 4, (2 * GH) / 3);
  }

  let isDraggingRD = false;
  canvas.addEventListener("mousedown", (e) => {
    isDraggingRD = true;
    handleRDInteract(e);
  });
  canvas.addEventListener("mousemove", (e) => {
    if (isDraggingRD) handleRDInteract(e);
  });
  canvas.addEventListener("mouseup", () => isDraggingRD = false);
  canvas.addEventListener("mouseleave", () => isDraggingRD = false);

  function handleRDInteract(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    seed(((mx / W) * GW) | 0, ((my / H) * GH) | 0);
  }

  function loop() {
    const dark = isDark();

    for (let step = 0; step < 6; step++) {
      for (let i = 0; i < GW; i++) {
        const ip = (i + 1) % GW, im = (i - 1 + GW) % GW;
        for (let j = 0; j < GH; j++) {
          const jp = (j + 1) % GH, jm = (j - 1 + GH) % GH;
          const lapU = U[ip][j] + U[im][j] + U[i][jp] + U[i][jm] - 4 * U[i][j];
          const lapV = V[ip][j] + V[im][j] + V[i][jp] + V[i][jm] - 4 * V[i][j];
          const uvv = U[i][j] * V[i][j] * V[i][j];
          nU[i][j] = U[i][j] + Du * lapU - uvv + f * (1 - U[i][j]);
          nV[i][j] = V[i][j] + Dv * lapV + uvv - (f + k) * V[i][j];
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

    requestAnimationFrame(loop);
  }

  init();
  window.addEventListener("resize", resize);
  loop();
})();

// ════════════════════════════════════
// PHYSICS SIM 5: Ising Model (2D Spin Lattice)
// ════════════════════════════════════
(function () {
  const canvas = document.getElementById("isingSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  const GRID = 64;
  const spins = [];
  let T = 2.27; // near critical temperature Tc ≈ 2.269
  let tempMode = 1; // 0=cold, 1=critical, 2=hot

  const off = document.createElement("canvas");
  off.width = GRID;
  off.height = GRID;
  const offCtx = off.getContext("2d");

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
  }

  function init() {
    resize();
    spins.length = 0;
    for (let i = 0; i < GRID; i++) {
      spins[i] = new Int8Array(GRID);
      for (let j = 0; j < GRID; j++) {
        spins[i][j] = Math.random() < 0.5 ? 1 : -1;
      }
    }
  }

  // Click cycles temperature: cold → critical → hot
  canvas.addEventListener("click", () => {
    tempMode = (tempMode + 1) % 3;
    T = [0.5, 2.27, 5.0][tempMode];
  });

  let mouseX = null, mouseY = null;
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  });
  canvas.addEventListener("mouseleave", () => {
    mouseX = null;
    mouseY = null;
  });

  function loop() {
    const dark = isDark();
    const cellW = W / GRID;
    const cellH = H / GRID;

    // Metropolis-Hastings: one full sweep per frame
    const steps = GRID * GRID;
    for (let s = 0; s < steps; s++) {
      const i = (Math.random() * GRID) | 0;
      const j = (Math.random() * GRID) | 0;

      // Mouse proximity heats spins locally
      let localT = T;
      if (mouseX !== null) {
        const dx = (i + 0.5) * cellW - mouseX;
        const dy = (j + 0.5) * cellH - mouseY;
        if (dx * dx + dy * dy < 1600) localT = Math.max(localT, 5.0);
      }

      const spin = spins[i][j];
      const neighbors =
        spins[(i + 1) % GRID][j] +
        spins[(i - 1 + GRID) % GRID][j] +
        spins[i][(j + 1) % GRID] +
        spins[i][(j - 1 + GRID) % GRID];
      const dE = 2 * spin * neighbors;

      if (dE <= 0 || Math.random() < Math.exp(-dE / localT)) {
        spins[i][j] = -spin;
      }
    }

    // Render to offscreen canvas at grid resolution, then scale up
    const imageData = offCtx.createImageData(GRID, GRID);
    const data = imageData.data;
    const upR = dark ? 232 : 207, upG = dark ? 148 : 107, upB = dark ? 74 : 79;
    const dnR = dark ? 26 : 245, dnG = dark ? 26 : 239, dnB = dark ? 46 : 230;

    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const idx = (j * GRID + i) * 4;
        if (spins[i][j] === 1) {
          data[idx] = upR; data[idx + 1] = upG; data[idx + 2] = upB;
        } else {
          data[idx] = dnR; data[idx + 1] = dnG; data[idx + 2] = dnB;
        }
        data[idx + 3] = 255;
      }
    }
    offCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, W, H);

    requestAnimationFrame(loop);
  }

  init();
  window.addEventListener("resize", resize);
  loop();
})();

// 7: 1D Traffic Flow (Nonlinear Dynamics - Enhanced Bando OV Model)
(() => {
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
      cars = next;
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

      // Brake lights
      if (cars[i].braking) {
        ctx.beginPath();
        ctx.arc(0, ch / 2 + 1, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 40, 40, 0.6)";
        ctx.fill();
      }

      // Headlights in dark mode
      if (dark) {
        ctx.beginPath();
        ctx.arc(0, -ch / 2 - 1, 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 180, 0.35)";
        ctx.fill();
      }

      ctx.restore();
    }
    ctx.restore();

    requestAnimationFrame(loop);
  }

  init();
  window.addEventListener("resize", resize);
  loop();
})();

// ────────────────────────────────────
// Project Cards — Swipe Carousel
// ────────────────────────────────────
(function () {
  const track = document.getElementById("projectTrack");
  const dotsContainer = document.getElementById("carouselDots");
  const counter = document.getElementById("carouselCounter");
  const prevBtn = document.getElementById("carouselPrev");
  const nextBtn = document.getElementById("carouselNext");
  if (!track) return;

  const cards = Array.from(track.querySelectorAll(".project-card"));
  const total = cards.length;
  let currentIndex = 0;

  // ── Build dot indicators with title labels ──
  cards.forEach((card, i) => {
    const dot = document.createElement("button");
    dot.classList.add("carousel-dot");
    dot.setAttribute("aria-label", `Go to project ${i + 1}`);
    // Add title label inside the dot
    const label = document.createElement("span");
    label.classList.add("dot-label");
    label.textContent = card.querySelector("h3").textContent;
    dot.appendChild(label);
    if (i === 0) dot.classList.add("active");
    dot.addEventListener("click", () => goTo(i));
    dotsContainer.appendChild(dot);
  });

  const dots = Array.from(dotsContainer.querySelectorAll(".carousel-dot"));

  function updateUI(index) {
    currentIndex = index;

    // Update dots
    dots.forEach((d, i) => d.classList.toggle("active", i === index));

    // Update counter
    counter.textContent = `${index + 1} / ${total}`;

    // Update active card class
    cards.forEach((c, i) => c.classList.toggle("card-active", i === index));

    // Update arrow enabled state
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === total - 1;
  }

  let navigating = false;

  function goTo(index) {
    index = Math.max(0, Math.min(total - 1, index));
    navigating = true;
    const card = cards[index];
    const trackRect = track.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    // Center the card in the track viewport
    const scrollTarget = card.offsetLeft - (trackRect.width / 2) + (cardRect.width / 2);
    track.scrollTo({ left: scrollTarget, behavior: "smooth" });
    updateUI(index);
    // Clear navigating flag after scroll settles
    clearTimeout(navTimeout);
    navTimeout = setTimeout(() => { navigating = false; }, 500);
  }

  let navTimeout;

  // ── Arrow buttons ──
  prevBtn.addEventListener("click", () => goTo(currentIndex - 1));
  nextBtn.addEventListener("click", () => goTo(currentIndex + 1));

  // ── Keyboard navigation ──
  document.addEventListener("keydown", (e) => {
    // Only when carousel is somewhat in view
    const rect = track.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    if (!inView) return;
    if (e.key === "ArrowLeft") goTo(currentIndex - 1);
    if (e.key === "ArrowRight") goTo(currentIndex + 1);
  });

  // ── Scroll-snap detection (update active on manual scroll/swipe) ──
  let scrollTimeout;
  track.addEventListener("scroll", () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      // Don't override during programmatic navigation
      if (navigating) return;
      const trackCenter = track.scrollLeft + track.offsetWidth / 2;
      let closest = 0;
      let closestDist = Infinity;
      cards.forEach((card, i) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const dist = Math.abs(trackCenter - cardCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      });
      updateUI(closest);
    }, 80);
  }, { passive: true });

  // ── Pointer drag (mouse + touch) ──
  let isDragging = false;
  let startX = 0;
  let scrollStart = 0;

  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") {
      isDragging = true;
      startX = e.clientX;
      scrollStart = track.scrollLeft;
      track.style.scrollSnapType = "none";
      track.style.scrollBehavior = "auto";
      track.setPointerCapture(e.pointerId);
    }
  });

  track.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    track.scrollLeft = scrollStart - dx;
  });

  track.addEventListener("pointerup", (e) => {
    if (!isDragging) return;
    isDragging = false;
    track.style.scrollSnapType = "x mandatory";
    track.style.scrollBehavior = "smooth";

    // Determine direction from drag distance and snap
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 50) {
      goTo(currentIndex + (dx < 0 ? 1 : -1));
    } else {
      goTo(currentIndex); // snap back
    }
  });

  track.addEventListener("pointercancel", () => {
    isDragging = false;
    track.style.scrollSnapType = "x mandatory";
    track.style.scrollBehavior = "smooth";
  });

  // ── Initial state ──
  updateUI(0);

  // After a short delay, center the first card properly
  requestAnimationFrame(() => {
    goTo(0);
  });
})();
