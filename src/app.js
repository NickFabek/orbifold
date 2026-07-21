(function () {
  "use strict";

  const storageKey = "orbifold.graph.v1";
  const defaultLayerId = "layer-1";
  const palette = ["#c74440", "#2d70b3", "#388c46", "#6042a6", "#000000", "#fa7e19"];
  const panelNames = ["profile", "layers", "variables", "properties"];
  const panelDragStartDistance = 8;
  let nextId = 1;

  function createExpression(latex = "", layerId = defaultLayerId) {
    return {
      id: `expression-${nextId++}`,
      type: "expression",
      latex,
      color: palette[(nextId - 2) % palette.length],
      visible: true,
      compiled: null,
      error: "",
      value: null,
      showLabel: false,
      graphLabel: "",
      visualization: "domain-coloring",
      resolution: 72,
      iterations: 64,
      lineStyle: "solid",
      fillArea: false,
      layerId,
    };
  }

  function createNote(text = "", layerId = defaultLayerId) {
    return { id: `note-${nextId++}`, type: "note", text, layerId };
  }

  function createAnnotation(probe) {
    const annotationKind = probe.kind === "tangent" ? "tangent" : "point";
    const number = state.items.filter((item) => item.type === "annotation" && item.annotationKind === annotationKind).length + 1;
    const letter = annotationKind === "tangent" ? "T" : "P";
    const label = `${letter}${number}`;
    const mathLabel = `${letter}_{${number}}`;
    const point = { x: probe.point.x, y: probe.point.y, z: probe.point.z || 0 };
    const coordinates = [point.x, point.y, ...(Math.abs(point.z) > 1e-9 ? [point.z] : [])]
      .map((value) => formatValue(value));
    const latex = annotationKind === "point"
      ? `${mathLabel}=\\left(${coordinates.join(",")}\\right)`
      : `${mathLabel}:\\;${probe.equation || `\\operatorname{tangent}\\left(${coordinates.join(",")}\\right)`}`;
    return {
      id: `annotation-${nextId++}`,
      type: "annotation",
      annotationKind,
      sourceId: probe.expressionId,
      point,
      direction: probe.direction || null,
      color: probe.color || "#2d70b3",
      visible: true,
      label,
      graphLabel: label,
      latex,
      extent: annotationKind === "tangent" ? "line" : null,
      layerId: state.activeLayerId || defaultLayerId,
    };
  }

  function createShape(shape) {
    const number = state.items.filter((item) => item.type === "shape").length + 1;
    return {
      id: `shape-${nextId++}`,
      type: "shape",
      shapeKind: shape.shapeKind,
      points: shape.points,
      direction: shape.direction || null,
      center: shape.center || null,
      radius: shape.radius || null,
      extent: shape.extent || "segment",
      color: shape.color || palette[number % palette.length],
      visible: true,
      label: shape.label || `G${number}`,
      graphLabel: shape.graphLabel || "",
      showLabel: Boolean(shape.showLabel),
      constraints: shape.constraints || [],
      latex: shape.latex || shape.label || `G_{${number}}`,
      layerId: state.activeLayerId || defaultLayerId,
    };
  }

  function formatValue(value) {
    if (!Number.isFinite(value)) return "0";
    return Number(value.toPrecision(7)).toString();
  }

  const state = {
    mode: "2d",
    projection: "perspective",
    layers: [{ id: defaultLayerId, name: "Graph", visible: true, coordinateSystem: "cartesian", space: "r3", representation: "explicit" }],
    items: [
      createExpression("y=\\sin\\left(x\\right)"),
      createExpression("x^2+y^2=9"),
      createExpression("z=\\frac{\\sin\\left(2\\sqrt{x^2+y^2}\\right)}{1+0.18\\left(x^2+y^2\\right)}"),
    ],
    activeId: null,
    settings: { grid: true, axes: true, labels: true, dark: false, snapping: true, range: 50 },
    tool: "select",
    shapeKind: "segment-two-point",
    curveKind: "line",
    activeLayerId: defaultLayerId,
    selectedLayerId: null,
    selectedId: null,
    keypadOpen: false,
    dockedPanels: { profile: false, layers: false, variables: false, properties: false },
  };

  const shell = document.querySelector(".calculator-shell");
  const expressionList = document.querySelector("[data-expression-list]");
  const variableList = document.querySelector("[data-variable-list]");
  const layerList = document.querySelector("[data-layer-list]");
  const keypad = document.querySelector("math-keypad");
  const canvas = document.querySelector("#graph-canvas");
  const toolbar = document.querySelector(".floating-toolbar");
  const addMenu = document.querySelector("[data-add-menu]");
  const aboutDialog = document.querySelector("[data-about]");
  const legend = document.querySelector("[data-graph-legend]");
  const saveButton = document.querySelector("[data-action='save']");
  const viewCube = document.querySelector("view-cube");
  const graph = new window.OrbifoldGraphEngine(canvas);
  const panelDrags = new Map();
  const suppressedPanelClicks = new Set();
  const history = [];
  let historyIndex = -1;
  let historyTimer = null;
  let persistTimer = null;

  function serializableState() {
    return {
      version: 2,
      mode: state.mode,
      layers: state.layers.map((layer) => ({ ...layer })),
      activeLayerId: state.activeLayerId,
      items: state.items.map((item) => {
        if (item.type === "note") return { id: item.id, type: "note", text: item.text, layerId: item.layerId };
        if (item.type === "annotation") return {
          id: item.id,
          type: "annotation",
          annotationKind: item.annotationKind,
          sourceId: item.sourceId,
          point: item.point,
          direction: item.direction,
          color: item.color,
          visible: item.visible,
          label: item.label,
          graphLabel: item.graphLabel,
          latex: item.latex,
          extent: item.extent,
          layerId: item.layerId,
        };
        if (item.type === "shape") return { ...item };
        return {
          id: item.id,
          type: "expression",
          latex: item.latex,
          color: item.color,
          visible: item.visible,
          value: item.value,
          showLabel: item.showLabel,
          graphLabel: item.graphLabel,
          visualization: item.visualization,
          resolution: item.resolution,
          iterations: item.iterations,
          lineStyle: item.lineStyle,
          fillArea: item.fillArea,
        };
      }),
      settings: { ...state.settings },
      projection: state.projection,
      keypadOpen: state.keypadOpen,
      dockedPanels: { ...state.dockedPanels },
    };
  }

  function snapshot() {
    return JSON.stringify(serializableState());
  }

  function restoreSnapshot(serialized, renderLists = true) {
    const saved = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    state.mode = saved.mode === "3d" ? "3d" : "2d";
    state.projection = saved.projection === "orthographic" ? "orthographic" : "perspective";
    state.layers = Array.isArray(saved.layers) && saved.layers.length ? saved.layers.map((layer, index) => ({
      id: layer.id || `layer-${index + 1}`,
      name: layer.name || `Layer ${index + 1}`,
      visible: layer.visible !== false,
      coordinateSystem: ["cartesian", "cylindrical", "spherical", "toroidal"].includes(layer.coordinateSystem) ? layer.coordinateSystem : "cartesian",
      space: ["r3", "sphere", "hyperbolic", "torus"].includes(layer.space) ? layer.space : "r3",
      representation: layer.representation === "implicit" ? "implicit" : "explicit",
    })) : [{ id: defaultLayerId, name: "Graph", visible: true, coordinateSystem: "cartesian", space: "r3", representation: "explicit" }];
    state.activeLayerId = state.layers.some((layer) => layer.id === saved.activeLayerId) ? saved.activeLayerId : state.layers[0].id;
    state.selectedLayerId = null;
    state.items = Array.isArray(saved.items) ? saved.items.map((item) => {
      if (item.type === "note") return { ...item, id: item.id || `note-${nextId++}`, layerId: item.layerId || state.layers[0].id };
      if (item.type === "annotation") return {
        ...item,
        id: item.id || `annotation-${nextId++}`,
        visible: item.visible !== false,
        color: item.color || "#2d70b3",
        graphLabel: item.graphLabel || item.label || "",
        layerId: item.layerId || state.layers[0].id,
      };
      if (item.type === "shape") return {
        ...item,
        id: item.id || `shape-${nextId++}`,
        visible: item.visible !== false,
        color: item.color || "#6042a6",
        graphLabel: item.graphLabel || "",
        showLabel: Boolean(item.showLabel),
        constraints: item.constraints || [],
        layerId: item.layerId || state.layers[0].id,
      };
      return {
        ...item,
        id: item.id || `expression-${nextId++}`,
        visible: item.visible !== false,
        color: item.color || palette[(nextId++) % palette.length],
        showLabel: Boolean(item.showLabel),
        graphLabel: item.graphLabel || "",
        visualization: item.visualization || "domain-coloring",
        resolution: Math.min(160, Math.max(24, Number(item.resolution) || 72)),
        iterations: Math.min(256, Math.max(8, Number(item.iterations) || 64)),
        lineStyle: ["solid", "dashed", "dotted"].includes(item.lineStyle) ? item.lineStyle : "solid",
        fillArea: Boolean(item.fillArea),
        layerId: item.layerId || state.layers[0].id,
        compiled: null,
        error: "",
      };
    }) : state.items;
    state.settings = { ...state.settings, ...(saved.settings || {}) };
    if (!saved.version && state.settings.range === 20) state.settings.range = 50;
    state.keypadOpen = Boolean(saved.keypadOpen);
    state.dockedPanels = { ...state.dockedPanels, ...(saved.dockedPanels || {}) };
    delete state.dockedPanels.expressions;
    syncNextId();
    compileAll();
    applyState(renderLists);
  }

  function syncNextId() {
    const highest = state.items.reduce((value, item) => {
      const number = Number(item.id?.split("-").pop());
      return Number.isFinite(number) ? Math.max(value, number) : value;
    }, 0);
    nextId = Math.max(nextId, highest + 1);
  }

  function compileItem(item) {
    if (item.type !== "expression") return;
    item.error = "";
    item.compiled = null;
    if (!item.latex.trim()) return;
    try {
      item.compiled = window.OrbifoldMath.compileLatex(item.latex);
      if (item.compiled.kind === "value") {
        if (item.compiled.variables.has("z")) item.compiled.kind = "implicit-3d";
        else if (item.compiled.variables.has("x") && item.compiled.variables.has("y")) item.compiled.kind = "z-of-xy";
        else if (item.compiled.variables.has("x")) item.compiled.kind = "y-of-x";
      }
    } catch (error) {
      item.error = error.message || "This expression could not be read.";
    }
  }

  function compileAll() {
    state.items.forEach(compileItem);
    const constants = {};
    for (let pass = 0; pass < 4; pass += 1) {
      for (const item of state.items) {
        if (item.type !== "expression" || item.compiled?.kind !== "constant" || item.error) continue;
        try {
          const value = item.compiled.evaluate(constants);
          if (Number.isFinite(value)) {
            item.value = value;
            constants[item.compiled.name] = value;
          }
        } catch (error) {
          if (pass === 3) item.error = error.message;
        }
      }
    }
  }

  function graphExpressions() {
    return state.items
      .filter((item) => item.type === "expression")
      .map((item) => ({ ...item, layer: state.layers.find((layer) => layer.id === item.layerId) || state.layers[0] }));
  }

  function graphAnnotations() {
    return state.items
      .filter((item) => item.type === "annotation" || item.type === "shape")
      .map((item) => ({ ...item, layer: state.layers.find((layer) => layer.id === item.layerId) || state.layers[0] }));
  }

  function equationItems() {
    return state.items.filter((item) => item.type === "note" || item.compiled?.kind !== "constant");
  }

  function variableItems() {
    return state.items.filter((item) => item.type === "expression" && item.compiled?.kind === "constant");
  }

  function renderItemLists(focusId = null) {
    const equations = equationItems();
    const variables = variableItems();
    expressionList.setItems(equations, equations.some((item) => item.id === focusId) ? focusId : null);
    variableList.setItems(variables, variables.some((item) => item.id === focusId) ? focusId : null);
    expressionList.setSelected(state.selectedId);
    variableList.setSelected(state.selectedId);
    renderLayers();
  }

  function renderLayers() {
    if (!layerList) return;
    layerList.replaceChildren();
    for (const layer of state.layers) {
      const row = document.createElement("div");
      row.className = "layer-item";
      row.draggable = true;
      row.dataset.layerId = layer.id;
      row.setAttribute("aria-selected", String(layer.id === state.activeLayerId));
      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.className = "layer-visibility";
      visibility.dataset.layerVisibility = layer.id;
      visibility.title = layer.visible ? "Hide layer" : "Show layer";
      visibility.textContent = layer.visible ? "◉" : "○";
      const name = document.createElement("span");
      name.className = "layer-name";
      name.textContent = layer.name;
      const meta = document.createElement("span");
      meta.className = "layer-meta";
      const count = state.items.filter((item) => item.layerId === layer.id).length;
      meta.textContent = `${count} · ${layer.coordinateSystem} · ${layer.space === "r3" ? "ℝ³" : layer.space}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "layer-delete";
      remove.dataset.layerDelete = layer.id;
      remove.title = "Delete layer";
      remove.textContent = "×";
      remove.disabled = state.layers.length === 1;
      row.append(visibility, name, meta, remove);
      layerList.append(row);
    }
  }

  function updateItemRow(item) {
    expressionList.updateRow(item);
    variableList.updateRow(item);
  }

  function applyState(renderLists = true, focusId = null) {
    shell.dataset.mode = state.mode;
    shell.classList.toggle("is-dark", state.settings.dark);
    document.querySelector("[data-action='keypad']").setAttribute("aria-pressed", String(state.keypadOpen));
    keypad.hidden = !state.keypadOpen;

    document.querySelectorAll("[data-mode-button]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.modeButton === state.mode));
    });
    document.querySelectorAll("[data-projection-button]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.projectionButton === state.projection));
    });
    document.querySelectorAll("[data-setting]").forEach((input) => {
      const value = state.settings[input.dataset.setting];
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = String(value);
    });
    document.querySelector("[data-interaction-hint]").textContent = state.mode === "3d"
      ? "Trackpad: two fingers orbit, three-finger drag pans · Mouse: drag pans, Shift-drag orbits"
      : "Drag or use two fingers to pan · pinch or scroll to zoom";

    graph.setMode(state.mode);
    graph.setProjection(state.projection);
    Object.entries(state.settings).forEach(([name, value]) => graph.setSetting(name, value));
    graph.setLayers(state.layers);
    graph.setExpressions(graphExpressions());
    graph.setAnnotations(graphAnnotations());
    graph.setTool(state.tool, state.shapeKind, state.curveKind);
    const selection = selectedItem();
    graph.setSelectedExpression(selection?.id || null);
    if (renderLists) renderItemLists(focusId);
    else renderLayers();
    updateToolButtons();
    updatePropertiesPanel();
    applyDockedPanelState();
    updateLegend();
  }

  function selectedItem() {
    return state.items.find((item) => item.id === state.selectedId) || null;
  }

  function updateToolButtons() {
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.tool === state.tool));
    });
    canvas.dataset.tool = state.tool;
  }

  function updatePropertiesPanel() {
    const item = selectedItem();
    const layer = state.layers.find((candidate) => candidate.id === state.selectedLayerId) || null;
    const graphProperties = document.querySelector("[data-graph-properties]");
    const selectionProperties = document.querySelector("[data-selection-properties]");
    const layerProperties = document.querySelector("[data-layer-properties]");
    graphProperties.hidden = Boolean(item || layer);
    selectionProperties.hidden = !item;
    layerProperties.hidden = !layer;
    if (layer) {
      document.querySelector("[data-layer-name]").value = layer.name;
      document.querySelector("[data-layer-representation]").value = layer.representation;
      document.querySelectorAll("[data-coordinate-system]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.coordinateSystem === layer.coordinateSystem));
      });
      document.querySelectorAll("[data-layer-space]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.layerSpace === layer.space));
      });
      return;
    }
    if (!item) return;
    const equation = document.querySelector("[data-selected-equation]");
    equation.setValue(item.latex || item.label || "", item.type !== "expression");
    document.querySelector("[data-selection-title]").textContent = item.type === "expression" ? "Equation properties" : item.type === "shape" ? "Shape properties" : "Annotation properties";
    document.querySelector("[data-selected-color]").value = item.color || "#2d70b3";
    document.querySelector("[data-selected-visible]").checked = item.visible !== false;
    const labelRow = document.querySelector("[data-selected-label-row]");
    labelRow.hidden = item.type !== "expression" && item.type !== "shape";
    document.querySelector("[data-selected-label]").checked = Boolean(item.showLabel);
    const lineKinds = new Set(["y-of-x", "x-of-y", "implicit", "parametric-2d", "parametric-3d", "radial"]);
    const lineStyleRow = document.querySelector("[data-line-style-row]");
    lineStyleRow.hidden = item.type !== "expression" || !lineKinds.has(item.compiled?.kind);
    document.querySelector("[data-selected-line-style]").value = item.lineStyle || "solid";
    const fillAreaRow = document.querySelector("[data-fill-area-row]");
    fillAreaRow.hidden = item.type !== "expression" || !["y-of-x", "x-of-y"].includes(item.compiled?.kind);
    document.querySelector("[data-selected-fill-area]").checked = Boolean(item.fillArea);
    const complexRow = document.querySelector("[data-complex-visualization-row]");
    complexRow.hidden = !["complex", "recurrence-complex"].includes(item.compiled?.kind);
    document.querySelector("[data-complex-visualization]").value = item.visualization || "domain-coloring";
    const surfaceKinds = new Set(["complex", "recurrence-complex", "fractal-3d", "z-of-xy", "x-of-yz", "y-of-xz", "implicit-3d", "parametric-2d", "parametric-3d"]);
    const resolutionRow = document.querySelector("[data-resolution-row]");
    resolutionRow.hidden = item.type !== "expression" || !surfaceKinds.has(item.compiled?.kind);
    document.querySelector("[data-selected-resolution]").value = String(item.resolution || 72);
    const iterationsRow = document.querySelector("[data-iterations-row]");
    iterationsRow.hidden = !["recurrence-complex", "fractal-3d"].includes(item.compiled?.kind);
    document.querySelector("[data-selected-iterations]").value = String(item.iterations || 64);
    const extentRow = document.querySelector("[data-shape-extent-row]");
    const hasExtent = item.type === "shape" && ["line", "ray", "segment", "tangent", "secant"].includes(item.shapeKind)
      || item.type === "annotation" && item.annotationKind === "tangent";
    extentRow.hidden = !hasExtent;
    document.querySelector("[data-shape-extent]").value = item.extent || "line";
  }

  function selectItem(id, openProperties = false) {
    const item = state.items.find((candidate) => candidate.id === id && candidate.type !== "note") || null;
    state.selectedId = item?.id || null;
    state.selectedLayerId = null;
    expressionList.setSelected(state.selectedId);
    variableList.setSelected(state.selectedId);
    graph.setSelectedExpression(item?.id || null);
    updatePropertiesPanel();
    if (openProperties) setPanelOpen("properties", true);
  }

  function selectLayer(id, openProperties = false) {
    const layer = state.layers.find((candidate) => candidate.id === id);
    if (!layer) return;
    state.activeLayerId = layer.id;
    state.selectedLayerId = layer.id;
    state.selectedId = null;
    expressionList.setSelected(null);
    variableList.setSelected(null);
    graph.setSelectedExpression(null);
    renderLayers();
    updatePropertiesPanel();
    if (openProperties) setPanelOpen("properties", true);
  }

  function setTool(tool) {
    if (!new Set(["select", "point", "tangent", "shape", "curve"]).has(tool)) return;
    state.tool = tool;
    graph.setTool(tool, state.shapeKind, state.curveKind);
    updateToolButtons();
  }

  function commitProbe(probe) {
    const annotation = createAnnotation(probe);
    state.items.push(annotation);
    state.selectedId = annotation.id;
    expressionList.activeId = null;
    variableList.activeId = null;
    applyState(true);
    pushHistory();
    persist();
  }

  function commitShape(shape) {
    const item = createShape(shape);
    state.items.push(item);
    state.selectedId = item.id;
    state.tool = "select";
    applyState(true);
    pushHistory();
    persist();
  }

  function commitExpressionTemplate(template) {
    if (!template?.latex) return;
    const item = createExpression(template.latex, state.activeLayerId);
    state.items.push(item);
    state.selectedId = item.id;
    state.activeId = item.id;
    state.tool = "select";
    compileAll();
    applyState(true, item.id);
    pushHistory();
    persist();
  }

  function updateLegend() {
    if (!legend) return;
    const candidates = graphExpressions().filter((item) => item.visible && item.compiled && !item.error);
    const expression = state.mode === "3d"
      ? candidates.find((item) => item.compiled.kind === "z-of-xy") || candidates.find((item) => item.compiled.kind.includes("-of-"))
      : candidates.find((item) => item.compiled.kind !== "z-of-xy" && item.compiled.kind !== "constant");
    if (!expression) {
      legend.hidden = true;
      return;
    }
    legend.hidden = false;
    legend.replaceChildren();
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.setProperty("--legend-color", expression.color);
    const math = document.createElement("span");
    if (window.katex) window.katex.render(expression.latex, math, { throwOnError: false });
    else math.textContent = expression.latex;
    legend.append(swatch, math);
  }

  function persist() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      try { localStorage.setItem(storageKey, snapshot()); } catch (error) { /* file privacy mode */ }
    }, 180);
  }

  function pushHistory() {
    window.clearTimeout(historyTimer);
    const current = snapshot();
    if (history[historyIndex] === current) return;
    history.splice(historyIndex + 1);
    history.push(current);
    if (history.length > 80) history.shift();
    historyIndex = history.length - 1;
  }

  function scheduleHistory() {
    window.clearTimeout(historyTimer);
    historyTimer = window.setTimeout(pushHistory, 420);
    persist();
  }

  function flushHistory() {
    if (!historyTimer) return;
    window.clearTimeout(historyTimer);
    historyTimer = null;
    pushHistory();
  }

  function undo() {
    flushHistory();
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    restoreSnapshot(history[historyIndex]);
    persist();
  }

  function redo() {
    flushHistory();
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    restoreSnapshot(history[historyIndex]);
    persist();
  }

  function addItem(type, afterId = null) {
    const item = type === "note" ? createNote("", state.activeLayerId) : createExpression("", state.activeLayerId);
    const afterIndex = afterId ? state.items.findIndex((candidate) => candidate.id === afterId) : state.items.length - 1;
    state.items.splice(afterIndex + 1, 0, item);
    compileItem(item);
    state.activeId = item.id;
    applyState(true, item.id);
    setPanelOpen("variables", true);
    pushHistory();
    persist();
    return item;
  }

  function nextVariableName() {
    const used = new Set(variableItems().map((item) => item.compiled.name));
    return "abcdefghjklmnpqrstuvw".split("").find((name) => !used.has(name)) || `a${variableItems().length + 1}`;
  }

  function addVariable() {
    const item = createExpression(`${nextVariableName()}=1`, state.activeLayerId);
    state.items.push(item);
    compileAll();
    state.activeId = item.id;
    applyState(true, item.id);
    setPanelOpen("variables", true);
    pushHistory();
    persist();
  }

  function addLayer() {
    const nextNumber = state.layers.reduce((highest, layer) => Math.max(highest, Number(layer.id.split("-").pop()) || 0), 0) + 1;
    const layer = {
      id: `layer-${nextNumber}`,
      name: `Layer ${nextNumber}`,
      visible: true,
      coordinateSystem: "cartesian",
      space: "r3",
      representation: "explicit",
    };
    state.layers.push(layer);
    selectLayer(layer.id);
    graph.setLayers(state.layers);
    pushHistory();
    persist();
  }

  function deleteLayer(id) {
    if (state.layers.length <= 1) return;
    const index = state.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    const replacement = state.layers[index === 0 ? 1 : index - 1];
    state.items.forEach((item) => { if (item.layerId === id) item.layerId = replacement.id; });
    state.layers.splice(index, 1);
    state.activeLayerId = replacement.id;
    state.selectedLayerId = replacement.id;
    applyState(true);
    pushHistory();
    persist();
  }

  function updateSelectedLayer(changes) {
    const layer = state.layers.find((candidate) => candidate.id === state.selectedLayerId);
    if (!layer) return;
    Object.assign(layer, changes);
    graph.setLayers(state.layers);
    graph.setExpressions(graphExpressions());
    graph.setAnnotations(graphAnnotations());
    renderLayers();
    updatePropertiesPanel();
    pushHistory();
    persist();
  }

  function deleteItem(id) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    state.items.splice(index, 1);
    if (state.selectedId === id) state.selectedId = null;
    const focusItem = state.items[Math.min(index, state.items.length - 1)];
    state.activeId = focusItem?.id || null;
    compileAll();
    applyState(true, focusItem?.id);
    pushHistory();
    persist();
  }

  function handleExpressionChange({ id, latex }) {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item || item.type !== "expression") return;
    const wasVariable = item.compiled?.kind === "constant";
    item.latex = latex;
    item.value = null;
    compileAll();
    const isVariable = item.compiled?.kind === "constant";
    if (wasVariable !== isVariable) renderItemLists(id);
    else updateItemRow(item);
    graph.setExpressions(graphExpressions());
    updateLegend();
    if (state.selectedId === item.id) updatePropertiesPanel();
    scheduleHistory();
  }

  function handleSlider({ id, value }, commit = false) {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item || item.compiled?.kind !== "constant") return;
    const rounded = Number(value.toFixed(4));
    item.latex = `${item.compiled.name}=${rounded}`;
    item.value = rounded;
    compileAll();
    variableList.setLatex(id, item.latex);
    updateItemRow(item);
    graph.setExpressions(graphExpressions());
    updateLegend();
    if (commit) pushHistory();
    persist();
  }

  function panelElements(name) {
    return {
      panel: document.querySelector(`[data-panel="${name}"]`),
      toggle: document.querySelector(`[data-panel-toggle="${name}"]`),
    };
  }

  function positionPanel(name) {
    const { panel, toggle } = panelElements(name);
    if (!panel || !toggle || panel.dataset.docked === "true") return;
    const buttonBox = toggle.getBoundingClientRect();
    const toolbarBox = toolbar.getBoundingClientRect();
    const margin = window.innerWidth <= 720 ? 12 : 16;
    const fallbackWidths = { profile: 320, layers: 340, variables: 760, properties: 360 };
    const width = Math.min(panel.offsetWidth || fallbackWidths[name], window.innerWidth - margin * 2);
    const anchor = buttonBox.left + buttonBox.width / 2;
    const center = Math.min(window.innerWidth - width / 2 - margin, Math.max(width / 2 + margin, anchor));
    panel.style.right = "auto";
    panel.style.left = `${center}px`;
    panel.style.bottom = `${window.innerHeight - toolbarBox.top + 10}px`;
  }

  function setPanelOpen(name, open) {
    const { panel, toggle } = panelElements(name);
    if (!panel || !toggle) return;
    if (panel.dataset.docked === "true") open = true;
    if (open) {
      for (const otherName of panelNames) {
        if (otherName === name) continue;
        const other = panelElements(otherName);
        if (other.panel?.dataset.docked !== "true") {
          other.panel.dataset.open = "false";
          other.toggle?.setAttribute("aria-expanded", "false");
          other.toggle?.setAttribute("aria-pressed", "false");
        }
      }
    }
    panel.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-pressed", String(open));
    if (open && panel.dataset.docked !== "true") {
      positionPanel(name);
      requestAnimationFrame(() => positionPanel(name));
    }
  }

  function setPanelDocked(name, docked, options = {}) {
    const { panel, toggle } = panelElements(name);
    if (!panel || !toggle) return;
    const mutate = () => {
      if (docked && (name === "layers" || name === "variables")) {
        const otherName = name === "layers" ? "variables" : "layers";
        if (state.dockedPanels[otherName]) setPanelDocked(otherName, false, { immediate: true });
      }
      panel.dataset.docked = String(docked);
      panel.dataset.open = String(docked);
      panel.dataset.dockSide = name === "properties" ? "right" : "left";
      panel.style.bottom = "";
      panel.style.right = "";
      panel.style.left = "";
      toggle.dataset.docked = String(docked);
      toggle.setAttribute("aria-expanded", String(docked));
      toggle.setAttribute("aria-pressed", String(docked));
      state.dockedPanels[name] = docked;
      updateDockedPanelLayout();
    };
    if (options.immediate || !document.startViewTransition) {
      mutate();
    } else {
      const transitionName = `orbifold-${name}-panel`;
      const from = docked ? toggle : panel;
      const to = docked ? panel : toggle;
      from.style.viewTransitionName = transitionName;
      const transition = document.startViewTransition(() => {
        from.style.viewTransitionName = "";
        to.style.viewTransitionName = transitionName;
        mutate();
      });
      transition.finished.finally(() => {
        from.style.viewTransitionName = "";
        to.style.viewTransitionName = "";
      });
    }
    if (!docked) positionPanel(name);
    persist();
  }

  function updateDockedPanelLayout() {
    let leftTop = 16;
    for (const name of ["profile", "layers", "variables"]) {
      const { panel } = panelElements(name);
      if (!panel || panel.dataset.docked !== "true") continue;
      panel.style.setProperty("--panel-docked-top", `${leftTop}px`);
      const height = panel.getBoundingClientRect().height;
      leftTop += Math.max(0, height) + 8;
    }
    const properties = panelElements("properties").panel;
    if (properties?.dataset.docked === "true") properties.style.setProperty("--panel-docked-top", "16px");
  }

  function applyDockedPanelState() {
    for (const name of panelNames) {
      const { panel, toggle } = panelElements(name);
      const docked = Boolean(state.dockedPanels[name]);
      panel.dataset.docked = String(docked);
      panel.dataset.dockSide = name === "properties" ? "right" : "left";
      if (docked) {
        panel.dataset.open = "true";
        panel.style.bottom = "";
        panel.style.right = "";
        panel.style.left = "";
      }
      toggle.dataset.docked = String(docked);
      toggle.setAttribute("aria-expanded", String(docked || panel.dataset.open === "true"));
      toggle.setAttribute("aria-pressed", String(docked || panel.dataset.open === "true"));
    }
    requestAnimationFrame(updateDockedPanelLayout);
  }

  function finishPanelDrag(element, name, pointerId) {
    const drag = panelDrags.get(name);
    if (!drag || drag.pointerId !== pointerId) return;
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    element.style.transform = "";
  }

  function installPanelDrag(name) {
    const { panel, toggle } = panelElements(name);
    if (!panel || !toggle) return;

    toggle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || panel.dataset.docked === "true") return;
      panelDrags.set(name, {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        box: toggle.getBoundingClientRect(),
        moved: false,
      });
      toggle.setPointerCapture?.(event.pointerId);
    });
    toggle.addEventListener("pointermove", (event) => {
      const drag = panelDrags.get(name);
      if (!drag || drag.pointerId !== event.pointerId) return;
      const offsetX = event.clientX - drag.startX;
      const offsetY = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(offsetX, offsetY) < panelDragStartDistance) return;
      drag.moved = true;
      toggle.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
      const toolbarBox = toolbar.getBoundingClientRect();
      const centerX = drag.box.left + drag.box.width / 2 + offsetX;
      const centerY = drag.box.top + drag.box.height / 2 + offsetY;
      if (centerX < toolbarBox.left || centerX > toolbarBox.right || centerY < toolbarBox.top || centerY > toolbarBox.bottom) {
        finishPanelDrag(toggle, name, event.pointerId);
        panelDrags.delete(name);
        suppressedPanelClicks.add(name);
        setPanelDocked(name, true);
        setTimeout(() => suppressedPanelClicks.delete(name), 0);
      }
    });
    const finishToggleDrag = (event) => {
      const drag = panelDrags.get(name);
      finishPanelDrag(toggle, name, event.pointerId);
      if (drag?.moved) {
        suppressedPanelClicks.add(name);
        setTimeout(() => suppressedPanelClicks.delete(name), 0);
      }
      panelDrags.delete(name);
    };
    toggle.addEventListener("pointerup", finishToggleDrag);
    toggle.addEventListener("pointercancel", finishToggleDrag);
    toggle.addEventListener("click", () => {
      if (suppressedPanelClicks.has(name)) return;
      setPanelOpen(name, panel.dataset.open !== "true");
    });

    panel.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || panel.dataset.docked !== "true" || !event.target.closest("[data-panel-drag-handle]")) return;
      panelDrags.set(name, { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false });
      panel.setPointerCapture?.(event.pointerId);
    });
    panel.addEventListener("pointermove", (event) => {
      const drag = panelDrags.get(name);
      if (!drag || drag.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.moved && distance < panelDragStartDistance) return;
      drag.moved = true;
      finishPanelDrag(panel, name, event.pointerId);
      panelDrags.delete(name);
      setPanelDocked(name, false);
    });
    const finishPanel = (event) => {
      finishPanelDrag(panel, name, event.pointerId);
      panelDrags.delete(name);
    };
    panel.addEventListener("pointerup", finishPanel);
    panel.addEventListener("pointercancel", finishPanel);
  }

  function loadSavedGraph() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        restoreSnapshot(saved, false);
        return;
      }
    } catch (error) { /* file origin storage can be unavailable */ }
    compileAll();
  }

  panelNames.forEach(installPanelDrag);
  layerList.addEventListener("click", (event) => {
    const visibilityId = event.target.closest("[data-layer-visibility]")?.dataset.layerVisibility;
    if (visibilityId) {
      const layer = state.layers.find((candidate) => candidate.id === visibilityId);
      if (layer) {
        selectLayer(visibilityId);
        updateSelectedLayer({ visible: !layer.visible });
      }
      return;
    }
    const deleteId = event.target.closest("[data-layer-delete]")?.dataset.layerDelete;
    if (deleteId) {
      deleteLayer(deleteId);
      return;
    }
    const id = event.target.closest("[data-layer-id]")?.dataset.layerId;
    if (id) selectLayer(id);
  });
  let draggedLayerId = null;
  layerList.addEventListener("dragstart", (event) => {
    draggedLayerId = event.target.closest("[data-layer-id]")?.dataset.layerId || null;
    if (draggedLayerId) event.dataTransfer.effectAllowed = "move";
  });
  layerList.addEventListener("dragover", (event) => {
    const row = event.target.closest("[data-layer-id]");
    if (!row || row.dataset.layerId === draggedLayerId) return;
    event.preventDefault();
    layerList.querySelectorAll("[data-drop-before], [data-drop-after]").forEach((item) => {
      delete item.dataset.dropBefore;
      delete item.dataset.dropAfter;
    });
    const before = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
    row.dataset[before ? "dropBefore" : "dropAfter"] = "true";
  });
  layerList.addEventListener("drop", (event) => {
    const targetId = event.target.closest("[data-layer-id]")?.dataset.layerId;
    if (!draggedLayerId || !targetId || draggedLayerId === targetId) return;
    event.preventDefault();
    const sourceIndex = state.layers.findIndex((layer) => layer.id === draggedLayerId);
    let targetIndex = state.layers.findIndex((layer) => layer.id === targetId);
    const after = Boolean(event.target.closest("[data-layer-id]")?.dataset.dropAfter);
    const [layer] = state.layers.splice(sourceIndex, 1);
    if (sourceIndex < targetIndex) targetIndex -= 1;
    state.layers.splice(targetIndex + (after ? 1 : 0), 0, layer);
    draggedLayerId = null;
    applyState(false);
    pushHistory();
    persist();
  });
  layerList.addEventListener("dragend", () => {
    draggedLayerId = null;
    renderLayers();
  });
  window.addEventListener("pointerdown", (event) => {
    for (const name of panelNames) {
      const { panel, toggle } = panelElements(name);
      if (panel.dataset.open !== "true" || panel.dataset.docked === "true") continue;
      if (!panel.contains(event.target) && !toggle.contains(event.target)) setPanelOpen(name, false);
    }
  }, { capture: true });
  window.addEventListener("resize", () => {
    for (const name of panelNames) positionPanel(name);
    updateDockedPanelLayout();
  });

  document.addEventListener("expression-change", (event) => handleExpressionChange(event.detail));
  document.addEventListener("expression-delete", (event) => deleteItem(event.detail.id));
  document.addEventListener("expression-visibility", (event) => {
    const item = state.items.find((candidate) => candidate.id === event.detail.id);
    if (!item || item.type === "note") return;
    item.visible = !item.visible;
    updateItemRow(item);
    graph.setExpressions(graphExpressions());
    graph.setAnnotations(graphAnnotations());
    updateLegend();
    if (state.selectedId === item.id) updatePropertiesPanel();
    pushHistory();
    persist();
  });
  document.addEventListener("expression-focus", (event) => {
    state.activeId = event.detail.id;
    selectItem(event.detail.id);
    if (event.target === expressionList) variableList.activeId = null;
    if (event.target === variableList) expressionList.activeId = null;
  });
  document.addEventListener("add-after", (event) => addItem("expression", event.detail.id));
  document.addEventListener("empty-add", () => addItem("expression"));
  document.addEventListener("empty-add-variable", addVariable);
  document.addEventListener("note-change", (event) => {
    const item = state.items.find((candidate) => candidate.id === event.detail.id);
    if (item?.type === "note") {
      item.text = event.detail.text;
      scheduleHistory();
    }
  });
  document.addEventListener("slider-change", (event) => handleSlider(event.detail));
  document.addEventListener("slider-commit", (event) => handleSlider(event.detail, true));
  document.addEventListener("property-equation-change", (event) => {
    const item = selectedItem();
    if (!item || item.type !== "expression") return;
    handleExpressionChange({ id: item.id, latex: event.detail.latex });
    expressionList.setLatex(item.id, event.detail.latex);
    variableList.setLatex(item.id, event.detail.latex);
  });
  document.addEventListener("keypad-input", (event) => {
    const wrote = expressionList.writeToActive(event.detail.latex, event.detail.key)
      || variableList.writeToActive(event.detail.latex, event.detail.key);
    if (!wrote) {
      const item = addItem("expression");
      requestAnimationFrame(() => expressionList.writeToActive(event.detail.latex, event.detail.key));
      state.activeId = item.id;
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-add-variable]")) {
      addVariable();
      return;
    }
    if (event.target.closest("[data-layer-action='add']")) {
      addLayer();
      return;
    }
    const preset = event.target.closest("[data-expression-preset]")?.dataset.expressionPreset;
    if (preset) {
      const latex = preset === "mandelbulb" ? "mandelbulb(8)" : "z_{n+1}=z_n^2+c";
      const item = addItem("expression");
      handleExpressionChange({ id: item.id, latex });
      expressionList.setLatex(item.id, latex);
      addMenu.hidden = true;
      document.querySelector("[data-action='add']").setAttribute("aria-expanded", "false");
      return;
    }
    const add = event.target.closest("[data-add]")?.dataset.add;
    if (add) {
      addMenu.hidden = true;
      document.querySelector("[data-action='add']").setAttribute("aria-expanded", "false");
      addItem(add);
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) {
      if (!event.target.closest("[data-add-menu]")) {
        addMenu.hidden = true;
        document.querySelector("[data-action='add']").setAttribute("aria-expanded", "false");
      }
      return;
    }
    if (action === "menu") aboutDialog.showModal();
    if (action === "close-about" && aboutDialog.open) aboutDialog.close();
    if (action === "clear-selection") selectItem(null);
    if (action === "clear-layer-selection") {
      state.selectedLayerId = null;
      updatePropertiesPanel();
    }
    if (action === "new-graph") {
      state.layers = [{ id: defaultLayerId, name: "Graph", visible: true, coordinateSystem: "cartesian", space: "r3", representation: "explicit" }];
      state.activeLayerId = defaultLayerId;
      state.selectedLayerId = null;
      state.items = [createExpression("", defaultLayerId)];
      state.activeId = state.items[0].id;
      state.selectedId = null;
      graph.resetView();
      if (aboutDialog.open) aboutDialog.close();
      compileAll();
      applyState(true, state.activeId);
      setPanelOpen("variables", true);
      pushHistory();
      persist();
    }
    if (action === "save") {
      try { localStorage.setItem(storageKey, snapshot()); } catch (error) { /* graph remains in memory */ }
      saveButton.textContent = "Saved";
      setTimeout(() => { saveButton.textContent = "Save"; }, 1100);
    }
    if (action === "add") {
      addMenu.hidden = !addMenu.hidden;
      event.target.setAttribute("aria-expanded", String(!addMenu.hidden));
    }
    if (action === "undo") undo();
    if (action === "redo") redo();
    if (action === "keypad") {
      state.keypadOpen = !state.keypadOpen;
      applyState(false);
      persist();
    }
    if (action === "zoom-in") graph.zoom(1);
    if (action === "zoom-out") graph.zoom(-1);
    if (action === "home") graph.resetView();
  });

  document.querySelectorAll("[data-mode-button]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.modeButton;
      applyState(false);
      pushHistory();
      persist();
    });
  });
  document.querySelectorAll("[data-projection-button]").forEach((button) => {
    button.addEventListener("click", () => {
      state.projection = button.dataset.projectionButton;
      applyState(false);
      pushHistory();
      persist();
    });
  });
  document.querySelectorAll("[data-setting]").forEach((input) => {
    input.addEventListener("change", () => {
      const name = input.dataset.setting;
      state.settings[name] = input.type === "checkbox"
        ? input.checked
        : Math.min(200, Math.max(5, Number(input.value) || 50));
      applyState(false);
      pushHistory();
      persist();
    });
  });
  document.querySelector("[data-layer-name]").addEventListener("change", (event) => {
    updateSelectedLayer({ name: event.target.value.trim() || "Layer" });
  });
  document.querySelectorAll("[data-coordinate-system]").forEach((button) => {
    button.addEventListener("click", () => updateSelectedLayer({ coordinateSystem: button.dataset.coordinateSystem }));
  });
  document.querySelectorAll("[data-layer-space]").forEach((button) => {
    button.addEventListener("click", () => updateSelectedLayer({ space: button.dataset.layerSpace }));
  });
  document.querySelector("[data-layer-representation]").addEventListener("change", (event) => {
    updateSelectedLayer({ representation: event.target.value });
  });
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });
  document.querySelectorAll("[data-shape-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      state.shapeKind = button.dataset.shapeKind;
      setTool("shape");
      document.querySelectorAll("[data-shape-kind]").forEach((option) => option.classList.toggle("is-active", option === button));
    });
  });
  document.querySelectorAll("[data-curve-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      state.curveKind = button.dataset.curveKind;
      setTool("curve");
      document.querySelectorAll("[data-curve-kind]").forEach((option) => option.classList.toggle("is-active", option === button));
    });
  });
  document.querySelector("[data-selected-color]").addEventListener("input", (event) => {
    const item = selectedItem();
    if (!item) return;
    item.color = event.target.value;
    updateItemRow(item);
    graph.setExpressions(graphExpressions());
    graph.setAnnotations(graphAnnotations());
    updateLegend();
    persist();
  });
  document.querySelector("[data-selected-color]").addEventListener("change", pushHistory);
  document.querySelector("[data-selected-visible]").addEventListener("change", (event) => {
    const item = selectedItem();
    if (!item) return;
    item.visible = event.target.checked;
    updateItemRow(item);
    graph.setExpressions(graphExpressions());
    graph.setAnnotations(graphAnnotations());
    updateLegend();
    pushHistory();
    persist();
  });
  document.querySelector("[data-selected-label]").addEventListener("change", (event) => {
    const item = selectedItem();
    if (!item || (item.type !== "expression" && item.type !== "shape")) return;
    item.showLabel = event.target.checked;
    graph.setExpressions(graphExpressions());
    graph.setAnnotations(graphAnnotations());
    pushHistory();
    persist();
  });
  document.querySelector("[data-selected-line-style]").addEventListener("change", (event) => {
    const item = selectedItem();
    if (!item || item.type !== "expression") return;
    item.lineStyle = event.target.value;
    graph.setExpressions(graphExpressions());
    pushHistory();
    persist();
  });
  document.querySelector("[data-selected-fill-area]").addEventListener("change", (event) => {
    const item = selectedItem();
    if (!item || item.type !== "expression") return;
    item.fillArea = event.target.checked;
    graph.setExpressions(graphExpressions());
    pushHistory();
    persist();
  });
  document.querySelector("[data-complex-visualization]").addEventListener("change", (event) => {
    const item = selectedItem();
    if (!item || !["complex", "recurrence-complex"].includes(item.compiled?.kind)) return;
    item.visualization = event.target.value;
    graph.setExpressions(graphExpressions());
    pushHistory();
    persist();
  });
  document.querySelector("[data-selected-resolution]").addEventListener("change", (event) => {
    const item = selectedItem();
    if (!item || item.type !== "expression") return;
    item.resolution = Math.min(160, Math.max(24, Number(event.target.value) || 72));
    event.target.value = String(item.resolution);
    graph.setExpressions(graphExpressions());
    pushHistory();
    persist();
  });
  document.querySelector("[data-selected-iterations]").addEventListener("change", (event) => {
    const item = selectedItem();
    if (!item || item.type !== "expression") return;
    item.iterations = Math.min(256, Math.max(8, Number(event.target.value) || 64));
    event.target.value = String(item.iterations);
    graph.setExpressions(graphExpressions());
    pushHistory();
    persist();
  });
  document.querySelector("[data-shape-extent]").addEventListener("change", (event) => {
    const item = selectedItem();
    if (!item || (item.type !== "shape" && item.annotationKind !== "tangent")) return;
    item.extent = event.target.value;
    graph.setAnnotations(graphAnnotations());
    updateItemRow(item);
    pushHistory();
    persist();
  });
  canvas.addEventListener("graph-view-change", (event) => viewCube.setView(
    event.detail.mode,
    event.detail.orientation,
    event.detail.basis,
  ));
  canvas.addEventListener("graph-expression-select", (event) => selectItem(event.detail.id));
  canvas.addEventListener("graph-probe-commit", (event) => commitProbe(event.detail));
  canvas.addEventListener("graph-shape-commit", (event) => commitShape(event.detail));
  canvas.addEventListener("graph-expression-template", (event) => commitExpressionTemplate(event.detail));
  canvas.addEventListener("graph-label-change", (event) => {
    const item = state.items.find((candidate) => candidate.id === event.detail.id);
    if (!item) return;
    item.graphLabel = event.detail.label.trim();
    if (item.type !== "expression") item.label = item.graphLabel || item.label;
    graph.setExpressions(graphExpressions());
    graph.setAnnotations(graphAnnotations());
    if (item.type !== "expression") renderItemLists();
    pushHistory();
    persist();
  });
  viewCube.addEventListener("view-cube-orbit", (event) => graph.orbitBy(event.detail.dx, event.detail.dy));
  viewCube.addEventListener("view-cube-snap", (event) => graph.snapView(event.detail));

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveButton.click();
    }
    const editingText = Boolean(event.target.closest("input, textarea, .mq-editable-field, [contenteditable='true']"));
    if ((event.key === "Backspace" || event.key === "Delete") && state.selectedId && !editingText) {
      event.preventDefault();
      deleteItem(state.selectedId);
      return;
    }
    const toolShortcut = { v: "select", p: "point", t: "tangent", g: "shape", f: "curve" }[event.key.toLowerCase()];
    if (toolShortcut && !event.metaKey && !event.ctrlKey && !event.altKey && !editingText) {
      setTool(toolShortcut);
      document.querySelector(`[data-tool='${toolShortcut}']`).focus();
    }
    if (event.key === "Escape") {
      addMenu.hidden = true;
      for (const name of panelNames) {
        if (panelElements(name).panel.dataset.docked !== "true") setPanelOpen(name, false);
      }
      if (aboutDialog.open) aboutDialog.close();
    }
  });

  loadSavedGraph();
  applyState(true);
  history.push(snapshot());
  historyIndex = 0;
}());
