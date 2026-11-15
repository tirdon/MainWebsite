import { stableInnerHeight, simulationsPlaying, isDark } from "../../core/runtime.js";
import { createWildlifeSimulation } from "../../simulations/wildlife.js";
import { clamp01 } from "./math.js";
import { jsFbm } from "./terrain.js";

export function startMountainFallback2d({ canvas, particleCanvas, getScrollPhases, setMountainOpacity, fadeThreshold }) {
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
  const fallbackWildlife = createWildlifeSimulation({ compact: window.innerWidth <= 700 });

  function fract(v) { return v - Math.floor(v); }
  function fallbackHash(v) { return fract(Math.sin(v * 12.9898) * 43758.5453); }
  function ridgeY(t, w, h, layer) {
    const cone = Math.pow(Math.max(0, 1 - Math.abs(t * 2 - 1)), 1.35);
    if (layer === 2) {
      const peak = Math.min(0.63, cone * 0.70);
      const gullies = Math.sin(t * Math.PI * 37) * 0.003 * cone;
      const grain = (jsFbm(t * 48 + 21, 7.3, 3) - 0.5) * 0.004 * cone;
      return h * (0.91 - peak + gullies + grain);
    }
    // Low wooded foothills frame the single summit without competing peaks.
    const rolling = Math.sin(t * Math.PI * 3 + layer * 1.9) * 0.026
      + Math.sin(t * Math.PI * 7 + layer) * 0.012;
    return h * (0.88 - layer * 0.075 - cone * 0.045 + rolling);
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
    if (layer === 2) {
      ctx.fillStyle = fill;
    } else {
      const haze = ctx.createLinearGradient(0, h * 0.70, 0, h * 0.94);
      haze.addColorStop(0, "transparent");
      haze.addColorStop(1, fill);
      ctx.fillStyle = haze;
    }
    ctx.fill();
  }
  function drawPine(ctx, x, y, size, dark, seasonT) {
    const snow = 1 - seasonT;
    ctx.fillStyle = dark ? "#45372b" : "#725037";
    ctx.beginPath();
    ctx.moveTo(x - size * 0.028, y);
    ctx.lineTo(x + size * 0.028, y);
    ctx.lineTo(x + size * 0.006, y - size * 0.98);
    ctx.lineTo(x - size * 0.006, y - size * 0.98);
    ctx.closePath();
    ctx.fill();
    const rootW = size * 0.10;
    ctx.beginPath();
    ctx.moveTo(x - rootW, y + size * 0.02);
    ctx.lineTo(x, y - size * 0.07);
    ctx.lineTo(x + rootW, y + size * 0.02);
    ctx.closePath();
    ctx.fill();
    const tiers = 8;
    for (let i = 0; i < tiers; i++) {
      const tierY = y - size * (0.24 + i * 0.095);
      const width = size * (0.33 * Math.pow(1 - i / tiers, 0.88) + 0.015)
        * (0.92 + fallbackHash(x * 0.01 + i * 2.7) * 0.16);
      const height = size * (0.25 - i * 0.012);
      const grad = ctx.createLinearGradient(x - width, tierY, x + width, tierY);
      if (dark) {
        grad.addColorStop(0, "#203c32");
        grad.addColorStop(0.46, "#3e6550");
        grad.addColorStop(1, "#172d28");
      } else {
        grad.addColorStop(0, "#2d513d");
        grad.addColorStop(0.46, "#62885c");
        grad.addColorStop(1, "#233e34");
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
  function drawBroadleaf(ctx, x, y, size, dark, seasonT) {
    ctx.strokeStyle = dark ? "#3b3731" : "#66503b";
    ctx.lineWidth = Math.max(1, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - size * 0.85);
    for (let i = 0; i < 5; i++) {
      const side = i % 2 ? 1 : -1;
      ctx.moveTo(x, y - size * (0.32 + i * 0.10));
      ctx.lineTo(x + side * size * 0.24, y - size * (0.52 + i * 0.09));
    }
    ctx.stroke();
    const grow = clamp01((seasonT - 0.18) / 0.37);
    if (grow === 0) return;
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(angle) * size * 0.18, y - size * 0.70 + Math.sin(angle) * size * 0.16,
        size * 0.23 * grow, size * 0.20 * grow, 0, 0, Math.PI * 2);
      ctx.fillStyle = dark ? (i % 2 ? "#354e40" : "#263e35") : (i % 2 ? "#79965b" : "#4f794c");
      ctx.fill();
    }
  }
  function drawStone(ctx, x, y, size, dark, seasonT) {
    ctx.beginPath();
    ctx.moveTo(x - size * 0.60, y);
    ctx.lineTo(x - size * 0.43, y - size * 0.42);
    ctx.lineTo(x + size * 0.08, y - size * 0.65);
    ctx.lineTo(x + size * 0.53, y - size * 0.30);
    ctx.lineTo(x + size * 0.62, y);
    ctx.closePath();
    ctx.fillStyle = dark ? "#434b51" : "#868579";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + size * 0.08, y - size * 0.65);
    ctx.lineTo(x + size * 0.53, y - size * 0.30);
    ctx.lineTo(x + size * 0.62, y);
    ctx.lineTo(x - size * 0.02, y);
    ctx.closePath();
    ctx.fillStyle = dark ? "#2a333c" : "#61685e";
    ctx.fill();
    if (seasonT < 0.65) {
      ctx.strokeStyle = dark ? "#667584" : "#e4ebeb";
      ctx.lineWidth = size * 0.09 * (1 - seasonT);
      ctx.beginPath();
      ctx.moveTo(x - size * 0.43, y - size * 0.42);
      ctx.lineTo(x + size * 0.08, y - size * 0.65);
      ctx.lineTo(x + size * 0.40, y - size * 0.40);
      ctx.stroke();
    }
  }
  function drawFox(ctx, x, y, size, dark, animal) {
    const direction = Math.cos(animal.heading) >= 0 ? 1 : -1;
    // Same posture weights as the GPU shader: a stalk or a rest lowers the
    // body onto shortened legs, and a pounce lifts it with the legs stretched.
    const air = Math.sin(Math.PI * animal.leap);
    const low = animal.crouch * 0.06 + animal.rest * 0.20;
    const ground = -low;
    const stride = Math.sin(animal.phase) * animal.activity * 0.14 * (1 - Math.max(air, animal.rest));
    y -= Math.abs(Math.sin(animal.phase)) * animal.activity * size * 0.035 * (1 - air);
    y += (low - air * 0.32) * size;
    function polygon(points, fill) {
      ctx.beginPath();
      points.forEach(([px, py], index) => {
        const sx = x + px * size * direction, sy = y + py * size;
        if (index === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    const fur = dark ? "#c16a3b" : "#cb632d";
    const cream = dark ? "#c7c8b9" : "#f0e8d6";
    const charcoal = "#302c29";
    polygon([[-0.28, -0.35], [-0.63, -0.48], [-1.08, -0.15], [-0.95, -0.03], [-0.61, -0.12], [-0.28, -0.12]], fur);
    polygon([[-0.87, -0.30], [-1.08, -0.15], [-0.95, -0.03], [-0.78, -0.13]], cream);
    polygon([[-0.30, -0.29], [-0.18, -0.27], [-0.21 + stride - air * 0.22, ground], [-0.32 + stride - air * 0.22, ground]], charcoal);
    polygon([[0.16, -0.30], [0.28, -0.30], [0.32 - stride + air * 0.22, ground], [0.22 - stride + air * 0.22, ground]], charcoal);
    polygon([[-0.40, -0.40], [0.25, -0.45], [0.38, -0.22], [0.14, -0.14], [-0.33, -0.17]], fur);
    polygon([[0.18, -0.40], [0.28, -0.79], [0.42, -0.61], [0.49, -0.76], [0.51, -0.54], [0.70, -0.45], [0.42, -0.28]], fur);
    polygon([[0.26, -0.42], [0.70, -0.45], [0.42, -0.28], [0.30, -0.16]], cream);
    polygon([[0.29, -0.72], [0.33, -0.60], [0.27, -0.58]], charcoal);
    polygon([[0.47, -0.69], [0.48, -0.57], [0.42, -0.59]], charcoal);
    polygon([[0.46, -0.52], [0.50, -0.53], [0.51, -0.49], [0.47, -0.48]], charcoal);
    polygon([[0.65, -0.47], [0.72, -0.45], [0.67, -0.41]], charcoal);
  }
  function drawRabbit(ctx, x, y, size, dark, animal) {
    const hop = Math.max(0, Math.sin(animal.phase)) * animal.activity;
    ctx.save();
    ctx.translate(x, y - hop * size * 0.16);
    ctx.scale(Math.cos(animal.heading) >= 0 ? size : -size, size);
    // Alert: rear up about the planted hind foot. Fleeing: ears laid back.
    ctx.translate(-0.19, 0);
    ctx.rotate(-animal.alert * 0.6);
    ctx.translate(0.19, 0);
    const earBack = animal.crouch * 0.95 - animal.alert * 0.1;
    const fur = dark ? "#a5a18d" : "#b8a98b";
    const cream = dark ? "#d6d4bf" : "#f2ecdc";
    function ellipse(x, y, rx, ry, fill, angle = 0) {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); ctx.fill();
    }
    ellipse(-0.39, -0.26, 0.11, 0.11, cream);
    ellipse(-0.10, -0.25, 0.32, 0.25, fur);
    ellipse(0.21, -0.47, 0.19, 0.17, fur);
    // Ears hinge at their base; tilt is positive toward the tail.
    function ear(baseX, baseY, half, width, tilt, fill, inner) {
      const cx = baseX - Math.sin(tilt) * half, cy = baseY - Math.cos(tilt) * half;
      ellipse(cx, cy, width, half, fill, -tilt);
      if (inner) ellipse(cx, cy, 0.023, 0.18, inner, -tilt);
    }
    ear(0.174, -0.495, 0.27, 0.065, 0.2 + earBack, fur);
    ear(0.231, -0.513, 0.26, 0.055, -0.15 + earBack, fur, cream);
    ellipse(0.31, -0.40, 0.11, 0.08, cream);
    ellipse(-0.19 + hop * 0.12, -0.025, 0.14, 0.04, cream);
    ellipse(0.22 - hop * 0.10, -0.025, 0.10, 0.035, cream);
    ellipse(0.28, -0.51, 0.024, 0.025, "#302c29");
    ellipse(0.41, -0.42, 0.026, 0.023, "#302c29");
    ctx.restore();
  }
  function resizeFallback() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(stableInnerHeight * dpr));
    if (fallbackCanvas.width === w && fallbackCanvas.height === h) return;
    fallbackCanvas.width = w;
    fallbackCanvas.height = h;
  }
  function drawFallback() {
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
    if (fade < fadeThreshold) return false;
    ctx2d.save();
    // CSS owns the fade, matching the hero-to-landscape transition.
    drawRidge(ctx2d, w, h, 2, dark ? "#202c40" : "#7b8b99");
    ctx2d.beginPath();
    ctx2d.moveTo(w * 0.5, ridgeY(0.5, w, h, 2));
    ctx2d.lineTo(w * 0.79, h * 0.91);
    ctx2d.lineTo(w, h * 0.91);
    for (let i = 180; i >= 90; i--) {
      ctx2d.lineTo(i / 180 * w, ridgeY(i / 180, w, h, 2));
    }
    ctx2d.closePath();
    ctx2d.fillStyle = dark ? "#172234" : "#647786";
    ctx2d.fill();

    const snowLine = h * (0.57 - seasonT * 0.14);
    const snowPoints = [];
    for (let i = 0; i <= 180; i++) {
      const t = i / 180;
      const y = ridgeY(t, w, h, 2);
      if (y <= snowLine) snowPoints.push([t * w, y, t]);
    }
    if (snowPoints.length) {
      ctx2d.beginPath();
      ctx2d.moveTo(snowPoints[0][0], snowPoints[0][1]);
      snowPoints.forEach(([x, y]) => ctx2d.lineTo(x, y));
      for (let i = snowPoints.length - 1; i >= 0; i--) {
        const [x, y, t] = snowPoints[i];
        ctx2d.lineTo(x, Math.max(y, snowLine + Math.sin(t * 170) * h * 0.014));
      }
      ctx2d.closePath();
      ctx2d.fillStyle = dark ? "#64778f" : "#edf2f1";
      ctx2d.fill();
    }

    drawRidge(ctx2d, w, h, 1, dark ? "#25392f" : "#819777");
    drawRidge(ctx2d, w, h, 0, dark ? "#1c302a" : "#536f52");
    const scenery = [];
    const entityCount = window.innerWidth <= 700 ? 64 : 110;
    for (let i = 0; i < entityCount; i++) {
      const t = fallbackHash(i * 4.71 + 0.2);
      const layer = fallbackHash(i * 3.13) < 0.34 ? 1 : 0;
      const y = ridgeY(t, w, h, layer) + (5 + fallbackHash(i + 8) * 16) * dpr;
      const size = (18 + fallbackHash(i + 4) * 30) * dpr * (layer ? 0.78 : 1);
      scenery.push({ x: t * w, y, size, type: fallbackHash(i * 1.37 + 2) });
    }
    for (const animal of fallbackWildlife.animals) {
      if (animal.hidden > 0) continue;
      const pose = fallbackWildlife.getPose(animal);
      const t = 0.5 + pose.x / 20;
      const depth = (pose.z + 9.2) / 18.4;
      scenery.push({ x: t * w, y: ridgeY(t, w, h, 0) + 15 * dpr + depth * h * 0.09,
        size: (animal.species === "fox" ? 25 : 17) * dpr * (0.65 + depth * 0.45) * Math.min(1, pose.age / 0.5),
        type: animal.species === "fox" ? 3 : 4, animal: pose });
    }
    scenery.sort((a, b) => a.y - b.y);
    for (const entity of scenery) {
      if (entity.animal) {
        (entity.type === 3 ? drawFox : drawRabbit)(ctx2d, entity.x, entity.y, entity.size, dark, entity.animal);
      } else {
        const drawEntity = entity.type < 0.18 ? drawStone : entity.type < 0.45 ? drawBroadleaf : drawPine;
        drawEntity(ctx2d, entity.x, entity.y, entity.size, dark, seasonT);
      }
    }

    ctx2d.globalAlpha = seasonT * 0.72;
    for (let i = 0; i < 220; i++) {
      const t = fallbackHash(i * 2.37 + 6.0);
      const y = ridgeY(t, w, h, 0) + (18 + fallbackHash(i) * 42) * dpr;
      if (y < h * 0.68 || y > h) continue;
      const blade = (6 + fallbackHash(i + 19) * 10) * dpr;
      const lean = (fallbackHash(i + 31) - 0.5) * 7 * dpr;
      ctx2d.beginPath();
      ctx2d.moveTo(t * w - dpr, y);
      ctx2d.quadraticCurveTo(t * w + lean, y - blade * 0.55, t * w + lean * 0.7, y - blade);
      ctx2d.quadraticCurveTo(t * w + lean + dpr, y - blade * 0.50, t * w + dpr, y);
      ctx2d.closePath();
      ctx2d.fillStyle = dark ? (i % 2 ? "#426d50" : "#385c45") : (i % 2 ? "#638754" : "#4e774b");
      ctx2d.fill();
    }
    ctx2d.restore();
    return true;
  }
  let pending = false;
  let previousTime = null;
  let fallbackDirty = true;
  function queueFallback() {
    if (pending || document.hidden) return;
    pending = true;
    requestAnimationFrame((now) => {
      pending = false;
      if (document.hidden) { previousTime = null; return; }
      if (!fallbackDirty && previousTime !== null && now - previousTime < 1000 / 30) { queueFallback(); return; }
      const dt = previousTime === null ? 0 : (now - previousTime) / 1000;
      previousTime = now;
      const visible = getScrollPhases().p1 >= fadeThreshold;
      if (visible && simulationsPlaying) fallbackWildlife.update(dt);
      fallbackDirty = false;
      drawFallback();
      if (visible && simulationsPlaying) queueFallback();
      else previousTime = null;
    });
  }
  function scheduleFallback() { fallbackDirty = true; queueFallback(); }
  window.addEventListener("scroll", scheduleFallback, { passive: true });
  window.addEventListener("resize", scheduleFallback);
  document.addEventListener("themechange", scheduleFallback);
  document.addEventListener("simulationplaybackchange", () => { previousTime = null; scheduleFallback(); });
  document.addEventListener("visibilitychange", () => { previousTime = null; scheduleFallback(); });
  scheduleFallback();
}
