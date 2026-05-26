// ────────────────────────────────────
// Stable Viewport Dimensions (ignores dynamic address bars & console toggles)
// ────────────────────────────────────
let stableInnerHeight = window.innerHeight;
let stableInnerWidth = window.innerWidth;

// Last user-initiated scroll position. We snapshot this on every scroll event
// that is NOT caused by us programmatically restoring scroll, and use it to
// undo any scroll shifts the browser introduces when the screen size changes
// (mobile toolbar toggle, devtools open, etc.). We also track scroll velocity
// so that rapid user-driven scrolling can fly past a toolbar transition
// without us snapping it back.
let preservedScrollY = window.scrollY;
let restoringScroll = false;
let lastResizeAt = 0;
let lastScrollY = window.scrollY;
let lastScrollAt = performance.now();
let scrollSpeed = 0; // pixels per millisecond

// Toolbar-sized shifts are usually under ~100px. Anything bigger is the user
// actually scrolling — leave it alone. Above this speed (px/ms) we treat any
// resize as happening mid-flick and skip restoration entirely.
const TOOLBAR_SHIFT_MAX_PX = 140;
const ACTIVE_SCROLL_SPEED = 0.6;

window.addEventListener("scroll", () => {
  const now = performance.now();
  const dt = now - lastScrollAt;
  if (dt > 0 && dt < 200) {
    scrollSpeed = (window.scrollY - lastScrollY) / dt;
  }
  lastScrollY = window.scrollY;
  lastScrollAt = now;

  // Skip our own restoration writes, plus any scroll events that arrive in
  // the same tick as a resize (those are the ones the browser issues to
  // compensate for the new viewport — exactly what we want to undo).
  if (restoringScroll) return;
  if (now - lastResizeAt < 32) return;
  preservedScrollY = window.scrollY;
}, { passive: true });

window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  lastResizeAt = performance.now();

  // Update stable dimensions only if it's a true resize (e.g. orientation rotation, split screen, window stretch)
  // Ignores dynamic toolbar collapses and height-only console opens under 350px.
  if (Math.abs(w - stableInnerWidth) > 5 || Math.abs(h - stableInnerHeight) > 350) {
    stableInnerWidth = w;
    stableInnerHeight = h;
    preservedScrollY = window.scrollY;
    return;
  }

  // The user is actively flicking the page; don't fight their momentum even
  // if a toolbar transition lands in the middle of the gesture.
  if (Math.abs(scrollSpeed) > ACTIVE_SCROLL_SPEED) {
    preservedScrollY = window.scrollY;
    return;
  }

  // Idle (or near-idle) user + minor resize: if the browser has shifted scroll
  // by a toolbar-sized amount, undo it. Larger deltas mean we lost track of a
  // real user scroll — accept the new position rather than snapping back.
  const delta = window.scrollY - preservedScrollY;
  if (Math.abs(delta) > 0.5 && Math.abs(delta) < TOOLBAR_SHIFT_MAX_PX) {
    restoringScroll = true;
    window.scrollTo(0, preservedScrollY);
    requestAnimationFrame(() => { restoringScroll = false; });
  } else {
    preservedScrollY = window.scrollY;
  }
});

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
  
  // Skip resizing if width has not changed and height change is small (e.g. mobile address bar toggles)
  if (canvas.width > 0 && Math.abs(canvas.width - W * dpr) < 1 && Math.abs(canvas.height - H * dpr) < 150 * dpr) {
    return { W: canvas.width / dpr, H: canvas.height / dpr };
  }

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W, H };
}

function runWhenVisible(canvas, frame) {
  let running = false;
  let visible = false;

  function tick() {
    if (!visible) { running = false; return; }
    frame();
    requestAnimationFrame(tick);
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible && !running) {
      running = true;
      requestAnimationFrame(tick);
    }
  }, { rootMargin: "100px" });
  io.observe(canvas);
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
(() => {
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
(() => {
  const section = document.getElementById("about");
  if (!section) return;

  const nameEl = document.getElementById("name");
  const textEl = section.querySelector(".text-reveal");
  if (!textEl) return;

  // Split paragraph into word spans with real whitespace between so text-align: justify works
  const words = textEl.textContent.trim().split(/\s+/);
  textEl.innerHTML = "";
  const wordSpans = words.map((word, i) => {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = word;
    textEl.appendChild(span);
    if (i < words.length - 1) textEl.appendChild(document.createTextNode(" "));
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
    const totalScrollable = Math.max(1, section.offsetHeight - stableInnerHeight);
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
(() => {
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
(() => { // PHYSICS SIM 1: 2D Wave Dynamics
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
  const COURANT = Math.SQRT1_2;
  const COURANT2 = COURANT * COURANT;

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

    // Finite-difference wave equation: u_tt = c^2 laplacian(u).
    // curr holds u_{n-1}, prev holds u_n; write u_{n+1} into curr.
    for (let i = 1; i < COLS - 1; i++) {
      const base = i * ROWS;
      const left = (i - 1) * ROWS;
      const right = (i + 1) * ROWS;
      for (let j = 1; j < ROWS - 1; j++) {
        const k = base + j;
        if (walls[k]) { curr[k] = 0; continue; }
        const lap =
          prev[left + j] +
          prev[right + j] +
          prev[base + j - 1] +
          prev[base + j + 1] -
          4 * prev[k];
        curr[k] = (2 * prev[k] - curr[k] + COURANT2 * lap) * DAMPING;
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
      nR = 61; nG = 217; nB = 193;   // teal trough
      wR = 70; wG = 70; wB = 78;
    } else {
      bgR = 247; bgG = 244; bgB = 238;
      pR = 207; pG = 107; pB = 79;
      nR = 30; nG = 111; nB = 92;
      wR = 150; wG = 150; wB = 150;
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
  }

  resize();
  setupWalls();
  window.addEventListener("resize", resize);
  runWhenVisible(canvas, loop);
})();

// ════════════════════════════════════
(() => { // PHYSICS SIM 2: Reaction-Diffusion (Gray-Scott)
  const canvas = document.getElementById("reactionSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  const GW = 120, GH = 80;
  let U, V, nU, nV;
  const Du = 0.16, Dv = 0.08;
  const f = 0.040, k = 0.060;
  const RD_DT = 1.0;

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
          nU[i][j] = U[i][j] + RD_DT * (Du * lapU - uvv + f * (1 - U[i][j]));
          nV[i][j] = V[i][j] + RD_DT * (Dv * lapV + uvv - (f + k) * V[i][j]);
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

  init();
  window.addEventListener("resize", resize);
  runWhenVisible(canvas, loop);
})();

// ════════════════════════════════════
(() => { // PHYSICS SIM 3: Ising Model (2D Spin Lattice)
  const canvas = document.getElementById("isingSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  const GRID = 64;
  const spins = [];
  const J = 1;
  const kB = 1;
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
      const dE = 2 * J * spin * neighbors;

      if (dE <= 0 || Math.random() < Math.exp(-dE / (kB * localT))) {
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
  }

  init();
  window.addEventListener("resize", resize);
  runWhenVisible(canvas, loop);
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

// ────────────────────────────────────
// Project Cards — Swipe Carousel
// ────────────────────────────────────
(() => {
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

// ════════════════════════════════════
// HERO BACKGROUND: Conway's Game of Life
// ════════════════════════════════════
(() => {
  const canvas = document.getElementById("lifeSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const CELL = 18;
  let W, H, COLS, ROWS, grid, next;
  let lastStep = 0;
  const STEP_MS = 160;
  let generation = 0;
  const RESEED_GENERATIONS = 400;

  function alloc() {
    grid = new Uint8Array(COLS * ROWS);
    next = new Uint8Array(COLS * ROWS);
  }

  function seed() {
    for (let i = 0; i < grid.length; i++) {
      grid[i] = Math.random() < 0.22 ? 1 : 0;
    }
    generation = 0;
  }

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
    COLS = Math.max(1, Math.ceil(W / CELL));
    ROWS = Math.max(1, Math.ceil(H / CELL));
    alloc();
    seed();
  }

  // Hover: sprinkle live cells around the pointer.
  // Listen on the hero section because the canvas has pointer-events: none.
  const host = document.getElementById("about");
  if (host) {
    const RADIUS_CELLS = 4;
    const SPRINKLE_PER_MOVE = 5;
    host.addEventListener("mousemove", (e) => {
      if (!grid) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || x > W || y < 0 || y > H) return;
      const cx = (x / CELL) | 0;
      const cy = (y / CELL) | 0;
      for (let k = 0; k < SPRINKLE_PER_MOVE; k++) {
        const theta = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * RADIUS_CELLS;
        const gx = ((cx + Math.round(Math.cos(theta) * r)) % COLS + COLS) % COLS;
        const gy = ((cy + Math.round(Math.sin(theta) * r)) % ROWS + ROWS) % ROWS;
        grid[gy * COLS + gx] = 1;
      }
    });
  }

  function step() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = (x + dx + COLS) % COLS;
            const ny = (y + dy + ROWS) % ROWS;
            n += grid[ny * COLS + nx];
          }
        }
        const alive = grid[y * COLS + x];
        next[y * COLS + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    [grid, next] = [next, grid];
    generation++;
    if (generation >= RESEED_GENERATIONS) seed();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const dark = isDark();
    const fill = dark ? "#e0bd5e" : "#c89b3c";
    ctx.fillStyle = fill;
    const r = Math.max(1, CELL * 0.28);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!grid[y * COLS + x]) continue;
        const cx = x * CELL + CELL / 2;
        const cy = y * CELL + CELL / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function loop(ts) {
    if (ts - lastStep >= STEP_MS) {
      step();
      lastStep = ts;
    }
    draw();
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(loop);
})();

// ════════════════════════════════════
(() => { // BACKDROP: WebGPU procedurally generated mountain (FBM noise)
  const canvas = document.getElementById("mountainBg");
  const particleCanvas = document.getElementById("mountainParticles");
  if (!canvas) return;
  const hasWebGPU = !!navigator.gpu;

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const setMountainOpacity = (v) => {
    document.documentElement.style.setProperty("--mountain-bg-opacity", v.toFixed(3));
  };

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
          grad.addColorStop(0, "#142f25");
          grad.addColorStop(0.52, "#2d5f3a");
          grad.addColorStop(1, "#0d221c");
        } else {
          grad.addColorStop(0, "#254b2f");
          grad.addColorStop(0.52, "#4f8b3d");
          grad.addColorStop(1, "#1f3f2a");
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

    const tiers = [
      { y: 0.20, r: 0.50, d: 0.235, w: 0.060, n: 11 },
      { y: 0.36, r: 0.44, d: 0.205, w: 0.054, n: 10 },
      { y: 0.52, r: 0.38, d: 0.172, w: 0.047, n: 10 },
      { y: 0.68, r: 0.31, d: 0.142, w: 0.040, n: 9 },
      { y: 0.83, r: 0.25, d: 0.116, w: 0.034, n: 8 },
      { y: 0.98, r: 0.19, d: 0.092, w: 0.028, n: 7 },
      { y: 1.12, r: 0.14, d: 0.068, w: 0.022, n: 6 },
      { y: 1.25, r: 0.09, d: 0.048, w: 0.016, n: 5 },
    ];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      mb.pineWhorl(t.y + j(), t.r, t.d, t.w, t.n, phase + i * 0.63, 1);
    }

    mb.cylinder([0, 0.17 + j(), 0], [0, 0.58 + j(), 0], 0.30, 0.070, 10, 1);
    mb.cylinder([0, 0.38 + j(), 0], [0, 0.82 + j(), 0], 0.25, 0.056, 10, 1);
    mb.cylinder([0, 0.62 + j(), 0], [0, 1.06 + j(), 0], 0.19, 0.041, 9, 1);
    mb.cylinder([0, 0.86 + j(), 0], [0, 1.28 + j(), 0], 0.13, 0.026, 8, 1);
    mb.cylinder([0, 1.10 + j(), 0], [0, 1.50 + j(), 0], 0.070, 0.0, 7, 1);
    mb.cylinder([0, 1.27, 0], [0, 1.56, 0], 0.016, 0.0, 6, 0);
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

  if (!hasWebGPU) {
    startMountainFallback2d();
    return;
  }

  (async () => {
    let adapter, device;
    try {
      adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("no adapter");
      device = await adapter.requestDevice();
    } catch {
      startMountainFallback2d();
      return;
    }

    const ctx = canvas.getContext("webgpu");
    if (!ctx) {
      startMountainFallback2d();
      return;
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
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

  // Two palettes, mixed by seasonT.
  let snowW   = vec3<f32>(0.94, 0.96, 1.00);
  let rockW   = vec3<f32>(0.55, 0.55, 0.62);
  let valleyW = vec3<f32>(0.78, 0.82, 0.88);
  let snowS   = vec3<f32>(0.86, 0.85, 0.78);
  let rockS   = vec3<f32>(0.52, 0.45, 0.34);
  let valleyS = vec3<f32>(0.26, 0.52, 0.22);

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
  let skyColor = mix(vec3<f32>(0.78, 0.84, 0.95), vec3<f32>(0.88, 0.82, 0.70), t);
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
  let pineTint = fract(sin(dot(v.worldPos.xz, vec2<f32>(41.17, 19.31))) * 43758.5453);
  let pineBand = fract(v.worldPos.y * 9.7 + pineTint * 3.1);
  let upwardNeedle = smoothstep(-0.18, 0.72, n.y);
  let pineWinter = mix(vec3<f32>(0.82, 0.91, 0.93), vec3<f32>(0.50, 0.66, 0.61), pineTint);
  let pineSummer = mix(vec3<f32>(0.035, 0.15, 0.075), vec3<f32>(0.18, 0.39, 0.14), pineTint);
  var pineLeaf = mix(pineWinter, pineSummer, u.seasonT);
  pineLeaf = mix(pineLeaf * vec3<f32>(0.72, 0.86, 0.76), pineLeaf * vec3<f32>(1.16, 1.08, 0.88), upwardNeedle);
  pineLeaf = mix(pineLeaf, pineLeaf * vec3<f32>(0.86, 0.96, 0.84), step(0.76, pineBand) * 0.18);
  pineLeaf = mix(pineLeaf, vec3<f32>(0.90, 0.95, 0.98), (1.0 - u.seasonT) * upwardNeedle * 0.25);

  let leaf = mix(broadLeaf, pineLeaf, v.treeType);
  var color = mix(stem, leaf, v.isLeaf) * lit;

  let dist = length(v.worldPos - u.cameraPos);
  let fog = clamp((dist - 3.5) / 14.0, 0.0, 0.85);
  let skyColor = mix(vec3<f32>(0.78, 0.84, 0.95), vec3<f32>(0.88, 0.82, 0.70), u.seasonT);
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
  let skyColor = mix(vec3<f32>(0.78, 0.84, 0.95), vec3<f32>(0.88, 0.82, 0.70), u.seasonT);
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
    const PARTICLE_COUNT = 1200;
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
      pass.draw(treeVertCount, treeInstanceCount);
      // Pines reuse the same pipeline (same vertex layout) but their own
      // geometry and instance band higher up the mountain.
      pass.setVertexBuffer(0, pineVertBuffer);
      pass.setVertexBuffer(1, pineInstanceBuffer);
      pass.draw(pineVertCount, pineInstanceCount);
      pass.setPipeline(grassPipeline);
      pass.setVertexBuffer(0, grassVertBuffer);
      pass.setVertexBuffer(1, grassInstanceBuffer);
      pass.draw(grassVertCount, grassInstanceCount);
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

    // The mountain surface only redraws on scroll/resize, while the overlay
    // particle canvas redraws each frame for falling snow/leaves.
    let needsRender = true;
    const schedule = () => { needsRender = true; };
    function tick(now) {
      const nowSeconds = now * 0.001;
      if (needsRender) {
        needsRender = false;
        render(nowSeconds);
      }
      renderParticles(nowSeconds);
      requestAnimationFrame(tick);
    }
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", () => { resize(); schedule(); });
    schedule();
    requestAnimationFrame(tick);
  })().catch(() => {
    startMountainFallback2d();
  });
})();
