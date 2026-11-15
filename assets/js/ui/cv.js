// Download Resume: reads the page's own tags, lays them out with the Typst
// template in assets/cv/cv.typ, and compiles a PDF in the browser with the
// Typst WebAssembly compiler. Nothing is fetched until the button is pressed.
//
// The wording lives only in index.html. Edit a sentence there and the next
// download carries it; this file and the template hold no CV text.

// The JS glue in assets/vendor/typst/ must come from the same release as the
// WebAssembly binary. To self-host the binary or fonts, point these at local
// paths (the binary is about 28 MB, 9 MB compressed).
const COMPILER_WASM =
  "https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0/pkg/typst_ts_web_compiler_bg.wasm";
const COMPILER_BYTES = 28_325_178; // uncompressed size of that binary; only used for the progress figure
const FONT_BASE = "https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.13.1/files/fonts/";
const FONTS = ["NewCM10-Regular.otf", "NewCM10-Bold.otf", "NewCM10-Italic.otf", "NewCM10-BoldItalic.otf"];
const TEMPLATE = new URL("../../cv/cv.typ", import.meta.url);

const PDF_FORMAT = 1;        // typst.ts CompileFormatEnum.pdf
const UNIX_DIAGNOSTICS = 2;  // "file:line:col: error: message" strings

// ────────────────────────────────────
// Page → data
// ────────────────────────────────────

// Text as a screen reader would get it: decorative arrows and the animated
// copy of the hero statement are aria-hidden, so they are left out.
function readText(element, exclude = "") {
  if (!element) return "";
  const copy = element.cloneNode(true);
  const dropped = `[aria-hidden="true"]${exclude ? `, ${exclude}` : ""}`;
  copy.querySelectorAll(dropped).forEach((node) => node.remove());
  return copy.textContent.replace(/\s+/g, " ").trim();
}

// "Expertise <span class="latin">(Peritiae)</span>" → { text, latin }
function readHeading(element) {
  return {
    text: readText(element, ".latin"),
    latin: readText(element?.querySelector(".latin")).replace(/^\(|\)$/g, ""),
  };
}

// A .timeline-list item: <strong> title, <em> dates, then paragraphs and/or
// a list of highlights. Links to supporting documents are not CV text.
function readEntry(item) {
  return {
    title: readText(item.querySelector(":scope > strong")),
    date: readText(item.querySelector(":scope > em")),
    notes: Array.from(item.querySelectorAll(":scope > p:not(.document-note)"), (note) => readText(note))
      .filter(Boolean),
    points: Array.from(item.querySelectorAll(":scope > ul > li"), (point) => {
      const label = point.querySelector(":scope > strong");
      const body = point.querySelectorAll(":scope > p");
      return {
        label: readText(label),
        text: body.length
          ? Array.from(body, (paragraph) => readText(paragraph)).join(" ")
          : readText(point, ":scope > strong"),
      };
    }),
  };
}

function readSection(id) {
  const section = document.getElementById(id);
  return {
    heading: readHeading(section?.querySelector(".section-heading")),
    entries: Array.from(section?.querySelectorAll(".timeline-list > li") || [], readEntry),
  };
}

function readContactLink(anchor) {
  const href = anchor.getAttribute("href") || "";
  let text = readText(anchor.querySelector("small"));
  let url = "";
  try {
    const target = new URL(href, document.baseURI);
    url = target.href;
    // On paper the address is what matters, so print it instead of a caption.
    if (target.protocol === "mailto:") text = decodeURIComponent(target.pathname);
    else if (/^https?:$/.test(target.protocol)) text = (target.host + target.pathname).replace(/\/$/, "");
  } catch {
    // Keep the caption when the link is not a usable URL.
  }
  return { label: readText(anchor.querySelector("strong")) || text, text, url };
}

function readPage() {
  const about = document.getElementById("about");
  const name = document.getElementById("name");
  // The hero shows one of several statements (?apply=…); print the visible one.
  const statement = Array.from(about?.querySelectorAll(".text-reveal") || [])
    .find((paragraph) => getComputedStyle(paragraph).display !== "none");
  const skills = document.getElementById("skills");
  const contact = document.getElementById("contact");
  const footer = contact?.closest("footer");

  return {
    title: document.title,
    name: name?.dataset.text || readText(name),
    subtitle: readText(document.getElementById("subtitle")),
    about: {
      heading: readHeading(document.querySelector('#mainNav a[href="#about"]')),
      body: readText(statement),
    },
    skills: {
      heading: readHeading(skills?.querySelector(".section-heading")),
      groups: Array.from(skills?.querySelectorAll(".skill-category") || [], (category) => ({
        name: readText(category.querySelector("h3")),
        // Proficiency matters for spoken languages; elsewhere the list is enough.
        showLevels: category.classList.contains("languages-category"),
        items: Array.from(category.querySelectorAll(".skill-item"), (item) => ({
          name: readText(item.querySelector(":scope > span:not(.skill-level)")),
          // site.js derives this word ("Native", "Advanced", …) from the bar's data-width.
          level: readText(item.querySelector(":scope > .skill-level")),
        })).filter((item) => item.name),
      })).filter((group) => group.items.length),
    },
    experience: readSection("experience"),
    education: readSection("education"),
    contact: {
      heading: readHeading(contact),
      intro: readText(footer?.querySelector(".contact-intro")),
      links: Array.from(footer?.querySelectorAll("#footer a[href]") || [], readContactLink),
    },
  };
}

// ────────────────────────────────────
// Data → PDF
// ────────────────────────────────────

async function download(url, kind) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} while loading ${url}`);
  return kind === "text" ? response.text() : new Uint8Array(await response.arrayBuffer());
}

// The compiler is by far the largest download, so its progress is the one
// worth showing. Counting bytes as they stream past keeps the streaming
// WebAssembly compile; without stream support the plain response still works.
let compilerProgress = 0;
let onCompilerProgress = () => {};

async function downloadCompiler() {
  const response = await fetch(COMPILER_WASM);
  if (!response.ok) throw new Error(`${response.status} while loading ${COMPILER_WASM}`);
  if (!response.body || typeof TransformStream !== "function") return response;
  let received = 0;
  const counted = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      compilerProgress = Math.min(1, received / COMPILER_BYTES);
      onCompilerProgress(compilerProgress);
      controller.enqueue(chunk);
    },
  }));
  return new Response(counted, { headers: { "Content-Type": "application/wasm" } });
}

let compilerReady;

// Loaded once per visit; later downloads reuse the compiler.
function loadCompiler() {
  compilerReady ??= (async () => {
    const [typst, template, ...fonts] = await Promise.all([
      import("../../vendor/typst/typst_ts_web_compiler.mjs"),
      download(TEMPLATE, "text"),
      ...FONTS.map((font) => download(FONT_BASE + font, "bytes")),
    ]);
    await typst.default({ module_or_path: downloadCompiler() });
    compilerProgress = 1;
    const builder = new typst.TypstCompilerBuilder();
    builder.set_dummy_access_model();
    for (const font of fonts) await builder.add_raw_font(font);
    const compiler = await builder.build();
    compiler.add_source("/cv.typ", template);
    return compiler;
  })();
  // A failed load (offline, blocked CDN) should not poison the next attempt.
  compilerReady.catch(() => {
    compilerReady = undefined;
    compilerProgress = 0;
  });
  return compilerReady;
}

async function buildPdf(data) {
  const compiler = await loadCompiler();
  compiler.map_shadow("/cv.json", new TextEncoder().encode(JSON.stringify(data)));
  const world = compiler.snapshot(null, "/cv.typ", null);
  try {
    const output = world.get_artifact(PDF_FORMAT, UNIX_DIAGNOSTICS);
    if (!output?.result) {
      throw new Error(`Typst could not compile the CV:\n${(output?.diagnostics || []).join("\n")}`);
    }
    return new Blob([output.result], { type: "application/pdf" });
  } finally {
    world.free();
  }
}

function save(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

// ────────────────────────────────────
// Button
// ────────────────────────────────────
(() => {
  const button = document.getElementById("downloadCv");
  const status = document.getElementById("cvStatus");
  if (!button || typeof WebAssembly !== "object") {
    // No compiler, no CV: do not offer a button that cannot work.
    button?.remove();
    return;
  }

  const idleLabel = button.textContent;
  let busy = false;
  let restore;

  function show(label, announcement = "") {
    button.textContent = label;
    if (status) status.textContent = announcement;
  }

  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    clearTimeout(restore);
    button.setAttribute("aria-busy", "true");
    button.classList.remove("cv-download--failed");
    // The first download of the compiler can take a while on a slow
    // connection; the label counts it in. Later presses reuse it.
    const firstLoad = compilerProgress < 1;
    onCompilerProgress = (progress) => {
      const label = progress < 1 ? `Preparing resume… ${Math.floor(progress * 100)}%` : "Preparing resume…";
      if (button.textContent !== label) button.textContent = label;
    };
    show("Preparing resume…", firstLoad
      ? "Preparing the resume. The first time can take up to a minute."
      : "Preparing the resume.");
    try {
      const data = readPage();
      const pdf = await buildPdf(data);
      const filename = `${data.name.trim().replace(/[^\p{L}\p{N}]+/gu, "-") || "My"}-Resume.pdf`;
      save(pdf, filename);
      show(idleLabel, `${filename} downloaded.`);
    } catch (error) {
      console.error(error);
      button.classList.add("cv-download--failed");
      show("Resume unavailable — try again", "The resume could not be created. Try again.");
      restore = setTimeout(() => {
        button.classList.remove("cv-download--failed");
        show(idleLabel);
      }, 6000);
    } finally {
      busy = false;
      onCompilerProgress = () => {};
      button.removeAttribute("aria-busy");
    }
  });
})();
