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
  const bars = document.querySelectorAll(".skill-bar-fill");
  const navLinks = document.querySelectorAll(".container nav ul li a");

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
                bar.style.width = bar.dataset.width + "%";
              }, i * 60);
            });
          }
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -50px 0px" },
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
    { threshold: 0.05, rootMargin: "-10% 0px -70% 0px" }
  );

  const sections = document.querySelectorAll(".main-content > div[id], footer h2[id='contact']");
  sections.forEach((section) => spyObserver.observe(section));
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
// Project Cards — Swipe Carousel
// ────────────────────────────────────
(() => {
  const track = document.getElementById("projectTrack");
  const dotsContainer = document.getElementById("carouselDots");
  const counter = document.getElementById("carouselCounter");
  const prevBtn = document.getElementById("carouselPrev");
  const nextBtn = document.getElementById("carouselNext");
  if (!track) return;

  const cards = Array.from(track.querySelectorAll(".project-card"));
  const total = cards.length;
  let currentIndex = 0;

  // ── Build dot indicators with title labels ──
  cards.forEach((card, i) => {
    const dot = document.createElement("button");
    dot.classList.add("carousel-dot");
    dot.setAttribute("aria-label", `Go to project ${i + 1}`);
    // Add title label inside the dot
    const label = document.createElement("span");
    label.classList.add("dot-label");
    label.textContent = card.querySelector("h3").textContent;
    dot.appendChild(label);
    if (i === 0) dot.classList.add("active");
    dot.addEventListener("click", () => goTo(i));
    dotsContainer.appendChild(dot);
  });

  const dots = Array.from(dotsContainer.querySelectorAll(".carousel-dot"));

  function updateUI(index) {
    currentIndex = index;

    // Update dots
    dots.forEach((d, i) => d.classList.toggle("active", i === index));

    // Update counter
    counter.textContent = `${index + 1} / ${total}`;

    // Update active card class
    cards.forEach((c, i) => c.classList.toggle("card-active", i === index));

    // Update arrow enabled state
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === total - 1;
  }

  let navigating = false;

  function goTo(index) {
    index = Math.max(0, Math.min(total - 1, index));
    navigating = true;
    const card = cards[index];
    const trackRect = track.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    // Center the card in the track viewport
    const scrollTarget = card.offsetLeft - (trackRect.width / 2) + (cardRect.width / 2);
    track.scrollTo({ left: scrollTarget, behavior: "smooth" });
    updateUI(index);
    // Clear navigating flag after scroll settles
    clearTimeout(navTimeout);
    navTimeout = setTimeout(() => { navigating = false; }, 500);
  }

  let navTimeout;

  // ── Arrow buttons ──
  prevBtn.addEventListener("click", () => goTo(currentIndex - 1));
  nextBtn.addEventListener("click", () => goTo(currentIndex + 1));

  // ── Keyboard navigation ──
  document.addEventListener("keydown", (e) => {
    // Only when carousel is somewhat in view
    const rect = track.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    if (!inView) return;
    if (e.key === "ArrowLeft") goTo(currentIndex - 1);
    if (e.key === "ArrowRight") goTo(currentIndex + 1);
  });

  // ── Scroll-snap detection (update active on manual scroll/swipe) ──
  let scrollTimeout;
  track.addEventListener("scroll", () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      // Don't override during programmatic navigation
      if (navigating) return;
      const trackCenter = track.scrollLeft + track.offsetWidth / 2;
      let closest = 0;
      let closestDist = Infinity;
      cards.forEach((card, i) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const dist = Math.abs(trackCenter - cardCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      });
      updateUI(closest);
    }, 80);
  }, { passive: true });

  // ── Pointer drag (mouse + touch) ──
  let isDragging = false;
  let startX = 0;
  let scrollStart = 0;

  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") {
      isDragging = true;
      startX = e.clientX;
      scrollStart = track.scrollLeft;
      track.style.scrollSnapType = "none";
      track.style.scrollBehavior = "auto";
      track.setPointerCapture(e.pointerId);
    }
  });

  track.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    track.scrollLeft = scrollStart - dx;
  });

  track.addEventListener("pointerup", (e) => {
    if (!isDragging) return;
    isDragging = false;
    track.style.scrollSnapType = "x mandatory";
    track.style.scrollBehavior = "smooth";

    // Determine direction from drag distance and snap
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 50) {
      goTo(currentIndex + (dx < 0 ? 1 : -1));
    } else {
      goTo(currentIndex); // snap back
    }
  });

  track.addEventListener("pointercancel", () => {
    isDragging = false;
    track.style.scrollSnapType = "x mandatory";
    track.style.scrollBehavior = "smooth";
  });

  // ── Initial state ──
  updateUI(0);

  // After a short delay, center the first card properly
  requestAnimationFrame(() => {
    goTo(0);
  });
})();
