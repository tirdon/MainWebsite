import { stableInnerHeight, simulationMotion } from "../core/runtime.js";

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
  const levelFor = (w, language) =>
    w >= 90 ? (language ? "Native" : "Expert")
    : w >= 72 ? "Advanced"
    : w >= 58 ? "Proficient"
    : w >= 35 ? "Intermediate"
    : "Beginner";

  bars.forEach((bar) => {
    const item = bar.closest(".skill-item");
    if (!item) return;
    const level = document.createElement("span");
    level.className = "skill-level";
    level.textContent = levelFor(Number(bar.dataset.width), Boolean(bar.closest(".languages-category")));
    bar.setAttribute("aria-hidden", "true");
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
              }, simulationMotion.matches ? 0 : i * 35);
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
            link.removeAttribute("aria-current");
            if (link.getAttribute("href") === `#${id}`) {
              link.classList.add("active");
              link.setAttribute("aria-current", "location");
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
// Hero text: start empty, then scrub the original name and word reveal by scroll.
// ────────────────────────────────────
(() => {
  const section = document.getElementById("about");
  const content = section?.querySelector(".hero-sticky");
  const name = document.getElementById("name");
  const subtitle = document.getElementById("subtitle");
  const actions = section?.querySelector(".hero-actions");
  const paragraph = Array.from(section?.querySelectorAll(".text-reveal") || [])
    .find((element) => getComputedStyle(element).display !== "none");
  if (!content || !paragraph) return;

  const originalText = paragraph.textContent.trim().replace(/\s+/g, " ");
  const accessibleText = document.createElement("span");
  accessibleText.className = "sr-only";
  accessibleText.textContent = originalText;
  const visualText = document.createElement("span");
  visualText.className = "text-reveal-visual";
  visualText.setAttribute("aria-hidden", "true");
  const words = originalText.split(" ");
  const spans = words.map((word, index) => {
    const span = document.createElement("span");
    span.className = "word";
    if (index === 0) {
      const initial = document.createElement("span");
      initial.className = "drop-cap";
      initial.textContent = word.charAt(0);
      span.append(initial, document.createTextNode(word.slice(1)));
    } else {
      span.textContent = word;
    }
    visualText.appendChild(span);
    if (index < words.length - 1) visualText.appendChild(document.createTextNode(" "));
    return span;
  });
  paragraph.replaceChildren(accessibleText, visualText);

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);
  const easeOutQuart = (value) => 1 - Math.pow(1 - value, 4);
  const wordSpacing = (0.92 - 0.25 - 0.14) / Math.max(1, spans.length - 1);
  let scrollDistance = 1;
  let animated = false;
  let visible = true;
  let pending = false;

  function update() {
    pending = false;
    if (!visible && animated) return;
    const progress = animated
      ? clamp01(-section.getBoundingClientRect().top / scrollDistance) : 1;

    // Preserve the original reveal windows; elapsed time never advances them.
    const nameProgress = easeOutCubic(clamp01(progress / 0.3));
    name.style.setProperty("--name-opacity", nameProgress);
    name.style.setProperty("--name-scale", 1.2 - 0.2 * nameProgress);
    name.style.setProperty("--name-ty", `${50 * (1 - nameProgress)}px`);
    name.style.setProperty("--name-blur", `${14 * (1 - nameProgress)}px`);

    if (subtitle) {
      const subtitleProgress = easeOutCubic(clamp01((progress - 0.16) / 0.18));
      subtitle.style.setProperty("--subtitle-opacity", subtitleProgress);
      subtitle.style.setProperty("--subtitle-ty", `${18 * (1 - subtitleProgress)}px`);
      subtitle.style.setProperty("--subtitle-blur", `${8 * (1 - subtitleProgress)}px`);
    }

    const blockProgress = easeOutQuart(clamp01((progress - 0.24) / 0.2));
    paragraph.style.setProperty("--text-block-opacity", blockProgress);
    paragraph.style.setProperty("--text-block-ty", `${24 * (1 - blockProgress)}px`);

    spans.forEach((span, index) => {
      const start = 0.25 + index * wordSpacing;
      const wordProgress = easeOutCubic(clamp01((progress - start) / 0.14));
      span.style.opacity = String(0.1 + 0.9 * wordProgress);
      span.style.filter = `blur(${(1 - wordProgress) * 6}px)`;
      span.style.transform = `translateY(${(1 - wordProgress) * 10}px)`;
    });

    if (actions) {
      const actionsProgress = easeOutCubic(clamp01((progress - 0.82) / 0.18));
      actions.style.setProperty("--hero-actions-opacity", actionsProgress);
      actions.style.setProperty("--hero-actions-ty", `${18 * (1 - actionsProgress)}px`);
      actions.style.setProperty("--hero-actions-visibility", actionsProgress > 0 ? "visible" : "hidden");
      actions.inert = actionsProgress < 0.95;
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(update);
  }

  // The pinned stage needs the name and statement on screen below the header;
  // the action links may follow once the pin releases. Measured with the pinned
  // styles applied, using layout offsets so the reveal transforms don't skew it.
  function fitsPinnedStage() {
    const style = getComputedStyle(content);
    const needed = paragraph.offsetTop + paragraph.offsetHeight - content.firstElementChild.offsetTop;
    const available = stableInnerHeight - (parseFloat(style.top) || 0) - parseFloat(style.paddingTop);
    return needed <= available;
  }

  function configure() {
    // Flip covers and very short windows read the hero in normal flow, fully
    // revealed, instead of pinning text taller than the screen.
    section.classList.toggle("hero-scroll--pinned", !simulationMotion.matches);
    animated = !simulationMotion.matches && fitsPinnedStage();
    section.classList.toggle("hero-scroll--pinned", animated);
    section.classList.toggle("text-reveal-ready", animated);
    if (animated) {
      scrollDistance = Math.max(1, stableInnerHeight * (window.innerWidth <= 600 ? 1 : 1.5));
      section.style.setProperty("--hero-viewport-height", `${stableInnerHeight}px`);
      // Natural content height keeps long statements and enlarged text accessible.
      section.style.setProperty("--hero-stage-height", `${content.offsetHeight}px`);
      section.style.setProperty("--hero-scroll-distance", `${scrollDistance}px`);
    }
    update();
  }

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) schedule();
  }).observe(section);
  window.addEventListener("scroll", () => { if (visible) schedule(); }, { passive: true });
  window.addEventListener("resize", configure);
  simulationMotion.addEventListener("change", configure);
  new ResizeObserver(configure).observe(content);
  document.fonts.ready.then(configure);
  configure();
})();

// ────────────────────────────────────
// Mobile menu: hide closed links, contain focus, and restore it on dismissal.
// ────────────────────────────────────
(() => {
  const btn = document.getElementById("menuToggle");
  const nav = document.getElementById("mainNav");
  const overlay = document.getElementById("navOverlay");
  const mobile = window.matchMedia("(max-width: 900px)");
  const background = [document.querySelector("main"), document.querySelector("footer"),
    document.getElementById("branding"), document.getElementById("themeToggle"),
    document.querySelector(".skip-link")];
  let opened = false;

  function setOpen(value, restoreFocus = false) {
    opened = value && mobile.matches;
    btn.classList.toggle("open", opened);
    btn.setAttribute("aria-expanded", String(opened));
    btn.setAttribute("aria-label", opened ? "Close menu" : "Open menu");
    nav.classList.toggle("open", opened);
    nav.inert = mobile.matches && !opened;
    overlay.classList.toggle("visible", opened);
    background.forEach((element) => { element.inert = opened; });
    document.body.style.overflow = opened ? "hidden" : "";
    if (opened) nav.querySelector("a").focus();
    else if (restoreFocus) btn.focus();
  }

  btn.addEventListener("click", () => setOpen(!opened, opened));
  overlay.addEventListener("click", () => setOpen(false, true));
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });
  document.addEventListener("keydown", (event) => {
    if (!opened) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false, true);
    } else if (event.key === "Tab") {
      const controls = [...nav.querySelectorAll("a"), btn];
      const current = controls.indexOf(document.activeElement);
      const next = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      event.preventDefault();
      controls[next].focus();
    }
  });
  mobile.addEventListener("change", () => {
    const focusInMenu = nav.contains(document.activeElement);
    setOpen(false, mobile.matches && focusInMenu);
  });
  setOpen(false);
})();

// Keep native anchor navigation/history; move keyboard focus to the destination.
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", () => {
    const target = document.getElementById(link.hash.slice(1));
    if (!target) return;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  });
});

// ────────────────────────────────────
// Project filters keep every card in normal document flow.
// Extra projects sit in a disclosure; its label and the count follow the filter.
// ────────────────────────────────────
(() => {
  const toolbar = document.getElementById("projectToolbar");
  const track = document.getElementById("projectTrack");
  const count = document.getElementById("projectCount");
  if (!toolbar || !track || !count) return;
  const cards = Array.from(track.querySelectorAll(".project-card"));
  const filters = Array.from(toolbar.querySelectorAll("[data-project-filter]"));
  const more = document.getElementById("moreProjects");
  const moreSummary = more?.querySelector("summary");
  const labels = { all: "", web: "web & graphics ", embedded: "embedded & IoT " };
  let kind = "all";

  const matching = (value) =>
    cards.filter((card) => value === "all" || card.dataset.projectKind === value);

  function render() {
    const matches = matching(kind);
    cards.forEach((card) => { card.hidden = !matches.includes(card); });
    const extra = more ? matches.filter((card) => more.contains(card)) : [];
    if (more) {
      more.hidden = extra.length === 0;
      moreSummary.textContent = more.open
        ? "Show featured projects only"
        : `Explore ${extra.length} more project${extra.length === 1 ? "" : "s"}`;
    }
    const shown = matches.length - (more && !more.open ? extra.length : 0);
    count.textContent = shown === matches.length
      ? `Showing ${kind === "all" ? "all " : ""}${matches.length} ${labels[kind]}projects`
      : `Showing ${shown} of ${matches.length} ${labels[kind]}projects`;
  }

  filters.forEach((button) => {
    button.querySelector("span").textContent = matching(button.dataset.projectFilter).length;
    button.addEventListener("click", () => {
      kind = button.dataset.projectFilter;
      filters.forEach((filter) => filter.setAttribute("aria-pressed", String(filter === button)));
      render();
    });
  });
  more?.addEventListener("toggle", render);
  render();
  toolbar.hidden = false;
})();

// ────────────────────────────────────
// Resize the extra demos when their disclosure becomes visible.
// Each renderer handles its own canvas; featured demos keep their current state.
// ────────────────────────────────────
(() => {
  const panel = document.getElementById("moreSimulations");
  if (!panel) return;
  const summary = panel.querySelector("summary");
  const canvases = panel.querySelectorAll(".physics-canvas");
  panel.addEventListener("toggle", () => {
    summary.textContent = panel.open
      ? "Show featured simulations only"
      : `Explore ${canvases.length} more simulations`;
    if (panel.open) {
      canvases.forEach((canvas) => canvas.dispatchEvent(new Event("simulationresize")));
    }
  });
})();

// ────────────────────────────────────
// Gesture feedback: pointer tilt, staggered entrances, and click/tap ripples.
// ────────────────────────────────────
(() => {
  const hover = window.matchMedia("(hover: hover) and (pointer: fine)");
  const cards = Array.from(document.querySelectorAll(
    ".skill-category, .timeline-list > li, .project-card, .physics-canvas-wrapper, #hobbies li, footer #footer > span"
  ));
  const controls = document.querySelectorAll(
    ".document-button, .simulation-toggle, .project-filter, .theme-toggle, .hamburger, .container nav a, footer #footer a"
  );
  const ripples = new Set();
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      target.classList.remove("gesture-pending");
      target.classList.add("gesture-arrived");
      revealObserver.unobserve(target);
    });
  }, { threshold: 0.06, rootMargin: "0px 0px -24px 0px" });

  const resets = [];
  cards.forEach((card, index) => {
    card.classList.add("gesture-card");
    card.style.setProperty("--reveal-delay", `${(index % 3) * 55}ms`);
    if (!simulationMotion.matches && card.getBoundingClientRect().top >= window.innerHeight) {
      card.classList.add("gesture-pending");
      revealObserver.observe(card);
    }

    let bounds;
    let pointer;
    let frame;
    function reset() {
      cancelAnimationFrame(frame);
      frame = null;
      bounds = null;
      card.classList.remove("gesture-hover");
      card.style.removeProperty("--tilt-x");
      card.style.removeProperty("--tilt-y");
    }
    resets.push(reset);
    card.addEventListener("pointerenter", (event) => {
      if (simulationMotion.matches || !hover.matches || event.pointerType === "touch") return;
      bounds = card.getBoundingClientRect();
      card.classList.add("gesture-hover");
    });
    card.addEventListener("pointermove", (event) => {
      if (!bounds) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const x = Math.max(0, Math.min(1, (pointer.x - bounds.left) / bounds.width));
        const y = Math.max(0, Math.min(1, (pointer.y - bounds.top) / bounds.height));
        card.style.setProperty("--tilt-x", `${(0.5 - y) * 3}deg`);
        card.style.setProperty("--tilt-y", `${(x - 0.5) * 3}deg`);
        card.style.setProperty("--glow-x", `${x * 100}%`);
        card.style.setProperty("--glow-y", `${y * 100}%`);
      });
    }, { passive: true });
    card.addEventListener("pointerleave", reset);
    card.addEventListener("pointercancel", reset);
  });

  controls.forEach((control) => {
    control.classList.add("gesture-control");
    control.addEventListener("click", (event) => {
      if (simulationMotion.matches || control.disabled) return;
      const rect = control.getBoundingClientRect();
      const size = Math.hypot(rect.width, rect.height) * 2;
      const ripple = document.createElement("span");
      ripple.className = "gesture-ripple";
      ripple.setAttribute("aria-hidden", "true");
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${(event.detail ? event.clientX - rect.left : rect.width / 2) - size / 2}px`;
      ripple.style.top = `${(event.detail ? event.clientY - rect.top : rect.height / 2) - size / 2}px`;
      control.appendChild(ripple);
      const animation = ripple.animate([
        { transform: "scale(0)", opacity: 0.2 },
        { transform: "scale(1)", opacity: 0 },
      ], { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      ripples.add(animation);
      animation.finished.catch(() => {}).finally(() => {
        ripples.delete(animation);
        ripple.remove();
      });
    });
  });

  function resetMotion() {
    resets.forEach((reset) => reset());
    if (!simulationMotion.matches) return;
    revealObserver.disconnect();
    cards.forEach((card) => card.classList.remove("gesture-pending", "gesture-arrived"));
    ripples.forEach((animation) => animation.cancel());
  }
  simulationMotion.addEventListener("change", resetMotion);
  hover.addEventListener("change", resetMotion);
})();
