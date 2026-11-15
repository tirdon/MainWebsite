import { resizeCanvas, isDark, runWhenVisible } from "../../core/runtime.js";

(() => { // PHYSICS SIM 7: Click to cycle cellular automata rules
  const canvas = document.getElementById("rule90Sim");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const ruleNum = document.getElementById("ruleNum");
  const rules = [18, 30, 73, 90];
  let ruleIndex = rules.indexOf(90);
  let W, H;

  let cells = [];
  const MAX_STEPS = 200;

  function updateRuleLabel() {
    const rule = rules[ruleIndex];
    if (ruleNum) {
      if (window.katex) {
        window.katex.render(String(rule), ruleNum, { displayMode: true, throwOnError: false });
      } else {
        ruleNum.textContent = rule;
      }
    }
    canvas.setAttribute("aria-label", `Cellular automata, Rule ${rule}. Click to change the rule.`);
  }

  function resize() {
    ({ W, H } = resizeCanvas(canvas));
    cells = [];
    const numCells = Math.floor(W / 2);
    cells.push(new Array(numCells).fill(0));
    cells[0][Math.floor(numCells / 2)] = 1; // Start with a single live cell in the middle
  }

  function stepAutomaton() {
    const prevRow = cells[cells.length - 1];
    const newRow = new Array(prevRow.length).fill(0);
    const rule = rules[ruleIndex];
    for (let i = 0; i < prevRow.length; i++) {
      const left = prevRow[i - 1] || 0;
      const center = prevRow[i];
      const right = prevRow[i + 1] || 0;
      const neighborhood = (left << 2) | (center << 1) | right;
      newRow[i] = (rule >> neighborhood) & 1;
    }
    cells.push(newRow);
    if (cells.length > MAX_STEPS) {
      cells.shift(); // Keep only the last MAX_STEPS rows
    }
  }

  function nextRule() {
    ruleIndex = (ruleIndex + 1) % rules.length;
    updateRuleLabel();
    resize();
  }

  function cellColor(dark) {
    const colors = dark
      ? ["#3dd9c1", "#e8944a"]
      : ["#1e6f5c", "#cf6b4f"];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function loop() {
    const dark = isDark();
    ctx.clearRect(0, 0, W, H);

    // Step the automaton
    stepAutomaton();

    // Draw the cells
    const cellWidth = W / cells[0].length;
    const cellHeight = H / MAX_STEPS;
    for (let y = 0; y < cells.length; y++) {
      for (let x = 0; x < cells[y].length; x++) {
        if (cells[y][x] === 1) {
          ctx.fillStyle = cellColor(dark);
          ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
        }
      }
    }
  }

  canvas.setAttribute("role", "button");
  canvas.tabIndex = 0;
  canvas.title = "Click to change cellular automata rule";
  canvas.addEventListener("click", nextRule);
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      nextRule();
    }
  });

  updateRuleLabel();
  resize();
  window.addEventListener("resize", resize);
  canvas.addEventListener("simulationresize", resize);
  runWhenVisible(canvas, loop);

})();
