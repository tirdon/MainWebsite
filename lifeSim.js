// ════════════════════════════════════
// HERO BACKGROUND: Conway's Game of Life
// ════════════════════════════════════
(() => {
  const canvas = document.getElementById("lifeSim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const CELL = 18;
  let W, H, COLS, ROWS, grid, next;
  let lastStep = 0;
  const STEP_MS = 160;
  let generation = 0;
  const RESEED_GENERATIONS = 400;

  function alloc() {
    grid = new Uint8Array(COLS * ROWS);
    next = new Uint8Array(COLS * ROWS);
  }

  function seed() {
    for (let i = 0; i < grid.length; i++) {
      grid[i] = Math.random() < 0.22 ? 1 : 0;
    }
    generation = 0;
  }

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
    COLS = Math.max(1, Math.ceil(W / CELL));
    ROWS = Math.max(1, Math.ceil(H / CELL));
    alloc();
    seed();
  }

  // Hover: sprinkle live cells around the pointer.
  // Listen on the hero section because the canvas has pointer-events: none.
  const host = document.getElementById("about");
  if (host) {
    const RADIUS_CELLS = 4;
    const SPRINKLE_PER_MOVE = 5;

    function sprinkle(clientX, clientY) {
      if (!grid) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || x > W || y < 0 || y > H) return;
      const cx = (x / CELL) | 0;
      const cy = (y / CELL) | 0;
      for (let k = 0; k < SPRINKLE_PER_MOVE; k++) {
        const theta = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * RADIUS_CELLS;
        const gx = ((cx + Math.round(Math.cos(theta) * r)) % COLS + COLS) % COLS;
        const gy = ((cy + Math.round(Math.sin(theta) * r)) % ROWS + ROWS) % ROWS;
        grid[gy * COLS + gx] = 1;
      }
    }

    host.addEventListener("mousemove", (e) => {
      sprinkle(e.clientX, e.clientY);
    });

    host.addEventListener("touchmove", (e) => {
      for (let i = 0; i < e.touches.length; i++) {
        sprinkle(e.touches[i].clientX, e.touches[i].clientY);
      }
    }, { passive: true });
  }

  function step() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = (x + dx + COLS) % COLS;
            const ny = (y + dy + ROWS) % ROWS;
            n += grid[ny * COLS + nx];
          }
        }
        const alive = grid[y * COLS + x];
        next[y * COLS + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    [grid, next] = [next, grid];
    generation++;
    if (generation >= RESEED_GENERATIONS) seed();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const dark = isDark();
    const fill = dark ? "#e0bd5e" : "#c89b3c";
    ctx.fillStyle = fill;
    const r = Math.max(1, CELL * 0.28);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!grid[y * COLS + x]) continue;
        const cx = x * CELL + CELL / 2;
        const cy = y * CELL + CELL / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  let isInView = true;
  const viewObserver = new IntersectionObserver((entries) => {
    const wasInView = isInView;
    isInView = entries[0].isIntersecting;
    if (isInView && !wasInView) {
      lastStep = performance.now();
      requestAnimationFrame(loop);
    }
  });
  viewObserver.observe(canvas);

  function loop(ts) {
    if (!isInView) return;
    if (ts - lastStep >= STEP_MS) {
      step();
      lastStep = ts;
    }
    draw();
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(loop);
})();
