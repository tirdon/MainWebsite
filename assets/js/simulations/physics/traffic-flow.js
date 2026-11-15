import { resizeCanvas, isDark, runWhenVisible } from "../../core/runtime.js";

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
  canvas.addEventListener("simulationresize", resize);
  runWhenVisible(canvas, loop);
})();
