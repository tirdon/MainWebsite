// Single shared WebGPU device. All sims and the mountain backdrop await this
// instead of each requesting their own adapter/device. Resolves to
// { device, format } once, or null if WebGPU is unavailable.
export const webgpuShared = (() => {
  if (!navigator.gpu) return { ready: Promise.resolve(null) };
  const ready = (async () => {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const format = navigator.gpu.getPreferredCanvasFormat();
      // If the device is lost we want every consumer to fall back gracefully.
      device.lost.then(() => {
        webgpuShared.lost = true;
      }).catch(() => {});
      return { device, format };
    } catch {
      return null;
    }
  })();
  return { ready, lost: false };
})();

// Helper: fullscreen-triangle vertex shader source shared by every sim that
// renders a 2D grid to a canvas. Emits a single triangle covering NDC.
export const FULLSCREEN_TRIANGLE_VS = `
@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  return vec4<f32>(pos[idx], 0.0, 1.0);
}
`;

