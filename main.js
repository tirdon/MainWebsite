// ────────────────────────────────────
// Dark / Light Theme Toggle
// ────────────────────────────────────
(function () {
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
// Navbar Scroll Enhancement
// ────────────────────────────────────
(function () {
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
    { threshold: 0.25, rootMargin: "-10% 0px -70% 0px" }
  );

  const sections = document.querySelectorAll(".main-content > div[id], footer h2[id='contact']");
  sections.forEach((section) => spyObserver.observe(section));
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
// PHYSICS SIM 1: Particle Gravity
// ════════════════════════════════════
(function () {
  const canvas = document.getElementById("particleSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;
  const particles = [];
  const PARTICLE_COUNT = 40;
  const G = 0.08; // gravity acceleration
  const DAMPING = 0.85;
  const FRICTION = 0.999;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function isDark() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }

  class Particle {
    constructor() {
      this.r = 3 + Math.random() * 6;
      this.x = this.r + Math.random() * (300 - this.r * 2);
      this.y = this.r + Math.random() * (200 - this.r * 2);
      this.vx = (Math.random() - 0.5) * 3;
      this.vy = (Math.random() - 0.5) * 2;
      this.hue = Math.floor(Math.random() * 40) + 160; // teals/cyans
    }
    update(w, h) {
      this.vy += G;
      this.vx *= FRICTION;
      this.vy *= FRICTION;
      this.x += this.vx;
      this.y += this.vy;

      // Boundaries
      if (this.x - this.r < 0) {
        this.x = this.r;
        this.vx *= -DAMPING;
      }
      if (this.x + this.r > w) {
        this.x = w - this.r;
        this.vx *= -DAMPING;
      }
      if (this.y - this.r < 0) {
        this.y = this.r;
        this.vy *= -DAMPING;
      }
      if (this.y + this.r > h) {
        this.y = h - this.r;
        this.vy *= -DAMPING;
      }
    }
    draw(ctx, dark) {
      const alpha = dark ? 0.85 : 0.75;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.hue}, 70%, ${dark ? 65 : 55}%, ${alpha})`;
      ctx.fill();
      // glow
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${this.hue}, 80%, 60%, 0.08)`;
      ctx.fill();
    }
  }

  // Particle-particle collision
  function resolveCollisions(particles) {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i],
          b = particles[j];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.r + b.r;
        if (dist < minDist && dist > 0) {
          const nx = dx / dist,
            ny = dy / dist;
          const overlap = (minDist - dist) * 0.5;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;

          // elastic impulse
          const dvx = a.vx - b.vx,
            dvy = a.vy - b.vy;
          const dot = dvx * nx + dvy * ny;
          if (dot > 0) {
            const massA = a.r * a.r,
              massB = b.r * b.r;
            const total = massA + massB;
            const impulse = (2 * dot) / total;
            a.vx -= impulse * massB * nx;
            a.vy -= impulse * massB * ny;
            b.vx += impulse * massA * nx;
            b.vy += impulse * massA * ny;
          }
        }
      }
    }
  }

  function init() {
    resize();
    particles.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = new Particle();
      p.x = p.r + Math.random() * (W - p.r * 2);
      p.y = p.r + Math.random() * (H - p.r * 2);
      particles.push(p);
    }
  }

  // Click to burst particles outward
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    particles.forEach((p) => {
      const dx = p.x - mx,
        dy = p.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = 300 / dist;
      p.vx += (dx / dist) * force * 0.3;
      p.vy += (dy / dist) * force * 0.3;
    });
  });

  function loop() {
    const dark = isDark();
    ctx.clearRect(0, 0, W, H);

    // Draw connection lines
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[j].x - particles[i].x;
        const dy = particles[j].y - particles[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 80) {
          const alpha = (1 - dist / 80) * (dark ? 0.15 : 0.1);
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = dark
            ? `rgba(61, 217, 193, ${alpha})`
            : `rgba(30, 111, 92, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    particles.forEach((p) => {
      p.update(W, H);
      p.draw(ctx, dark);
    });
    resolveCollisions(particles);
    requestAnimationFrame(loop);
  }

  init();
  window.addEventListener("resize", () => {
    resize();
  });
  loop();
})();

// ════════════════════════════════════
// PHYSICS SIM 2: Double Pendulum
// ════════════════════════════════════
(function () {
  const canvas = document.getElementById("pendulumSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    trail.length = 0;
  }

  function isDark() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }

  // Double pendulum parameters
  const g = 1.5;
  const m1 = 12,
    m2 = 12;
  let l1, l2;
  let a1 = Math.PI / 2 + 0.3;
  let a2 = Math.PI / 2 - 0.5;
  let a1_v = 0,
    a2_v = 0;
  const dt = 0.3;
  const trail = [];
  const MAX_TRAIL = 600;

  // Click to randomize initial conditions
  canvas.addEventListener("click", () => {
    a1 = Math.random() * Math.PI * 2;
    a2 = Math.random() * Math.PI * 2;
    a1_v = (Math.random() - 0.5) * 0.5;
    a2_v = (Math.random() - 0.5) * 0.5;
    trail.length = 0;
  });

  function step() {
    // RK4-like Lagrangian double pendulum equations
    const num1 = -g * (2 * m1 + m2) * Math.sin(a1);
    const num2 = -m2 * g * Math.sin(a1 - 2 * a2);
    const num3 = -2 * Math.sin(a1 - a2) * m2;
    const num4 = a2_v * a2_v * l2 + a1_v * a1_v * l1 * Math.cos(a1 - a2);
    const den = l1 * (2 * m1 + m2 - m2 * Math.cos(2 * a1 - 2 * a2));
    const a1_a = (num1 + num2 + num3 * num4) / den;

    const num5 = 2 * Math.sin(a1 - a2);
    const num6 = a1_v * a1_v * l1 * (m1 + m2);
    const num7 = g * (m1 + m2) * Math.cos(a1);
    const num8 = a2_v * a2_v * l2 * m2 * Math.cos(a1 - a2);
    const den2 = l2 * (2 * m1 + m2 - m2 * Math.cos(2 * a1 - 2 * a2));
    const a2_a = (num5 * (num6 + num7 + num8)) / den2;

    a1_v += a1_a * dt;
    a2_v += a2_a * dt;
    a1 += a1_v * dt;
    a2 += a2_v * dt;

    // Slight damping for visual stability
    a1_v *= 0.9995;
    a2_v *= 0.9995;
  }

  function loop() {
    l1 = Math.min(W, H) * 0.28;
    l2 = Math.min(W, H) * 0.28;

    step();

    const dark = isDark();
    const ox = W / 2,
      oy = H * 0.3;

    const x1 = ox + l1 * Math.sin(a1);
    const y1 = oy + l1 * Math.cos(a1);
    const x2 = x1 + l2 * Math.sin(a2);
    const y2 = y1 + l2 * Math.cos(a2);

    trail.push({ x: x2, y: y2 });
    if (trail.length > MAX_TRAIL) trail.shift();

    ctx.clearRect(0, 0, W, H);

    // Draw trail
    if (trail.length > 2) {
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let i = 1; i < trail.length; i++) {
        ctx.lineTo(trail[i].x, trail[i].y);
      }
      ctx.strokeStyle = dark
        ? "rgba(232, 148, 74, 0.25)"
        : "rgba(207, 107, 79, 0.2)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Brighter recent trail
      const recentStart = Math.max(0, trail.length - 80);
      ctx.beginPath();
      ctx.moveTo(trail[recentStart].x, trail[recentStart].y);
      for (let i = recentStart + 1; i < trail.length; i++) {
        ctx.lineTo(trail[i].x, trail[i].y);
      }
      ctx.strokeStyle = dark
        ? "rgba(232, 148, 74, 0.6)"
        : "rgba(207, 107, 79, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw arms
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = dark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pivot
    ctx.beginPath();
    ctx.arc(ox, oy, 4, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)";
    ctx.fill();

    // Mass 1
    ctx.beginPath();
    ctx.arc(x1, y1, 8, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "#3dd9c1" : "#1e6f5c";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x1, y1, 14, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "rgba(61,217,193,0.12)" : "rgba(30,111,92,0.1)";
    ctx.fill();

    // Mass 2
    ctx.beginPath();
    ctx.arc(x2, y2, 8, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "#e8944a" : "#cf6b4f";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x2, y2, 14, 0, Math.PI * 2);
    ctx.fillStyle = dark ? "rgba(232,148,74,0.12)" : "rgba(207,107,79,0.1)";
    ctx.fill();

    requestAnimationFrame(loop);
  }

  resize();
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
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const dark = document.documentElement.getAttribute("data-theme") === "dark";

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
        : "rgba(67, 233, 123, 0.4)";
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
        : "rgba(67, 233, 123, 0.8)";
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
// PHYSICS SIM 4: Coupled Oscillators
// ════════════════════════════════════
(function () {
  const canvas = document.getElementById("waveSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  const N = 40;
  const y = new Float32Array(N);
  const v = new Float32Array(N);
  const k = 0.05; // coupling
  const damp = 0.98;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function init() {
    resize();
    for (let i = 0; i < N; i++) {
      y[i] = 0;
      v[i] = 0;
    }
  }

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.floor((mx / W) * N);
    if (idx >= 0 && idx < N) {
      y[idx] += 30; // drop a "stone"
      if (idx > 0) y[idx - 1] += 15;
      if (idx < N - 1) y[idx + 1] += 15;
    }
  });

  function loop() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";

    for (let i = 1; i < N - 1; i++) {
      const force = k * (y[i - 1] + y[i + 1] - 2 * y[i]);
      const restore = -0.01 * y[i];
      v[i] += force + restore;
      v[i] *= damp;
    }
    for (let i = 1; i < N - 1; i++) {
      y[i] += v[i];
    }

    ctx.clearRect(0, 0, W, H);

    const step = W / (N - 1);
    const oy = H / 2;

    ctx.beginPath();
    ctx.moveTo(0, oy + y[0]);
    for (let i = 1; i < N; i++) {
      ctx.lineTo(i * step, oy + y[i]);
    }
    ctx.strokeStyle = dark ? "#3dd9c1" : "#1e6f5c";
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let i = 0; i < N; i++) {
      ctx.beginPath();
      ctx.arc(i * step, oy + y[i], 3, 0, Math.PI * 2);
      ctx.fillStyle = dark ? "#FFFFFF" : "#000000";
      ctx.fill();
    }

    requestAnimationFrame(loop);
  }

  init();
  window.addEventListener("resize", resize);
  loop();
})();

// ════════════════════════════════════
// PHYSICS SIM 5: Boids Flocking
// ════════════════════════════════════
(function () {
  const canvas = document.getElementById("boidsSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  const boids = [];
  const NUM_BOIDS = 40;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  class Boid {
    constructor() {
      this.x = Math.random() * W || 200;
      this.y = Math.random() * H || 200;
      const a = Math.random() * Math.PI * 2;
      this.vx = Math.cos(a) * 2;
      this.vy = Math.sin(a) * 2;
      this.angle = a;
    }
  }

  function init() {
    resize();
    boids.length = 0;
    for (let i = 0; i < NUM_BOIDS; i++) boids.push(new Boid());
  }

  let targetX = null,
    targetY = null;
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    targetX = e.clientX - rect.left;
    targetY = e.clientY - rect.top;
  });
  canvas.addEventListener("mouseleave", () => {
    targetX = null;
    targetY = null;
  });
  canvas.addEventListener("click", () => {
    boids.forEach((b) => {
      b.vx += (Math.random() - 0.5) * 10;
      b.vy += (Math.random() - 0.5) * 10;
    });
  });

  function loop() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    ctx.clearRect(0, 0, W, H);

    const vLimit = 3;

    for (let i = 0; i < NUM_BOIDS; i++) {
      const b = boids[i];
      let cx = 0,
        cy = 0,
        sx = 0,
        sy = 0,
        ax = 0,
        ay = 0,
        neighbors = 0;

      for (let j = 0; j < NUM_BOIDS; j++) {
        if (i === j) continue;
        const o = boids[j];
        const dx = o.x - b.x,
          dy = o.y - b.y;
        const dist2 = dx * dx + dy * dy;

        if (dist2 < 4000) {
          cx += o.x;
          cy += o.y;
          ax += o.vx;
          ay += o.vy;
          neighbors++;
        }
        if (dist2 < 400) {
          sx -= dx;
          sy -= dy;
        }
      }

      let fx = 0,
        fy = 0;
      if (neighbors > 0) {
        cx /= neighbors;
        cy /= neighbors;
        ax /= neighbors;
        ay /= neighbors;
        fx += (cx - b.x) * 0.005;
        fx += (ax - b.vx) * 0.05; // alignment
        fy += (cy - b.y) * 0.005; // cohesion
        fy += (ay - b.vy) * 0.05;
      }
      fx += sx * 0.05; // separation
      fy += sy * 0.05;

      if (targetX !== null) {
        fx += (targetX - b.x) * 0.01;
        fy += (targetY - b.y) * 0.01;
      }

      b.vx += fx;
      b.vy += fy;

      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (speed > vLimit) {
        b.vx = (b.vx / speed) * vLimit;
        b.vy = (b.vy / speed) * vLimit;
      }
      if (speed < 1) {
        b.vx = (b.vx / speed) * 1;
        b.vy = (b.vy / speed) * 1;
      }

      b.x += b.vx;
      b.y += b.vy;

      if (b.x < 0) b.x += W;
      if (b.x > W) b.x -= W;
      if (b.y < 0) b.y += H;
      if (b.y > H) b.y -= H;

      const targetAngle = Math.atan2(b.vy, b.vx);
      let diff = targetAngle - b.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      b.angle += diff * 0.15; // Smooth realignment animation

      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, 3);
      ctx.lineTo(-4, -3);
      ctx.closePath();
      ctx.fillStyle = dark ? "#e8944a" : "#cf6b4f";
      ctx.fill();
      ctx.restore();
    }

    requestAnimationFrame(loop);
  }

  init();
  window.addEventListener("resize", resize);
  loop();
})();

// 7: 1D Traffic Flow (Nonlinear Dynamics - Bando Optimal Velocity Model)
(() => {
  const canvas = document.getElementById("trafficSim");
  const ctx = canvas.getContext("2d");
  let W, H;

  const numCars = 15;
  let cars = []; // { x: position (arc length), v: velocity }
  const radius = 80;
  const sensitivity = 0.8; // a in dv/dt = a[V(dx) - v]

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function init() {
    resize();
    cars = [];
    const circumference = 2 * Math.PI * radius;
    for (let i = 0; i < numCars; i++) {
      // Evenly spaced positions, fully random initial velocity
      const pos = (i / numCars) * circumference;
      const vel = Math.random() * 1.4; // Max velocity is 1.4
      cars.push({ x: pos, v: vel });
    }
  }

  // Realistic Bando Optimal Velocity (OV) nonlinear function
  const V_opt = (dx) => {
    const vmax = 1.4; // Maximum allowed velocity
    const hc = 28.0; // Safety distance (critical headway)
    const w = 6.0; // Transition width

    // Normalized tanh curve representing how drivers respond to distance to the car ahead
    // V(dx) = vmax * [tanh((dx - hc) / w) + tanh(hc / w)] / [1 + tanh(hc / w)]
    const normalization = 1.0 + Math.tanh(hc / w);
    return (
      (vmax * (Math.tanh((dx - hc) / w) + Math.tanh(hc / w))) / normalization
    );
  };

  // Click to brake a car and manually trigger a jam
  canvas.addEventListener("click", () => {
    if (cars.length > 0) cars[0].v = 0;
  });

  function loop() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    ctx.clearRect(0, 0, W, H);

    const circumference = 2 * Math.PI * radius;

    // Physics step
    let dt = 0.5;
    let newCars = JSON.parse(JSON.stringify(cars));

    for (let i = 0; i < numCars; i++) {
      let car = cars[i];
      let nextCar = cars[(i + 1) % numCars];

      let dx = nextCar.x - car.x;
      if (dx < 0) dx += circumference; // Wrap around ring

      let accel = sensitivity * (V_opt(dx) - car.v);
      newCars[i].v = car.v + accel * dt;

      // Prevent driving backwards
      if (newCars[i].v < 0) newCars[i].v = 0;

      newCars[i].x = car.x + newCars[i].v * dt;
      if (newCars[i].x > circumference) {
        newCars[i].x -= circumference;
      }
    }
    cars = newCars;

    // Render scene
    ctx.save();
    ctx.translate(W / 2, H / 2);

    // Draw circular 1D track
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = dark ? "#2a2a2a" : "#eaeaea";
    ctx.lineWidth = 14;
    ctx.stroke();

    ctx.strokeStyle = dark ? "#444" : "#ccc";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw cars
    for (let i = 0; i < numCars; i++) {
      const angle = cars[i].x / radius;
      const cx = Math.cos(angle) * radius;
      const cy = Math.sin(angle) * radius;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      ctx.beginPath();
      // Draw cars as little rectangles pointing along the track
      ctx.rect(-4, -6, 8, 12);

      // Color heatmaps based on local velocity
      // Slow = red, Fast = green
      const vRatio = Math.min(cars[i].v / 2.0, 1.0);
      const r = Math.floor(255 * (1 - vRatio));
      const g = Math.floor(255 * vRatio);
      ctx.fillStyle = `rgb(${r}, ${g}, 80)`;

      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    requestAnimationFrame(loop);
  }

  init();
  window.addEventListener("resize", resize);
  loop();
})();
