import { clamp01 } from "./math.js";
import { jsVnoise } from "./terrain.js";

// Each landscape owns its placement grid, so rebuilds do not retain old trees.
export function createSceneryPlacement(groundHeight) {
  // ── Scenery placement. Instance stride 6 floats:
  // [worldX, worldY, worldZ, scale, yRotation, type] (0 = broadleaf, 1 = pine, 2 = rock)
  const occupiedScenery = new Map();
  function reserveScenery(x, z, radius, allowOverlap = false) {
    const cellSize = 0.8;
    const cx = Math.floor(x / cellSize), cz = Math.floor(z / cellSize);
    const reach = Math.ceil((radius + 1) / cellSize);
    for (let dz = -reach; !allowOverlap && dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const neighbors = occupiedScenery.get(`${cx + dx},${cz + dz}`) || [];
        if (neighbors.some((other) => Math.hypot(x - other.x, z - other.z) < radius + other.radius)) return false;
      }
    }
    const key = `${cx},${cz}`;
    if (!occupiedScenery.has(key)) occupiedScenery.set(key, []);
    occupiedScenery.get(key).push({ x, z, radius });
    return true;
  }

  function rejectionSample(opts) {
    const out = [];
    let attempts = 0;
    const maxAttempts = opts.count * 40;
    while (out.length / 6 < opts.count && attempts < maxAttempts) {
      attempts++;
      const rx = (opts.rnd() * 2 - 1) * opts.extent * (opts.spanFrac || 0.92);
      const rz = (opts.rnd() * 2 - 1) * opts.extent * (opts.spanFrac || 0.92);
      const h = groundHeight(rx, rz);
      if (h < opts.hMin || h > opts.hMax) continue;
      // Forest patches leave open meadows between groves.
      if (opts.clustered && opts.rnd() > 0.16 + jsVnoise(rx * 0.42 + 13, rz * 0.42 - 7) * 0.84) continue;
      const eps = 0.06;
      const hx = groundHeight(rx + eps, rz) - groundHeight(rx - eps, rz);
      const hz = groundHeight(rx, rz + eps) - groundHeight(rx, rz - eps);
      const slope = Math.hypot(hx, hz) / (2 * eps);
      if (slope > opts.slopeMax) continue;
      const scale = opts.scaleFn(opts.rnd, h);
      const clearance = opts.clearanceFn ? opts.clearanceFn(scale) : scale * (opts.type === 2 ? 0.78 : 0.62);
      if (!reserveScenery(rx, rz, clearance)) continue;
      const rot = opts.rnd() * Math.PI * 2;
      const settle = opts.settleFn ? opts.settleFn(scale, slope, h) : opts.yOffset;
      out.push(rx, h + settle, rz, scale, rot, opts.type);
    }
    return new Float32Array(out);
  }
  function placeTrees(count, extent, rnd) {
    return rejectionSample({
      count, extent, rnd,
      hMin: 0.22, hMax: 2.05, slopeMax: 1.25, clustered: true,
      yOffset: -0.006, type: 0.0,
      scaleFn: (r) => 0.22 + Math.pow(r(), 1.6) * 0.34,
      settleFn: (scale, slope) => -0.003 - slope * scale * 0.012,
    });
  }
  function placePines(count, extent, rnd) {
    // Above the broadleaf band and into the lower snow line, leaving the
    // steepest summit bare.
    return rejectionSample({
      count, extent, rnd,
      hMin: 0.90, hMax: 3.55, slopeMax: 1.65, clustered: true,
      yOffset: -0.004, type: 1.0,
      scaleFn: (r, h) => (0.26 + Math.pow(r(), 1.35) * 0.36) * (1 - clamp01((h - 2.4) / 1.2) * 0.30),
      settleFn: (scale, slope) => -0.002 - slope * scale * 0.010,
    });
  }

  function placeBoulders(count, extent, rnd) {
    return rejectionSample({
      count, extent, rnd,
      hMin: 0.45, hMax: 5.8, slopeMax: 2.1,
      type: 2.0,
      // Pick a permanent size at placement time: large foothill boulders
      // taper to small scree above the lower slopes, without growth animation.
      scaleFn: (r, h) => {
        const foothill = 1 - clamp01((h - 0.8) / 1.6);
        const minScale = 0.08 + foothill * 0.10;
        const maxScale = 0.20 + foothill * foothill * 0.88;
        return minScale + Math.pow(r(), 2.1) * (maxScale - minScale);
      },
      settleFn: (scale, slope) => -scale * (0.08 + slope * 0.20),
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
      const h = groundHeight(rx, rz);
      if (h < -0.22 || h > 1.85) continue;
      const eps = 0.06;
      const hx = groundHeight(rx + eps, rz) - groundHeight(rx - eps, rz);
      const hz = groundHeight(rx, rz + eps) - groundHeight(rx, rz - eps);
      const slope = Math.hypot(hx, hz) / (2 * eps);
      if (slope > 2.25) continue;
      const scale = 0.34 + rnd() * 0.38;
      const rot = rnd() * Math.PI * 2;
      out.push(rx, h - 0.018, rz, scale, rot);
    }
    return new Float32Array(out);
  }

  return { reserveScenery, placeTrees, placePines, placeBoulders, placeGrass };
}
