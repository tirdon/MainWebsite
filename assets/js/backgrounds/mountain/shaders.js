// WGSL for terrain, vegetation, wildlife, and seasonal particles.
const landscapeShader = `
struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  sunDir: vec3<f32>,
  seasonT: f32,
  fade: f32,
  themeDark: f32,
  canvasSize: vec2<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash21(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
}
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

// Three small world-space octaves add rock grain without animated noise.
fn terrainDetail(p: vec2<f32>) -> f32 {
  let coarse = vnoise(p);
  let medium = vnoise(p * 2.03 + vec2<f32>(11.1, 7.3));
  let fine = vnoise(p * 4.12 + vec2<f32>(33.6, 22.1));
  return coarse * 0.57 + medium * 0.29 + fine * 0.14;
}

fn mountainSnowLine() -> f32 {
  return mix(2.80, 4.65, u.seasonT);
}

fn landscapeColor(color: vec3<f32>, world: vec3<f32>) -> vec4<f32> {
  let dist = length(world - u.cameraPos);
  let fog = smoothstep(8.0, 38.0, dist) * 0.88;
  let skyW = mix(vec3<f32>(0.78, 0.84, 0.95), vec3<f32>(0.12, 0.14, 0.20), u.themeDark);
  let skyS = mix(vec3<f32>(0.88, 0.82, 0.70), vec3<f32>(0.14, 0.13, 0.18), u.themeDark);
  let hazy = mix(color, mix(skyW, skyS, u.seasonT), fog);
  // Become transparent well before the far clip plane, dissolving the ground
  // into the actual sky backdrop instead of drawing a straight horizon edge.
  let alpha = u.fade * (1.0 - smoothstep(18.0, 48.0, dist));
  return vec4<f32>(hazy * alpha, alpha);
}

struct VOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) height: f32,
  @location(3) slope: f32,
};

@vertex
fn vs_main(@location(0) world: vec3<f32>, @location(1) normal: vec3<f32>) -> VOut {
  var o: VOut;
  o.clipPos = u.viewProj * vec4<f32>(world, 1.0);
  o.worldPos = world;
  o.normal = normal;
  o.height = world.y;
  o.slope = 1.0 - normal.y;
  return o;
}

@fragment
fn fs_main(v: VOut) -> @location(0) vec4<f32> {
  let n = normalize(v.normal);
  let viewDir = normalize(v.worldPos - u.cameraPos);
  let l = normalize(u.sunDir);
  let ndl = max(0.0, dot(n, l));
  let halfV = normalize(l - viewDir);
  let spec = pow(max(0.0, dot(n, halfV)), 24.0) * 0.18;
  let lit = 0.35 + ndl * 0.9 + spec;

  // Two palettes, mixed by seasonT. In dark theme snow tilts toward a
  // moody alpine-night gray-blue instead of pure white so it doesn't blow
  // out against the page; rock and valley pick up a matching cool dim.
  let snowW   = mix(vec3<f32>(0.94, 0.96, 1.00), vec3<f32>(0.30, 0.36, 0.46), u.themeDark);
  let rockW   = mix(vec3<f32>(0.55, 0.55, 0.62), vec3<f32>(0.20, 0.22, 0.28), u.themeDark);
  let valleyW = mix(vec3<f32>(0.78, 0.82, 0.88), vec3<f32>(0.24, 0.28, 0.34), u.themeDark);
  let snowS   = mix(vec3<f32>(0.90, 0.94, 0.93), vec3<f32>(0.30, 0.36, 0.40), u.themeDark);
  let rockS   = mix(vec3<f32>(0.40, 0.43, 0.46), vec3<f32>(0.15, 0.17, 0.21), u.themeDark);
  let valleyS = mix(vec3<f32>(0.26, 0.52, 0.22), vec3<f32>(0.10, 0.20, 0.12), u.themeDark);

  let t = u.seasonT;
  let snowC   = mix(snowW,   snowS,   t);
  let rockC   = mix(rockW,   rockS,   t);
  let valleyC = mix(valleyW, valleyS, t);

  // Snow descends further in winter; valley line is higher in summer.
  let snowLine   = mountainSnowLine();
  let valleyLine = mix(0.30, 1.60, t);

  // Break up the snow line and expose strata on the higher rock faces.
  let detail = terrainDetail(v.worldPos.xz * 5.5);
  let h = v.height + (detail - 0.5) * 0.40;
  var color: vec3<f32>;
  if (h < valleyLine) {
    color = valleyC;
  } else if (h < snowLine) {
    color = mix(valleyC, rockC, smoothstep(valleyLine, snowLine, h));
  } else {
    color = mix(rockC, snowC, smoothstep(snowLine, snowLine + 0.65, h));
  }

  // Steep faces expose darker rock regardless of band.
  let slopeFactor = smoothstep(0.32, 0.72, v.slope);
  color = mix(color, rockC * 0.75, slopeFactor * 0.65);
  let strata = 0.92 + 0.08 * sin(v.height * 21.0 + detail * 4.0);
  color = color * mix(0.94 + detail * 0.12, strata, slopeFactor);

  color = color * lit;

  return landscapeColor(color, v.worldPos);
}

// ── Trees: trunk vertices stay at full size (so the mountain "appears" with
// stems already visible, snow-white at first); leaf-cluster vertices use a
// shared cluster center so broadleaf crowns grow in across the season.
// Pine needles keep their evergreen silhouette and recolour by season.
struct TreeVOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) isLeaf: f32,
  @location(3) treeType: f32,
};

@vertex
fn tree_vs(@location(0) localPos: vec3<f32>,
           @location(1) localCenter: vec3<f32>,
           @location(2) localNormal: vec3<f32>,
           @location(3) isLeaf: f32,
           @location(4) instOrigin: vec3<f32>,
           @location(5) instData: vec3<f32>) -> TreeVOut {
  let instScale = instData.x;
  let r = instData.y;
  let treeType = instData.z;

  // Leaves on broadleaf trees expand from the cluster center as season
  // grows. For stems (center=self) and pine cones (center=self) the offset
  // is zero so leafScale has no effect.
  let seasonGrow = smoothstep(0.18, 0.55, u.seasonT);
  let vegetationLeaf = select(0.0, isLeaf, treeType < 1.5);
  let leafScale = mix(1.0, seasonGrow, vegetationLeaf);
  let local = localCenter + (localPos - localCenter) * leafScale;
  // Rock geometry is permanent; only vegetation grows as the scene appears.
  let growth = select(u.fade, 1.0, treeType > 1.5);
  let scaled = local * (instScale * growth);

  let cr = cos(r);
  let sr = sin(r);
  let rotated = vec3<f32>(
    cr * scaled.x + sr * scaled.z,
    scaled.y,
    -sr * scaled.x + cr * scaled.z,
  );
  let world = rotated + instOrigin;
  let n = vec3<f32>(
    cr * localNormal.x + sr * localNormal.z,
    localNormal.y,
    -sr * localNormal.x + cr * localNormal.z,
  );

  var o: TreeVOut;
  o.clipPos = u.viewProj * vec4<f32>(world, 1.0);
  o.worldPos = world;
  o.normal = n;
  o.isLeaf = isLeaf;
  o.treeType = treeType;
  return o;
}

@fragment
fn tree_fs(v: TreeVOut) -> @location(0) vec4<f32> {
  let n = normalize(v.normal);
  let l = normalize(u.sunDir);
  let ndl = max(0.0, dot(n, l));
  let lit = 0.45 + ndl * 0.7;

  // Stems start snow-white when the mountain first appears and fade to
  // varied bark over the season.
  let barkTint = vnoise(v.worldPos.xz * 4.5);
  let bark = mix(vec3<f32>(0.23, 0.14, 0.08), vec3<f32>(0.38, 0.24, 0.13), barkTint);
  let stemSnow = mix(vec3<f32>(0.88, 0.92, 0.95), vec3<f32>(0.30, 0.36, 0.42), u.themeDark);
  let barkVisibility = max(u.seasonT, clamp(v.treeType, 0.0, 1.0) * 0.85);
  let stem = mix(stemSnow, bark * mix(1.0, 0.62, u.themeDark), barkVisibility);

  // Broadleaf canopy: mixed warm/cool greens with slight height variation.
  let wobble = vnoise(v.worldPos.xz * 2.8);
  let leafHeight = smoothstep(0.55, 1.55, v.worldPos.y);
  let broadWinter = mix(vec3<f32>(0.84, 0.88, 0.78), vec3<f32>(0.66, 0.74, 0.62), wobble);
  let broadSummer = mix(vec3<f32>(0.10, 0.30, 0.12), vec3<f32>(0.34, 0.50, 0.16), wobble);
  var broadLeaf = mix(broadWinter, broadSummer, u.seasonT);
  broadLeaf = mix(broadLeaf, broadLeaf * vec3<f32>(1.14, 1.08, 0.88), leafHeight * 0.25);
  broadLeaf = broadLeaf * mix(1.0, 0.58, u.themeDark);

  // Pine needles keep their evergreen mass but vary by tree and light angle.
  // Two scaled-noise samples give per-tree variation AND a finer per-branch
  // variation so the canopy reads as clusters of needles rather than a flat mass.
  let pineTint = vnoise(v.worldPos.xz * 1.8);
  let needleNoise = vnoise(v.worldPos.xz * 9.0 + vec2<f32>(v.worldPos.y));
  let pineBand = fract(v.worldPos.y * 9.7 + pineTint * 3.1);
  let upwardNeedle = smoothstep(-0.18, 0.72, n.y);
  let pineWinter = mix(vec3<f32>(0.13, 0.26, 0.22), vec3<f32>(0.27, 0.42, 0.32), pineTint);
  // Deeper, more saturated evergreen for summer with a hint of blue-green variation.
  let pineSummerDark  = vec3<f32>(0.050, 0.150, 0.080);
  let pineSummerMid   = vec3<f32>(0.160, 0.350, 0.135);
  let pineSummerBlue  = vec3<f32>(0.100, 0.280, 0.180);
  let pineSummer = mix(
    mix(pineSummerDark, pineSummerMid, pineTint),
    pineSummerBlue,
    needleNoise * 0.35,
  );
  var pineLeaf = mix(pineWinter, pineSummer, u.seasonT);
  // Light-facing (top) needles glow brighter; underside needles stay shadowed.
  pineLeaf = mix(pineLeaf * vec3<f32>(0.62, 0.78, 0.70), pineLeaf * vec3<f32>(1.22, 1.10, 0.86), upwardNeedle);
  // Faint horizontal banding picks out the whorls.
  pineLeaf = mix(pineLeaf, pineLeaf * vec3<f32>(0.84, 0.94, 0.82), step(0.76, pineBand) * 0.22);
  // Snow dust on top-facing needles in winter. Tinted toward a cool blue-gray
  // in dark theme so the dust matches the mountain palette.
  let pineSnow = mix(vec3<f32>(0.92, 0.96, 0.99), vec3<f32>(0.40, 0.46, 0.56), u.themeDark);
  pineLeaf = mix(pineLeaf, pineSnow, (1.0 - u.seasonT) * upwardNeedle * 0.68);
  // Final dark-theme dim so the canopy reads moodier without losing definition.
  let pineDarkMul = mix(1.0, 0.55, u.themeDark);
  pineLeaf = pineLeaf * pineDarkMul;

  let leaf = mix(broadLeaf, pineLeaf, clamp(v.treeType, 0.0, 1.0));
  var color = mix(stem, leaf, v.isLeaf) * lit;

  if (v.treeType > 1.5 && v.treeType < 2.5) {
    let mineral = vnoise(v.worldPos.xz * 6.0 + vec2<f32>(v.worldPos.y));
    let granite = mix(vec3<f32>(0.34, 0.36, 0.34), vec3<f32>(0.60, 0.56, 0.46), mineral);
    let moss = vec3<f32>(0.25, 0.37, 0.19);
    let mossCover = (1.0 - smoothstep(1.8, 3.3, v.worldPos.y)) * smoothstep(0.1, 0.8, n.y) * u.seasonT;
    // Snow settles on upward-facing facets above the mountain's snow line.
    // Steep sides keep their stone colour, and the rock geometry stays fixed.
    let altitudeSnow = smoothstep(mountainSnowLine() - 0.35, mountainSnowLine() + 0.10, v.worldPos.y);
    let snowCover = smoothstep(0.45, 0.85, n.y) * altitudeSnow;
    let rockSnow = mix(vec3<f32>(0.97, 0.98, 1.0), vec3<f32>(0.61, 0.69, 0.80), u.themeDark);
    let stone = mix(granite, moss, mossCover * 0.65) * mix(1.0, 0.48, u.themeDark);
    color = mix(stone, rockSnow, snowCover) * lit;
  } else if (v.treeType > 2.5) {
    // Fox material IDs reuse the leaf field: russet fur, cream, and charcoal.
    let russet = mix(vec3<f32>(0.84, 0.32, 0.10), vec3<f32>(0.68, 0.27, 0.10), u.themeDark);
    let cream = mix(vec3<f32>(0.97, 0.92, 0.80), vec3<f32>(0.71, 0.73, 0.69), u.themeDark);
    let charcoal = mix(vec3<f32>(0.075, 0.065, 0.060), vec3<f32>(0.030, 0.035, 0.042), u.themeDark);
    let rabbitFur = mix(vec3<f32>(0.70, 0.63, 0.48), vec3<f32>(0.58, 0.57, 0.51), u.themeDark);
    let baseFur = select(russet, rabbitFur, v.treeType > 3.5);
    let fur = mix(baseFur, cream, clamp(v.isLeaf, 0.0, 1.0));
    color = select(fur, charcoal, v.isLeaf > 1.5) * lit;
  }

  return landscapeColor(color, v.worldPos);
}

// Rigid animal parts: rotate positions and normals around authored joints.
fn animalRotateX(p: vec3<f32>, a: f32) -> vec3<f32> {
  return vec3<f32>(p.x, cos(a) * p.y - sin(a) * p.z, sin(a) * p.y + cos(a) * p.z);
}
fn animalRotateY(p: vec3<f32>, a: f32) -> vec3<f32> {
  return vec3<f32>(cos(a) * p.x + sin(a) * p.z, p.y, -sin(a) * p.x + cos(a) * p.z);
}
fn animalRotateZ(p: vec3<f32>, a: f32) -> vec3<f32> {
  return vec3<f32>(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y, p.z);
}

@vertex
fn animal_vs(@location(0) localPos: vec3<f32>,
             @location(1) joint: vec3<f32>,
             @location(2) localNormal: vec3<f32>,
             @location(3) material: f32,
             @location(4) origin: vec3<f32>,
             @location(5) data: vec3<f32>,
             @location(6) motion: vec4<f32>,
             @location(7) pose: vec4<f32>,
             @location(8) stance: vec4<f32>) -> TreeVOut {
  var local = localPos;
  var normal = localNormal;
  let rabbit = data.z > 3.5;
  let phase = motion.x;
  let activity = motion.y;
  let moving = smoothstep(0.0, 0.18, activity);
  let part = i32(joint.z + 0.5);
  let pivot = vec3<f32>(joint.xy, 0.0);
  let idle = pose.w;

  // Posture weights from the simulation: crouch, leap progress, alert, rest.
  let crouch = stance.x;
  let air = sin(stance.y * 3.14159);       // 0 → 1 → 0 across a pounce
  let alert = stance.z;
  let rest = stance.w;
  // Fox legs are rigid, so a stalk splays them and lying folds them forward;
  // the body drops by exactly what that rotation lifts the feet.
  let legLength = select(0.35, 0.25, rabbit);
  let stalkAngle = select(crouch * 0.62, 0.0, rabbit);
  let lieAngle = select(rest * 1.3, 0.0, rabbit);
  let drop = legLength * ((1.0 - cos(stalkAngle)) + (1.0 - cos(lieAngle)));
  // An alert rabbit rears up on its haunches.
  let sit = select(0.0, alert * 0.95, rabbit);
  let headPivot = select(vec3<f32>(0.25, 0.49, 0.0), vec3<f32>(0.10, 0.35, 0.0), rabbit);

  if (part >= 3 && part <= 6) {
    let front = part >= 5;
    let right = part == 4 || part == 6;
    // A four-beat walk blends into a diagonal trot; rabbits bound in pairs.
    let walkOffset = select(select(0.0, 3.14159, right), select(4.71239, 1.57080, right), front);
    let trotOffset = select(0.0, 3.14159, part == 4 || part == 5);
    let foxOffset = mix(walkOffset, trotOffset, smoothstep(0.25, 0.65, activity));
    let offset = select(foxOffset, select(0.0, 2.2, front), rabbit);
    let cycle = phase + offset;
    // No stride while airborne or lying down.
    let grounded = 1.0 - max(air, rest);
    let swingAngle = sin(cycle) * (0.30 + activity * 0.40) * moving * grounded;
    // Stalking splays the pairs apart, a leap stretches them out, lying folds
    // both pairs forward, and a sitting rabbit tucks its forepaws.
    var poseAngle = select(-1.0, 1.0, front) * (stalkAngle + air * 0.95) + lieAngle;
    if (front) { poseAngle -= sit * 0.55; }
    let legAngle = swingAngle + poseAngle;
    local = pivot + animalRotateZ(local - pivot, legAngle);
    normal = animalRotateZ(normal, legAngle);
    // Keep the stance leg near the ground while the other pair swings through.
    let stance01 = 1.0 - smoothstep(-0.12, 0.12, cos(cycle));
    let footWeight = 1.0 - smoothstep(0.04, pivot.y, localPos.y);
    local.y -= (1.0 - cos(swingAngle)) * pivot.y * stance01 * footWeight;
    local.y += max(0.0, cos(cycle)) * 0.045 * activity * footWeight * grounded;
  } else if (part == 2) {
    // The tail streams level in a leap and curls round the body at rest.
    let curl = select(rest * 1.15, 0.0, rabbit);
    let sway = sin(idle * 0.85) * 0.055 * (1.0 - rest) + sin(phase * 0.5) * activity * 0.16 - pose.x * 1.6 + curl;
    let lift = select(air * 0.45 - crouch * 0.12, 0.0, rabbit);
    local = pivot + animalRotateY(animalRotateZ(local - pivot, -lift), sway);
    normal = animalRotateY(animalRotateZ(normal, -lift), sway);
  }

  if (part == 7) {
    // Ears hinge at their base: rabbits lay them back to sprint and raise them
    // to listen; foxes flatten them to stalk and leap. Each side twitches at idle.
    let twitch = sin(idle * 2.6 + sign(localPos.z) * 1.7) * 0.07 * (1.0 - activity);
    let earAngle = select(crouch * 0.55 + air * 0.35, crouch * 1.15 - alert * 0.14, rabbit) + twitch;
    local = pivot + animalRotateZ(local - pivot, earAngle);
    normal = animalRotateZ(normal, earAngle);
  }
  if (part == 1 || part == 7) {
    // Head (and the ears it carries): graze or eat, hang low in a stalk or at
    // rest, and stay level while a rabbit's body rears up beneath it.
    let nod = -pose.z * 0.62 - sit * 0.8 - select(crouch * 0.30 + rest * 0.28, 0.0, rabbit)
      + sin(idle * 1.8) * 0.025 * (1.0 - activity);
    local = headPivot + animalRotateY(animalRotateZ(local - headPivot, nod), -pose.y);
    normal = animalRotateY(animalRotateZ(normal, nod), -pose.y);
  }

  // Everything except the planted hind legs pitches about the haunches.
  if (sit > 0.0 && part != 3 && part != 4) {
    let haunch = vec3<f32>(-0.16, 0.14, 0.0);
    local = haunch + animalRotateZ(local - haunch, sit);
    normal = animalRotateZ(normal, sit);
  }

  let bodyPivot = vec3<f32>(0.0, 0.28, 0.0);
  // Nose up on take-off, down on landing.
  let leapPitch = sin(stance.y * 6.28318) * 0.30;
  let bodyPitch = select(sin(phase * 2.0) * 0.018, sin(phase + 0.4) * 0.10, rabbit) * activity * (1.0 - air) + leapPitch;
  local = bodyPivot + animalRotateX(animalRotateZ(local - bodyPivot, bodyPitch), pose.x);
  normal = animalRotateX(animalRotateZ(normal, bodyPitch), pose.x);
  let bounce = select(abs(sin(phase)) * 0.018, max(0.0, sin(phase)) * 0.22, rabbit) * activity * (1.0 - air);
  local.y += bounce + (0.5 + 0.5 * sin(idle * 2.0)) * 0.005 * (1.0 - activity) - drop + air * 0.40;

  // An orthonormal ground frame follows the slope without shearing the body.
  let cr = cos(data.y);
  let sr = sin(data.y);
  let groundUp = normalize(vec3<f32>(-motion.z, 1.0, -motion.w));
  let forward = normalize(vec3<f32>(cr, motion.z * cr - motion.w * sr, -sr));
  let side = normalize(cross(forward, groundUp));
  let up = normalize(cross(side, forward));
  let scaled = local * data.x;
  let world = origin + forward * scaled.x + up * scaled.y + side * scaled.z;
  var o: TreeVOut;
  o.clipPos = u.viewProj * vec4<f32>(world, 1.0);
  o.worldPos = world;
  o.normal = normalize(forward * normal.x + up * normal.y + side * normal.z);
  o.isLeaf = material;
  o.treeType = data.z;
  return o;
}

// ── Grass: instanced ribbons, tapered and lit on both sides.
struct GrassVOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) tipT: f32,
};

@vertex
fn grass_vs(@location(0) localPos: vec3<f32>,
            @location(1) tipT: f32,
            @location(2) instOrigin: vec3<f32>,
            @location(3) instScaleRot: vec2<f32>) -> GrassVOut {
  let seasonGrow = smoothstep(0.20, 0.55, u.seasonT);
  let s = instScaleRot.x * seasonGrow * u.fade;
  let r = instScaleRot.y;
  let cr = cos(r);
  let sr = sin(r);
  var sp = localPos * s;
  let tuftRand = fract(sin(dot(instOrigin.xz, vec2<f32>(53.1, 17.7))) * 43758.5453);
  let bend = (tuftRand - 0.5) * 0.060 * tipT * tipT * s;
  sp.x = sp.x + bend;
  sp.z = sp.z + (0.5 - tuftRand) * 0.035 * tipT * tipT * s;
  let rotated = vec3<f32>(
    cr * sp.x + sr * sp.z,
    sp.y,
    -sr * sp.x + cr * sp.z,
  );
  let world = rotated + instOrigin;

  var o: GrassVOut;
  o.clipPos = u.viewProj * vec4<f32>(world, 1.0);
  o.worldPos = world;
  o.tipT = tipT;
  return o;
}

@fragment
fn grass_fs(v: GrassVOut) -> @location(0) vec4<f32> {
  let bladeT = clamp(v.tipT, 0.0, 1.0);
  let winterBase = vec3<f32>(0.58, 0.64, 0.52);
  let winterTip  = vec3<f32>(0.78, 0.82, 0.66);
  let summerBase = vec3<f32>(0.12, 0.29, 0.15);
  let summerTip  = vec3<f32>(0.40, 0.57, 0.26);
  let base = mix(winterBase, summerBase, u.seasonT);
  let tip = mix(winterTip, summerTip, u.seasonT);
  var color = mix(base, tip, bladeT);
  let meadowTint = vnoise(v.worldPos.xz * 4.0);
  color = color * mix(vec3<f32>(0.85, 0.96, 0.89), vec3<f32>(1.12, 1.04, 0.92), meadowTint);
  let bladeNormal = normalize(cross(dpdx(v.worldPos), dpdy(v.worldPos)));
  let light = 0.58 + 0.42 * abs(dot(bladeNormal, normalize(u.sunDir)));
  color = color * light;
  color = color * mix(1.0, 0.56, u.themeDark);

  return landscapeColor(color, v.worldPos);
}

struct ParticleUniforms {
  viewport: vec2<f32>,
  time: f32,
  seasonT: f32,
  fade: f32,
  themeDark: f32,
};
@group(0) @binding(1) var<uniform> p: ParticleUniforms;

fn hash11(n: f32) -> f32 {
  return fract(sin(n) * 43758.5453123);
}

fn rotate2(v: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);
}

struct ParticleOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) leafKeep: f32,
  @location(2) flakeSeed: f32,
};

@vertex
fn particle_vs(@builtin(vertex_index) vid: u32,
               @builtin(instance_index) iid: u32) -> ParticleOut {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let q = corners[vid % 6u];
  let id = f32(iid);
  let s0 = hash11(id * 12.9898 + 0.17);
  let s1 = hash11(id * 78.233 + 1.91);
  let s2 = hash11(id * 37.719 + 4.71);
  let s3 = hash11(id * 91.113 + 8.33);
  let s4 = hash11(id * 53.337 + 2.23);

  let snowPhase = 1.0 - smoothstep(0.18, 0.52, p.seasonT);
  let leafPhase = smoothstep(0.55, 0.86, p.seasonT);
  let leafMix = leafPhase / max(0.001, snowPhase + leafPhase);

  let snowCycle = fract(s1 + p.time * (0.035 + s2 * 0.026));
  let snowFall = snowCycle * snowCycle;
  var snowX = s0 * 2.42 - 1.21 + sin(p.time * (0.55 + s4) + s3 * 6.28318) * 0.065 + p.time * 0.012;
  snowX = fract((snowX + 1.21) / 2.42) * 2.42 - 1.21;
  let snowY = 1.18 - snowFall * 2.36;

  let leafCycle = fract(s3 + p.time * (0.012 + s4 * 0.012));
  let leafFall = leafCycle * 0.62 + 0.38 * leafCycle * leafCycle;
  var leafX = s0 * 2.48 - 1.24 + sin(p.time * (1.10 + s2) + s1 * 6.28318) * 0.16 + p.time * (0.012 + s2 * 0.020);
  leafX = fract((leafX + 1.24) / 2.48) * 2.48 - 1.24;
  let leafY = 1.16 - leafFall * 2.32 + sin(p.time * 3.1 + s0 * 6.28318) * 0.020 * leafPhase;

  let pos = mix(vec2<f32>(snowX, snowY), vec2<f32>(leafX, leafY), leafMix);
  let snowPx = 4.2 + s2 * 5.4;
  let leafPx = 5.5 + s4 * 5.0;
  let pxSize = mix(vec2<f32>(snowPx, snowPx), vec2<f32>(leafPx * 1.65, leafPx * 0.72), leafMix);
  let angle = leafMix * (p.time * (1.8 + s2 * 2.8) + s1 * 6.28318 + sin(p.time * 2.2 + s3 * 6.28318) * 0.65);
  let local = rotate2(q * pxSize / p.viewport * 2.0, angle);

  var o: ParticleOut;
  o.clipPos = vec4<f32>(pos + local, 0.0, 1.0);
  o.uv = q;
  o.leafKeep = 1.0 - step(0.30, s4);
  o.flakeSeed = s3;
  return o;
}

fn lineMask(uv: vec2<f32>, dir: vec2<f32>, halfWidth: f32, endAt: f32) -> f32 {
  let along = abs(dot(uv, dir));
  let dist = abs(uv.x * dir.y - uv.y * dir.x);
  let stroke = 1.0 - smoothstep(halfWidth, halfWidth * 1.85, dist);
  let cap = 1.0 - smoothstep(endAt * 0.78, endAt, along);
  return stroke * cap;
}

@fragment
fn particle_fs(v: ParticleOut) -> @location(0) vec4<f32> {
  let snowPhase = 1.0 - smoothstep(0.18, 0.52, p.seasonT);
  let leafPhase = smoothstep(0.55, 0.86, p.seasonT);
  let r = length(v.uv);
  let d0 = vec2<f32>(1.0, 0.0);
  let d1 = vec2<f32>(0.5, 0.8660254);
  let d2 = vec2<f32>(-0.5, 0.8660254);
  var flake = 1.0 - smoothstep(0.08, 0.24, r);
  flake = max(flake, lineMask(v.uv, d0, 0.030, 0.92));
  flake = max(flake, lineMask(v.uv, d1, 0.030, 0.92));
  flake = max(flake, lineMask(v.uv, d2, 0.030, 0.92));
  let branchA = 0.54 + v.flakeSeed * 0.10;
  flake = max(flake, lineMask(v.uv - d0 * 0.40, normalize(d1), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv + d0 * 0.40, normalize(d2), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv - d1 * 0.40, normalize(d2), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv + d1 * 0.40, normalize(d0), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv - d2 * 0.40, normalize(d0), 0.018, branchA) * 0.72);
  flake = max(flake, lineMask(v.uv + d2 * 0.40, normalize(d1), 0.018, branchA) * 0.72);
  let snowAlpha = flake * (1.0 - smoothstep(0.96, 1.18, r)) * snowPhase;
  let leafShape = (1.0 - smoothstep(0.18, 1.0, abs(v.uv.x))) * (1.0 - smoothstep(0.08, 1.0, abs(v.uv.y)));
  let leafVein = 1.0 - smoothstep(0.03, 0.11, abs(v.uv.x));
  let leafAlpha = leafShape * leafPhase * v.leafKeep;
  let snowColor = vec3<f32>(0.92, 0.97, 1.0);
  let leafT = 0.5 + 0.5 * v.uv.y;
  var lightLeaf = mix(vec3<f32>(0.28, 0.55, 0.24), vec3<f32>(0.78, 0.86, 0.28), leafT);
  lightLeaf = mix(lightLeaf, vec3<f32>(0.90, 0.94, 0.42), leafVein * 0.24);
  var darkLeaf = mix(vec3<f32>(0.10, 0.30, 0.11), vec3<f32>(0.48, 0.55, 0.12), leafT);
  darkLeaf = mix(darkLeaf, vec3<f32>(0.62, 0.68, 0.20), leafVein * 0.18);
  let leafColor = mix(lightLeaf, darkLeaf, p.themeDark);
  let combinedAlpha = max(snowAlpha, leafAlpha) * p.fade;
  let color = (snowColor * snowAlpha + leafColor * leafAlpha) / max(0.001, snowAlpha + leafAlpha);
  return vec4<f32>(color * combinedAlpha, combinedAlpha);
}
`;

export default landscapeShader;
