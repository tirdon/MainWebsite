import { resizeCanvas, isDark, runWhenVisible } from "../../core/runtime.js";

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
  canvas.addEventListener("simulationresize", resize);
  runWhenVisible(canvas, loop);
})();
