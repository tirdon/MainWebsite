// ────────────────────────────────────
// Stable Viewport Dimensions (ignores dynamic address bars & console toggles)
// ────────────────────────────────────
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

let stableInnerHeight = window.innerHeight;
let stableInnerWidth = window.innerWidth;

// Last user-initiated scroll position. We snapshot this on every scroll event
// that is NOT caused by us programmatically restoring scroll, and use it to
// undo any scroll shifts the browser introduces when the screen size changes
// (mobile toolbar toggle, devtools open, etc.). We also track scroll velocity
// so that rapid user-driven scrolling can fly past a toolbar transition
// without us snapping it back.
let preservedScrollY = window.scrollY;
let restoringScroll = false;
let lastResizeAt = 0;
let lastScrollY = window.scrollY;
let lastScrollAt = performance.now();
let scrollSpeed = 0; // pixels per millisecond

// Toolbar-sized shifts are usually under ~100px. Anything bigger is the user
// actually scrolling — leave it alone. Above this speed (px/ms) we treat any
// resize as happening mid-flick and skip restoration entirely.
const TOOLBAR_SHIFT_MAX_PX = 140;
const ACTIVE_SCROLL_SPEED = 0.6;

window.addEventListener("scroll", () => {
  const now = performance.now();
  const dt = now - lastScrollAt;
  if (dt > 0 && dt < 200) {
    scrollSpeed = (window.scrollY - lastScrollY) / dt;
  }
  lastScrollY = window.scrollY;
  lastScrollAt = now;

  // Skip our own restoration writes, plus any scroll events that arrive in
  // the same tick as a resize (those are the ones the browser issues to
  // compensate for the new viewport — exactly what we want to undo).
  if (restoringScroll) return;
  if (now - lastResizeAt < 32) return;
  preservedScrollY = window.scrollY;
}, { passive: true });

window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  lastResizeAt = performance.now();

  // Update stable dimensions only if it's a true resize (e.g. orientation rotation, split screen, window stretch)
  // Ignores dynamic toolbar collapses and height-only console opens under 350px.
  if (Math.abs(w - stableInnerWidth) > 5 || Math.abs(h - stableInnerHeight) > 350) {
    stableInnerWidth = w;
    stableInnerHeight = h;
    preservedScrollY = window.scrollY;
    return;
  }

  // The user is actively flicking the page; don't fight their momentum even
  // if a toolbar transition lands in the middle of the gesture.
  if (Math.abs(scrollSpeed) > ACTIVE_SCROLL_SPEED) {
    preservedScrollY = window.scrollY;
    return;
  }

  // Idle (or near-idle) user + minor resize: if the browser has shifted scroll
  // by a toolbar-sized amount, undo it. Larger deltas mean we lost track of a
  // real user scroll — accept the new position rather than snapping back.
  const delta = window.scrollY - preservedScrollY;
  if (Math.abs(delta) > 0.5 && Math.abs(delta) < TOOLBAR_SHIFT_MAX_PX) {
    restoringScroll = true;
    window.scrollTo(0, preservedScrollY);
    requestAnimationFrame(() => { restoringScroll = false; });
  } else {
    preservedScrollY = window.scrollY;
  }
});

// ────────────────────────────────────
// Dark / Light Theme Toggle
// ────────────────────────────────────
(() => {
  const toggle = document.getElementById("themeToggle");
  const html = document.documentElement;
  const saved = localStorage.getItem("theme");
  if (saved) html.setAttribute("data-theme", saved);
  else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    html.setAttribute("data-theme", "dark");
  }
  toggle.addEventListener("click", () => {
    const current = html.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });
})();

// ────────────────────────────────────
// Shared Simulation Helpers
// ────────────────────────────────────
function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function resizeCanvas(canvas) {
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

function runWhenVisible(canvas, frame) {
  let running = false;
  let visible = false;

  function tick() {
    if (!visible) { running = false; return; }
    frame();
    requestAnimationFrame(tick);
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible && !running) {
      running = true;
      requestAnimationFrame(tick);
    }
  }, { rootMargin: "100px" });
  io.observe(canvas);
}

// Same idea as runWhenVisible, but the frame is only requested from a manual
// `schedule()`. Use for GPU jobs that should re-render on demand (scroll, theme
// change, resize) instead of every animation frame.
function onDemandWhenVisible(canvas, frame, { rootMargin = "100px" } = {}) {
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



// ────────────────────────────────────
// Navbar Scroll Enhancement
// ────────────────────────────────────
(() => {
  const nav = document.querySelector(".container");
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        nav.classList.toggle("scrolled", window.scrollY > 60);
        ticking = false;
      });
      ticking = true;
    }
  });
})();

// ────────────────────────────────────
// Scroll-Reveal & ScrollSpy & Skill Bar Animation
// ────────────────────────────────────
(() => {
  const reveals = document.querySelectorAll(".reveal");
  const bars = document.querySelectorAll(".skill-bar");
  const navLinks = document.querySelectorAll(".container nav ul li a");

  // Proficiency word derived from each bar's data-width, then injected as a
  // .skill-level span into the .skill-item (placed via grid-area, so DOM
  // order doesn't matter). Keeping it here, rather than hand-written in the
  // markup, keeps the label in sync with the bar — one source of truth per
  // skill.
  const levelFor = (w) =>
    w >= 90 ? "Native"
    : w >= 72 ? "Advanced"
    : w >= 58 ? "Proficient"
    : w >= 35 ? "Intermediate"
    : "Beginner";

  bars.forEach((bar) => {
    const item = bar.closest(".skill-item");
    if (!item) return;
    const level = document.createElement("span");
    level.className = "skill-level";
    level.textContent = levelFor(Number(bar.dataset.width));
    item.appendChild(level);
  });

  let barsAnimated = false;

  // Intersection Observer for Scroll-Reveal & Skill Bars
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");

          // Animate skill bars when skills section is visible
          if (!barsAnimated && entry.target.id === "skills") {
            barsAnimated = true;
            bars.forEach((bar, i) => {
              setTimeout(() => {
                bar.style.backgroundSize = bar.dataset.width + "% 100%";
              }, i * 60);
            });
          }
        }
      });
    },
    // Low threshold so very tall sections (the 400vh+ project orbit) still
    // reveal as soon as they meaningfully enter the viewport.
    { threshold: 0.02, rootMargin: "0px 0px -80px 0px" },
  );

  reveals.forEach((el) => revealObserver.observe(el));

  // Intersection Observer for ScrollSpy (Active Nav Link)
  const spyObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute("id");
          navLinks.forEach((link) => {
            link.classList.remove("active");
            if (link.getAttribute("href") === `#${id}`) {
              link.classList.add("active");
            }
          });
        }
      });
    },
    // threshold 0: a fixed-height spy band can never cover 5% of the
    // 400vh+ project section, so fire on any intersection instead.
    { threshold: 0, rootMargin: "-10% 0px -70% 0px" }
  );

  const sections = document.querySelectorAll(".main-content > div[id], footer h2[id='contact']");
  sections.forEach((section) => spyObserver.observe(section));
})();

// ────────────────────────────────────
// Skill Deck — randomize which card is raised on each fan-out
// ────────────────────────────────────
(() => {
  const deck = document.querySelector(".skill-deck");
  if (!deck) return;
  const categories = Array.from(deck.querySelectorAll(".skill-category"));

  function randomizeRaised() {
    const chosen = Math.floor(Math.random() * categories.length);
    categories.forEach((cat, i) => cat.classList.toggle("raised", i === chosen));
  }

  deck.addEventListener("mouseenter", randomizeRaised);
  deck.addEventListener("focusin", randomizeRaised);
})();

// ────────────────────────────────────
// Hero Scroll Reveal (name + word cascade)
// ────────────────────────────────────
(() => {
  const section = document.getElementById("about");
  if (!section) return;

  const nameEl = document.getElementById("name");
  const textEl = section.querySelector(".text-reveal");
  if (!textEl) return;

  // Split paragraph into word spans with real whitespace between so text-align: justify works
  const words = textEl.textContent.trim().split(/\s+/);
  textEl.innerHTML = "";
  const wordSpans = words.map((word, i) => {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = word;
    textEl.appendChild(span);
    if (i < words.length - 1) textEl.appendChild(document.createTextNode(" "));
    return span;
  });

  const N = wordSpans.length;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // Word cascade: each word's reveal window overlaps neighbors so multiple
  // words are in flight at once, creating a smooth cascade rather than a
  // discrete one-word-at-a-time transition.
  const WORD_RANGE_START = 0.25;
  const WORD_RANGE_END = 0.92;
  const PER_WORD_DURATION = 0.14;
  const wordSpacing = Math.max(
    0,
    (WORD_RANGE_END - WORD_RANGE_START - PER_WORD_DURATION) / Math.max(1, N - 1),
  );

  let isInView = false;
  let ticking = false;

  function schedule() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }

  function update() {
    ticking = false;

    const rect = section.getBoundingClientRect();
    const totalScrollable = Math.max(1, section.offsetHeight - stableInnerHeight);
    const p = clamp01(-rect.top / totalScrollable);

    // Name: 0 → 0.3 scroll progress
    const nameP = easeOutCubic(clamp01(p / 0.3));
    nameEl.style.setProperty("--name-opacity", nameP);
    nameEl.style.setProperty("--name-scale", 1.2 - 0.2 * nameP);
    nameEl.style.setProperty("--name-ty", 50 * (1 - nameP) + "px");
    nameEl.style.setProperty("--name-blur", 14 * (1 - nameP) + "px");

    // Text block: 0.15 → 0.35 scroll progress
    const blockP = easeOutQuart(clamp01((p - 0.15) / 0.2));
    textEl.style.setProperty("--text-block-opacity", blockP);
    textEl.style.setProperty("--text-block-ty", 24 * (1 - blockP) + "px");

    // Per-word cascade
    for (let i = 0; i < N; i++) {
      const wordStart = WORD_RANGE_START + i * wordSpacing;
      const wp = easeOutCubic(clamp01((p - wordStart) / PER_WORD_DURATION));
      const span = wordSpans[i];
      span.style.opacity = 0.1 + 0.9 * wp;
      span.style.filter = `blur(${(1 - wp) * 6}px)`;
      span.style.transform = `translateY(${(1 - wp) * 10}px)`;
    }
  }

  const viewObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        isInView = entry.isIntersecting;
        if (isInView) schedule();
      });
    },
    { threshold: 0 },
  );
  viewObserver.observe(section);

  window.addEventListener("scroll", () => { if (isInView) schedule(); }, { passive: true });
  window.addEventListener("resize", schedule);
  requestAnimationFrame(update);
})();



// ────────────────────────────────────
// Mobile Hamburger Menu
// ────────────────────────────────────
(() => {
  const btn = document.getElementById("menuToggle");
  const nav = document.getElementById("mainNav");
  const overlay = document.getElementById("navOverlay");

  function close() {
    btn.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    nav.classList.remove("open");
    overlay.classList.remove("visible");
    document.body.style.overflow = "";
  }

  btn.addEventListener("click", () => {
    const opening = !nav.classList.contains("open");
    if (opening) {
      btn.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      nav.classList.add("open");
      overlay.classList.add("visible");
      document.body.style.overflow = "hidden";
    } else {
      close();
    }
  });

  overlay.addEventListener("click", close);

  // Close menu when a nav link is clicked
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", close);
  });

  // Close on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("open")) close();
  });
})();

// ────────────────────────────────────
// Smooth Scroll for Nav (fallback)
// ────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// ────────────────────────────────────
// Project Cards — Scroll-Driven Cone-Spring Orbit
// The carousel is a tall scroll region with a pinned stage. Page scroll
// winds a progress value p ∈ [0, N-1]; each card sits on a tapered helix
// (cone spring) at angular offset (i − p) · 2π/N — the front card is at
// full radius, cards behind spiral up and inward, scaled down by depth.
// ────────────────────────────────────
(() => {
  const carousel = document.getElementById("projectCarousel");
  const stage = document.getElementById("carouselStage");
  const track = document.getElementById("projectTrack");
  const dotsContainer = document.getElementById("carouselDots");
  const counter = document.getElementById("carouselCounter");
  const prevBtn = document.getElementById("carouselPrev");
  const nextBtn = document.getElementById("carouselNext");
  if (!track || !stage) return;

  const cards = Array.from(track.querySelectorAll(".project-card"));
  const total = cards.length;
  const STEP = (Math.PI * 2) / total;
  let currentIndex = -1;

  // ── Build dot indicators with title labels ──
  cards.forEach((card, i) => {
    const dot = document.createElement("button");
    dot.classList.add("carousel-dot");
    dot.setAttribute("aria-label", `Go to project ${i + 1}`);
    const label = document.createElement("span");
    label.classList.add("dot-label");
    label.textContent = card.querySelector("h3").textContent;
    dot.appendChild(label);
    dot.addEventListener("click", () => goTo(i));
    dotsContainer.appendChild(dot);
  });

  const dots = Array.from(dotsContainer.querySelectorAll(".carousel-dot"));

  function updateUI(index) {
    if (index === currentIndex) return;
    currentIndex = index;
    dots.forEach((d, i) => d.classList.toggle("active", i === index));
    counter.textContent = `${index + 1} / ${total}`;
    cards.forEach((c, i) => c.classList.toggle("card-active", i === index));
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === total - 1;
  }

  // Scrollable distance the orbit consumes (section height minus the
  // pinned viewport-tall stage).
  function scrollRange() {
    return Math.max(1, carousel.offsetHeight - stage.offsetHeight);
  }

  function progress() {
    const top = carousel.getBoundingClientRect().top + window.scrollY;
    const p = (window.scrollY - top) / scrollRange();
    return Math.max(0, Math.min(1, p)) * (total - 1);
  }

  function layout() {
    const p = progress();
    const R0 = Math.min(track.offsetWidth * 1.05, 560);
    for (let i = 0; i < total; i++) {
      const d = i - p;
      const angle = d * STEP;
      // Cone taper: cards later along the coil orbit tighter; passed
      // cards swing slightly wider. Clamped so nothing collapses.
      const R = Math.max(R0 * 0.5, Math.min(R0 * 1.15, R0 * (1 - 0.085 * d)));
      const x = Math.sin(angle) * R;
      const z = Math.cos(angle) * R - R0;
      // Coil rise: left-side windows (already passed, d<0) ride higher;
      // right-side windows (still upcoming, d>0) dip lower.
      const y = d * 34;
      // Tangent plane: the card lies on the cylinder surface, its normal
      // pointing radially outward (perpendicular to the coil axis).
      const rot = angle * (180 / Math.PI);
      const s = Math.max(0.72, 1 - 0.05 * Math.abs(d));
      // Distant coils dissolve: a tangent card goes edge-on at 90° (and
      // would show its mirrored back past it), and anything deeper would
      // be seen THROUGH the front card's glass — the aperture is a real
      // hole. Fade out just before edge-on.
      const deg = Math.abs(angle) * (180 / Math.PI);
      const fade = deg < 68 ? 1 : deg > 92 ? 0 : 1 - (deg - 68) / 24;
      cards[i].style.transform =
        `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) ` +
        `rotateY(${rot.toFixed(2)}deg) scale(${s.toFixed(3)})`;
      cards[i].style.opacity = fade.toFixed(3);
      cards[i].style.visibility = fade < 0.02 ? "hidden" : "";
      cards[i].style.zIndex = String(1000 + Math.round(z));
    }
    updateUI(Math.max(0, Math.min(total - 1, Math.round(p))));
  }

  let rafQueued = false;
  function scheduleLayout() {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      layout();
    });
  }

  // Snap to the nearest card once scrolling goes idle mid-orbit, so the
  // drum never rests between stops with the front window half-turned.
  // The idle delay is deliberately lazy: a short one tugs against slow
  // wheel/trackpad scrolling and makes the cards look like they jump.
  let snapTimer;
  window.addEventListener("scroll", () => {
    scheduleLayout();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      if (isDragging) return;
      const p = progress();
      if (p <= 0.02 || p >= total - 1.02) return;
      const target = Math.round(p);
      if (Math.abs(p - target) > 0.03) goTo(target);
    }, 800);
  }, { passive: true });
  window.addEventListener("resize", scheduleLayout);

  // ── Navigation: map card index to a page scroll position ──
  function goTo(index) {
    index = Math.max(0, Math.min(total - 1, index));
    const top = carousel.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: top + (index / (total - 1)) * scrollRange(),
      behavior: "smooth",
    });
  }

  prevBtn.addEventListener("click", () => goTo(currentIndex - 1));
  nextBtn.addEventListener("click", () => goTo(currentIndex + 1));

  // ── Keyboard navigation ──
  document.addEventListener("keydown", (e) => {
    const rect = stage.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    if (!inView) return;
    if (e.key === "ArrowLeft") goTo(currentIndex - 1);
    if (e.key === "ArrowRight") goTo(currentIndex + 1);
  });

  // ── Mouse drag winds the orbit (maps horizontal drag to page scroll) ──
  let isDragging = false;
  let lastX = 0;
  let dragDistance = 0;

  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") {
      isDragging = true;
      lastX = e.clientX;
      dragDistance = 0;
      track.setPointerCapture(e.pointerId);
    }
  });

  track.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    dragDistance += Math.abs(dx);
    window.scrollBy({ top: -dx * 1.5, behavior: "instant" });
  });

  const endDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    // A real drag settles on the nearest card; a plain click doesn't scroll
    if (dragDistance > 8) goTo(Math.round(progress()));
  };
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);

  // Suppress link clicks that were actually drags
  track.addEventListener("click", (e) => {
    if (dragDistance > 8) {
      e.preventDefault();
      e.stopPropagation();
      dragDistance = 0;
    }
  }, true);

  // ── Initial state ──
  layout();
  window.addEventListener("load", scheduleLayout);
})();
