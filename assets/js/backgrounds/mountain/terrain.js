import { clamp01 } from "./math.js";

// Generate the landscape once on the CPU. Mesh vertices and entity roots
// sample the same surface, avoiding CPU/GPU noise differences at ground level.
function jsHash21(x, y) {
  const h = x * 127.1 + y * 311.7;
  const s = Math.sin(h) * 43758.5453;
  return s - Math.floor(s);
}
export function jsVnoise(x, y) {
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
export function jsFbm(x, y, octaves = 6) {
  let v = 0, amp = 0.55, px = x, py = y;
  for (let i = 0; i < octaves; i++) {
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
  const radius = Math.sqrt(r2);
  const angle = Math.atan2(z, x);
  // One dominant cone with a broad base and a gently flattened crater rim.
  const cone = Math.min(6.0, 6.65 * Math.pow(Math.max(0, 1 - radius / 8.8), 1.45));
  const crater = 0.22 * Math.exp(-r2 * 10);
  const flank = Math.min(1, radius * 0.8) * Math.max(0, 1 - radius / 8.8);
  const gullies = (Math.sin(angle * 14 + radius * 0.32) * 0.075
    + Math.sin(angle * 23 - radius * 0.24) * 0.035) * flank;
  const foothills = 0.36 * Math.exp(-r2 * 0.024);
  const texture = (jsRidgedFbm(x * 0.52, z * 0.52) - 0.55) * 0.12;
  // Small, static fractal relief on the flanks; taper it at the crater and
  // base so the single summit and distant ground keep their existing shape.
  const detailWeight = clamp01((radius - 0.45) / 0.85) * clamp01((8.8 - radius) / 1.8);
  const fineRelief = (jsFbm(x * 0.85 + 23.1, z * 0.85 - 7.7, 3) - 0.5) * 0.18 * detailWeight;
  return cone - crater + gullies + foothills + texture + fineRelief + jsFbm(x * 0.32, z * 0.32) * 0.16 - 0.12;
}

export function makeTerrain(grid, extent) {
  const step = extent * 2 / (grid - 1);
  // Detailed ground near the mountain, then inexpensive rings extending
  // beyond the camera's far plane. The square mesh boundary never enters view.
  const outerExtents = [14, 28, 64, 256];
  const borderCount = (grid - 1) * 4;
  const heights = new Float32Array(grid * grid);
  const vertices = new Float32Array((grid * grid + borderCount * outerExtents.length) * 6);
  const indices = new Uint32Array(((grid - 1) ** 2 + borderCount * outerExtents.length) * 6);
  for (let z = 0; z < grid; z++) {
    for (let x = 0; x < grid; x++) {
      heights[z * grid + x] = jsMountainHeight(x * step - extent, z * step - extent);
    }
  }
  let index = 0;
  for (let z = 0; z < grid; z++) {
    for (let x = 0; x < grid; x++) {
      const i = z * grid + x;
      const x0 = Math.max(0, x - 1), x1 = Math.min(grid - 1, x + 1);
      const z0 = Math.max(0, z - 1), z1 = Math.min(grid - 1, z + 1);
      const nx = (heights[z * grid + x0] - heights[z * grid + x1]) / ((x1 - x0) * step);
      const nz = (heights[z0 * grid + x] - heights[z1 * grid + x]) / ((z1 - z0) * step);
      const length = Math.hypot(nx, 1, nz);
      vertices.set([x * step - extent, heights[i], z * step - extent, nx / length, 1 / length, nz / length], i * 6);
      if (x < grid - 1 && z < grid - 1) {
        // Match these two triangles exactly when seating scenery below.
        indices.set([i, i + grid, i + 1, i + 1, i + grid, i + grid + 1], index);
        index += 6;
      }
    }
  }
  const border = [];
  for (let x = 0; x < grid - 1; x++) border.push(x);
  for (let z = 0; z < grid - 1; z++) border.push(z * grid + grid - 1);
  for (let x = grid - 1; x > 0; x--) border.push((grid - 1) * grid + x);
  for (let z = grid - 1; z > 0; z--) border.push(z * grid);
  let previousRing = border;
  let vertex = grid * grid;
  for (const outerExtent of outerExtents) {
    const ring = [];
    for (const original of border) {
      const x = vertices[original * 6] * outerExtent / extent;
      const z = vertices[original * 6 + 2] * outerExtent / extent;
      const nx = jsMountainHeight(x - 0.1, z) - jsMountainHeight(x + 0.1, z);
      const nz = jsMountainHeight(x, z - 0.1) - jsMountainHeight(x, z + 0.1);
      const length = Math.hypot(nx, 0.2, nz);
      vertices.set([x, jsMountainHeight(x, z), z, nx / length, 0.2 / length, nz / length], vertex * 6);
      ring.push(vertex++);
    }
    for (let i = 0; i < borderCount; i++) {
      const next = (i + 1) % borderCount;
      indices.set([previousRing[i], previousRing[next], ring[i], previousRing[next], ring[next], ring[i]], index);
      index += 6;
    }
    previousRing = ring;
  }
  function heightAt(x, z) {
    if (Math.abs(x) > extent || Math.abs(z) > extent) return jsMountainHeight(x, z);
    const gx = Math.max(0, Math.min(grid - 1, (x + extent) / step));
    const gz = Math.max(0, Math.min(grid - 1, (z + extent) / step));
    const ix = Math.min(grid - 2, Math.floor(gx)), iz = Math.min(grid - 2, Math.floor(gz));
    const tx = gx - ix, tz = gz - iz;
    const a = heights[iz * grid + ix], b = heights[iz * grid + ix + 1];
    const c = heights[(iz + 1) * grid + ix], d = heights[(iz + 1) * grid + ix + 1];
    return tx + tz <= 1
      ? a + (b - a) * tx + (c - a) * tz
      : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }
  return { vertices, indices, heightAt };
}

