import { resizeCanvas, isDark, runWhenVisible } from "../../core/runtime.js";

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
  canvas.addEventListener("simulationresize", resize);
  runWhenVisible(canvas, loop);
})();
