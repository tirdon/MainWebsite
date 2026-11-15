// ────────────────────────────────────
// Stable Viewport Dimensions
// Touch browsers resize the viewport as their address bar slides, so small
// height changes are ignored there. Mouse-driven windows have no such bar:
// any height change is a real resize and is followed.
// ────────────────────────────────────
export let stableInnerHeight = window.innerHeight;
export let stableInnerWidth = window.innerWidth;
const coarsePointer = window.matchMedia("(pointer: coarse)");
window.addEventListener("resize", () => {
  const heightTolerance = coarsePointer.matches ? 350 : 5;
  if (Math.abs(window.innerWidth - stableInnerWidth) > 5 ||
      Math.abs(window.innerHeight - stableInnerHeight) > heightTolerance) {
    stableInnerWidth = window.innerWidth;
    stableInnerHeight = window.innerHeight;
  }
});

// ────────────────────────────────────
// Shared Simulation Helpers
// ────────────────────────────────────
export function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

export function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = rect.width;
  const H = rect.height;
  
  // Skip resizing if width has not changed and height change is small (e.g. mobile address bar toggles)
  if (canvas.width > 0 && Math.abs(canvas.width - W * dpr) < 1 && Math.abs(canvas.height - H * dpr) < 150 * dpr) {
    return { W: canvas.width / dpr, H: canvas.height / dpr };
  }

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W, H };
}

// Pause controls apply to the interactive simulations and the hero backdrop.
export const simulationMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
export let simulationsPlaying = !simulationMotion.matches;
const simulationToggle = document.getElementById("simulationToggle");
function updateSimulationPlayback() {
  simulationToggle.hidden = false;
  simulationToggle.textContent = simulationsPlaying ? "Pause simulations" : "Play simulations";
  document.dispatchEvent(new Event("simulationplaybackchange"));
}
simulationToggle.addEventListener("click", () => {
  simulationsPlaying = !simulationsPlaying;
  updateSimulationPlayback();
});
simulationMotion.addEventListener("change", () => {
  simulationsPlaying = !simulationMotion.matches;
  updateSimulationPlayback();
});
updateSimulationPlayback();

export function runWhenVisible(canvas, frame) {
  let running = false;
  let visible = false;

  function tick() {
    if (!visible || !simulationsPlaying || document.hidden) {
      running = false;
      return;
    }
    frame();
    requestAnimationFrame(tick);
  }

  function resume() {
    if (visible && !running && !document.hidden) {
      if (simulationsPlaying) {
        running = true;
        requestAnimationFrame(tick);
      } else {
        frame();
      }
    }
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    resume();
  }, { rootMargin: "100px" });
  io.observe(canvas);
  document.addEventListener("simulationplaybackchange", resume);
  document.addEventListener("visibilitychange", resume);
  let redrawQueued = false;
  function redrawPaused() {
    if (redrawQueued || simulationsPlaying) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      // Run after the simulations' resize handlers have cleared their canvases.
      if (visible && !simulationsPlaying && !document.hidden) frame();
    });
  }
  window.addEventListener("resize", redrawPaused);
  document.addEventListener("themechange", redrawPaused);
}

// Same idea as runWhenVisible, but the frame is only requested from a manual
// `schedule()`. Use for GPU jobs that should re-render on demand (scroll, theme
// change, resize) instead of every animation frame.
export function onDemandWhenVisible(canvas, frame, { rootMargin = "100px" } = {}) {
  let visible = false;
  let pending = false;
  function tick() {
    pending = false;
    if (!visible) return;
    frame();
  }
  function schedule() {
    if (pending || !visible) return;
    pending = true;
    requestAnimationFrame(tick);
  }
  const io = new IntersectionObserver((entries) => {
    const wasVisible = visible;
    visible = entries[0].isIntersecting;
    if (visible && !wasVisible) schedule();
  }, { rootMargin });
  io.observe(canvas);
  return { schedule, isVisible: () => visible };
}
