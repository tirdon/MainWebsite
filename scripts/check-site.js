import { readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { hosting } = JSON.parse(await readFile(resolve(root, "firebase.json"), "utf8"));
const publicRoot = resolve(root, hosting.public);
const ignored = (hosting.ignore || []).map(pattern => new Bun.Glob(pattern));
const checked = new Set();
const entrypoints = [];
const modules = [];
const transpiler = new Bun.Transpiler({ loader: "js", target: "browser" });

async function checkFile(file) {
  const path = relative(publicRoot, file).split(sep).join("/");
  if (path === ".." || path.startsWith("../")) throw new Error(`Asset is outside the Hosting directory: ${file}`);
  if (ignored.some(pattern => pattern.match(path))) throw new Error(`Referenced asset is excluded from Hosting: ${path}`);
  if (checked.has(file)) return;
  if (!(await stat(file)).isFile()) throw new Error(`Expected a static file: ${path}`);
  checked.add(file);
}

function localFile(reference, parent) {
  // External URLs, mail links, inline data, and in-page anchors are not assets.
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return null;
  const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  if (!pathname) return null;
  return resolve(pathname.startsWith("/") ? publicRoot : dirname(parent),
    pathname === "/" ? "index.html" : pathname.replace(/^\//, ""));
}

for (const name of ["index.html", "404.html"]) {
  const page = resolve(publicRoot, name);
  await checkFile(page);
  const html = await readFile(page, "utf8");
  for (const [, reference] of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const file = localFile(reference, page);
    if (file) await checkFile(file);
  }
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const file = src && localFile(src, page);
    if (file) {
      entrypoints.push(file);
      modules.push(file);
    }
  }
}

const scanned = new Set();
while (modules.length) {
  const file = modules.pop();
  if (scanned.has(file)) continue;
  await checkFile(file);
  scanned.add(file);
  const source = await readFile(file, "utf8");
  for (const { path: specifier } of transpiler.scanImports(source)) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      throw new Error(`Browser module requires a nonlocal import: ${relative(root, file)} → ${specifier}`);
    }
    const dependency = localFile(specifier, file);
    if (!dependency) throw new Error(`Invalid module path: ${specifier}`);
    modules.push(dependency);
  }
  // Files a module fetches relative to itself (for example the CV template).
  for (const [, reference] of source.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) {
    const asset = localFile(reference, file);
    if (asset) await checkFile(asset);
  }
}

// Compile for validation only. Firebase serves the original browser modules.
const result = await Bun.build({ entrypoints: [...new Set(entrypoints)], target: "browser", write: false });
if (!result.success) throw new AggregateError(result.logs, "Browser module validation failed");
console.log(`Validated ${checked.size} static files and ${scanned.size} browser modules for Firebase Hosting.`);
