import { resizeCanvas, isDark, runWhenVisible } from "../../core/runtime.js";

(() => { // PHYSICS SIM 8: Brownian Motion of Particles
  const canvas = document.getElementById("brownianSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H;

  const particles = [];
  const DIFFUSION = 260; // px²/s
  const TRAIL_LENGTH = 42;
  let tracer;

  // Box–Muller gives the Gaussian displacement required by a Wiener process.
  function normal() {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function makeParticle(radius, isTracer = false) {
    return {
      x: radius + Math.random() * Math.max(1, W - radius * 2),
      y: radius + Math.random() * Math.max(1, H - radius * 2),
      radius,
      isTracer,
      trail: [],
    };
  }

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
    particles.length = 0;
    const count = Math.max(55, Math.min(120, Math.round((W * H) / 1500)));
    for (let i = 0; i < count; i++) particles.push(makeParticle(1.7));
    tracer = makeParticle(4.5, true);
  }

  function diffuse(p, dt) {
    const displacement = Math.sqrt(2 * DIFFUSION * dt);
    p.x += normal() * displacement;
    p.y += normal() * displacement;

    // Reflecting boundaries keep the particles in the fluid cell.
    if (p.x < p.radius) p.x = p.radius * 2 - p.x;
    if (p.x > W - p.radius) p.x = 2 * (W - p.radius) - p.x;
    if (p.y < p.radius) p.y = p.radius * 2 - p.y;
    if (p.y > H - p.radius) p.y = 2 * (H - p.radius) - p.y;

    if (p.isTracer) {
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > TRAIL_LENGTH) p.trail.shift();
    }
  }

  function drawTrail(dark) {
    if (tracer.trail.length < 2) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < tracer.trail.length; i++) {
      const opacity = (i / tracer.trail.length) * 0.55;
      ctx.strokeStyle = dark ? `rgba(96, 218, 194, ${opacity})` : `rgba(25, 126, 106, ${opacity})`;
      ctx.lineWidth = 1 + (i / tracer.trail.length) * 1.4;
      ctx.beginPath();
      ctx.moveTo(tracer.trail[i - 1].x, tracer.trail[i - 1].y);
      ctx.lineTo(tracer.trail[i].x, tracer.trail[i].y);
      ctx.stroke();
    }
  }

  let previousTime = performance.now();
  function loop() {
    const dark = isDark();
    const now = performance.now();
    const dt = Math.min(0.05, (now - previousTime) / 1000);
    previousTime = now;
    ctx.clearRect(0, 0, W, H);

    for (const p of particles) diffuse(p, dt);
    diffuse(tracer, dt);

    drawTrail(dark);
    ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.78)" : "rgba(0, 0, 0, 0.66)";
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = dark ? "#60dac2" : "#197e6a";
    ctx.beginPath();
    ctx.arc(tracer.x, tracer.y, tracer.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  resize();
  window.addEventListener("resize", () => {
    resize();
    previousTime = performance.now();
  });
  canvas.addEventListener("simulationresize", () => {
    resize();
    previousTime = performance.now();
  });
  canvas.addEventListener("click", () => {
    resize();
    previousTime = performance.now();
  });
  runWhenVisible(canvas, loop);
})();
