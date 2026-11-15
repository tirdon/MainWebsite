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
      const a = phase + (i / count) * Math.PI * 2 + Math.sin((i + 1) * 6.17 + y * 4.8) * 0.10;
      const wobble = 0.91 + 0.17 * Math.sin((i + 1) * 12.9898 + y * 19.19 + phase);
      const dirX = Math.cos(a), dirZ = Math.sin(a);
      const sideX = -dirZ, sideZ = dirX;
      const len = radius * wobble;
      const point = (reach, side, down) => [
        dirX * len * reach + sideX * width * side,
        y - drop * down,
        dirZ * len * reach + sideZ * width * side,
      ];
      // Solid boughs retain their undersides during the camera orbit.
      // Slightly lifted tips and uneven lengths soften the conical outline.
      const outline = [
        point(0.08, 0.28, 0), point(0.45, 1.0, 0.28),
        point(0.80, 0.48, 0.90), point(1.0, 0, 0.68),
        point(0.80, -0.48, 0.90), point(0.45, -1.0, 0.28),
        point(0.08, -0.28, 0),
      ];
      const crown = point(0.40, 0, 0.12);
      crown[1] += width * 0.65;
      const underside = point(0.45, 0, 0.48);
      underside[1] -= width * 0.48;
      for (let edge = 0; edge < outline.length; edge++) {
        const a = outline[edge], b = outline[(edge + 1) % outline.length];
        addTri(crown, a, b, crown, a, b, isLeaf);
        addTri(underside, b, a, underside, b, a, isLeaf);
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
  return { verts, addTri, cylinder, icoSphere, leafEllipsoid, pineWhorl };
}

// Broadleaf tree: root flare, segmented trunk, primary limbs, side twigs,
// and overlapping ellipsoid canopy clusters.
export function makeTree(seed) {
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

    const puff = 0.17 + rand() * 0.06;
    mb.leafEllipsoid(tipX, tipY + 0.045, tipZ, puff * 1.25, puff, puff * 1.05, 1);
    mb.leafEllipsoid(twigTip[0], twigTip[1] + 0.035, twigTip[2], puff * 0.90, puff * 0.75, puff * 0.85, 1);
  }
  mb.leafEllipsoid(baseLeanX * 0.75, 1.08, baseLeanZ * 0.75, 0.33 + rand() * 0.05, 0.27, 0.30, 1);
  mb.leafEllipsoid(baseLeanX * 0.3 - 0.15, 1.22 + rand() * 0.04, baseLeanZ * 0.3 + 0.08, 0.25, 0.20, 0.23, 1);
  mb.leafEllipsoid(baseLeanX * 0.3 + 0.15, 1.20 + rand() * 0.06, baseLeanZ * 0.3 - 0.06, 0.23, 0.19, 0.22, 1);
  return new Float32Array(mb.verts);
}

// Pine tree: exposed tapered trunk and overlapping, irregular evergreen
// boughs. Needle vertices use center=self through the seasonal transition.
export function makePine(seed) {
  const rand = makePRNG(seed);
  const mb = makeMeshBuilder();
  const j = () => (rand() - 0.5) * 0.035;
  const phase = rand() * Math.PI * 2;
  mb.cylinder([0, -0.015, 0], [0.008, 0.72, -0.006], 0.053, 0.030, 8, 0);
  mb.cylinder([0.008, 0.72, -0.006], [0, 1.66, 0], 0.030, 0.005, 7, 0);
  const rootCount = 5;
  for (let i = 0; i < rootCount; i++) {
    const a = phase + (i / rootCount) * Math.PI * 2 + rand() * 0.18;
    mb.cylinder(
      [0, 0.030, 0],
      [Math.cos(a) * (0.08 + rand() * 0.05), -0.018, Math.sin(a) * (0.08 + rand() * 0.05)],
      0.018,
      0.007,
      5,
      0,
    );
  }

  // Leave the lower trunk visible and taper the crown gradually upward.
  // Rotating each layer breaks up stacked, identical umbrella shapes.
  const tiers = [
    { y: 0.40, r: 0.46, d: 0.085, w: 0.095, n: 10 },
    { y: 0.54, r: 0.47, d: 0.100, w: 0.105, n: 11 },
    { y: 0.69, r: 0.43, d: 0.090, w: 0.100, n: 10 },
    { y: 0.84, r: 0.39, d: 0.080, w: 0.090, n: 9 },
    { y: 0.99, r: 0.34, d: 0.065, w: 0.080, n: 8 },
    { y: 1.13, r: 0.28, d: 0.050, w: 0.070, n: 7 },
    { y: 1.27, r: 0.22, d: 0.040, w: 0.060, n: 6 },
    { y: 1.39, r: 0.15, d: 0.032, w: 0.048, n: 5 },
    { y: 1.50, r: 0.09, d: 0.020, w: 0.030, n: 4 },
  ];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const tierY = t.y + j();
    const tierRadius = t.r * (0.94 + rand() * 0.12);
    mb.pineWhorl(tierY, tierRadius, t.d, t.w, t.n, phase + i * 0.79, 1);
    // Compact inner foliage fills the crown while preserving the branch tips.
    mb.cylinder([0, tierY - 0.055, 0], [0, tierY + 0.24, 0], tierRadius * 0.50, tierRadius * 0.07, 7, 1);
  }

  mb.cylinder([0, 1.49, 0], [0, 1.76, 0], 0.070, 0.002, 7, 1);
  return new Float32Array(mb.verts);
}

export function scaleMesh(source, sx, sy, sz) {
  const mesh = new Float32Array(source);
  for (let i = 0; i < mesh.length; i += 10) {
    mesh[i] *= sx; mesh[i + 1] *= sy; mesh[i + 2] *= sz;
    mesh[i + 3] *= sx; mesh[i + 4] *= sy; mesh[i + 5] *= sz;
    const nx = mesh[i + 6] / sx, ny = mesh[i + 7] / sy, nz = mesh[i + 8] / sz;
    const length = Math.hypot(nx, ny, nz) || 1;
    mesh[i + 6] = nx / length; mesh[i + 7] = ny / length; mesh[i + 8] = nz / length;
  }
  return mesh;
}

// Irregular, closed stone meshes share the foliage instance layout, allowing
// small scree and larger outcrops to use the same culling and draw pipeline.
export function makeBoulder(seed) {
  const rand = makePRNG(seed);
  const mb = makeMeshBuilder();
  const sides = 9;
  const rings = [
    { y: -0.20, radius: 0.44 },
    { y: 0.10, radius: 0.78 },
    { y: 0.48, radius: 0.63 },
    { y: 0.73, radius: 0.28 },
  ].map(({ y, radius }) => Array.from({ length: sides }, (_, i) => {
    const angle = i / sides * Math.PI * 2;
    const r = radius * (0.80 + rand() * 0.35);
    return [Math.cos(angle) * r, y + (rand() - 0.5) * 0.13, Math.sin(angle) * r * 0.80];
  }));
  const triangle = (a, b, c) => mb.addTri(a, b, c, a, b, c, 0);
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides;
      triangle(rings[ring][i], rings[ring + 1][i], rings[ring][next]);
      triangle(rings[ring][next], rings[ring + 1][i], rings[ring + 1][next]);
    }
  }
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    triangle(rings[3][i], [0.04, 0.84, -0.06], rings[3][next]);
    triangle(rings[0][next], [0, -0.24, 0], rings[0][i]);
  }
  return new Float32Array(mb.verts);
}

// Animals reuse the vertex layout, with center = [pivotX, pivotY, partId].
// Rigid parts keep body vertices out of the leg animation and rotate normals
// together with their geometry: 0 body, 1 head, 2 tail, 3–6 individual legs,
// 7 ears (hinged at their base, then carried by the head).
function tagAnimalPart(mesh, start, part, pivotX, pivotY) {
  for (let i = start; i < mesh.verts.length; i += 10) {
    mesh.verts[i + 3] = pivotX;
    mesh.verts[i + 4] = pivotY;
    mesh.verts[i + 5] = part;
  }
}

// Material IDs 0/1/2 distinguish fur, cream markings, and dark features.
export function makeFox() {
  const mb = makeMeshBuilder();
  mb.leafEllipsoid(-0.02, 0.39, 0, 0.37, 0.18, 0.15, 0);
  mb.leafEllipsoid(-0.24, 0.36, 0, 0.18, 0.20, 0.16, 0);
  mb.leafEllipsoid(0.25, 0.45, 0, 0.16, 0.20, 0.14, 0);
  mb.leafEllipsoid(0.34, 0.47, 0, 0.085, 0.15, 0.11, 1);
  tagAnimalPart(mb, 0, 0, 0, 0.35);
  const headStart = mb.verts.length;
  mb.leafEllipsoid(0.43, 0.67, 0, 0.18, 0.15, 0.13, 0);
  mb.cylinder([0.49, 0.63, 0], [0.70, 0.61, 0], 0.095, 0.023, 6, 1);
  mb.icoSphere(0.707, 0.614, 0, 0.027, 2);
  for (const side of [-1, 1]) mb.icoSphere(0.52, 0.705, side * 0.105, 0.019, 2);
  tagAnimalPart(mb, headStart, 1, 0.25, 0.49);
  const foxEarStart = mb.verts.length;
  for (const side of [-1, 1]) {
    const z = side * 0.083;
    const ear = [[0.32, 0.77, z - 0.050], [0.49, 0.77, z], [0.32, 0.77, z + 0.050], [0.35, 0.99, z + side * 0.018]];
    const center = [0, 0, 0];
    ear.forEach(p => p.forEach((value, axis) => { center[axis] += value / 4; }));
    for (const [ia, ib, ic, material] of [[0, 1, 2, 0], [0, 3, 1, 0], [1, 3, 2, 2], [2, 3, 0, 0]]) {
      const a = ear[ia], b = ear[ib], c = ear[ic];
      const ab = b.map((value, axis) => value - a[axis]);
      const ac = c.map((value, axis) => value - a[axis]);
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const outward = n.reduce((sum, value, axis) => sum + value * (a[axis] - center[axis]), 0) > 0;
      mb.addTri(a, outward ? b : c, outward ? c : b, a, outward ? b : c, outward ? c : b, material);
    }
  }
  tagAnimalPart(mb, foxEarStart, 7, 0.40, 0.77);
  for (const x of [-0.23, 0.23]) {
    for (const z of [-0.105, 0.105]) {
      const legStart = mb.verts.length;
      const footX = x + (x > 0 ? 0.035 : -0.015);
      const ground = 0;
      mb.cylinder([x, 0.35, z], [footX, ground + 0.12, z], 0.044, 0.027, 5, 0);
      mb.cylinder([footX, ground + 0.13, z], [footX, ground + 0.03, z], 0.029, 0.024, 5, 2);
      mb.leafEllipsoid(footX + 0.016, ground + 0.023, z, 0.049, 0.026, 0.032, 2);
      tagAnimalPart(mb, legStart, (x < 0 ? 3 : 5) + (z > 0 ? 1 : 0), x, 0.35);
    }
  }
  const tailStart = mb.verts.length;
  mb.cylinder([-0.31, 0.41, 0], [-0.60, 0.31, 0.07], 0.10, 0.15, 7, 0);
  mb.cylinder([-0.60, 0.31, 0.07], [-0.88, 0.20, 0.14], 0.15, 0.085, 7, 0);
  mb.cylinder([-0.88, 0.20, 0.14], [-1.05, 0.18, 0.18], 0.087, 0.006, 7, 1);
  tagAnimalPart(mb, tailStart, 2, -0.31, 0.41);
  return new Float32Array(mb.verts);
}

export function makeRabbit() {
  const mb = makeMeshBuilder();
  mb.leafEllipsoid(-0.10, 0.28, 0, 0.29, 0.25, 0.18, 0);
  tagAnimalPart(mb, 0, 0, 0, 0.25);
  const tailStart = mb.verts.length;
  mb.icoSphere(-0.37, 0.30, 0, 0.10, 1);
  tagAnimalPart(mb, tailStart, 2, -0.28, 0.30);
  const headStart = mb.verts.length;
  mb.leafEllipsoid(0.20, 0.43, 0, 0.17, 0.17, 0.14, 0);
  mb.leafEllipsoid(0.30, 0.37, 0, 0.12, 0.09, 0.10, 1);
  mb.icoSphere(0.395, 0.39, 0, 0.027, 2);
  for (const side of [-1, 1]) mb.icoSphere(0.265, 0.49, side * 0.117, 0.023, 2);
  tagAnimalPart(mb, headStart, 1, 0.10, 0.35);
  const rabbitEarStart = mb.verts.length;
  for (const side of [-1, 1]) {
    mb.leafEllipsoid(0.14, 0.73, side * 0.085, 0.065, 0.26, 0.045, 0);
    mb.leafEllipsoid(0.177, 0.76, side * 0.085, 0.025, 0.18, 0.027, 1);
  }
  tagAnimalPart(mb, rabbitEarStart, 7, 0.14, 0.50);
  for (const side of [-1, 1]) {
    for (const x of [-0.17, 0.20]) {
      const legStart = mb.verts.length;
      if (x < 0) mb.leafEllipsoid(-0.20, 0.16, side * 0.13, 0.15, 0.15, 0.10, 0);
      mb.cylinder([x, 0.25, side * 0.115], [x + 0.02, 0.055, side * 0.115], 0.047, 0.028, 5, 0);
      mb.leafEllipsoid(x + 0.055, 0.036, side * 0.115, 0.09, 0.035, 0.043, 1);
      tagAnimalPart(mb, legStart, (x < 0 ? 3 : 5) + (side > 0 ? 1 : 0), x, 0.25);
    }
  }
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

// ── Grass tuft: curved, tapered ribbons with enough width to catch light.
// Triangle-list, drawn on both sides:
// [x, y, z, tipT] per vertex (tipT 0->1 gives blade-base -> blade-tip colour).
export function makeGrass(seed) {
  const rand = makePRNG(seed);
  const verts = [];

  function addTriangle(a, ta, b, tb, c, tc) {
    verts.push(...a, ta, ...b, tb, ...c, tc);
  }

  const bladeCount = 16;
  const segmentCount = 3;
  for (let i = 0; i < bladeCount; i++) {
    const a = rand() * Math.PI * 2;
    const rootR = Math.sqrt(rand()) * 0.035;
    const root = [Math.cos(a) * rootR, 0, Math.sin(a) * rootR];
    const leanA = a + (rand() - 0.5) * 1.6;
    const lean = 0.035 + rand() * 0.065;
    const height = 0.11 + Math.pow(rand(), 1.5) * 0.13;
    const bladeWidth = 0.006 + rand() * 0.007;
    const sideX = -Math.sin(leanA), sideZ = Math.cos(leanA);
    const twistPhase = rand() * Math.PI;
    let previous;
    for (let s = 0; s <= segmentCount; s++) {
      const t = s / segmentCount;
      const bend = lean * t * t;
      const twist = Math.sin(t * Math.PI + twistPhase) * 0.010 * t;
      const center = [
        root[0] + Math.cos(leanA) * bend + sideX * twist,
        height * (1 - Math.pow(1 - t, 1.35)),
        root[2] + Math.sin(leanA) * bend + sideZ * twist,
      ];
      const halfWidth = bladeWidth * Math.pow(1 - t, 0.8);
      const left = [center[0] + sideX * halfWidth, center[1], center[2] + sideZ * halfWidth];
      const right = [center[0] - sideX * halfWidth, center[1], center[2] - sideZ * halfWidth];
      if (previous) {
        addTriangle(previous.left, previous.t, left, t, previous.right, previous.t);
        if (s < segmentCount) addTriangle(previous.right, previous.t, left, t, right, t);
      }
      previous = { left, right, t };
    }
  }

  return new Float32Array(verts);
}
