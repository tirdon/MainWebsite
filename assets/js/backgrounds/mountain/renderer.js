import { stableInnerHeight, simulationsPlaying, isDark } from "../../core/runtime.js";
import { webgpuShared } from "../../core/webgpu.js";
import { createWildlifeSimulation } from "../../simulations/wildlife.js";
import { clamp01, mat4Perspective, mat4LookAt, mat4Mul } from "./math.js";
import { makeTerrain } from "./terrain.js";
import { makeTree, makePine, scaleMesh, makeBoulder, makeFox, makeRabbit, makeGrass } from "./models.js";
import { createSceneryPlacement } from "./placement.js";
import { startMountainFallback2d } from "./fallback.js";
import landscapeShader from "./shaders.js";

// ════════════════════════════════════
(() => { // BACKDROP: Fuji-inspired volcanic cone, woodland, and rocky foothills
  const canvas = document.getElementById("mountainBg");
  const particleCanvas = document.getElementById("mountainParticles");
  if (!canvas) return;

  const setMountainOpacity = (v) => {
    document.documentElement.style.setProperty("--mountain-bg-opacity", v.toFixed(3));
  };
  // Below this fade level the mountain is effectively invisible — skip all
  // GPU work while the user is reading sections outside the backdrop's range.
  const FADE_THRESHOLD = 0.005;

  // Map document scroll into two phases:
  //   p1: 0 at top-of-#skills → 1 at top-of-#education (fade-in + zoom-out)
  //   p2: 0 at top-of-#education → 1 at bottom-of-#hobbies (orbit + season)
  // Reference point is the viewport center so the transition tracks where the
  // viewer's eye actually is.
  function getScrollPhases() {
    const skills = document.getElementById("skills");
    const education = document.getElementById("education");
    const hobbies = document.getElementById("hobbies");
    if (!skills || !education || !hobbies) return { p1: 0, p2: 0 };
    const ref = window.scrollY + stableInnerHeight * 0.5;
    const skillsTop = skills.getBoundingClientRect().top + window.scrollY;
    const educationTop = education.getBoundingClientRect().top + window.scrollY;
    const hobbiesBot = hobbies.getBoundingClientRect().bottom + window.scrollY;
    const p1 = clamp01((ref - skillsTop) / Math.max(1, educationTop - skillsTop));
    const p2 = clamp01((ref - educationTop) / Math.max(1, hobbiesBot - educationTop));
    return { p1, p2 };
  }

  let terrainSurface;
  const groundHeight = (x, z) => terrainSurface.heightAt(x, z);
  let fallbackStarted = false;
  function startFallback() {
    if (fallbackStarted) return;
    fallbackStarted = true;
    startMountainFallback2d({ canvas, particleCanvas, getScrollPhases, setMountainOpacity, fadeThreshold: FADE_THRESHOLD });
  }

  (async () => {
    const shared = await webgpuShared.ready;
    if (!shared || webgpuShared.lost) {
      startFallback();
      return;
    }
    const { device, format } = shared;

    const ctx = canvas.getContext("webgpu");
    if (!ctx) {
      startFallback();
      return;
    }
    ctx.configure({ device, format, alphaMode: "premultiplied",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
    const particleCtx = particleCanvas ? particleCanvas.getContext("webgpu") : null;
    if (particleCanvas && !particleCtx) particleCanvas.style.display = "none";
    if (particleCtx) particleCtx.configure({ device, format, alphaMode: "premultiplied" });

    // Keep the richer scenery affordable on phones; meshes are built once and
    // instanced, then culled to the current view before each scroll redraw.
    const compactScene = window.matchMedia("(max-width: 700px)").matches;
    const sceneBudget = compactScene
      ? { grid: 128, trees: 180, pines: 260, rocks: 90, grass: 1100, dpr: 1.5 }
      : { grid: 208, trees: 420, pines: 480, rocks: 180, grass: 3500, dpr: 2 };
    const EXTENT = 10.0;
    terrainSurface = makeTerrain(sceneBudget.grid, EXTENT);
    const { reserveScenery, placeTrees, placePines, placeBoulders, placeGrass } = createSceneryPlacement(groundHeight);
    const { vertices: verts, indices } = terrainSurface;
    const vertexBuffer = device.createBuffer({
      size: verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, verts);
    const indexBuffer = device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, indices);

    // ── Uniform layout (112 bytes, std140-style):
    //   off  0  mat4x4f  viewProj
    //   off 64  vec3f    cameraPos
    //   off 76  f32      time
    //   off 80  vec3f    sunDir
    //   off 92  f32      seasonT      (0 = winter snow, 1 = green forest)
    //   off 96  f32      fade         (0 = invisible, 1 = full)
    //   off 100 f32      themeDark    (0 = light, 1 = dark)
    //   off 104 vec2f    canvasSize   (CSS display W,H in CSS pixels)
    const UNIFORM_SIZE = 112;
    const uniformBuffer = device.createBuffer({
      size: UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const uniformData = new Float32Array(UNIFORM_SIZE / 4);

    const shaderModule = device.createShaderModule({ code: landscapeShader });
    const compilation = await shaderModule.getCompilationInfo();
    if (compilation.messages.some((message) => message.type === "error")) {
      throw new Error("Landscape shader compilation failed");
    }

    // Explicit pipeline layout so the mountain and tree pipelines share the
    // same uniform bind group rather than two auto-generated layouts.
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      }],
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    const blendPremul = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };

    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
          ],
        }],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{ format, blend: blendPremul }],
      },
      primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
    });

    // Shared placement PRNG so the forest stays the same across reloads.
    let placementSeed = 0xC0FFEE;
    const placementRand = () => {
      placementSeed = (placementSeed * 1664525 + 1013904223) >>> 0;
      return placementSeed / 4294967296;
    };

    // ── Scenery pipeline + geometry. Vertex stride 40 (3 pos + 3 center +
    // 3 normal + 1 isLeaf), instance stride 24 (3 origin + 3 [scale,rot,type]).
    function sceneryBatch(geometry, instances) {
      const vertexBuffer = device.createBuffer({
        size: geometry.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      const instanceBuffer = device.createBuffer({
        size: Math.max(24, instances.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(vertexBuffer, 0, geometry);
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < geometry.length; i += 10) {
        minY = Math.min(minY, geometry[i + 1]);
        maxY = Math.max(maxY, geometry[i + 1]);
      }
      const centerY = (minY + maxY) * 0.5;
      let radius = 0;
      for (let i = 0; i < geometry.length; i += 10) {
        radius = Math.max(radius, Math.hypot(geometry[i], geometry[i + 1] - centerY, geometry[i + 2]));
      }
      return {
        vertexBuffer, instanceBuffer, instances, centerY, radius: radius + 0.02,
        vertexCount: geometry.length / 10,
        count: instances.length / 6,
        visibleCount: 0,
        culled: new Float32Array(instances.length),
      };
    }
    // Keep initial animal groups in small clearings. Subsequent movement avoids
    // the actual trees and rocks using the same placement grid.
    const wildlifeObstacles = new Map();
    const wildlife = createWildlifeSimulation({ compact: compactScene, heightAt: groundHeight,
      blocked(x, z, clearance) {
        const cx = Math.floor(x / 0.8), cz = Math.floor(z / 0.8);
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const neighbors = wildlifeObstacles.get(`${cx + dx},${cz + dz}`);
            if (neighbors?.some(other => Math.hypot(x - other.x, z - other.z) < clearance + other.radius)) return true;
          }
        }
        return false;
      },
    });
    // Clearings may overlap each other; every animal still needs its full area.
    for (const animal of wildlife.animals) reserveScenery(animal.x, animal.z, 0.40, true);
    // Several silhouettes share each material: rounded crowns, slender trees,
    // broad firs, tall spruces, and two distinct rock profiles.
    const sceneryBatches = [
      sceneryBatch(makeBoulder(73), placeBoulders(sceneBudget.rocks / 2, EXTENT, placementRand)),
      sceneryBatch(scaleMesh(makeBoulder(91), 1.25, 0.72, 0.85), placeBoulders(sceneBudget.rocks / 2, EXTENT, placementRand)),
      sceneryBatch(makeTree(11), placeTrees(sceneBudget.trees / 2, EXTENT, placementRand)),
      sceneryBatch(scaleMesh(makeTree(47), 0.78, 1.18, 0.78), placeTrees(sceneBudget.trees / 2, EXTENT, placementRand)),
      sceneryBatch(makePine(31), placePines(sceneBudget.pines / 2, EXTENT, placementRand)),
      sceneryBatch(scaleMesh(makePine(53), 0.72, 1.20, 0.72), placePines(sceneBudget.pines / 2, EXTENT, placementRand)),
    ];
    for (const batch of sceneryBatches) {
      for (let i = 0; i < batch.instances.length; i += 6) {
        const [x, , z, scale, , type] = batch.instances.subarray(i, i + 6);
        const key = `${Math.floor(x / 0.8)},${Math.floor(z / 0.8)}`;
        if (!wildlifeObstacles.has(key)) wildlifeObstacles.set(key, []);
        wildlifeObstacles.get(key).push({ x, z, radius: scale * (type === 2 ? 0.8 : 0.16) });
      }
    }

    const treePipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "tree_vs",
        buffers: [
          {
            arrayStride: 40,
            attributes: [
              { shaderLocation: 0, offset: 0,  format: "float32x3" }, // localPos
              { shaderLocation: 1, offset: 12, format: "float32x3" }, // localCenter
              { shaderLocation: 2, offset: 24, format: "float32x3" }, // normal
              { shaderLocation: 3, offset: 36, format: "float32"   }, // isLeaf
            ],
          },
          {
            arrayStride: 24,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 4, offset: 0,  format: "float32x3" }, // origin
              { shaderLocation: 5, offset: 12, format: "float32x3" }, // scale, rot, type
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "tree_fs",
        targets: [{ format, blend: blendPremul }],
      },
      primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
    });

    const ANIMAL_FLOATS = 18;
    const animalBatches = [makeFox(), makeRabbit()].map((geometry, index) => {
      const species = index === 0 ? "fox" : "rabbit";
      const members = wildlife.animals.filter(animal => animal.species === species);
      const vertexBuffer = device.createBuffer({ size: geometry.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(vertexBuffer, 0, geometry);
      // Origin/scale/species, locomotion/slope, lean/head/graze/idle pose,
      // then crouch/leap/alert/rest posture weights.
      const instances = new Float32Array(members.length * ANIMAL_FLOATS);
      const instanceBuffer = device.createBuffer({ size: instances.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      return { members, instances, instanceBuffer, vertexBuffer, vertexCount: geometry.length / 10 };
    });
    const animalPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shaderModule, entryPoint: "animal_vs", buffers: [
        { arrayStride: 40, attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
          { shaderLocation: 2, offset: 24, format: "float32x3" },
          { shaderLocation: 3, offset: 36, format: "float32" },
        ] },
        { arrayStride: ANIMAL_FLOATS * 4, stepMode: "instance", attributes: [
          { shaderLocation: 4, offset: 0, format: "float32x3" },
          { shaderLocation: 5, offset: 12, format: "float32x3" },
          { shaderLocation: 6, offset: 24, format: "float32x4" },
          { shaderLocation: 7, offset: 40, format: "float32x4" },
          { shaderLocation: 8, offset: 56, format: "float32x4" },
        ] },
      ] },
      fragment: { module: shaderModule, entryPoint: "tree_fs", targets: [{ format, blend: blendPremul }] },
      primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less-equal" },
    });

    // ── Grass: solid blade tuft, instanced in patches on the valley /
    // low-slope band. Stride 16: 12B position + 4B tipT.
    const grassGeom = makeGrass(23);
    const grassVertCount = grassGeom.length / 4;
    const grassVertBuffer = device.createBuffer({
      size: grassGeom.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(grassVertBuffer, 0, grassGeom);

    const grassInstanceData = placeGrass(sceneBudget.grass, EXTENT, placementRand);
    const grassInstanceCount = grassInstanceData.length / 5;
    const grassInstanceBuffer = device.createBuffer({
      size: grassInstanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(grassInstanceBuffer, 0, grassInstanceData);

    // ── CPU frustum culling. The mountain only re-renders on scroll/theme/
    // resize. Sphere bounds come from each mesh so taller trees do not pop
    // out of view before their crowns have left the screen.
    // Sphere/plane test rejects instances completely outside the view.
    // We rewrite the same instance buffer each frame with only the visible
    // prefix, and pass the surviving count to draw().
    const culledGrassData = new Float32Array(grassInstanceData.length);
    let culledGrassCount = grassInstanceCount;
    const frustumPlanes = new Float32Array(24); // 6 planes × 4 floats

    // Extract the 6 frustum planes from a column-major viewProj matrix that
    // targets WebGPU clip space (z in [0, 1]). Each plane is normalized so
    // signed distance to a point is `a*x + b*y + c*z + d`; positive = inside.
    function extractFrustumPlanes(m, out) {
      // Left: row3 + row0
      out[ 0] = m[ 3] + m[ 0]; out[ 1] = m[ 7] + m[ 4]; out[ 2] = m[11] + m[ 8]; out[ 3] = m[15] + m[12];
      // Right: row3 - row0
      out[ 4] = m[ 3] - m[ 0]; out[ 5] = m[ 7] - m[ 4]; out[ 6] = m[11] - m[ 8]; out[ 7] = m[15] - m[12];
      // Bottom: row3 + row1
      out[ 8] = m[ 3] + m[ 1]; out[ 9] = m[ 7] + m[ 5]; out[10] = m[11] + m[ 9]; out[11] = m[15] + m[13];
      // Top: row3 - row1
      out[12] = m[ 3] - m[ 1]; out[13] = m[ 7] - m[ 5]; out[14] = m[11] - m[ 9]; out[15] = m[15] - m[13];
      // Near (D3D-style z >= 0): row2
      out[16] = m[ 2];          out[17] = m[ 6];          out[18] = m[10];          out[19] = m[14];
      // Far: row3 - row2
      out[20] = m[ 3] - m[ 2]; out[21] = m[ 7] - m[ 6]; out[22] = m[11] - m[10]; out[23] = m[15] - m[14];
      for (let p = 0; p < 6; p++) {
        const o = p * 4;
        const a = out[o], b = out[o + 1], c = out[o + 2];
        const inv = 1 / Math.max(1e-8, Math.hypot(a, b, c));
        out[o] = a * inv; out[o + 1] = b * inv; out[o + 2] = c * inv; out[o + 3] = out[o + 3] * inv;
      }
    }

    function cullStride6(src, total, planes, centerYMul, radiusMul, out) {
      let count = 0;
      for (let i = 0; i < total; i++) {
        const off = i * 6;
        const x = src[off], yb = src[off + 1], z = src[off + 2], scale = src[off + 3];
        const cy = yb + centerYMul * scale;
        const r = radiusMul * scale;
        let inside = true;
        for (let p = 0; p < 6; p++) {
          const o = p * 4;
          if (planes[o] * x + planes[o + 1] * cy + planes[o + 2] * z + planes[o + 3] < -r) {
            inside = false;
            break;
          }
        }
        if (inside) {
          const o2 = count * 6;
          out[o2]     = x;
          out[o2 + 1] = yb;
          out[o2 + 2] = z;
          out[o2 + 3] = scale;
          out[o2 + 4] = src[off + 4];
          out[o2 + 5] = src[off + 5];
          count++;
        }
      }
      return count;
    }

    function cullStride5(src, total, planes, centerYMul, radiusMul, out) {
      let count = 0;
      for (let i = 0; i < total; i++) {
        const off = i * 5;
        const x = src[off], yb = src[off + 1], z = src[off + 2], scale = src[off + 3];
        const cy = yb + centerYMul * scale;
        const r = radiusMul * scale;
        let inside = true;
        for (let p = 0; p < 6; p++) {
          const o = p * 4;
          if (planes[o] * x + planes[o + 1] * cy + planes[o + 2] * z + planes[o + 3] < -r) {
            inside = false;
            break;
          }
        }
        if (inside) {
          const o2 = count * 5;
          out[o2]     = x;
          out[o2 + 1] = yb;
          out[o2 + 2] = z;
          out[o2 + 3] = scale;
          out[o2 + 4] = src[off + 4];
          count++;
        }
      }
      return count;
    }

    const grassPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "grass_vs",
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0,  format: "float32x3" }, // localPos
              { shaderLocation: 1, offset: 12, format: "float32"   }, // tipT
            ],
          },
          {
            arrayStride: 20,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 2, offset: 0,  format: "float32x3" }, // origin
              { shaderLocation: 3, offset: 12, format: "float32x2" }, // scale + rot
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "grass_fs",
        targets: [{ format, blend: blendPremul }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
    });

    const particleBindGroupLayout = device.createBindGroupLayout({
      entries: [{
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      }],
    });
    const particlePipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [particleBindGroupLayout],
    });
    const PARTICLE_COUNT = compactScene ? 96 : 192;
    const particleUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const particleUniformData = new Float32Array(8);
    const particleBindGroup = device.createBindGroup({
      layout: particleBindGroupLayout,
      entries: [{ binding: 1, resource: { buffer: particleUniformBuffer } }],
    });
    const particlePipeline = particleCtx ? device.createRenderPipeline({
      layout: particlePipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "particle_vs",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "particle_fs",
        targets: [{ format, blend: blendPremul }],
      },
      primitive: { topology: "triangle-list" },
    }) : null;

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    let depthTex = null;
    let depthView = null;
    let landscapeTex = null;
    let landscapeDepth = null;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, sceneBudget.dpr);
      const w = Math.max(1, Math.floor(window.innerWidth * dpr));
      const h = Math.max(1, Math.floor(stableInnerHeight * dpr));
      const particleSized = !particleCanvas || (particleCanvas.width === w && particleCanvas.height === h);
      if (canvas.width === w && canvas.height === h && particleSized && depthTex) return;
      canvas.width = w;
      canvas.height = h;
      if (particleCanvas) {
        particleCanvas.width = w;
        particleCanvas.height = h;
      }
      if (depthTex) depthTex.destroy();
      if (landscapeTex) landscapeTex.destroy();
      if (landscapeDepth) landscapeDepth.destroy();
      depthTex = device.createTexture({
        size: [w, h],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      });
      depthView = depthTex.createView();
      landscapeTex = device.createTexture({ size: [w, h], format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      landscapeDepth = device.createTexture({ size: [w, h], format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    }
    resize();

    function render(nowSeconds) {
      const { p1, p2 } = getScrollPhases();

      // CSS display dimensions keep the view correct when mobile browser
      // chrome changes height without resizing the backing buffer.
      const displayRect = canvas.getBoundingClientRect();
      const displayW = displayRect.width || canvas.width;
      const displayH = displayRect.height || canvas.height;
      const aspect = displayW / displayH;

      // Phase 1 → close-up to wider framing ("zoom out" as fade comes in).
      const portraitFraming = 1 + Math.max(0, 1 - aspect) * 0.22;
      const radius = (6.0 + 2.6 * p1) * portraitFraming;
      // Phase 2 → one full revolution around the peak, with a gentle vertical bob.
      const angle = 0.18 * Math.PI + p2 * Math.PI * 2;
      const camY = 3.6 + 0.8 * p1 + 0.35 * Math.sin(p2 * Math.PI * 2);
      const eye = [Math.sin(angle) * radius, camY, Math.cos(angle) * radius];
      eye[1] = Math.max(eye[1], groundHeight(eye[0], eye[2]) + 1.25);
      const target = [0, 3.2 - 0.4 * p1, 0];
      const up = [0, 1, 0];

      const fade = p1;
      const seasonT = Math.min(1, p2 / 0.7);
      setMountainOpacity(fade);

      const proj = mat4Perspective(Math.PI / 3, aspect, 0.1, 80);
      const viewMat = mat4LookAt(eye, target, up);
      const vp = mat4Mul(proj, viewMat);

      const sunDir = [0.45, 0.80, 0.35];

      uniformData.set(vp, 0);
      uniformData[16] = eye[0]; uniformData[17] = eye[1]; uniformData[18] = eye[2];
      uniformData[19] = nowSeconds;
      uniformData[20] = sunDir[0]; uniformData[21] = sunDir[1]; uniformData[22] = sunDir[2];
      uniformData[23] = seasonT;
      uniformData[24] = fade;
      uniformData[25] = isDark() ? 1 : 0;
      uniformData[26] = displayW;
      uniformData[27] = displayH;
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      // Frustum-cull every scenery variant before uploading visible instances.
      extractFrustumPlanes(vp, frustumPlanes);
      for (const batch of sceneryBatches) {
        batch.visibleCount = cullStride6(batch.instances, batch.count, frustumPlanes, batch.centerY, batch.radius, batch.culled);
        if (batch.visibleCount > 0) {
          device.queue.writeBuffer(batch.instanceBuffer, 0, batch.culled, 0, batch.visibleCount * 6);
        }
      }
      culledGrassCount = cullStride5(grassInstanceData, grassInstanceCount, frustumPlanes, 0.10, 0.25, culledGrassData);
      if (culledGrassCount > 0) device.queue.writeBuffer(grassInstanceBuffer, 0, culledGrassData, 0, culledGrassCount * 5);

      const cmd = device.createCommandEncoder();
      const pass = cmd.beginRenderPass({
        colorAttachments: [{
          view: landscapeTex.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
        depthStencilAttachment: {
          view: landscapeDepth.createView(),
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      pass.setBindGroup(0, bindGroup);
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setIndexBuffer(indexBuffer, "uint32");
      pass.drawIndexed(indices.length);
      // Rocks and foliage share terrain depth, including the arched project views.
      pass.setPipeline(treePipeline);
      for (const batch of sceneryBatches) {
        if (!batch.visibleCount) continue;
        pass.setVertexBuffer(0, batch.vertexBuffer);
        pass.setVertexBuffer(1, batch.instanceBuffer);
        pass.draw(batch.vertexCount, batch.visibleCount);
      }
      pass.setPipeline(grassPipeline);
      pass.setVertexBuffer(0, grassVertBuffer);
      pass.setVertexBuffer(1, grassInstanceBuffer);
      if (culledGrassCount > 0) pass.draw(grassVertCount, culledGrassCount);
      pass.end();
      device.queue.submit([cmd.finish()]);
    }

    function renderWildlife() {
      const cmd = device.createCommandEncoder();
      const texture = ctx.getCurrentTexture();
      const size = [canvas.width, canvas.height];
      // Restore static colour AND depth before every frame so moving animals
      // leave no trails and remain occluded by mountains, trees, and rocks.
      cmd.copyTextureToTexture({ texture: landscapeTex }, { texture }, size);
      cmd.copyTextureToTexture({ texture: landscapeDepth }, { texture: depthTex }, size);
      const pass = cmd.beginRenderPass({
        colorAttachments: [{ view: texture.createView(), loadOp: "load", storeOp: "store" }],
        depthStencilAttachment: { view: depthView, depthLoadOp: "load", depthStoreOp: "store" },
      });
      pass.setBindGroup(0, bindGroup);
      pass.setPipeline(animalPipeline);
      for (const batch of animalBatches) {
        let count = 0;
        for (const animal of batch.members) {
          if (animal.hidden > 0) continue;
          const { x, z, heading, phase, activity, age, slopeX, slopeZ, lean, headYaw, graze, idle,
            crouch, leap, alert, rest } = wildlife.getPose(animal);
          const y = groundHeight(x, z) + 0.012;
          const scale = animal.scale * Math.min(1, age / 0.5);
          let visible = true;
          for (let p = 0; p < 6; p++) {
            const o = p * 4;
            if (frustumPlanes[o] * x + frustumPlanes[o + 1] * (y + scale * 0.5)
              + frustumPlanes[o + 2] * z + frustumPlanes[o + 3] < -scale * 1.6) { visible = false; break; }
          }
          if (!visible) continue;
          batch.instances.set([x, y, z, scale, -heading, animal.species === "fox" ? 3 : 4,
            phase % (Math.PI * 4), activity, slopeX, slopeZ, lean, headYaw, graze, idle % (Math.PI * 40),
            crouch, leap, alert, rest], count++ * ANIMAL_FLOATS);
        }
        if (!count) continue;
        device.queue.writeBuffer(batch.instanceBuffer, 0, batch.instances, 0, count * ANIMAL_FLOATS);
        pass.setVertexBuffer(0, batch.vertexBuffer);
        pass.setVertexBuffer(1, batch.instanceBuffer);
        pass.draw(batch.vertexCount, count);
      }
      pass.end();
      device.queue.submit([cmd.finish()]);
    }

    function renderParticles(nowSeconds) {
      if (!particleCtx || !particlePipeline || !particleCanvas) return;

      const { p1, p2 } = getScrollPhases();
      // Use the CSS display rect so particle pixel sizes stay consistent on
      // screen even when the buffer was sized to a different (stable) height.
      const particleRect = particleCanvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, sceneBudget.dpr);
      particleUniformData[0] = (particleRect.width || particleCanvas.width / dpr) * dpr;
      particleUniformData[1] = (particleRect.height || particleCanvas.height / dpr) * dpr;
      particleUniformData[2] = nowSeconds;
      particleUniformData[3] = Math.min(1, p2 / 0.7);
      particleUniformData[4] = p1;
      particleUniformData[5] = isDark() ? 1 : 0;
      device.queue.writeBuffer(particleUniformBuffer, 0, particleUniformData);

      const tex = particleCtx.getCurrentTexture();
      const cmd = device.createCommandEncoder();
      const pass = cmd.beginRenderPass({
        colorAttachments: [{
          view: tex.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(particlePipeline);
      pass.setBindGroup(0, particleBindGroup);
      pass.draw(6, PARTICLE_COUNT);
      pass.end();
      device.queue.submit([cmd.finish()]);
    }

    // Interpolate the 30 Hz simulation at display refresh on desktop. Phones
    // keep a 30 fps drawing budget while sharing exactly the same simulation.
    // Pausing, hiding the tab, or leaving the landscape stops simulation time.
    let needsRender = true;
    let mountainVisible = false;
    let rafQueued = false;
    let lastFrame = null;
    let simulationTime = 0;
    function ensureTick() {
      if (rafQueued || !mountainVisible || document.hidden || fallbackStarted) return;
      rafQueued = true;
      requestAnimationFrame(tick);
    }
    function schedule() {
      needsRender = true;
      ensureTick();
    }
    function tick(now) {
      rafQueued = false;
      if (!mountainVisible || document.hidden || fallbackStarted) { lastFrame = null; return; }
      if (webgpuShared.lost) { startFallback(); return; }
      const phases = getScrollPhases();
      if (phases.p1 < FADE_THRESHOLD) {
        // Section is in view (IntersectionObserver says so) but the fade
        // mapping puts the mountain at zero opacity — drop GPU work.
        setMountainOpacity(0);
        lastFrame = null;
        return;
      }
      if (compactScene && !needsRender && lastFrame !== null && now - lastFrame < 1000 / 30 - 0.5) { ensureTick(); return; }
      const dt = lastFrame === null ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      if (simulationsPlaying) { wildlife.update(dt); simulationTime += dt; }
      if (needsRender) {
        needsRender = false;
        render(simulationTime);
      }
      renderWildlife();
      renderParticles(simulationTime);
      if (simulationsPlaying) ensureTick();
    }
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", () => { resize(); schedule(); });
    document.addEventListener("simulationplaybackchange", () => { lastFrame = null; schedule(); });
    document.addEventListener("visibilitychange", () => { lastFrame = null; if (!document.hidden) schedule(); });

    const visibleSections = new Set();
    const visObserver = new IntersectionObserver((entries) => {
      const wasVisible = mountainVisible;
      for (const e of entries) {
        if (e.isIntersecting) visibleSections.add(e.target);
        else visibleSections.delete(e.target);
      }
      mountainVisible = visibleSections.size > 0;
      if (!mountainVisible) lastFrame = null;
      if (mountainVisible && !wasVisible) {
        needsRender = true;
        ensureTick();
      }
    }, { rootMargin: "200px 0px 200px 0px" });
    const observedSections = ["skills", "experience", "education", "extracurricular", "project", "interests", "hobbies", "personal-data"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const footer = document.querySelector("footer");
    if (footer) observedSections.push(footer);
    if (observedSections.length === 0) {
      mountainVisible = true;
      ensureTick();
    } else {
      for (const sec of observedSections) visObserver.observe(sec);
    }
  })().catch(() => {
    startFallback();
  });
})();
