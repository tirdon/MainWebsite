import { resizeCanvas, isDark, runWhenVisible, simulationsPlaying } from "../core/runtime.js";

// Small, inspectable models for the Interests cards. Both use the shared
// visibility/playback lifecycle; vertical gestures continue to scroll the page.
(() => {
  // |gain| < 1 makes this map a contraction. Its fixed point is exactly c,
  // with derivative gain at c; negative gains give alternating convergence.
  function fixedPointValue(x, c, gain) {
    return c + gain * Math.sin(x - c);
  }

  function fixedPointOrbit(initial, c, gain) {
    const orbit = [initial];
    for (let i = 0; i < 18; i++) {
      const next = fixedPointValue(orbit[orbit.length - 1], c, gain);
      orbit.push(next);
      if (Math.abs(next - c) < 0.002) break;
    }
    return orbit;
  }

  // An illustrative feed-forward network, not a trained classifier. The same
  // weights drive both the drawn connections and the computed activations.
  const networkWeights = [
    [[1.8, -1.4, 0.6], [-0.7, 1.9, 0.8], [1.2, 0.5, -1.6], [-1.5, 0.9, 1.7], [0.7, -0.8, 1.4]],
    [[1.4, -1.1, 0.7, -0.9, 1.3], [-0.8, 1.6, -1.2, 1.1, 0.6], [1.1, 0.4, 1.5, -1.3, -0.7], [-1.2, 1.1, 0.8, 1.4, -0.5]],
    [[1.9, -1.4, 1.2, -0.9], [-1.1, 1.7, -1.3, 1.5]],
  ];
  const networkBiases = [[-0.5, -0.6, 0.1, -0.4, -0.3], [-0.5, -0.6, -0.4, -0.7], [-0.4, -0.5]];

  function forwardNetwork(inputs) {
    const layers = [inputs.slice()];
    networkWeights.forEach((weights, layer) => {
      layers.push(weights.map((row, neuron) => {
        const sum = row.reduce((value, weight, source) => value + weight * layers[layer][source], networkBiases[layer][neuron]);
        return 1 / (1 + Math.exp(-sum));
      }));
    });
    return layers;
  }

  function palette() {
    return isDark()
      ? { empty: "#30343b", site: "#b5a087", connected: "#7fc4a8", path: "#f0c66b", negative: "#e89070", ink: "#dedbd2", muted: "#a8aba9", surface: "#1b1d22" }
      : { empty: "#e6e3dc", site: "#907960", connected: "#36785f", path: "#aa7716", negative: "#b85a3e", ink: "#343b35", muted: "#656962", surface: "#ffffff" };
  }

  function animateCard(canvas, advance, draw) {
    let width = 0;
    let height = 0;
    let previousTime = performance.now();
    const redraw = () => draw(width, height);
    function resize() {
      ({ W: width, H: height } = resizeCanvas(canvas));
      redraw();
    }
    function resetClock() {
      previousTime = performance.now();
      redraw();
    }
    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("themechange", redraw);
    document.addEventListener("simulationplaybackchange", resetClock);
    document.addEventListener("visibilitychange", resetClock);
    runWhenVisible(canvas, () => {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      if (simulationsPlaying && !document.hidden) advance(dt);
      redraw();
    });
    return redraw;
  }

  // Horizontal gestures belong to the demo; vertical gestures stay with the
  // page. Pointer capture starts only after horizontal intent is established.
  function interactWithCanvas(canvas, actions) {
    let pointer = null;
    let suppressClick = false;
    const position = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    };
    function finish(event, cancelled = false) {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dragged = pointer.dragged;
      pointer = null;
      canvas.classList.remove("is-dragging");
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (dragged && !cancelled) actions.commit();
      if (cancelled || event.pointerType === "touch") actions.hover(null);
    }
    canvas.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
      suppressClick = false;
      actions.begin();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch") actions.hover(position(event));
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (!pointer.dragged) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          pointer = null;
          suppressClick = true;
          return;
        }
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
        pointer.dragged = true;
        suppressClick = true;
        canvas.classList.add("is-dragging");
        canvas.setPointerCapture(event.pointerId);
      }
      actions.drag(dx / canvas.getBoundingClientRect().width);
    });
    canvas.addEventListener("pointerup", (event) => finish(event));
    canvas.addEventListener("pointercancel", (event) => finish(event, true));
    canvas.addEventListener("lostpointercapture", (event) => finish(event, true));
    canvas.addEventListener("pointerleave", () => actions.hover(null));
    canvas.addEventListener("click", () => {
      if (suppressClick) { suppressClick = false; return; }
      actions.activate();
    });
    canvas.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        actions.activate();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        actions.step((event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01));
        actions.commit();
      }
    });
  }

  // Cobweb iteration: vertical steps evaluate f, horizontal steps return to
  // y=x. The moving point shows x_n approaching the marked fixed point c.
  (() => {
    const canvas = document.getElementById("fixedPointSim");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const readout = document.getElementById("fixedPointReadout");
    const announcement = document.getElementById("fixedPointAnnouncement");
    const c = 0.35;
    let gain = 0.72;
    let initial = -1.65;
    let dragStart = gain;
    let cursor = 0;
    let hoverX = null;
    let geometry;
    let orbit;
    let points;

    function restart(start = initial) {
      initial = start;
      orbit = fixedPointOrbit(initial, c, gain);
      points = [[initial, 0]];
      for (let i = 0; i < orbit.length - 1; i++) {
        points.push([orbit[i], orbit[i + 1]], [orbit[i + 1], orbit[i + 1]]);
      }
      cursor = 0;
      readout.textContent = `f(x) = c + k sin(x − c), with c = ${c.toFixed(2)} and k = ${gain.toFixed(2)}. Starting at ${initial.toFixed(2)}, the iteration converges ${gain < 0 ? "with alternating steps" : "toward c"}. Click to restart; drag horizontally to adjust the slope.`;
    }

    function advance(dt) {
      cursor += dt * 2.8;
      if (cursor > points.length + 4) restart(initial < c ? 1.65 : -1.65);
    }

    function draw(W, H) {
      if (!points || W <= 0 || H <= 0) return;
      const colors = palette();
      ctx.clearRect(0, 0, W, H);
      const left = 25;
      const right = W - 15;
      const top = 28;
      const bottom = H - 30;
      const px = (x) => left + (x + 2) / 4 * (right - left);
      const py = (y) => bottom - (y + 2) / 4 * (bottom - top);
      geometry = { W, H, left, right, top, bottom };
      const line = (x1, y1, x2, y2) => {
        ctx.beginPath();
        ctx.moveTo(px(x1), py(y1));
        ctx.lineTo(px(x2), py(y2));
        ctx.stroke();
      };
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.empty;
      for (const value of [-1, 0, 1]) {
        line(value, -2, value, 2);
        line(-2, value, 2, value);
      }
      ctx.strokeStyle = colors.muted;
      ctx.globalAlpha = 0.5;
      line(-2, 0, 2, 0);
      line(0, -2, 0, 2);
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([4, 4]);
      line(-2, -2, 2, 2);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = colors.connected;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const x = -2 + i / 25;
        const y = fixedPointValue(x, c, gain);
        if (i === 0) ctx.moveTo(px(x), py(y));
        else ctx.lineTo(px(x), py(y));
      }
      ctx.stroke();

      const progress = Math.min(cursor, points.length - 1);
      const complete = Math.floor(progress);
      const fraction = progress - complete;
      const from = points[complete];
      const to = points[Math.min(complete + 1, points.length - 1)];
      const current = [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
      ctx.strokeStyle = colors.path;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px(points[0][0]), py(points[0][1]));
      for (let i = 1; i <= complete; i++) ctx.lineTo(px(points[i][0]), py(points[i][1]));
      ctx.lineTo(px(current[0]), py(current[1]));
      ctx.stroke();

      // A fixed marker at (c,c) remains visible while the orbit converges.
      ctx.strokeStyle = colors.connected;
      ctx.lineWidth = 1.5;
      ctx.fillStyle = colors.surface;
      ctx.beginPath();
      ctx.arc(px(c), py(c), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.path;
      ctx.beginPath();
      ctx.arc(px(current[0]), py(current[1]), 3, 0, Math.PI * 2);
      ctx.fill();

      if (hoverX !== null) {
        const y = fixedPointValue(hoverX, c, gain);
        ctx.strokeStyle = colors.muted;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        line(hoverX, 0, hoverX, y);
        ctx.setLineDash([]);
        ctx.fillStyle = colors.negative;
        ctx.beginPath();
        ctx.arc(px(hoverX), py(y), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.textBaseline = "middle";
      ctx.font = "500 9px Inter, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = colors.ink;
      ctx.fillText(hoverX === null ? `f(c) = c = ${c.toFixed(2)}`
        : `f(${hoverX.toFixed(1)}) = ${fixedPointValue(hoverX, c, gain).toFixed(2)}`, 12, 13);
      ctx.textAlign = "right";
      ctx.fillStyle = colors.muted;
      ctx.fillText(`k = ${gain.toFixed(2)}`, W - 12, 13);
      ctx.fillText("y = x", right - 2, top + 6);
      ctx.fillStyle = colors.connected;
      ctx.fillText("y = f(x)", right - 2, py(fixedPointValue(2, c, gain)) - 9);
      ctx.textAlign = "left";
      ctx.fillText("c", px(c) + 8, py(c) - 8);
      ctx.textAlign = "center";
      ctx.fillStyle = colors.muted;
      for (const value of [-1, 0, 1]) ctx.fillText(String(value), px(value), bottom + 9);
      ctx.fillText("Click: restart · drag: slope", W / 2, H - 8);
    }

    restart();
    const redraw = animateCard(canvas, advance, draw);
    function adjust(next) {
      gain = Math.max(-0.92, Math.min(0.92, Math.round(next * 100) / 100));
      restart();
      redraw();
    }
    interactWithCanvas(canvas, {
      begin: () => { dragStart = gain; },
      drag: (distance) => adjust(dragStart + distance * 1.84),
      step: (amount) => adjust(gain + amount),
      commit: () => { announcement.textContent = readout.textContent; },
      activate() {
        const start = (Math.random() < 0.5 ? -1 : 1) * (1.1 + Math.random() * 0.7);
        restart(start);
        redraw();
        announcement.textContent = readout.textContent;
      },
      hover(pointer) {
        hoverX = pointer && geometry && pointer.y * geometry.H >= geometry.top && pointer.y * geometry.H <= geometry.bottom
          && pointer.x * geometry.W >= geometry.left && pointer.x * geometry.W <= geometry.right
          ? -2 + (pointer.x * geometry.W - geometry.left) / (geometry.right - geometry.left) * 4 : null;
        redraw();
      },
    });
  })();

  // Neural network: click samples inputs, dragging adjusts the first input,
  // and hovering a neuron emphasizes its incoming and outgoing connections.
  (() => {
    const canvas = document.getElementById("neuralSim");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const readout = document.getElementById("neuralReadout");
    const announcement = document.getElementById("neuralAnnouncement");
    let inputs = [0.5, 0.25, 0.8];
    let layers = forwardNetwork(inputs);
    let phase = 0;
    let dragStart = inputs[0];
    let hovered = null;
    let geometry;

    function updateInputs() {
      layers = forwardNetwork(inputs);
      const outputs = layers[layers.length - 1];
      readout.textContent = `Inputs ${inputs.map((input) => input.toFixed(2)).join(" / ")}. Output activations ${outputs[0].toFixed(2)} / ${outputs[1].toFixed(2)}.`;
      phase = 0;
    }

    function draw(W, H) {
      if (W <= 0 || H <= 0) return;
      const colors = palette();
      ctx.clearRect(0, 0, W, H);
      const radius = Math.max(7, Math.min(15, W / 26));
      const margin = Math.max(24, radius + 12);
      const nodes = layers.map((layer, layerIndex) => layer.map((activation, neuron) => ({
        x: margin + (W - margin * 2) * layerIndex / 3,
        y: 27 + (H - 61) * (neuron + 1) / (layer.length + 1),
        activation,
      })));
      geometry = { W, H, radius, nodes };
      const completedLayer = simulationsPlaying ? Math.min(3, Math.floor(phase)) : 3;
      const movingLayer = Math.floor(phase);
      const progress = phase % 1;

      networkWeights.forEach((weights, layer) => {
        weights.forEach((row, neuron) => row.forEach((weight, source) => {
          const a = nodes[layer][source];
          const b = nodes[layer + 1][neuron];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          const ax = a.x + dx / distance * (radius + 2);
          const ay = a.y + dy / distance * (radius + 2);
          const bx = b.x - dx / distance * (radius + 2);
          const by = b.y - dy / distance * (radius + 2);
          const highlighted = hovered && ((hovered.layer === layer && hovered.neuron === source)
            || (hovered.layer === layer + 1 && hovered.neuron === neuron));
          ctx.globalAlpha = hovered ? (highlighted ? 0.85 : 0.07) : completedLayer > layer ? 0.35 : 0.16;
          ctx.strokeStyle = weight > 0 ? colors.connected : colors.negative;
          ctx.lineWidth = 0.6 + Math.abs(weight) * 0.65;
          ctx.setLineDash(weight < 0 ? [3, 4] : []);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          if (simulationsPlaying && layer === movingLayer && (!hovered || highlighted)) {
            ctx.globalAlpha = 0.3 + a.activation * 0.7;
            ctx.fillStyle = colors.path;
            ctx.beginPath();
            ctx.arc(ax + (bx - ax) * progress, ay + (by - ay) * progress, 1.4 + a.activation * 1.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }));
      });
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const labels = ["Input", "Hidden 1", "Hidden 2", "Output"];
      nodes.forEach((layer, layerIndex) => {
        layer.forEach(({ x, y, activation }, neuron) => {
          const selected = hovered?.layer === layerIndex && hovered.neuron === neuron;
          const active = selected || layerIndex <= completedLayer;
          ctx.fillStyle = colors.surface;
          ctx.strokeStyle = selected ? colors.path : active ? colors.connected : colors.empty;
          ctx.lineWidth = selected ? 2.5 : active ? 1.8 : 1.2;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = colors.connected;
          ctx.globalAlpha = active ? 0.12 + activation * 0.25 : 0.04;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = active ? colors.ink : colors.muted;
          ctx.font = `500 ${Math.max(7, Math.min(10, radius * 0.7))}px Inter, system-ui, sans-serif`;
          ctx.fillText(active ? activation.toFixed(1) : "·", x, y + 0.5);
        });
        ctx.fillStyle = colors.muted;
        ctx.font = `${W < 300 ? 8 : 10}px Inter, system-ui, sans-serif`;
        ctx.fillText(labels[layerIndex], layer[0].x, H - 17);
      });
      ctx.fillStyle = colors.muted;
      ctx.font = "500 9px Inter, system-ui, sans-serif";
      const sum = hovered && hovered.layer > 0
        ? networkWeights[hovered.layer - 1][hovered.neuron].reduce((value, weight, source) =>
          value + weight * layers[hovered.layer - 1][source], networkBiases[hovered.layer - 1][hovered.neuron]) : null;
      const status = hovered ? (sum === null ? `Input · activation ${layers[0][hovered.neuron].toFixed(2)}`
        : `z = ${sum.toFixed(2)} → a = ${layers[hovered.layer][hovered.neuron].toFixed(2)}`)
        : !simulationsPlaying ? "PAUSED · ACTIVATIONS SHOWN"
        : phase < 1 ? "INPUT → HIDDEN 1"
        : phase < 2 ? "HIDDEN 1 → HIDDEN 2"
        : phase < 3 ? "HIDDEN 2 → OUTPUT" : "FORWARD PASS COMPLETE";
      ctx.fillText(status, W / 2, 16);
    }

    updateInputs();
    const redraw = animateCard(canvas, (dt) => { phase = (phase + dt * 0.72) % 4.1; }, draw);
    function adjust(next) {
      inputs[0] = Math.max(0, Math.min(1, Math.round(next * 100) / 100));
      updateInputs();
      redraw();
    }
    interactWithCanvas(canvas, {
      begin: () => { dragStart = inputs[0]; },
      drag: (distance) => adjust(dragStart + distance),
      step: (amount) => adjust(inputs[0] + amount),
      commit: () => { announcement.textContent = readout.textContent; },
      activate() {
        inputs = inputs.map(() => Math.round(Math.random() * 100) / 100);
        updateInputs();
        redraw();
        announcement.textContent = readout.textContent;
      },
      hover(pointer) {
        let next = null;
        if (pointer && geometry) {
          geometry.nodes.forEach((layer, layerIndex) => layer.forEach((node, neuron) => {
            if (Math.hypot(pointer.x * geometry.W - node.x, pointer.y * geometry.H - node.y) <= geometry.radius + 5) {
              next = { layer: layerIndex, neuron };
            }
          }));
        }
        if (next?.layer !== hovered?.layer || next?.neuron !== hovered?.neuron) {
          hovered = next;
          redraw();
        }
      },
    });
  })();
})();
