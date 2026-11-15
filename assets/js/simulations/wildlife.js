// Deterministic predator–prey behavior in landscape X/Z coordinates.
// A fixed simulation step and interpolated poses keep motion independent of FPS.
//
// Foxes: roam / graze (sniff) → stalk (slow, crouched approach while the rabbit
// has not bolted) → hunt (sprint) → pounce (short leap) → rest (eat, then lie down).
// Rabbits: roam / graze → alert (freeze upright and watch a distant fox, or
// answer a neighbour's alarm) → flee (zigzag sprint, ears laid back).
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const angleDelta = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const approach = (value, target, amount) => value + clamp(target - value, -amount, amount);
// Renderers read these per frame. crouch / leap / alert / rest are 0–1 posture
// weights: stalking or ears-back sprint, pounce progress, upright watch, lying down.
const poseFields = ["x", "z", "heading", "phase", "activity", "lean", "headYaw", "graze", "idle", "slopeX", "slopeZ", "age",
  "crouch", "leap", "alert", "rest"];

const RABBIT_SIGHT = 1.9;      // notices a fox and freezes to watch it
const RABBIT_FLIGHT = 1.0;     // bolts from any fox this close
const RABBIT_ALARM = 1.4;      // a bolting rabbit startles neighbours within this range
const FOX_SIGHT = 3.3;
const FOX_CHARGE = 1.2;        // stalking ends and the sprint begins
const FOX_POUNCE = 0.56;       // leap range once sprinting and facing the rabbit
const POUNCE_SECONDS = 0.42;

export function createWildlifeSimulation({ compact = false, heightAt = () => 0, blocked = () => false, seed = 7349 } = {}) {
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const animals = [];
  const foxCount = compact ? 3 : 5;
  const rabbitCount = compact ? 16 : 28;
  const stepSeconds = 1 / 30;
  let accumulator = 0;
  let time = 0;
  const stats = { catches: 0, returns: 0, pounces: 0, misses: 0 };
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const clearanceFor = animal => animal.species === "fox" ? 0.18 : 0.10;

  function slopeAt(x, z) {
    return [(heightAt(x + 0.14, z) - heightAt(x - 0.14, z)) / 0.28,
      (heightAt(x, z + 0.14) - heightAt(x, z - 0.14)) / 0.28];
  }
  function habitable(x, z, clearance = 0.12) {
    const radius = Math.hypot(x, z);
    if (radius < 5.6 || radius > 9.15 || blocked(x, z, clearance)) return false;
    return Math.hypot(...slopeAt(x, z)) < 0.95;
  }
  function savePose(animal) {
    for (const field of poseFields) animal.previous[field] = animal[field];
  }

  function spawn(animal, angle, avoidHunters = false) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const a = attempt < 12 ? angle + (random() - 0.5) * 0.6 : random() * TAU;
      const radius = 6.6 + random() * 1.9;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      if (!habitable(x, z, clearanceFor(animal))) continue;
      if (avoidHunters && animals.some(other => other.species === "fox" && Math.hypot(other.x - x, other.z - z) < 2)) continue;
      const [slopeX, slopeZ] = slopeAt(x, z);
      Object.assign(animal, { x, z, vx: 0, vz: 0, speed: 0, heading: a + Math.PI / 2,
        nextHeading: a + Math.PI / 2, desiredSpeed: 0, wantedHead: 0,
        wanderHeading: a + Math.PI / 2, angularVelocity: 0, avoidance: 0, avoidanceTimer: 0,
        stuckTime: 0, escapeTimer: 0, escapeHeading: a + Math.PI / 2,
        hidden: 0, age: avoidHunters ? 0 : 1, state: "roam", timer: 1 + random() * 4,
        energy: 1, targetId: -1, activity: 0, lean: 0, headYaw: 0, graze: 0,
        crouch: 0, leap: 0, alert: 0, rest: 0, leaping: false, pounceCooldown: 0, stalkTime: 0, eating: 0, alarm: 0, startled: false,
        idle: time * 1.7 + animal.id * 2.3, slopeX, slopeZ });
      savePose(animal); // A returning animal never interpolates across the world.
      return true;
    }
    return false;
  }

  for (let i = 0; i < foxCount + rabbitCount; i++) {
    const species = i < foxCount ? "fox" : "rabbit";
    const animal = { id: i, species, scale: species === "fox" ? 0.36 + random() * 0.07 : 0.27 + random() * 0.06,
      phase: random() * TAU, hidden: 1, x: 0, z: 0, previous: {}, pose: {} };
    const group = i < foxCount ? i : (i - foxCount) % foxCount;
    spawn(animal, group / foxCount * TAU + 0.4 + (species === "rabbit" ? 0.15 : 0));
    animals.push(animal);
  }

  function pathClear(animal, angle, reach) {
    const dx = Math.cos(angle), dz = Math.sin(angle), clearance = clearanceFor(animal);
    // Check the near edge too; a longer probe alone can skip a narrow obstacle.
    const near = Math.min(0.02, reach / 2);
    if (!habitable(animal.x + dx * near, animal.z + dz * near, clearance)) return false;
    // Sample along the path so a narrow trunk cannot fall between the feelers.
    const samples = Math.max(2, Math.ceil(reach / 0.16));
    for (let i = 1; i <= samples; i++) {
      const d = reach * i / samples;
      if (!habitable(animal.x + dx * d, animal.z + dz * d, clearance)) return false;
    }
    return true;
  }

  function avoidObstacles(animal, desired, speed, dt) {
    const reach = 0.18 + Math.max(animal.speed, speed) * 0.52;
    animal.avoidanceTimer = Math.max(0, animal.avoidanceTimer - dt);
    if (pathClear(animal, desired, reach)) {
      // Briefly hold the chosen side until past an obstacle instead of zigzagging.
      if (animal.avoidanceTimer > 0) {
        const held = desired + animal.avoidance * 0.32;
        if (pathClear(animal, held, reach)) return held;
      }
      return desired;
    }
    let best = animal.heading, score = -Infinity;
    const preferredSide = animal.avoidance || (animal.id % 2 ? 1 : -1);
    for (const offset of [0.45, -0.45, 0.85, -0.85, 1.3, -1.3, 1.85, -1.85, 2.5, -2.5, Math.PI]) {
      const angle = desired + offset;
      if (!pathClear(animal, angle, reach)) continue;
      const candidateScore = Math.cos(offset) * 2 + Math.cos(angleDelta(angle, animal.heading))
        + (Math.sign(offset) === preferredSide ? 0.35 : 0);
      if (candidateScore > score) { score = candidateScore; best = angle; }
    }
    if (score === -Infinity) {
      // In a tight gap, brake and turn toward a short clear exit.
      for (let i = 1; i <= 8; i++) {
        const angle = animal.heading + preferredSide * i * Math.PI / 4;
        if (pathClear(animal, angle, 0.12)) { best = angle; break; }
      }
    }
    animal.avoidance = Math.sign(angleDelta(best, desired)) || preferredSide;
    animal.avoidanceTimer = 0.65;
    return best;
  }

  function chooseEscape(animal) {
    let best = animal.heading, bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const angle = animal.heading + i * TAU / 16;
      if (!pathClear(animal, angle, 0.13)) continue;
      const open = pathClear(animal, angle, 0.5) ? 2 : pathClear(animal, angle, 0.3) ? 1 : 0;
      const score = open + Math.cos(angleDelta(angle, animal.heading)) * 0.25;
      if (score > bestScore) { bestScore = score; best = angle; }
    }
    animal.escapeHeading = best;
    animal.escapeTimer = 1.4;
    animal.stuckTime = 0;
  }

  function step(dt) {
    time += dt;
    for (const animal of animals) {
      if (animal.hidden > 0) {
        animal.hidden -= dt;
        if (animal.hidden <= 0) {
          if (spawn(animal, random() * TAU, true)) stats.returns++;
          else animal.hidden = 1;
        }
        continue;
      }
      savePose(animal);
      animal.age += dt;
      animal.timer -= dt;
      const fox = animal.species === "fox";
      animal.alarm = Math.max(0, animal.alarm - dt);
      animal.eating = Math.max(0, animal.eating - dt);
      animal.pounceCooldown = Math.max(0, animal.pounceCooldown - dt);
      animal.startled = false;
      let target = animals[animal.targetId];
      const sight = fox ? FOX_SIGHT : RABBIT_SIGHT;
      // Keep a chase target until it escapes the wider release radius.
      if (!target || target.hidden > 0 || distance(animal, target) > sight + 0.65) target = null;
      let nearest = target ? distance(animal, target) * 0.65 : sight;
      for (const other of animals) {
        if (other.hidden > 0 || other.species === animal.species) continue;
        const d = distance(animal, other);
        if (d < nearest) { nearest = d; target = other; }
      }
      // A fox that is resting (fed or spent) only worries rabbits at close range.
      if (!fox && target && target.state === "rest" && distance(animal, target) > 0.9) target = null;
      animal.targetId = target?.id ?? -1;
      let dx = Math.cos(animal.wanderHeading), dz = Math.sin(animal.wanderHeading);
      let speed = fox ? 0.27 : 0.18;
      const gap = target ? distance(animal, target) : Infinity;
      const charging = target && (target.state === "hunt" || target.state === "pounce");
      // Keep running until the fox gives up or falls well behind, then stop and look back.
      const fleeing = animal.state === "flee" && (charging || gap < RABBIT_FLIGHT + 0.6);
      if (!fox && target && (fleeing || gap < RABBIT_FLIGHT || charging || animal.alarm > 0)) {
        if (animal.state !== "flee") animal.startled = true;
        animal.state = "flee";
        dx = animal.x - target.x; dz = animal.z - target.z;
        // Zigzag while running; sidestep hard when the fox commits to a leap.
        const dodge = target.state === "pounce" && target.targetId === animal.id ? 0.85 : 0.25;
        const jink = Math.sin(time * 2.3 + animal.id * 2.7) * dodge;
        const awayX = dx; dx -= dz * jink; dz += awayX * jink;
        speed = 0.86;
        animal.timer = 1.2;
      } else if (!fox && (target || animal.alarm > 0)) {
        // Freeze upright: watch the fox, or scan after a neighbour's alarm.
        animal.state = "alert";
        speed = 0;
        animal.timer = 0.8;
      } else if (fox && animal.state === "pounce") {
        // Committed: the leap runs its course even if the rabbit slips away.
        if (target) {
          dx = target.x + target.vx * 0.12 - animal.x;
          dz = target.z + target.vz * 0.12 - animal.z;
        } else { dx = Math.cos(animal.heading); dz = Math.sin(animal.heading); }
        speed = 1.7;
        if (animal.leap >= 1) {
          // Landed without a catch: winded, and briefly off the pace.
          animal.state = "hunt";
          animal.energy = Math.max(0, animal.energy - 0.1);
          animal.speed *= 0.45;
          animal.pounceCooldown = 0.9;
          stats.misses++;
        }
      } else if (fox && animal.state === "rest" && animal.timer > 0) {
        speed = 0;
        animal.stalkTime = 0;
        animal.energy = Math.min(1, animal.energy + dt * 0.15);
      } else if (fox && target && animal.energy > 0.12) {
        const facing = Math.abs(angleDelta(Math.atan2(target.z - animal.z, target.x - animal.x), animal.heading));
        // Patience differs per fox; when it runs out the fox charges from where it is,
        // which also ends any standoff with a frozen rabbit behind an obstacle.
        const patience = 4.5 + (animal.id % 3) * 1.3;
        if (animal.state !== "hunt" && target.state !== "flee" && gap > FOX_CHARGE && animal.stalkTime < patience) {
          // Unnoticed, or merely watched: close the distance low and slow.
          animal.state = "stalk";
          animal.stalkTime += dt;
          dx = target.x - animal.x; dz = target.z - animal.z;
          speed = 0.2;
          animal.energy = Math.min(1, animal.energy + dt * 0.03);
        } else if (gap < FOX_POUNCE && facing < 0.45 && animal.speed > 0.5 && !animal.leaping && animal.pounceCooldown <= 0) {
          animal.state = "pounce";
          animal.leaping = true;
          dx = target.x - animal.x; dz = target.z - animal.z;
          speed = 1.7;
          stats.pounces++;
        } else {
          animal.state = "hunt";
          const lead = Math.min(0.55, gap / 2);
          dx = target.x + target.vx * lead - animal.x;
          dz = target.z + target.vz * lead - animal.z;
          speed = 1.02;
          animal.energy = Math.max(0, animal.energy - dt * 0.048);
          if (animal.energy <= 0.12) { animal.state = "rest"; animal.timer = 6; speed = 0; }
        }
      } else {
        animal.energy = Math.min(1, animal.energy + dt * 0.08);
        animal.stalkTime = 0;
        if (animal.timer <= 0 || (animal.state !== "roam" && animal.state !== "graze")) {
          animal.state = random() < 0.3 ? "graze" : "roam";
          animal.timer = 1.5 + random() * 4;
          // Change the intended direction, never the body's actual orientation.
          animal.wanderHeading = animal.heading + (random() - 0.5) * 1.5;
        }
        if (animal.state === "graze") speed = 0;
        const wander = animal.wanderHeading + Math.sin(time * 0.55 + animal.id) * 0.35;
        dx = Math.cos(wander); dz = Math.sin(wander);
      }
      const length = Math.hypot(dx, dz) || 1;
      dx /= length; dz /= length;
      const radius = Math.hypot(animal.x, animal.z);
      const radial = radius < 6.3 ? (6.3 - radius) * 3 : radius > 8.6 ? (8.6 - radius) * 3 : 0;
      dx += animal.x / radius * radial; dz += animal.z / radius * radial;
      for (const other of animals) {
        if (other === animal || other.hidden > 0 || other.species !== animal.species) continue;
        const d = distance(animal, other);
        if (d > 0 && d < 0.48) {
          dx += (animal.x - other.x) / d * (0.48 - d) * 3;
          dz += (animal.z - other.z) / d * (0.48 - d) * 3;
        }
      }
      let desired = Math.atan2(dz, dx);
      if (speed > 0) {
        if (animal.stuckTime > 0.55) chooseEscape(animal);
        if (animal.escapeTimer > 0) {
          animal.escapeTimer -= dt;
          desired = animal.escapeHeading;
          // Turn in place before easing through the opening.
          speed = Math.abs(angleDelta(desired, animal.heading)) > 0.5 ? 0.01 : Math.min(speed, 0.24);
        } else desired = avoidObstacles(animal, desired, speed, dt);
      }
      const turn = angleDelta(desired, animal.heading);
      const maxTurn = animal.state === "pounce" ? 1.4 : fox ? 2.5 : 3.5;
      const wantedTurn = speed > 0 ? clamp(turn * 5, -maxTurn, maxTurn) : 0;
      animal.angularVelocity = approach(animal.angularVelocity, wantedTurn, dt * 9);
      animal.nextHeading = animal.heading + animal.angularVelocity * dt;
      // Slow into tight turns and uphill grades; accelerate out of them.
      const corner = 0.22 + 0.78 * Math.max(0, Math.cos(turn));
      const uphill = Math.max(0, animal.slopeX * Math.cos(animal.heading) + animal.slopeZ * Math.sin(animal.heading));
      animal.desiredSpeed = speed * corner / (1 + uphill * 0.7);
      animal.movementRequested = speed > 0.025;
      // The selected route can be clear while the body is still turning toward
      // it. Brake along the current heading so we do not enter a closed pocket.
      if (animal.desiredSpeed > 0 && !pathClear(animal, animal.nextHeading, 0.16 + animal.speed * 0.35)) {
        animal.desiredSpeed = 0;
      }
      // A frozen rabbit turns its head, not its body, to keep the fox in view.
      const headReach = animal.state === "alert" ? 1.1 : 0.5;
      animal.wantedHead = target ? clamp(angleDelta(Math.atan2(target.z - animal.z, target.x - animal.x), animal.heading), -headReach, headReach)
        : Math.sin(time * (animal.state === "alert" ? 2.1 : 0.75) + animal.id * 3.1) * (animal.state === "alert" ? 0.6 : 0.22);
    }

    // A bolting rabbit thumps: neighbours freeze and scan, and run if a fox is in view.
    for (const animal of animals) {
      if (!animal.startled) continue;
      for (const other of animals) {
        if (other !== animal && other.species === "rabbit" && other.hidden <= 0 && other.state !== "flee"
          && distance(animal, other) < RABBIT_ALARM) other.alarm = Math.max(other.alarm, 1.2);
      }
    }

    // Integrate only after every animal has made a decision from the snapshot.
    for (const animal of animals) {
      if (animal.hidden > 0 || animal.nextHeading === undefined) continue;
      const fox = animal.species === "fox";
      animal.heading = animal.nextHeading;
      const accelerating = animal.desiredSpeed > animal.speed;
      // Foxes explode out of a stalk; a pounce is near-instant.
      const thrust = animal.state === "pounce" ? 7 : !accelerating ? 2.8 : animal.state === "hunt" ? 2.1 : 1.5;
      animal.speed = approach(animal.speed, animal.desiredSpeed, dt * thrust);
      animal.vx = Math.cos(animal.heading) * animal.speed;
      animal.vz = Math.sin(animal.heading) * animal.speed;
      const x = animal.x + animal.vx * dt, z = animal.z + animal.vz * dt;
      let moved = 0;
      if (habitable(x, z, clearanceFor(animal))) {
        moved = Math.hypot(x - animal.x, z - animal.z);
        animal.x = x; animal.z = z;
      } else {
        animal.speed = 0; animal.vx = 0; animal.vz = 0;
      }
      animal.stuckTime = animal.movementRequested && moved < dt * 0.012
        ? animal.stuckTime + dt : Math.max(0, animal.stuckTime - dt * 2);
      const blend = 1 - Math.exp(-dt * 9);
      animal.activity += (Math.min(1, moved / dt / 0.85) - animal.activity) * blend;
      const strideLength = animal.scale * (fox ? 0.85 + animal.activity * 0.65 : 1.05 + animal.activity * 0.85);
      animal.phase += moved / strideLength * TAU;
      animal.lean += (clamp(animal.angularVelocity * animal.speed * 0.07, -0.16, 0.16) - animal.lean) * blend;
      animal.headYaw += (animal.wantedHead - animal.headYaw) * (1 - Math.exp(-dt * 5));
      const headDown = animal.state === "graze" || animal.eating > 0;
      animal.graze += ((headDown ? 1 : 0) - animal.graze) * (1 - Math.exp(-dt * 4));
      const crouch = animal.state === "stalk" || animal.state === "flee" ? 1 : animal.state === "hunt" ? 0.2 : 0;
      animal.crouch += (crouch - animal.crouch) * (1 - Math.exp(-dt * 6));
      animal.alert += ((animal.state === "alert" ? 1 : 0) - animal.alert) * (1 - Math.exp(-dt * 8));
      const lying = animal.state === "rest" && animal.eating <= 0;
      animal.rest += ((lying ? 1 : 0) - animal.rest) * (1 - Math.exp(-dt * 2.5));
      // Leap progress runs 0 → 1 and renderers shape it with sin(π·leap), so both
      // ends meet the ground. A catch in mid-air still finishes the arc, and the
      // return to 0 skips interpolation so the pose never sweeps back through it.
      if (animal.leaping) {
        if (animal.leap >= 1) { animal.leap = 0; animal.previous.leap = 0; animal.leaping = false; }
        else animal.leap = Math.min(1, animal.leap + dt / POUNCE_SECONDS);
      }
      animal.idle = time * 1.7 + animal.id * 2.3;
      const [slopeX, slopeZ] = slopeAt(animal.x, animal.z);
      animal.slopeX += (slopeX - animal.slopeX) * blend;
      animal.slopeZ += (slopeZ - animal.slopeZ) * blend;
    }
    for (const fox of animals) {
      if (fox.species !== "fox" || fox.hidden > 0 || (fox.state !== "hunt" && fox.state !== "pounce")) continue;
      // A leap reaches a little further than a running snap.
      const reach = fox.state === "pounce" ? 0.21 : 0.19;
      const caught = animals.find(rabbit => rabbit.species === "rabbit" && rabbit.hidden <= 0 && distance(fox, rabbit) < reach);
      if (!caught) continue;
      caught.hidden = 10 + random() * 12; caught.state = "hidden";
      caught.speed = 0; caught.vx = 0; caught.vz = 0; caught.activity = 0;
      // Eat head-down first, then lie down for the rest of the pause.
      fox.state = "rest"; fox.timer = 5 + random() * 4; fox.eating = 2.6; fox.energy = 1; fox.targetId = -1;
      stats.catches++;
    }
  }

  return {
    animals, stats,
    // Reuse one pose per animal; no per-frame allocations or phase-wrap jumps.
    getPose(animal) {
      const alpha = clamp(accumulator / stepSeconds, 0, 1);
      for (const field of poseFields) animal.pose[field] = animal.previous[field] + (animal[field] - animal.previous[field]) * alpha;
      return animal.pose;
    },
    update(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      accumulator += Math.min(seconds, 0.1);
      while (accumulator + 1e-9 >= stepSeconds) {
        step(stepSeconds);
        accumulator = Math.max(0, accumulator - stepSeconds);
      }
    },
  };
}
