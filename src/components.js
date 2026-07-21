(function () {
  "use strict";

  class ExpressionList extends HTMLElement {
    constructor() {
      super();
      this.items = [];
      this.fields = new Map();
      this.activeId = null;
      this.selectedId = null;
    }

    connectedCallback() {
      this.addEventListener("click", (event) => this.handleClick(event));
      this.addEventListener("input", (event) => this.handleNativeInput(event));
      this.addEventListener("change", (event) => this.handleChange(event));
    }

    setItems(items, focusId = null) {
      this.items = items;
      this.fields.clear();
      this.replaceChildren();
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "empty-expression-state";
        const variables = this.dataset.listKind === "variables";
        empty.innerHTML = variables
          ? "<div><strong>No variables yet</strong><br><span>Add a scalar value for sliders and parameters.</span><br><button type=\"button\" data-empty-add>Add variable</button></div>"
          : "<div><strong>No expressions yet</strong><br><span>Add one to begin graphing.</span><br><button type=\"button\" data-empty-add>Add expression</button></div>";
        this.append(empty);
        return;
      }

      items.forEach((item, index) => this.append(this.createRow(item, index)));
      this.setSelected(this.selectedId);
      if (focusId) requestAnimationFrame(() => this.focus(focusId));
    }

    createRow(item, index) {
      if (item.type === "note") return this.createNoteRow(item, index);
      if (item.type === "annotation" || item.type === "shape") return this.createAnnotationRow(item, index);
      const row = document.createElement("article");
      row.className = `expression-row${item.visible ? "" : " is-hidden"}`;
      row.dataset.expressionId = item.id;
      row.style.setProperty("--expression-color", item.color);
      row.innerHTML = `
        <span class="expression-index">${index + 1}</span>
        <div class="expression-color-wrap">
          <button class="expression-color" type="button" data-visibility aria-label="${item.visible ? "Hide" : "Show"} expression" aria-pressed="${item.visible}"></button>
        </div>
        <div class="math-field-shell"><span class="math-input" data-math-input aria-label="Expression ${index + 1}"></span></div>
        <button class="expression-delete" type="button" data-delete aria-label="Delete expression">×</button>
      `;
      this.installMathField(row, item);
      this.updateRow(item, row);
      return row;
    }

    createAnnotationRow(item, index) {
      const row = document.createElement("article");
      row.className = `expression-row annotation-row${item.visible === false ? " is-hidden" : ""}`;
      row.dataset.expressionId = item.id;
      row.style.setProperty("--expression-color", item.color);
      row.innerHTML = `
        <span class="expression-index">${index + 1}</span>
        <div class="expression-color-wrap"><button class="annotation-color" type="button" data-visibility aria-label="${item.visible ? "Hide" : "Show"} geometry"></button></div>
        <div class="annotation-content">
          <strong>${this.escapeHtml(item.graphLabel || item.label || (item.type === "shape" ? "Shape" : item.annotationKind === "tangent" ? "Tangent" : "Point"))}</strong>
          <span data-annotation-math></span>
        </div>
        <button class="expression-delete" type="button" data-delete aria-label="Delete annotation">×</button>
      `;
      const math = row.querySelector("[data-annotation-math]");
      if (window.katex) window.katex.render(item.latex || "", math, { throwOnError: false });
      else math.textContent = item.latex || "";
      return row;
    }

    createNoteRow(item, index) {
      const row = document.createElement("article");
      row.className = "expression-row note-row";
      row.dataset.expressionId = item.id;
      row.innerHTML = `
        <span class="expression-index">${index + 1}</span>
        <span></span>
        <textarea class="note-input" data-note-input aria-label="Note ${index + 1}" placeholder="Add a note">${this.escapeHtml(item.text || "")}</textarea>
        <button class="expression-delete" type="button" data-delete aria-label="Delete note">×</button>
      `;
      const textarea = row.querySelector("textarea");
      textarea.addEventListener("focus", () => this.setFocused(item.id));
      textarea.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") this.emit("add-after", { id: item.id });
      });
      return row;
    }

    installMathField(row, item) {
      const target = row.querySelector("[data-math-input]");
      const MQ = window.MathQuill && window.jQuery ? window.MathQuill.getInterface(2) : null;
      if (!MQ) {
        const input = document.createElement("input");
        input.className = "math-input-fallback";
        input.value = item.latex;
        input.dataset.fallbackInput = "";
        input.setAttribute("aria-label", target.getAttribute("aria-label"));
        target.replaceWith(input);
        this.fields.set(item.id, {
          latex: (value) => {
            if (value === undefined) return input.value;
            input.value = value;
          },
          focus: () => input.focus(),
          write: (value) => {
            input.setRangeText(value, input.selectionStart, input.selectionEnd, "end");
            input.dispatchEvent(new Event("input", { bubbles: true }));
          },
          keystroke: (key) => {
            if (key === "Backspace") document.execCommand("delete");
          },
        });
        input.addEventListener("focus", () => this.setFocused(item.id));
        return;
      }

      const field = MQ.MathField(target, {
        autoCommands: "pi theta sqrt sum prod alpha beta gamma delta lambda mu sigma phi",
        autoOperatorNames: "sin cos tan sec csc cot asin acos atan sinh cosh tanh log ln min max abs arg re im conj exp",
        charsThatBreakOutOfSupSub: "+-=<>",
        spaceBehavesLikeTab: true,
        handlers: {
          edit: (mathField) => this.emit("expression-change", { id: item.id, latex: mathField.latex() }),
          enter: () => this.emit("add-after", { id: item.id }),
        },
      });
      field.latex(item.latex);
      this.fields.set(item.id, field);
      target.addEventListener("focusin", () => this.setFocused(item.id));
      target.addEventListener("pointerdown", () => this.setFocused(item.id));
    }

    updateRow(item, existingRow = null) {
      const row = existingRow || this.querySelector(`[data-expression-id="${CSS.escape(item.id)}"]`);
      if (!row || item.type === "note") return;
      if (item.type === "annotation" || item.type === "shape") {
        row.style.setProperty("--expression-color", item.color);
        row.classList.toggle("is-hidden", item.visible === false);
        row.querySelector("[data-visibility]")?.setAttribute("aria-pressed", String(item.visible !== false));
        const title = row.querySelector(".annotation-content strong");
        if (title) title.textContent = item.graphLabel || item.label || "Geometry";
        return;
      }
      row.classList.toggle("is-hidden", !item.visible);
      row.style.setProperty("--expression-color", item.color);
      row.querySelector("[data-visibility]")?.setAttribute("aria-pressed", String(item.visible));

      let message = row.querySelector(".expression-message");
      if (item.error) {
        if (!message) {
          message = document.createElement("div");
          message.className = "expression-message";
          row.append(message);
        }
        message.textContent = item.error;
      } else {
        message?.remove();
      }

      let slider = row.querySelector(".slider-row");
      if (item.compiled?.kind === "constant" && Number.isFinite(item.value)) {
        if (!slider) {
          slider = document.createElement("label");
          slider.className = "slider-row";
          slider.innerHTML = `<input type="range" min="-10" max="10" step="0.1" data-slider><output></output>`;
          row.append(slider);
        }
        slider.style.setProperty("--expression-color", item.color);
        slider.querySelector("input").value = String(item.value);
        slider.querySelector("output").textContent = Number(item.value.toFixed(4)).toString();
      } else {
        slider?.remove();
      }
    }

    handleClick(event) {
      const row = event.target.closest("[data-expression-id]");
      if (event.target.closest("[data-empty-add]")) {
        this.emit(this.dataset.listKind === "variables" ? "empty-add-variable" : "empty-add");
        return;
      }
      if (!row) return;
      const id = row.dataset.expressionId;
      if (event.target.closest("[data-delete]")) this.emit("expression-delete", { id });
      if (event.target.closest("[data-visibility]")) this.emit("expression-visibility", { id });
      if (!event.target.closest("button")) this.setFocused(id);
    }

    handleNativeInput(event) {
      const row = event.target.closest("[data-expression-id]");
      if (!row) return;
      if (event.target.matches("[data-fallback-input]")) {
        this.emit("expression-change", { id: row.dataset.expressionId, latex: event.target.value });
      }
      if (event.target.matches("[data-note-input]")) {
        this.emit("note-change", { id: row.dataset.expressionId, text: event.target.value });
      }
      if (event.target.matches("[data-slider]")) {
        const value = Number(event.target.value);
        event.target.nextElementSibling.textContent = Number(value.toFixed(4)).toString();
        this.emit("slider-change", { id: row.dataset.expressionId, value });
      }
    }

    handleChange(event) {
      if (!event.target.matches("[data-slider]")) return;
      const row = event.target.closest("[data-expression-id]");
      this.emit("slider-commit", { id: row.dataset.expressionId, value: Number(event.target.value) });
    }

    setFocused(id) {
      this.activeId = id;
      this.querySelectorAll(".expression-row").forEach((row) => row.classList.toggle("is-focused", row.dataset.expressionId === id));
      this.emit("expression-focus", { id });
    }

    setSelected(id) {
      this.selectedId = id || null;
      this.querySelectorAll(".expression-row").forEach((row) => row.classList.toggle("is-selected", row.dataset.expressionId === id));
    }

    focus(id) {
      const field = this.fields.get(id);
      if (!field) return;
      this.setFocused(id);
      field.focus();
    }

    setLatex(id, latex) {
      const field = this.fields.get(id);
      if (field && field.latex() !== latex) field.latex(latex);
    }

    writeToActive(latex, keystroke = null) {
      const field = this.fields.get(this.activeId);
      if (!field) return false;
      if (keystroke) field.keystroke(keystroke);
      else field.write(latex);
      field.focus();
      return true;
    }

    emit(name, detail = {}) {
      this.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
    }

    escapeHtml(value) {
      return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]);
    }
  }

  class MathKeypad extends HTMLElement {
    connectedCallback() {
      const keys = [
        { latex: "x", label: "x" },
        { latex: "y", label: "y" },
        { latex: "z", label: "z" },
        { latex: "^2", label: "a^2" },
        { latex: "^", label: "a^b" },
        { latex: "\\sqrt{}", label: "\\sqrt{x}" },
        { latex: "7", label: "7" },
        { latex: "8", label: "8" },
        { latex: "9", label: "9" },
        { latex: "(", label: "(" },
        { latex: ")", label: ")" },
        { latex: "/", label: "\\frac{a}{b}" },
        { latex: "4", label: "4" },
        { latex: "5", label: "5" },
        { latex: "6", label: "6" },
        { latex: "\\sin(", label: "\\sin" },
        { latex: "\\cos(", label: "\\cos" },
        { latex: "*", label: "\\times", operation: true },
        { latex: "1", label: "1" },
        { latex: "2", label: "2" },
        { latex: "3", label: "3" },
        { latex: "\\pi", label: "\\pi" },
        { latex: "e", label: "e" },
        { latex: "-", label: "-", operation: true },
        { latex: "0", label: "0" },
        { latex: ".", label: "." },
        { latex: "=", label: "=" },
        { key: "Left", label: "\\leftarrow", operation: true },
        { key: "Backspace", label: "\\mathrm{del}", operation: true },
        { latex: "+", label: "+", operation: true },
      ];
      const grid = document.createElement("div");
      grid.className = "keypad-grid";
      keys.forEach((key) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `keypad-key${key.operation ? " is-operation" : ""}`;
        button.dataset.latex = key.latex || "";
        button.dataset.key = key.key || "";
        button.setAttribute("aria-label", key.latex || key.key);
        if (window.katex) window.katex.render(key.label, button, { throwOnError: false });
        else button.textContent = key.label;
        grid.append(button);
      });
      this.replaceChildren(grid);
      this.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        this.dispatchEvent(new CustomEvent("keypad-input", {
          bubbles: true,
          detail: { latex: button.dataset.latex, key: button.dataset.key },
        }));
      });
    }
  }

  class EquationPropertyEditor extends HTMLElement {
    connectedCallback() {
      if (this.field || this.input) return;
      const target = document.createElement("span");
      target.className = "property-math-input";
      this.append(target);
      const MQ = window.MathQuill && window.jQuery ? window.MathQuill.getInterface(2) : null;
      if (!MQ) {
        const input = document.createElement("input");
        input.className = "property-math-fallback";
        input.addEventListener("input", () => {
          if (!this.suppress) this.emitChange(input.value);
        });
        target.replaceWith(input);
        this.input = input;
        return;
      }
      this.field = MQ.MathField(target, {
        autoCommands: "pi theta sqrt sum prod alpha beta gamma delta lambda mu sigma phi",
        autoOperatorNames: "sin cos tan sec csc cot asin acos atan sinh cosh tanh log ln min max abs arg re im conj exp",
        charsThatBreakOutOfSupSub: "+-=<>",
        spaceBehavesLikeTab: true,
        handlers: {
          edit: (field) => {
            if (!this.suppress) this.emitChange(field.latex());
          },
        },
      });
    }

    setValue(latex, readOnly = false) {
      this.dataset.readOnly = String(readOnly);
      this.suppress = true;
      if (this.field && this.field.latex() !== latex) this.field.latex(latex);
      if (this.input) {
        this.input.value = latex;
        this.input.readOnly = readOnly;
      }
      this.suppress = false;
    }

    emitChange(latex) {
      if (this.dataset.readOnly === "true") return;
      this.dispatchEvent(new CustomEvent("property-equation-change", { bubbles: true, detail: { latex } }));
    }
  }

  class ViewCube extends HTMLElement {
    connectedCallback() {
      if (this.dataset.ready) return;
      this.dataset.ready = "true";
      this.setAttribute("aria-label", "Current graph orientation");
      this.innerHTML = `
        <div class="view-cube-stage">
          <div class="orientation-cube">
            <span class="cube-face cube-front cube-y-positive">Y</span>
            <span class="cube-face cube-back cube-y-negative">−Y</span>
            <span class="cube-face cube-right cube-x-positive">X</span>
            <span class="cube-face cube-left cube-x-negative">−X</span>
            <span class="cube-face cube-top cube-z-positive">Z</span>
            <span class="cube-face cube-bottom cube-z-negative">−Z</span>
          </div>
          <span class="cube-hit-grid" aria-label="Snap graph view">
            ${[-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x) => `<button type="button" data-cube-x="${x}" data-cube-y="${y}" aria-label="Snap to ${x && y ? "corner" : x || y ? "edge" : "face"} view"></button>`)).join("")}
          </span>
        </div>
      `;
      this.drag = null;
      const hitGrid = this.querySelector(".cube-hit-grid");
      hitGrid.addEventListener("pointerover", (event) => {
        const button = event.target.closest("[data-cube-x]");
        if (button) this.highlightZone(Number(button.dataset.cubeX), Number(button.dataset.cubeY));
      });
      hitGrid.addEventListener("pointerleave", () => this.clearHighlight());
      this.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        this.clearHighlight();
        this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, button: event.target.closest("[data-cube-x]") };
        this.setPointerCapture(event.pointerId);
        try { this.requestPointerLock?.(); } catch (error) { /* pointer capture remains active */ }
      });
      this.addEventListener("pointermove", (event) => {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        if (document.pointerLockElement === this) return;
        const dx = event.clientX - this.drag.x;
        const dy = event.clientY - this.drag.y;
        if (Math.hypot(dx, dy) > 2 && !this.drag.moved) {
          this.drag.moved = true;
        }
        if (!this.drag.moved) return;
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
        this.dispatchEvent(new CustomEvent("view-cube-orbit", { detail: { dx: -dx * 1.8, dy: -dy * 1.8 } }));
      });
      const finishDrag = (event) => {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        const moved = this.drag.moved;
        const button = this.drag.button;
        this.drag = null;
        if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
        if (document.pointerLockElement === this) document.exitPointerLock();
        if (moved) return;
        if (!button) return;
        this.dispatchEvent(new CustomEvent("view-cube-snap", {
          detail: { x: Number(button.dataset.cubeX), y: Number(button.dataset.cubeY), basis: this.basis },
        }));
      };
      this.addEventListener("pointerup", finishDrag);
      this.addEventListener("pointercancel", (event) => {
        if (this.drag?.pointerId !== event.pointerId) return;
        this.drag = null;
        if (document.pointerLockElement === this) document.exitPointerLock();
      });
      document.addEventListener("mousemove", (event) => {
        if (!this.drag || document.pointerLockElement !== this) return;
        this.drag.moved = true;
        this.dispatchEvent(new CustomEvent("view-cube-orbit", { detail: { dx: -(event.movementX || 0) * 1.8, dy: -(event.movementY || 0) * 1.8 } }));
      });
      document.addEventListener("mouseup", (event) => {
        if (!this.drag || document.pointerLockElement !== this || event.button !== 0) return;
        finishDrag({ pointerId: this.drag.pointerId });
      });
      this.setView("2d", null, {
        right: [1, 0, 0],
        up: [0, 1, 0],
        forward: [0, 0, -1],
      });
    }

    clearHighlight() {
      const cube = this.querySelector(".orientation-cube");
      if (cube) delete cube.dataset.hoverKind;
      this.querySelectorAll(".cube-face.is-hovered").forEach((face) => face.classList.remove("is-hovered"));
    }

    highlightZone(x, y) {
      this.clearHighlight();
      if (!this.basis) return;
      const [right, up, forward] = [this.basis.right, this.basis.up, this.basis.forward];
      const raw = [
        forward[0] + right[0] * x * 0.9 - up[0] * y * 0.9,
        forward[1] + right[1] * x * 0.9 - up[1] * y * 0.9,
        forward[2] + right[2] * x * 0.9 - up[2] * y * 0.9,
      ];
      const count = x && y ? 3 : x || y ? 2 : 1;
      const axes = [0, 1, 2].sort((a, b) => Math.abs(raw[b]) - Math.abs(raw[a])).slice(0, count);
      const classes = [
        ["cube-x-negative", "cube-x-positive"],
        ["cube-y-negative", "cube-y-positive"],
        ["cube-z-negative", "cube-z-positive"],
      ];
      axes.forEach((axis) => {
        const normalSign = raw[axis] >= 0 ? 0 : 1;
        this.querySelector(`.${classes[axis][normalSign]}`)?.classList.add("is-hovered");
      });
      this.querySelector(".orientation-cube").dataset.hoverKind = count === 1 ? "face" : count === 2 ? "edge" : "corner";
    }

    setView(mode, quaternion, basis) {
      this.dataset.mode = mode;
      this.basis = basis;
      const cube = this.querySelector(".orientation-cube");
      if (!cube) return;
      const right = basis?.right || [1, 0, 0];
      const up = basis?.up || [0, 1, 0];
      const forward = basis?.forward || [0, 0, -1];
      cube.style.transform = `matrix3d(${right[0]},${-up[0]},${-forward[0]},0,${-right[2]},${up[2]},${forward[2]},0,${right[1]},${-up[1]},${-forward[1]},0,0,0,0,1)`;
    }
  }

  customElements.define("expression-list", ExpressionList);
  customElements.define("math-keypad", MathKeypad);
  customElements.define("equation-property-editor", EquationPropertyEditor);
  customElements.define("view-cube", ViewCube);
}());
