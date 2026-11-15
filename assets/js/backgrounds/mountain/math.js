export const clamp01 = (value) => Math.max(0, Math.min(1, value));

// Column-major 4x4 matrix helpers. Perspective targets WebGPU clip space
// (z in [0, 1]) — different from the OpenGL convention.
export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, near * far * nf, 0,
  ]);
}
export function mat4LookAt(eye, target, up) {
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
export function mat4Mul(a, b) {
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

