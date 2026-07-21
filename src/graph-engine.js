(function () {
  "use strict";

  const vertexShader = `
    struct VertexInput {
      @location(0) position: vec2<f32>,
      @location(1) color: vec4<f32>,
    };

    struct VertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) color: vec4<f32>,
    };

    @vertex
    fn vertex_main(input: VertexInput) -> VertexOutput {
      var output: VertexOutput;
      output.position = vec4<f32>(input.position, 0.0, 1.0);
      output.color = input.color;
      return output;
    }

    @fragment
    fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
      return input.color;
    }
  `;

  const gridShader = `
    struct GridUniforms {
      viewport_mode_dark: vec4<f32>,
      view_center_scale_focal: vec4<f32>,
      camera_position_major: vec4<f32>,
      camera_right_minor: vec4<f32>,
      camera_up_micro: vec4<f32>,
      camera_forward_minor_alpha: vec4<f32>,
      settings: vec4<f32>,
    };

    @group(0) @binding(0) var<uniform> uniforms: GridUniforms;

    struct GridVertexOutput {
      @builtin(position) position: vec4<f32>,
      @location(0) screen: vec2<f32>,
    };

    struct PlanePoint {
      world: vec2<f32>,
      horizon: f32,
      valid: f32,
    };

    @vertex
    fn grid_vertex(@builtin(vertex_index) index: u32) -> GridVertexOutput {
      let points = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
      );
      let clip = points[index];
      let viewport = uniforms.viewport_mode_dark.xy;
      var output: GridVertexOutput;
      output.position = vec4<f32>(clip, 0.0, 1.0);
      output.screen = vec2<f32>(
        (clip.x + 1.0) * 0.5 * viewport.x,
        (1.0 - clip.y) * 0.5 * viewport.y
      );
      return output;
    }

    fn plane_point(screen: vec2<f32>) -> PlanePoint {
      let viewport = uniforms.viewport_mode_dark.xy;
      if (uniforms.viewport_mode_dark.z < 0.5) {
        let center = uniforms.view_center_scale_focal.xy;
        let scale = uniforms.view_center_scale_focal.z;
        return PlanePoint(vec2<f32>(
          center.x + (screen.x - viewport.x * 0.5) / scale,
          center.y - (screen.y - viewport.y * 0.5) / scale
        ), 1.0, 1.0);
      }

      let focal = uniforms.view_center_scale_focal.w;
      let orthographic = uniforms.viewport_mode_dark.z > 1.5;
      let scale = focal / max(uniforms.view_center_scale_focal.y, 0.001);
      let camera_x = select((screen.x - viewport.x * 0.5) / focal, (screen.x - viewport.x * 0.5) / scale, orthographic);
      let camera_y = select(-(screen.y - viewport.y * 0.5) / focal, -(screen.y - viewport.y * 0.5) / scale, orthographic);
      var ray_origin = uniforms.camera_position_major.xyz;
      if (orthographic) {
        ray_origin += uniforms.camera_right_minor.xyz * camera_x + uniforms.camera_up_micro.xyz * camera_y;
      }
      var ray = normalize(
        uniforms.camera_right_minor.xyz * camera_x +
        uniforms.camera_up_micro.xyz * camera_y +
        uniforms.camera_forward_minor_alpha.xyz
      );
      if (orthographic) { ray = uniforms.camera_forward_minor_alpha.xyz; }
      let horizon = abs(ray.z);
      let safe_z = select(select(-0.00001, 0.00001, ray.z >= 0.0), ray.z, horizon > 0.00001);
      let distance = -ray_origin.z / safe_z;
      let valid = select(0.0, 1.0, horizon > 0.00001 && distance > 0.0);
      let world = ray_origin + ray * distance;
      return PlanePoint(world.xy, horizon, valid);
    }

    fn line_alpha(coordinate: f32, step: f32) -> f32 {
      let cell = coordinate / step;
      let distance_to_line = abs(fract(cell + 0.5) - 0.5);
      let width = max(fwidth(cell), 0.00001);
      return 1.0 - smoothstep(0.35 * width, 1.25 * width, distance_to_line);
    }

    fn grid_level(world: vec2<f32>, step: f32) -> f32 {
      return max(line_alpha(world.x, step), line_alpha(world.y, step));
    }

    @fragment
    fn grid_fragment(input: GridVertexOutput) -> @location(0) vec4<f32> {
      let point = plane_point(input.screen);
      if (point.valid < 0.5) { discard; }
      let world = point.world;
      let show_grid = uniforms.settings.y;
      let show_axes = uniforms.settings.z;
      let dark = uniforms.viewport_mode_dark.w;
      let major_step = uniforms.camera_position_major.w;
      let minor_step = uniforms.camera_right_minor.w;
      let micro_step = uniforms.camera_up_micro.w;
      let minor_alpha = uniforms.camera_forward_minor_alpha.w;
      let micro_alpha = uniforms.settings.x;
      let major_alpha = uniforms.settings.w;

      let major = grid_level(world, major_step);
      let minor = grid_level(world, minor_step) * (1.0 - major);
      let micro = grid_level(world, micro_step) * (1.0 - max(major, minor));
      var opacity = show_grid * (
        major * major_alpha +
        minor * 0.13 * minor_alpha +
        micro * 0.075 * micro_alpha
      );

      let derivative_x = max(fwidth(world.x), 0.00001);
      let derivative_y = max(fwidth(world.y), 0.00001);
      let y_axis = (1.0 - smoothstep(0.45 * derivative_x, 1.35 * derivative_x, abs(world.x))) * show_axes;
      let x_axis = (1.0 - smoothstep(0.45 * derivative_y, 1.35 * derivative_y, abs(world.y))) * show_axes;
      let axis = max(x_axis, y_axis);
      let horizon_fade = select(1.0, smoothstep(0.0015, 0.025, point.horizon), uniforms.viewport_mode_dark.z > 0.5);
      opacity *= horizon_fade;

      if (axis > 0.001) {
        let x_color = vec3<f32>(0.78, 0.267, 0.251);
        let y_color = vec3<f32>(0.22, 0.55, 0.275);
        let axis_color = mix(y_color, x_color, step(y_axis, x_axis));
        return vec4<f32>(axis_color, axis * 0.92 * horizon_fade);
      }

      opacity = max(opacity, axis * 0.34 * horizon_fade);
      let line_color = mix(vec3<f32>(0.1), vec3<f32>(0.9), dark);
      return vec4<f32>(line_color, clamp(opacity, 0.0, 0.7));
    }
  `;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function dot3(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  function cross3(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  function normalize3(vector) {
    const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  }

  function normalizeQuat(quaternion) {
    const length = Math.hypot(...quaternion) || 1;
    return quaternion.map((value) => value / length);
  }

  function quatMultiply(a, b) {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  }

  function quatFromAxisAngle(axis, angle) {
    const normal = normalize3(axis);
    const halfAngle = angle * 0.5;
    const scale = Math.sin(halfAngle);
    return [normal.x * scale, normal.y * scale, normal.z * scale, Math.cos(halfAngle)];
  }

  function rotateVectorRawByQuat(vector, quaternion) {
    const [qx, qy, qz, qw] = quaternion;
    const tx = 2 * (qy * vector.z - qz * vector.y);
    const ty = 2 * (qz * vector.x - qx * vector.z);
    const tz = 2 * (qx * vector.y - qy * vector.x);
    return {
      x: vector.x + qw * tx + qy * tz - qz * ty,
      y: vector.y + qw * ty + qz * tx - qx * tz,
      z: vector.z + qw * tz + qx * ty - qy * tx,
    };
  }

  function rotateVectorByQuat(vector, quaternion) {
    return normalize3(rotateVectorRawByQuat(vector, quaternion));
  }

  function rotationFromOrbitDelta(startOrientation, deltaX, deltaY, sensitivity) {
    const yaw = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, -deltaX * sensitivity);
    const afterYaw = normalizeQuat(quatMultiply(yaw, startOrientation));
    const right = rotateVectorByQuat({ x: 1, y: 0, z: 0 }, afterYaw);
    const pitch = quatFromAxisAngle(right, -deltaY * sensitivity);
    return normalizeQuat(quatMultiply(pitch, yaw));
  }

  function quaternionFromCameraBasis(right, up, forward) {
    const m00 = right.x;
    const m01 = up.x;
    const m02 = -forward.x;
    const m10 = right.y;
    const m11 = up.y;
    const m12 = -forward.y;
    const m20 = right.z;
    const m21 = up.z;
    const m22 = -forward.z;
    const trace = m00 + m11 + m22;
    let quaternion;
    if (trace > 0) {
      const scale = Math.sqrt(trace + 1) * 2;
      quaternion = [(m21 - m12) / scale, (m02 - m20) / scale, (m10 - m01) / scale, scale / 4];
    } else if (m00 > m11 && m00 > m22) {
      const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
      quaternion = [scale / 4, (m01 + m10) / scale, (m02 + m20) / scale, (m21 - m12) / scale];
    } else if (m11 > m22) {
      const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
      quaternion = [(m01 + m10) / scale, scale / 4, (m12 + m21) / scale, (m02 - m20) / scale];
    } else {
      const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
      quaternion = [(m02 + m20) / scale, (m12 + m21) / scale, scale / 4, (m10 - m01) / scale];
    }
    return normalizeQuat(quaternion);
  }

  function hexToColor(hex, alpha = 1) {
    const value = hex.replace("#", "");
    const normalized = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
    const number = Number.parseInt(normalized, 16);
    return [(number >> 16) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, alpha];
  }

  function mixColor(a, b, amount, alpha = 1) {
    return [
      a[0] + (b[0] - a[0]) * amount,
      a[1] + (b[1] - a[1]) * amount,
      a[2] + (b[2] - a[2]) * amount,
      alpha,
    ];
  }

  function hsvToColor(hue, saturation, value, alpha = 1) {
    const wrapped = ((hue % 1) + 1) % 1;
    const sector = wrapped * 6;
    const index = Math.floor(sector);
    const fraction = sector - index;
    const p = value * (1 - saturation);
    const q = value * (1 - fraction * saturation);
    const t = value * (1 - (1 - fraction) * saturation);
    const colors = [
      [value, t, p], [q, value, p], [p, value, t],
      [p, q, value], [t, p, value], [value, p, q],
    ];
    return [...colors[index % 6], alpha];
  }

  function isApplePlatform() {
    const platform = navigator.userAgentData?.platform || navigator.platform || "";
    return /Mac|iPhone|iPad|iPod/i.test(platform);
  }

  function isTrackpadPinch(event) {
    return (event.ctrlKey || event.metaKey) && event.deltaMode === 0;
  }

  function isContinuousPixelWheel(event) {
    if (event.deltaMode !== 0) return false;
    if (Math.abs(event.deltaX) > 0) return true;
    return Math.abs(event.deltaY) > 0 && Math.abs(event.deltaY) < 80;
  }

  function isLikelyMouseWheel(event) {
    if (event.deltaMode !== 0) return true;
    const x = Math.abs(event.deltaX);
    const y = Math.abs(event.deltaY);
    const wheelDeltaY = Math.abs(Number(event.wheelDeltaY ?? 0));
    if (wheelDeltaY >= 120 && Math.abs(wheelDeltaY % 120) < 0.001) return true;
    return Number.isInteger(event.deltaX) && Number.isInteger(event.deltaY) && Math.max(x, y) >= 80;
  }

  class GraphEngine {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.mode = "2d";
      this.projection = "perspective";
      this.expressions = [];
      this.annotations = [];
      this.layers = [{ id: "layer-1", visible: true, coordinateSystem: "cartesian", space: "r3", representation: "explicit" }];
      this.constants = {};
      this.settings = { grid: true, axes: true, labels: true, dark: false, snapping: true, range: 50 };
      this.tool = "select";
      this.shapeKind = "segment-two-point";
      this.curveKind = "line";
      this.shapeDraft = null;
      this.shapeHoverPoint = null;
      this.shapeHoverSnapped = false;
      this.shapeHoverConstraint = null;
      this.lastShapeSnap = null;
      this.selectedExpressionId = null;
      this.hoverProbe = null;
      this.hitGeometry = [];
      this.view2d = { centerX: 0, centerY: 0, scale: 58 };
      this.camera = {
        target: { x: 0, y: 0, z: 0 },
        orientation: normalizeQuat(rotationFromOrbitDelta([0, 0, 0, 1], 220, 190, 0.003)),
        distance: 16,
        focalScale: 1.15,
        orbitSensitivity: 0.003,
        trackpadOrbitSensitivity: 0.004,
      };
      this.pointer = {
        x: 0,
        y: 0,
        drag: null,
        wheelOrbit: null,
        trackpadPanUntil: 0,
        lastRightClick: null,
      };
      this.width = 1;
      this.height = 1;
      this.dpr = 1;
      this.renderQueued = false;
      this.ready = false;
      this.geometryCache = new Map();
      this.expressionSignature = "";
      this.onViewChange = options.onViewChange || (() => {});
      this.labelLayer = document.createElement("div");
      this.labelLayer.className = "graph-axis-labels";
      this.labelLayer.setAttribute("aria-label", "Graph labels");
      canvas.after(this.labelLayer);
      this.installInteractions();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement || canvas);
      this.initializeWebGPU();
    }

    async initializeWebGPU() {
      try {
        if (!navigator.gpu) throw new Error("WebGPU is not available in this browser.");
        this.adapter = await navigator.gpu.requestAdapter();
        if (!this.adapter) throw new Error("No WebGPU adapter is available.");
        this.device = await this.adapter.requestDevice();
        this.context = this.canvas.getContext("webgpu");
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
          device: this.device,
          format: this.format,
          alphaMode: "opaque",
        });
        const shader = this.device.createShaderModule({ code: vertexShader, label: "Orbifold graph shader" });
        this.pipeline = this.device.createRenderPipeline({
          label: "Orbifold graph pipeline",
          layout: "auto",
          vertex: {
            module: shader,
            entryPoint: "vertex_main",
            buffers: [{
              arrayStride: 24,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x4" },
              ],
            }],
          },
          fragment: {
            module: shader,
            entryPoint: "fragment_main",
            targets: [{
              format: this.format,
              blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              },
            }],
          },
          primitive: { topology: "triangle-list" },
        });
        const gridModule = this.device.createShaderModule({ code: gridShader, label: "Orbifold infinite grid shader" });
        this.gridPipeline = this.device.createRenderPipeline({
          label: "Orbifold infinite grid pipeline",
          layout: "auto",
          vertex: { module: gridModule, entryPoint: "grid_vertex" },
          fragment: {
            module: gridModule,
            entryPoint: "grid_fragment",
            targets: [{
              format: this.format,
              blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              },
            }],
          },
          primitive: { topology: "triangle-list" },
        });
        this.gridUniformBuffer = this.device.createBuffer({
          label: "Orbifold grid uniforms",
          size: 112,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.gridBindGroup = this.device.createBindGroup({
          label: "Orbifold grid bind group",
          layout: this.gridPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: this.gridUniformBuffer } }],
        });
        this.device.lost.then(() => this.showWebGPUError("The WebGPU device was lost. Reload to reconnect."));
        this.ready = true;
        this.resize();
      } catch (error) {
        this.showWebGPUError(error.message);
      }
    }

    showWebGPUError(message) {
      this.ready = false;
      let notice = this.canvas.parentElement.querySelector(".webgpu-error");
      if (!notice) {
        notice = document.createElement("div");
        notice.className = "webgpu-error";
        this.canvas.parentElement.append(notice);
      }
      notice.innerHTML = `<strong>WebGPU required</strong><span>${message}</span>`;
    }

    setExpressions(expressions) {
      this.expressions = expressions;
      this.constants = {};
      for (const expression of expressions) {
        if (!expression.visible || expression.compiled?.kind !== "constant") continue;
        if (Number.isFinite(expression.value)) this.constants[expression.compiled.name] = expression.value;
      }
      this.evaluationScope = { ...this.constants };
      const signature = JSON.stringify(expressions.map((expression) => [
        expression.id,
        expression.latex,
        expression.color,
        expression.visible,
        expression.value,
        expression.compiled?.kind,
        expression.showLabel,
        expression.visualization,
        expression.graphLabel,
        expression.resolution,
        expression.iterations,
        expression.lineStyle,
        expression.fillArea,
      ]));
      if (signature !== this.expressionSignature) {
        this.expressionSignature = signature;
        this.geometryCache.clear();
      }
      this.requestRender();
    }

    setMode(mode) {
      if (mode !== "2d" && mode !== "3d") return;
      if (mode !== this.mode) {
        const equivalentScale = Math.max(this.width, this.height) * this.camera.focalScale / Math.max(this.camera.distance, 0.001);
        if (mode === "2d") {
          this.view2d.centerX = this.camera.target.x;
          this.view2d.centerY = this.camera.target.y;
          this.view2d.scale = clamp(equivalentScale, 1.5, 1400);
        } else {
          this.camera.target.x = this.view2d.centerX;
          this.camera.target.y = this.view2d.centerY;
          this.camera.distance = clamp(Math.max(this.width, this.height) * this.camera.focalScale / Math.max(this.view2d.scale, 0.001), 2.2, 1e6);
        }
      }
      this.mode = mode;
      this.canvas.setAttribute("aria-label", mode === "3d"
        ? "Interactive WebGPU 3D graph. Drag to pan, Shift-drag to orbit with a mouse, use two fingers to orbit, use three-finger drag to pan, and pinch to zoom."
        : "Interactive WebGPU 2D graph. Drag or use two fingers to pan and pinch or scroll to zoom.");
      this.requestRender();
    }

    setProjection(projection) {
      this.projection = projection === "orthographic" ? "orthographic" : "perspective";
      this.requestRender();
    }

    setSetting(name, value) {
      if (!(name in this.settings)) return;
      if (name === "range") {
        const range = clamp(Number(value) || 50, 5, 200);
        if (range !== this.settings.range) this.geometryCache.clear();
        this.settings.range = range;
      } else {
        this.settings[name] = Boolean(value);
      }
      if (name === "snapping") this.updateToolHover();
      this.requestRender();
    }

    setAnnotations(annotations) {
      this.annotations = annotations || [];
      this.requestRender();
    }

    setLayers(layers) {
      const nextLayers = Array.isArray(layers) && layers.length ? layers : this.layers;
      const signature = JSON.stringify(nextLayers);
      if (signature !== this.layerSignature) this.geometryCache.clear();
      this.layerSignature = signature;
      this.layers = nextLayers;
      this.requestRender();
    }

    setTool(tool, shapeKind = this.shapeKind, curveKind = this.curveKind) {
      if (!["select", "point", "tangent", "shape", "curve"].includes(tool)) return;
      this.tool = tool;
      this.shapeKind = shapeKind;
      this.curveKind = curveKind;
      this.shapeDraft = null;
      this.shapeHoverPoint = null;
      this.shapeHoverSnapped = false;
      this.shapeHoverConstraint = null;
      this.lastShapeSnap = null;
      this.canvas.dataset.tool = tool;
      this.updateToolHover();
    }

    setSelectedExpression(id) {
      this.selectedExpressionId = id || null;
      this.requestRender();
    }

    resetView() {
      if (this.mode === "2d") {
        this.view2d = { centerX: 0, centerY: 0, scale: 58 };
      } else {
        this.camera.target = { x: 0, y: 0, z: 0 };
        this.camera.orientation = normalizeQuat(rotationFromOrbitDelta([0, 0, 0, 1], 220, 190, 0.003));
        this.camera.distance = 16;
      }
      this.requestRender();
      this.onViewChange();
    }

    orbitBy(deltaX, deltaY) {
      if (this.mode !== "3d") return;
      const rotation = rotationFromOrbitDelta(this.camera.orientation, deltaX, deltaY, this.camera.orbitSensitivity);
      this.camera.orientation = normalizeQuat(quatMultiply(rotation, this.camera.orientation));
      this.requestRender();
    }

    snapView({ x = 0, y = 0, basis } = {}) {
      if (this.mode !== "3d" || !basis) return;
      const vector = (values) => ({ x: values[0], y: values[1], z: values[2] });
      const currentForward = vector(basis.forward);
      const currentRight = vector(basis.right);
      const currentUp = vector(basis.up);
      const rawForward = {
        x: currentForward.x + currentRight.x * x * 0.9 - currentUp.x * y * 0.9,
        y: currentForward.y + currentRight.y * x * 0.9 - currentUp.y * y * 0.9,
        z: currentForward.z + currentRight.z * x * 0.9 - currentUp.z * y * 0.9,
      };
      const componentCount = x && y ? 3 : x || y ? 2 : 1;
      const components = ["x", "y", "z"].sort((a, b) => Math.abs(rawForward[b]) - Math.abs(rawForward[a]));
      const snapped = { x: 0, y: 0, z: 0 };
      components.slice(0, componentCount).forEach((name) => { snapped[name] = Math.sign(rawForward[name]) || 1; });
      const forward = normalize3(snapped);
      const referenceUp = Math.abs(forward.z) > 0.94 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
      const right = normalize3(cross3(forward, referenceUp));
      const up = normalize3(cross3(right, forward));
      this.camera.orientation = quaternionFromCameraBasis(right, up, forward);
      this.requestRender();
    }

    resize() {
      const bounds = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, bounds.width);
      this.height = Math.max(1, bounds.height);
      this.dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
      this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
      this.requestRender();
    }

    updatePointer(event) {
      const bounds = this.canvas.getBoundingClientRect();
      this.pointer.x = event.clientX - bounds.left;
      this.pointer.y = event.clientY - bounds.top;
    }

    isTrackpadPan(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.deltaMode !== 0) return false;
      if (event.timeStamp < this.pointer.trackpadPanUntil) return true;
      return isContinuousPixelWheel(event);
    }

    installInteractions() {
      this.canvas.addEventListener("pointerdown", (event) => {
        if (![0, 1, 2].includes(event.button)) return;
        event.preventDefault();
        this.canvas.focus({ preventScroll: true });
        this.updatePointer(event);
        this.canvas.setPointerCapture(event.pointerId);
        if (event.button === 0 && (this.tool === "shape" || this.tool === "curve")) {
          this.beginShapePointer(event);
          return;
        }
        const doubleRightOrbit = this.shouldStartDoubleRightOrbit(event);
        if (event.shiftKey || doubleRightOrbit) this.beginPointerOrbit(event);
        else {
          const action = event.button === 0 ? this.pointerAction() : null;
          this.beginPointerPan(event);
          this.pointer.drag.action = action;
        }
      });

      this.canvas.addEventListener("pointermove", (event) => {
        this.updatePointer(event);
        if (!this.pointer.drag || this.pointer.drag.pointerId !== event.pointerId) {
          if (this.tool === "shape" || this.tool === "curve") {
            const curveConstraint = this.tool === "shape" && (this.shapeKind === "tangent-curve" || this.shapeKind === "secant-curve");
            this.shapeHoverPoint = this.shapePointAt(this.pointer.x, this.pointer.y, curveConstraint || event.shiftKey);
            this.shapeHoverConstraint = event.shiftKey ? this.constraintFromSnap() : null;
            this.requestRender();
            return;
          }
          this.updateToolHover();
          return;
        }
        if (this.pointer.drag.mode === "orbit" && document.pointerLockElement === this.canvas) return;
        if (this.pointer.drag.mode === "orbit") this.applyPointerOrbitMove(event);
        else if (this.pointer.drag.mode === "shape") {
          this.pointer.drag.current = this.shapePointAt(this.pointer.x, this.pointer.y, event.shiftKey);
          this.pointer.drag.currentConstraint = event.shiftKey ? this.constraintFromSnap() : null;
          this.shapeHoverConstraint = this.pointer.drag.currentConstraint;
          this.shapeHoverPoint = this.pointer.drag.current;
          this.pointer.drag.moved ||= Math.hypot(this.pointer.x - this.pointer.drag.startX, this.pointer.y - this.pointer.drag.startY) > 3;
          this.requestRender();
        }
        else this.applyPointerPan();
      });

      this.canvas.addEventListener("pointerleave", () => {
        if (!this.pointer.drag && this.shapeHoverPoint) {
          this.shapeHoverPoint = null;
          this.shapeHoverSnapped = false;
          this.shapeHoverConstraint = null;
          this.lastShapeSnap = null;
          this.requestRender();
        }
        if (this.pointer.drag || !this.hoverProbe) return;
        this.hoverProbe = null;
        this.requestRender();
      });

      const endDrag = (event) => this.endPointerDrag(event);
      this.canvas.addEventListener("pointerup", endDrag);
      this.canvas.addEventListener("pointercancel", endDrag);
      this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
      this.canvas.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false });

      document.addEventListener("mousemove", (event) => {
        if (this.pointer.drag?.mode !== "orbit" || document.pointerLockElement !== this.canvas) return;
        this.applyOrbitMovement(event.movementX || 0, event.movementY || 0, true);
      });
      document.addEventListener("mouseup", (event) => {
        if (this.pointer.drag?.mode !== "orbit" || document.pointerLockElement !== this.canvas) return;
        if (event.button === this.pointer.drag.button) this.finishPointerDrag();
      });

      this.canvas.addEventListener("keydown", (event) => {
        if (event.key === "+" || event.key === "=") this.zoomAtPointer(-180, 0.001, this.width / 2, this.height / 2);
        if (event.key === "-") this.zoomAtPointer(180, 0.001, this.width / 2, this.height / 2);
        if (event.key === "Home" || event.key === "0") this.resetView();
      });
    }

    beginPointerPan(event) {
      this.pointer.wheelOrbit = null;
      this.pointer.drag = {
        mode: "pan",
        pointerId: event.pointerId,
        button: event.button,
        anchor: this.mode === "2d"
          ? this.screenToWorld2d(this.pointer.x, this.pointer.y)
          : this.screenToPlane(this.pointer.x, this.pointer.y),
        startX: this.pointer.x,
        startY: this.pointer.y,
        moved: false,
      };
      this.canvas.dataset.panning = "true";
      this.canvas.dataset.orbiting = "false";
    }

    beginPointerOrbit(event) {
      this.pointer.wheelOrbit = null;
      this.pointer.drag = {
        ...this.beginOrbitGesture(this.pointer.x, this.pointer.y),
        mode: "orbit",
        pointerId: event.pointerId,
        button: event.button,
        orbitDirection: !isApplePlatform() && (event.pointerType === "mouse" || !event.pointerType) ? -1 : 1,
        startX: this.pointer.x,
        startY: this.pointer.y,
        lastX: this.pointer.x,
        lastY: this.pointer.y,
      };
      this.canvas.dataset.panning = "false";
      this.canvas.dataset.orbiting = "true";
      if (this.mode === "3d") this.requestPointerLock();
    }

    requestPointerLock() {
      if (!this.canvas.requestPointerLock) return;
      try {
        const request = this.canvas.requestPointerLock({ unadjustedMovement: true });
        request?.catch?.(() => this.canvas.requestPointerLock());
      } catch (error) {
        try { this.canvas.requestPointerLock(); } catch (ignored) { /* pointer capture remains active */ }
      }
    }

    shouldStartDoubleRightOrbit(event) {
      if (event.button !== 2 || event.shiftKey) return false;
      const last = this.pointer.lastRightClick;
      if (!last) return false;
      const closeInTime = performance.now() - last.time <= 450;
      const closeInSpace = Math.hypot(this.pointer.x - last.x, this.pointer.y - last.y) <= 12;
      if (closeInTime && closeInSpace) this.pointer.lastRightClick = null;
      return closeInTime && closeInSpace;
    }

    applyPointerPan() {
      const drag = this.pointer.drag;
      drag.moved ||= Math.hypot(this.pointer.x - drag.startX, this.pointer.y - drag.startY) > 3;
      if (!drag.moved) return;
      if (this.mode === "2d") {
        this.view2d.centerX = drag.anchor.x - (this.pointer.x - this.width / 2) / this.view2d.scale;
        this.view2d.centerY = drag.anchor.y + (this.pointer.y - this.height / 2) / this.view2d.scale;
      } else {
        this.lockPlanePointToScreen(drag.anchor, this.pointer.x, this.pointer.y);
      }
      this.requestRender();
    }

    endPointerDrag(event) {
      const drag = this.pointer.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.mode === "shape") {
        this.finishShapePointer(drag);
        this.finishPointerDrag();
        return;
      }
      if (event.type !== "pointercancel" && drag.mode === "pan" && drag.button === 0 && !drag.moved && drag.action) this.commitPointerAction(drag.action);
      if (drag.mode === "pan" && drag.button === 2 && !drag.moved) {
        this.pointer.lastRightClick = { time: performance.now(), x: drag.startX, y: drag.startY };
      } else if (drag.button === 2) {
        this.pointer.lastRightClick = null;
      }
      this.finishPointerDrag();
    }

    pointerAction() {
      if (this.tool === "select") {
        const hit = this.hitTestExpression(this.pointer.x, this.pointer.y);
        return { type: "select", id: hit?.expression.id || null };
      }
      const probe = this.createProbe(this.pointer.x, this.pointer.y);
      return probe ? { type: "probe", probe } : null;
    }

    commitPointerAction(action) {
      if (action.type === "select") {
        this.canvas.dispatchEvent(new CustomEvent("graph-expression-select", { detail: { id: action.id } }));
      }
      if (action.type === "probe") {
        this.canvas.dispatchEvent(new CustomEvent("graph-probe-commit", { detail: action.probe }));
      }
    }

    finishPointerDrag() {
      const pointerId = this.pointer.drag?.pointerId;
      if (pointerId != null && this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.pointer.drag = null;
      this.canvas.dataset.panning = "false";
      this.canvas.dataset.orbiting = "false";
      this.onViewChange();
    }

    shapePointAt(screenX, screenY, forceCurve = false) {
      if (forceCurve || this.settings.snapping) {
        const hit = this.hitTestCurve(screenX, screenY, 18, true);
        if (hit?.world) {
          this.shapeHoverSnapped = true;
          this.lastShapeSnap = hit;
          return hit.world;
        }
      }
      this.shapeHoverSnapped = false;
      this.lastShapeSnap = null;
      return this.mode === "2d" ? { ...this.screenToWorld2d(screenX, screenY), z: 0 } : this.screenToPlane(screenX, screenY);
    }

    constraintFromSnap() {
      const hit = this.lastShapeSnap;
      if (!hit?.geometry?.worldA || !hit.geometry.worldB) return null;
      const direction = normalize3({
        x: hit.geometry.worldB.x - hit.geometry.worldA.x,
        y: hit.geometry.worldB.y - hit.geometry.worldA.y,
        z: (hit.geometry.worldB.z || 0) - (hit.geometry.worldA.z || 0),
      });
      if (Math.hypot(direction.x, direction.y, direction.z) < 1e-6) return null;
      return {
        kind: "tangent",
        expressionId: hit.expression.id,
        point: { ...hit.world },
        direction,
        normal: normalize3({ x: -direction.y, y: direction.x, z: 0 }),
      };
    }

    beginShapePointer(event) {
      const curveConstraint = this.tool === "shape" && (this.shapeKind === "tangent-curve" || this.shapeKind === "secant-curve");
      const point = this.shapePointAt(this.pointer.x, this.pointer.y, curveConstraint || event.shiftKey);
      const constraint = event.shiftKey ? this.constraintFromSnap() : null;
      this.shapeHoverPoint = point;
      this.shapeHoverConstraint = constraint;
      this.pointer.drag = {
        mode: "shape", pointerId: event.pointerId, button: event.button,
        startX: this.pointer.x, startY: this.pointer.y, start: point, current: point,
        startConstraint: constraint, currentConstraint: constraint, moved: false,
      };
      this.canvas.dataset.panning = "false";
    }

    finishShapePointer(drag) {
      if (!drag.start || !Number.isFinite(drag.start.x) || !drag.current || !Number.isFinite(drag.current.x)) return;
      const kind = this.tool === "curve" ? `curve:${this.curveKind}` : this.shapeKind;
      if (kind === "tangent-curve") {
        const hit = this.hitTestCurve(drag.startX, drag.startY, 18, true);
        if (!hit) return;
        const segment = {
          x: hit.geometry.worldB.x - hit.geometry.worldA.x,
          y: hit.geometry.worldB.y - hit.geometry.worldA.y,
          z: (hit.geometry.worldB.z || 0) - (hit.geometry.worldA.z || 0),
        };
        const direction = this.tangentFor(hit.expression, hit.world) || segment;
        this.dispatchShape({ shapeKind: "tangent", points: [hit.world], direction, extent: "line", color: hit.expression.color });
        return;
      }
      const required = kind === "circle-three-point" || kind === "arc-three-point" ? 3 : kind === "secant-curve" ? 2 : 2;
      const point = kind === "secant-curve" ? this.shapePointAt(this.pointer.x, this.pointer.y, true) : drag.current;
      if (drag.moved && required === 2 && kind !== "secant-curve") {
        this.commitShapePoints(kind, [drag.start, drag.current], [drag.startConstraint, drag.currentConstraint]);
        return;
      }
      if (!this.shapeDraft || this.shapeDraft.kind !== kind) this.shapeDraft = { kind, points: [], constraints: [] };
      this.shapeDraft.points.push(point);
      this.shapeDraft.constraints.push(drag.currentConstraint || drag.startConstraint || null);
      if (this.shapeDraft.points.length >= required) {
        this.commitShapePoints(kind, this.shapeDraft.points, this.shapeDraft.constraints);
        this.shapeDraft = null;
      }
      this.requestRender();
    }

    commitShapePoints(kind, points, constraints = []) {
      if (kind.startsWith("curve:")) {
        const curveKind = kind.slice(6);
        const latex = this.curveTemplateLatex(curveKind, points[0], points[1]);
        if (latex) this.canvas.dispatchEvent(new CustomEvent("graph-expression-template", { detail: { latex, curveKind } }));
        return;
      }
      const extentByKind = { "line-two-point": "line", "ray-two-point": "ray", "segment-two-point": "segment", "secant-curve": "line" };
      if (kind === "circle-center" || kind === "circle-diameter") {
        const circle = this.circleFromTwoPoints(kind, points, constraints);
        const { center, radius } = circle;
        this.dispatchShape({ shapeKind: "circle", points, center, radius, constraints, extent: "segment" });
        return;
      }
      if (kind === "circle-three-point" || kind === "arc-three-point") {
        const circle = this.circleThroughConstrainedPoints(points, constraints);
        if (!circle) return;
        this.dispatchShape({ shapeKind: kind.startsWith("arc") ? "arc" : "circle", points, constraints, ...circle, extent: "segment" });
        return;
      }
      const constrainedPoints = this.linePointsWithConstraints(points, constraints);
      this.dispatchShape({
        shapeKind: kind === "secant-curve" ? "secant" : extentByKind[kind],
        points: constrainedPoints, constraints,
        extent: extentByKind[kind] || "segment",
      });
    }

    dispatchShape(shape) {
      this.canvas.dispatchEvent(new CustomEvent("graph-shape-commit", { detail: shape }));
    }

    circleThroughPoints(a, b, c) {
      const determinant = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
      if (Math.abs(determinant) < 1e-9) return null;
      const aa = a.x * a.x + a.y * a.y;
      const bb = b.x * b.x + b.y * b.y;
      const cc = c.x * c.x + c.y * c.y;
      const center = {
        x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / determinant,
        y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / determinant,
        z: 0,
      };
      return { center, radius: Math.hypot(a.x - center.x, a.y - center.y) };
    }

    circleThroughConstrainedPoints(points, constraints = []) {
      const tangentIndex = constraints.findIndex((constraint) => constraint?.kind === "tangent");
      if (tangentIndex < 0) return this.circleThroughPoints(points[0], points[1], points[2]);
      const tangent = points[tangentIndex];
      const normal = constraints[tangentIndex].normal;
      const offsets = points
        .filter((_, index) => index !== tangentIndex)
        .map((point) => {
          const dx = tangent.x - point.x;
          const dy = tangent.y - point.y;
          const denominator = 2 * (normal.x * dx + normal.y * dy);
          return Math.abs(denominator) < 1e-8 ? NaN : -(dx * dx + dy * dy) / denominator;
        })
        .filter(Number.isFinite);
      if (!offsets.length) return this.circleThroughPoints(points[0], points[1], points[2]);
      const offset = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
      const center = { x: tangent.x + normal.x * offset, y: tangent.y + normal.y * offset, z: tangent.z || 0 };
      return { center, radius: Math.abs(offset) };
    }

    circleFromTwoPoints(kind, points, constraints = []) {
      let first = points[0];
      let second = points[1];
      if (kind === "circle-center" && constraints[1]?.kind === "tangent") {
        const tangent = second;
        const normal = constraints[1].normal;
        let offset = (first.x - tangent.x) * normal.x + (first.y - tangent.y) * normal.y;
        if (Math.abs(offset) < 1e-6) offset = Math.hypot(first.x - tangent.x, first.y - tangent.y);
        first = { x: tangent.x + normal.x * offset, y: tangent.y + normal.y * offset, z: tangent.z || 0 };
      }
      if (kind === "circle-diameter") {
        const index = constraints.findIndex((constraint) => constraint?.kind === "tangent");
        if (index >= 0) {
          const tangent = points[index];
          const normal = constraints[index].normal;
          const other = points[1 - index];
          const distance = Math.hypot(other.x - tangent.x, other.y - tangent.y);
          const sign = Math.sign((other.x - tangent.x) * normal.x + (other.y - tangent.y) * normal.y) || 1;
          const replacement = { x: tangent.x + normal.x * distance * sign, y: tangent.y + normal.y * distance * sign, z: tangent.z || 0 };
          if (index === 0) second = replacement;
          else first = replacement;
        }
      }
      const center = kind === "circle-center" ? first : {
        x: (first.x + second.x) * 0.5, y: (first.y + second.y) * 0.5, z: 0,
      };
      const radius = kind === "circle-center"
        ? Math.hypot(second.x - center.x, second.y - center.y)
        : Math.hypot(second.x - first.x, second.y - first.y) * 0.5;
      return { center, radius };
    }

    linePointsWithConstraints(points, constraints = []) {
      const index = constraints.findIndex((constraint) => constraint?.kind === "tangent");
      if (index < 0) return points;
      const tangent = points[index];
      const other = points[1 - index];
      const direction = constraints[index].direction;
      const length = Math.max(1e-6, Math.hypot(other.x - tangent.x, other.y - tangent.y, (other.z || 0) - (tangent.z || 0)));
      const towardOther = Math.sign((other.x - tangent.x) * direction.x + (other.y - tangent.y) * direction.y) || 1;
      const replacement = {
        x: tangent.x + direction.x * length * towardOther,
        y: tangent.y + direction.y * length * towardOther,
        z: (tangent.z || 0) + direction.z * length * towardOther,
      };
      return index === 0 ? [tangent, replacement] : [replacement, tangent];
    }

    curveTemplateLatex(kind, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const number = (value) => this.formatGridNumber(Math.abs(value) < 1e-10 ? 0 : value);
      const shifted = (name, center) => center > 0 ? `${name}-${number(center)}` : center < 0 ? `${name}+${number(-center)}` : name;
      const plus = (value) => value > 0 ? `+${number(value)}` : value < 0 ? number(value) : "";
      if (kind === "line") {
        if (Math.abs(dx) < 1e-8) return `x=${number(a.x)}`;
        const slope = dy / dx;
        return `y=${number(slope)}x${plus(a.y - slope * a.x)}`;
      }
      const safeDx = Math.abs(dx) < 1e-5 ? (dx < 0 ? -1 : 1) : dx;
      const localX = shifted("x", a.x);
      if (kind === "parabola") return `y=${number(dy / (safeDx * safeDx))}\\left(${localX}\\right)^2${plus(a.y)}`;
      if (kind === "cubic") return `y=${number(dy / (safeDx * safeDx * safeDx))}\\left(${localX}\\right)^3${plus(a.y)}`;
      if (kind === "quartic") return `y=${number(dy / (safeDx ** 4))}\\left(${localX}\\right)^4${plus(a.y)}`;
      if (kind === "absolute") return `y=${number(dy / Math.abs(safeDx))}\\left|${localX}\\right|${plus(a.y)}`;
      const frequency = Math.PI / (2 * Math.abs(safeDx));
      if (kind === "sine") return `y=${number(dy || 1)}\\sin\\left(${number(frequency)}\\left(${localX}\\right)\\right)${plus(a.y)}`;
      if (kind === "cosine") {
        const amplitude = a.y - b.y || 1;
        return `y=${number(amplitude)}\\cos\\left(${number(frequency)}\\left(${localX}\\right)\\right)${plus(b.y)}`;
      }
      if (kind === "tangent") return `y=${number(dy || 1)}\\tan\\left(${number(Math.PI / (4 * Math.abs(safeDx)))}\\left(${localX}\\right)\\right)${plus(a.y)}`;
      if (kind === "exponential") {
        const rate = Math.log(Math.max(0.05, Math.abs(dy) + 1)) / safeDx;
        const direction = Math.sign(dy) || 1;
        return `y=${number(direction)}\\left(e^{${number(rate)}\\left(${localX}\\right)}-1\\right)${plus(a.y)}`;
      }
      if (kind === "logarithm") {
        const direction = safeDx < 0 ? -1 : 1;
        const argument = direction < 0 ? `${number(a.x)}-x` : shifted("x", a.x);
        return `y=\\ln\\left(\\frac{${argument}}{${number(Math.abs(safeDx))}}\\right)${plus(b.y)}`;
      }
      if (kind === "square-root") {
        const argument = safeDx < 0 ? `${number(a.x)}-x` : localX;
        return `y=${number(dy / Math.sqrt(Math.abs(safeDx)) || 1)}\\sqrt{${argument}}${plus(a.y)}`;
      }
      if (kind === "reciprocal") return `y=\\frac{${number(dy * safeDx || 1)}}{${localX}}${plus(a.y)}`;
      return null;
    }

    curveTemplateValue(kind, a, b, x) {
      const dx = Math.abs(b.x - a.x) < 1e-5 ? 1 : b.x - a.x;
      const dy = b.y - a.y;
      const local = x - a.x;
      if (kind === "line") return a.y + dy / dx * local;
      if (kind === "parabola") return a.y + dy / (dx * dx) * local * local;
      if (kind === "cubic") return a.y + dy / (dx * dx * dx) * local * local * local;
      if (kind === "quartic") return a.y + dy / (dx ** 4) * (local ** 4);
      if (kind === "absolute") return a.y + dy / Math.abs(dx) * Math.abs(local);
      if (kind === "sine") return a.y + (dy || 1) * Math.sin(Math.PI / (2 * Math.abs(dx)) * local);
      if (kind === "cosine") return b.y + (a.y - b.y || 1) * Math.cos(Math.PI / (2 * Math.abs(dx)) * local);
      if (kind === "tangent") return a.y + (dy || 1) * Math.tan(Math.PI / (4 * Math.abs(dx)) * local);
      if (kind === "exponential") return a.y + (Math.sign(dy) || 1) * (Math.exp(Math.log(Math.max(0.05, Math.abs(dy) + 1)) / dx * local) - 1);
      if (kind === "logarithm") {
        const argument = dx < 0 ? -local : local;
        return argument > 0 ? b.y + Math.log(argument / Math.abs(dx)) : NaN;
      }
      if (kind === "square-root") {
        const argument = dx < 0 ? -local : local;
        return argument >= 0 ? a.y + (dy / Math.sqrt(Math.abs(dx)) || 1) * Math.sqrt(argument) : NaN;
      }
      if (kind === "reciprocal") return a.y + (dy * dx || 1) / local;
      return NaN;
    }

    applyPointerOrbitMove(event) {
      const drag = this.pointer.drag;
      const dx = Number.isFinite(event.movementX) && event.movementX !== 0 ? event.movementX : this.pointer.x - drag.lastX;
      const dy = Number.isFinite(event.movementY) && event.movementY !== 0 ? event.movementY : this.pointer.y - drag.lastY;
      drag.lastX = this.pointer.x;
      drag.lastY = this.pointer.y;
      this.applyOrbitMovement(dx, dy);
    }

    applyOrbitMovement(deltaX, deltaY) {
      const drag = this.pointer.drag;
      if (!drag || drag.mode !== "orbit" || this.mode !== "3d") return;
      const direction = drag.orbitDirection ?? 1;
      drag.totalX += deltaX * direction;
      drag.totalY += deltaY * direction;
      this.applyOrbitGesture(drag, this.camera.orbitSensitivity);
      this.requestRender();
    }

    handleWheel(event) {
      event.preventDefault();
      this.updatePointer(event);
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (isTrackpadPinch(event)) {
        this.pointer.trackpadPanUntil = 0;
        this.zoomAtPointer(delta, 0.018, this.pointer.x, this.pointer.y);
      } else if (event.shiftKey && event.deltaMode === 0 && this.mode === "3d") {
        this.pointer.trackpadPanUntil = 0;
        this.orbitWheelAtPointer(event);
      } else if (this.isTrackpadPan(event)) {
        this.pointer.trackpadPanUntil = event.timeStamp + 220;
        if (this.mode === "3d") this.orbitWheelAtPointer(event);
        else {
          this.pointer.wheelOrbit = null;
          this.panByWheel(event.deltaX, event.deltaY);
        }
      } else {
        this.pointer.trackpadPanUntil = 0;
        this.zoomAtPointer(delta, 0.001, this.pointer.x, this.pointer.y);
      }
      this.requestRender();
    }

    panByWheel(deltaX, deltaY) {
      if (this.mode === "2d") {
        this.view2d.centerX += deltaX / this.view2d.scale;
        this.view2d.centerY -= deltaY / this.view2d.scale;
        return;
      }
      const anchor = this.screenToPlane(this.pointer.x, this.pointer.y);
      this.lockPlanePointToScreen(anchor, this.pointer.x - deltaX, this.pointer.y - deltaY);
    }

    zoom(direction) {
      const delta = direction > 0 ? -180 : 180;
      this.zoomAtPointer(delta, 0.001, this.width / 2, this.height / 2);
      this.requestRender();
      this.onViewChange();
    }

    zoomAtPointer(delta, sensitivity, screenX, screenY) {
      this.pointer.wheelOrbit = null;
      if (this.mode === "2d") {
        const before = this.screenToWorld2d(screenX, screenY);
        this.view2d.scale = clamp(this.view2d.scale * Math.exp(-delta * sensitivity), 1.5, 1400);
        const after = this.screenToWorld2d(screenX, screenY);
        this.view2d.centerX += before.x - after.x;
        this.view2d.centerY += before.y - after.y;
        return;
      }
      const anchor = this.screenToPlane(screenX, screenY);
      this.camera.distance = clamp(this.camera.distance * Math.exp(delta * sensitivity), 2.2, 1e6);
      this.lockPlanePointToScreen(anchor, screenX, screenY);
    }

    beginOrbitGesture(screenX, screenY) {
      const cameraState = this.cameraState();
      const pivot = this.screenToPlane(screenX, screenY);
      return {
        pivot: Number.isFinite(pivot.x) ? pivot : { ...this.camera.target },
        totalX: 0,
        totalY: 0,
        startOrientation: [...this.camera.orientation],
        startPosition: { ...cameraState.position },
        viewDistance: this.camera.distance,
      };
    }

    applyOrbitGesture(gesture, sensitivity) {
      const rotation = rotationFromOrbitDelta(gesture.startOrientation, gesture.totalX, gesture.totalY, sensitivity);
      const nextOrientation = normalizeQuat(quatMultiply(rotation, gesture.startOrientation));
      const startOffset = {
        x: gesture.startPosition.x - gesture.pivot.x,
        y: gesture.startPosition.y - gesture.pivot.y,
        z: gesture.startPosition.z - gesture.pivot.z,
      };
      const nextOffset = rotateVectorRawByQuat(startOffset, rotation);
      const nextPosition = {
        x: gesture.pivot.x + nextOffset.x,
        y: gesture.pivot.y + nextOffset.y,
        z: gesture.pivot.z + nextOffset.z,
      };
      const nextForward = rotateVectorByQuat({ x: 0, y: 0, z: -1 }, nextOrientation);
      this.camera.orientation = nextOrientation;
      this.camera.target = {
        x: nextPosition.x + nextForward.x * gesture.viewDistance,
        y: nextPosition.y + nextForward.y * gesture.viewDistance,
        z: nextPosition.z + nextForward.z * gesture.viewDistance,
      };
    }

    orbitWheelAtPointer(event) {
      if (!this.pointer.wheelOrbit || event.timeStamp - this.pointer.wheelOrbit.lastTime > 260) {
        this.pointer.wheelOrbit = this.beginOrbitGesture(this.pointer.x, this.pointer.y);
      }
      const orbit = this.pointer.wheelOrbit;
      orbit.lastTime = event.timeStamp;
      const direction = !isApplePlatform() && isLikelyMouseWheel(event) ? -1 : 1;
      orbit.totalX += event.deltaX * direction;
      orbit.totalY += event.deltaY * direction;
      this.applyOrbitGesture(orbit, this.camera.trackpadOrbitSensitivity);
    }

    screenToWorld2d(x, y) {
      return {
        x: this.view2d.centerX + (x - this.width / 2) / this.view2d.scale,
        y: this.view2d.centerY - (y - this.height / 2) / this.view2d.scale,
      };
    }

    worldToScreen2d(x, y) {
      return {
        x: this.width / 2 + (x - this.view2d.centerX) * this.view2d.scale,
        y: this.height / 2 - (y - this.view2d.centerY) * this.view2d.scale,
      };
    }

    cameraState() {
      const right = rotateVectorByQuat({ x: 1, y: 0, z: 0 }, this.camera.orientation);
      const up = rotateVectorByQuat({ x: 0, y: 1, z: 0 }, this.camera.orientation);
      const forward = rotateVectorByQuat({ x: 0, y: 0, z: -1 }, this.camera.orientation);
      const position = {
        x: this.camera.target.x - forward.x * this.camera.distance,
        y: this.camera.target.y - forward.y * this.camera.distance,
        z: this.camera.target.z - forward.z * this.camera.distance,
      };
      return {
        right,
        up,
        forward,
        position,
        focal: Math.max(this.width, this.height) * this.camera.focalScale,
      };
    }

    screenRay(x, y) {
      const state = this.cameraState();
      if (this.projection === "orthographic") {
        const scale = state.focal / Math.max(this.camera.distance, 0.001);
        const offsetX = (x - this.width / 2) / scale;
        const offsetY = -(y - this.height / 2) / scale;
        return {
          origin: {
            x: state.position.x + state.right.x * offsetX + state.up.x * offsetY,
            y: state.position.y + state.right.y * offsetX + state.up.y * offsetY,
            z: state.position.z + state.right.z * offsetX + state.up.z * offsetY,
          },
          direction: state.forward,
        };
      }
      const cameraX = (x - this.width / 2) / state.focal;
      const cameraY = -(y - this.height / 2) / state.focal;
      return {
        origin: state.position,
        direction: normalize3({
          x: state.right.x * cameraX + state.up.x * cameraY + state.forward.x,
          y: state.right.y * cameraX + state.up.y * cameraY + state.forward.y,
          z: state.right.z * cameraX + state.up.z * cameraY + state.forward.z,
        }),
      };
    }

    screenToPlane(x, y, z = 0) {
      const ray = this.screenRay(x, y);
      if (Math.abs(ray.direction.z) < 0.00001) return { x: NaN, y: NaN, z };
      const distance = (z - ray.origin.z) / ray.direction.z;
      if (!Number.isFinite(distance) || distance <= 0) return { x: NaN, y: NaN, z };
      return {
        x: ray.origin.x + ray.direction.x * distance,
        y: ray.origin.y + ray.direction.y * distance,
        z,
      };
    }

    lockPlanePointToScreen(anchor, screenX, screenY) {
      if (!anchor || !Number.isFinite(anchor.x)) return;
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const current = this.screenToPlane(screenX, screenY, anchor.z || 0);
        if (!Number.isFinite(current.x)) return;
        this.camera.target.x += anchor.x - current.x;
        this.camera.target.y += anchor.y - current.y;
        this.camera.target.z += anchor.z - current.z;
      }
    }

    project3(point, state) {
      const relative = {
        x: point.x - state.position.x,
        y: point.y - state.position.y,
        z: point.z - state.position.z,
      };
      const depth = dot3(relative, state.forward);
      if (depth <= 0.05) return null;
      if (this.projection === "orthographic") {
        const scale = state.focal / Math.max(this.camera.distance, 0.001);
        return {
          x: this.width / 2 + dot3(relative, state.right) * scale,
          y: this.height / 2 - dot3(relative, state.up) * scale,
          depth,
        };
      }
      return {
        x: this.width / 2 + dot3(relative, state.right) * state.focal / depth,
        y: this.height / 2 - dot3(relative, state.up) * state.focal / depth,
        depth,
      };
    }

    requestRender() {
      if (!this.ready || this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        this.render();
      });
    }

    render() {
      if (!this.ready || !this.canvas.width || !this.canvas.height) return;
      const vertices = [];
      const labels = [];
      this.hitGeometry = [];
      if (this.mode === "3d") this.build3d(vertices, labels);
      else this.build2d(vertices, labels);
      if (this.tool === "point" || this.tool === "tangent") this.hoverProbe = this.createProbe(this.pointer.x, this.pointer.y);
      this.buildExpressionLabels(labels);
      this.buildAnnotations(vertices, labels);
      this.buildHoverProbe(vertices, labels);
      this.renderLabels(labels);

      const encoder = this.device.createCommandEncoder({ label: "Orbifold frame encoder" });
      const view = this.context.getCurrentTexture().createView();
      const background = this.settings.dark
        ? { r: 0.125, g: 0.129, b: 0.141, a: 1 }
        : { r: 1, g: 1, b: 1, a: 1 };
      this.writeGridUniforms();
      const gridPass = encoder.beginRenderPass({
        colorAttachments: [{ view, clearValue: background, loadOp: "clear", storeOp: "store" }],
      });
      gridPass.setPipeline(this.gridPipeline);
      gridPass.setBindGroup(0, this.gridBindGroup);
      gridPass.draw(3);
      gridPass.end();

      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: "load", storeOp: "store" }],
      });
      if (vertices.length) {
        const data = new Float32Array(vertices);
        if (!this.vertexBuffer || this.vertexBuffer.size < data.byteLength) {
          this.vertexBuffer?.destroy();
          const size = Math.max(24, Math.ceil(data.byteLength / 4096) * 4096);
          this.vertexBuffer = this.device.createBuffer({
            label: "Orbifold geometry buffer",
            size,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
        }
        this.device.queue.writeBuffer(this.vertexBuffer, 0, data);
        pass.setPipeline(this.pipeline);
        pass.setVertexBuffer(0, this.vertexBuffer);
        pass.draw(data.length / 6);
      }
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      const viewState = this.cameraState();
      this.canvas.dispatchEvent(new CustomEvent("graph-view-change", {
        detail: {
          mode: this.mode,
          orientation: this.mode === "3d" ? [...this.camera.orientation] : [0, 0, 0, 1],
          basis: this.mode === "3d" ? {
            right: [viewState.right.x, viewState.right.y, viewState.right.z],
            up: [viewState.up.x, viewState.up.y, viewState.up.z],
            forward: [viewState.forward.x, viewState.forward.y, viewState.forward.z],
          } : {
            right: [1, 0, 0],
            up: [0, 1, 0],
            forward: [0, 0, -1],
          },
        },
      }));
    }

    writeGridUniforms() {
      const state = this.cameraState();
      const pixelsPerUnit = this.mode === "2d"
        ? this.view2d.scale
        : state.focal / Math.max(this.camera.distance, 0.001);
      const majorStep = this.mode === "3d"
        ? this.gridMajorStep3d(state)
        : 5 * 10 ** Math.ceil(Math.log10(70 / Math.max(pixelsPerUnit * 5, 0.001)));
      const minorStep = majorStep / 5;
      const microStep = majorStep / 10;
      const smoothstep = (start, end, value) => {
        const amount = clamp((value - start) / (end - start), 0, 1);
        return amount * amount * (3 - 2 * amount);
      };
      const minorAlpha = smoothstep(8, 22, minorStep * pixelsPerUnit);
      const microAlpha = smoothstep(8, 28, microStep * pixelsPerUnit);
      const majorAlpha = 0.09 + smoothstep(70, 150, majorStep * pixelsPerUnit) * 0.13;
      const uniforms = new Float32Array([
        this.width, this.height, this.mode === "3d" ? this.projection === "orthographic" ? 2 : 1 : 0, this.settings.dark ? 1 : 0,
        this.view2d.centerX, this.mode === "3d" ? this.camera.distance : this.view2d.centerY, this.view2d.scale, state.focal,
        state.position.x, state.position.y, state.position.z, majorStep,
        state.right.x, state.right.y, state.right.z, minorStep,
        state.up.x, state.up.y, state.up.z, microStep,
        state.forward.x, state.forward.y, state.forward.z, minorAlpha,
        microAlpha, this.settings.grid ? 1 : 0, this.settings.axes ? 1 : 0, majorAlpha,
      ]);
      this.device.queue.writeBuffer(this.gridUniformBuffer, 0, uniforms);
    }

    renderLabels(labels) {
      this.labelLayer.replaceChildren();
      for (const label of labels) {
        if (!this.settings.labels && !label.always) continue;
        if (!Number.isFinite(label.x) || !Number.isFinite(label.y)) continue;
        const span = document.createElement("span");
        span.textContent = label.text;
        span.style.left = `${label.x}px`;
        span.style.top = `${label.y}px`;
        if (label.color) span.style.color = label.color;
        if (label.axis) span.classList.add("axis-name");
        if (label.className) span.classList.add(label.className);
        if (label.editId) {
          span.dataset.editId = label.editId;
          span.title = "Double-click to edit label";
          span.addEventListener("dblclick", (event) => {
            event.stopPropagation();
            span.textContent = label.editValue || label.text || "";
            span.contentEditable = "plaintext-only";
            span.classList.add("is-editing");
            span.focus();
            const selection = window.getSelection();
            selection?.selectAllChildren(span);
          });
          const commit = () => {
            if (!span.isContentEditable) return;
            span.contentEditable = "false";
            span.classList.remove("is-editing");
            this.canvas.dispatchEvent(new CustomEvent("graph-label-change", { detail: { id: label.editId, label: span.textContent || "" } }));
          };
          span.addEventListener("blur", commit);
          span.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              span.blur();
            }
            if (event.key === "Escape") {
              span.textContent = label.editValue || label.text || "";
              span.blur();
            }
          });
        }
        if (label.latex && window.katex) {
          span.textContent = "";
          window.katex.render(label.latex, span, { throwOnError: false });
        }
        this.labelLayer.append(span);
      }
    }

    clipPoint(point) {
      return { x: point.x / this.width * 2 - 1, y: 1 - point.y / this.height * 2 };
    }

    addVertex(vertices, point, color) {
      const clip = this.clipPoint(point);
      vertices.push(clip.x, clip.y, ...color);
    }

    addTriangle(vertices, a, b, c, color) {
      this.addVertex(vertices, a, color);
      this.addVertex(vertices, b, color);
      this.addVertex(vertices, c, color);
    }

    addLine(vertices, a, b, width, color) {
      if (!a || !b || !Number.isFinite(a.x + a.y + b.x + b.y)) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.001) return;
      const nx = -dy / length * width * 0.5;
      const ny = dx / length * width * 0.5;
      const p0 = { x: a.x + nx, y: a.y + ny };
      const p1 = { x: a.x - nx, y: a.y - ny };
      const p2 = { x: b.x - nx, y: b.y - ny };
      const p3 = { x: b.x + nx, y: b.y + ny };
      this.addTriangle(vertices, p0, p1, p2, color);
      this.addTriangle(vertices, p0, p2, p3, color);
    }

    addStyledLine(vertices, a, b, width, color, expression) {
      const style = expression?.lineStyle || "solid";
      if (style === "solid") {
        this.addLine(vertices, a, b, width, color);
        return;
      }
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const coordinate = Math.abs(dx) >= Math.abs(dy) ? (a.x + b.x) * 0.5 : (a.y + b.y) * 0.5;
      const period = style === "dotted" ? 7 : 17;
      const ink = style === "dotted" ? 2.2 : 10;
      const phase = ((coordinate % period) + period) % period;
      if (phase <= ink) this.addLine(vertices, a, b, style === "dotted" ? Math.max(width, 2.4) : width, color);
    }

    addDisc(vertices, point, radius, color) {
      const steps = 18;
      for (let index = 0; index < steps; index += 1) {
        const start = index / steps * Math.PI * 2;
        const end = (index + 1) / steps * Math.PI * 2;
        this.addTriangle(vertices, point, {
          x: point.x + Math.cos(start) * radius,
          y: point.y + Math.sin(start) * radius,
        }, {
          x: point.x + Math.cos(end) * radius,
          y: point.y + Math.sin(end) * radius,
        }, color);
      }
    }

    lineWidth(expression, base) {
      return expression.id === this.selectedExpressionId ? base + 2.2 : base;
    }

    safeEvaluate(expression, scope) {
      try {
        const evaluationScope = this.evaluationScope || (this.evaluationScope = { ...this.constants });
        for (const name in scope) evaluationScope[name] = scope[name];
        const value = expression.compiled.evaluate(evaluationScope);
        return Number.isFinite(value) ? value : NaN;
      } catch (error) {
        return NaN;
      }
    }

    safeEvaluatePoint(expression, scope) {
      try {
        const values = expression.compiled.evaluatePoint({ ...this.constants, ...scope });
        return values.every(Number.isFinite) ? values : null;
      } catch (error) {
        return null;
      }
    }

    safeEvaluateComplex(expression, z) {
      try {
        const value = expression.compiled.evaluateComplex({ ...this.constants, z });
        return Number.isFinite(value?.re + value?.im) ? value : null;
      } catch (error) {
        return null;
      }
    }

    recurrenceEscape(expression, c) {
      try {
        const limit = Math.min(256, Math.max(8, expression.iterations || 64));
        let value = { re: 0, im: 0 };
        for (let iteration = 0; iteration < limit; iteration += 1) {
          value = expression.compiled.evaluateStep(value, c, this.constants);
          const magnitude = Math.hypot(value.re, value.im);
          if (!Number.isFinite(magnitude)) return { iteration, limit, escaped: true, value };
          if (magnitude > 4) {
            const smooth = iteration + 1 - Math.log2(Math.max(1, Math.log2(magnitude)));
            return { iteration: smooth, limit, escaped: true, value };
          }
        }
        return { iteration: limit, limit, escaped: false, value };
      } catch (error) {
        return null;
      }
    }

    recurrenceColor(result, alpha = 0.9) {
      if (!result) return [0, 0, 0, 0];
      if (!result.escaped) return this.settings.dark ? [0.04, 0.05, 0.07, alpha] : [0.035, 0.045, 0.07, alpha];
      const amount = clamp(result.iteration / result.limit, 0, 1);
      return hsvToColor(0.58 + amount * 0.78, 0.82, 0.35 + 0.65 * Math.sqrt(amount), alpha);
    }

    complexColor(value, strategy, alpha = 0.78) {
      const magnitude = Math.hypot(value.re, value.im);
      const phase = Math.atan2(value.im, value.re);
      const hue = phase / (Math.PI * 2) + 0.5;
      if (strategy === "magnitude") {
        const light = 0.25 + 0.7 * (1 - Math.exp(-magnitude * 0.22));
        return hsvToColor(0.58, 0.72, light, alpha);
      }
      if (strategy === "phase") return hsvToColor(hue, 0.9, 0.9, alpha);
      const bands = 0.82 + 0.18 * Math.cos(Math.log1p(magnitude) * Math.PI * 2);
      return hsvToColor(hue, 0.82, clamp(bands, 0.48, 1), alpha);
    }

    recordLine(expression, a, b, worldA, worldB) {
      if (!a || !b || !worldA || !worldB) return;
      if (![a.x, a.y, b.x, b.y, worldA.x, worldA.y, worldB.x, worldB.y].every(Number.isFinite)) return;
      this.hitGeometry.push({ type: "line", expression, a, b, worldA, worldB });
    }

    recordTriangle(expression, a, b, c, worldA, worldB, worldC) {
      if (!a || !b || !c) return;
      this.hitGeometry.push({ type: "triangle", expression, a, b, c, worldA, worldB, worldC });
    }

    nearestPointOnLine(x, y, geometry) {
      const dx = geometry.b.x - geometry.a.x;
      const dy = geometry.b.y - geometry.a.y;
      const lengthSquared = dx * dx + dy * dy || 1;
      const amount = clamp(((x - geometry.a.x) * dx + (y - geometry.a.y) * dy) / lengthSquared, 0, 1);
      const screen = { x: geometry.a.x + dx * amount, y: geometry.a.y + dy * amount };
      const world = {
        x: geometry.worldA.x + (geometry.worldB.x - geometry.worldA.x) * amount,
        y: geometry.worldA.y + (geometry.worldB.y - geometry.worldA.y) * amount,
        z: (geometry.worldA.z || 0) + ((geometry.worldB.z || 0) - (geometry.worldA.z || 0)) * amount,
      };
      return { distance: Math.hypot(x - screen.x, y - screen.y), screen, world, geometry };
    }

    pointInTriangle(x, y, triangle) {
      const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
      const point = { x, y };
      const d1 = sign(point, triangle.a, triangle.b);
      const d2 = sign(point, triangle.b, triangle.c);
      const d3 = sign(point, triangle.c, triangle.a);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    }

    hitTestExpression(x, y, lineThreshold = 9) {
      let closest = null;
      for (const geometry of this.hitGeometry) {
        if (geometry.type !== "line") continue;
        const hit = this.nearestPointOnLine(x, y, geometry);
        if (hit.distance <= lineThreshold && (!closest || hit.distance < closest.distance)) closest = hit;
      }
      if (closest) return { ...closest, expression: closest.geometry.expression };
      for (let index = this.hitGeometry.length - 1; index >= 0; index -= 1) {
        const geometry = this.hitGeometry[index];
        if (geometry.type === "triangle" && this.pointInTriangle(x, y, geometry)) {
          return { expression: geometry.expression, geometry, distance: 0 };
        }
      }
      return null;
    }

    hitTestCurve(x, y, threshold = 16, includeConstructions = false) {
      let closest = null;
      for (const geometry of this.hitGeometry) {
        if (geometry.type !== "line" || geometry.expression.id === "shape-preview") continue;
        if (!includeConstructions && geometry.expression.type && geometry.expression.type !== "expression") continue;
        if (geometry.expression.compiled?.kind === "z-of-xy") continue;
        const hit = this.nearestPointOnLine(x, y, geometry);
        if (hit.distance <= threshold && (!closest || hit.distance < closest.distance)) closest = hit;
      }
      return closest ? { ...closest, expression: closest.geometry.expression } : null;
    }

    projectWorld(point) {
      return this.mode === "2d" ? this.worldToScreen2d(point.x, point.y) : this.project3(point, this.cameraState());
    }

    explicitPoint(expression, input) {
      if (expression.compiled.kind === "y-of-x") {
        const y = this.safeEvaluate(expression, { x: input });
        return Number.isFinite(y) ? { x: input, y, z: 0 } : null;
      }
      const x = this.safeEvaluate(expression, { y: input });
      return Number.isFinite(x) ? { x, y: input, z: 0 } : null;
    }

    derivative(expression, input) {
      const step = Math.max(1e-5, Math.abs(input) * 1e-5, this.settings.range * 1e-6);
      const before = this.explicitPoint(expression, input - step);
      const after = this.explicitPoint(expression, input + step);
      if (!before || !after) return NaN;
      const outputBefore = expression.compiled.kind === "y-of-x" ? before.y : before.x;
      const outputAfter = expression.compiled.kind === "y-of-x" ? after.y : after.x;
      return (outputAfter - outputBefore) / (step * 2);
    }

    keyPointNear(expression, input, screenX, screenY) {
      if (!this.settings.snapping || !["y-of-x", "x-of-y"].includes(expression.compiled.kind)) return null;
      const radius = this.mode === "2d" ? 34 / this.view2d.scale : this.settings.range * 0.05;
      const candidates = [];
      const addCandidate = (candidateInput, snapType) => {
        if (!Number.isFinite(candidateInput) || Math.abs(candidateInput - input) > radius * 1.5) return;
        const point = this.explicitPoint(expression, candidateInput);
        const screen = point && this.projectWorld(point);
        if (!screen) return;
        const distance = Math.hypot(screen.x - screenX, screen.y - screenY);
        if (distance <= 15) candidates.push({ point, screen, distance, snapType });
      };

      addCandidate(0, "axis intercept");
      let root = input;
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const point = this.explicitPoint(expression, root);
        const output = expression.compiled.kind === "y-of-x" ? point?.y : point?.x;
        const slope = this.derivative(expression, root);
        if (!Number.isFinite(output) || !Number.isFinite(slope) || Math.abs(slope) < 1e-8) break;
        root -= output / slope;
      }
      addCandidate(root, "zero");

      let critical = input;
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const step = Math.max(1e-4, Math.abs(critical) * 1e-4, radius * 0.01);
        const first = this.derivative(expression, critical);
        const second = (this.derivative(expression, critical + step) - this.derivative(expression, critical - step)) / (step * 2);
        if (!Number.isFinite(first) || !Number.isFinite(second) || Math.abs(second) < 1e-8) break;
        critical -= first / second;
      }
      const criticalSlope = this.derivative(expression, critical);
      if (Math.abs(criticalSlope) < 1e-4) {
        const step = Math.max(1e-3, radius * 0.02);
        const curvature = (this.derivative(expression, critical + step) - this.derivative(expression, critical - step)) / (step * 2);
        addCandidate(critical, curvature >= 0 ? "minimum" : "maximum");
      }
      return candidates.sort((a, b) => a.distance - b.distance)[0] || null;
    }

    implicitGradient(expression, point) {
      const step = Math.max(1e-5, this.settings.range * 1e-5);
      return {
        x: (this.safeEvaluate(expression, { x: point.x + step, y: point.y }) - this.safeEvaluate(expression, { x: point.x - step, y: point.y })) / (step * 2),
        y: (this.safeEvaluate(expression, { x: point.x, y: point.y + step }) - this.safeEvaluate(expression, { x: point.x, y: point.y - step })) / (step * 2),
      };
    }

    implicitKeyPointNear(expression, start, screenX, screenY) {
      if (!this.settings.snapping) return null;
      const radius = this.mode === "2d" ? 34 / this.view2d.scale : this.settings.range * 0.05;
      const candidates = [];
      const addCandidate = (point, snapType) => {
        if (!point || Math.hypot(point.x - start.x, point.y - start.y) > radius * 1.5) return;
        const screen = this.projectWorld(point);
        if (!screen) return;
        const distance = Math.hypot(screen.x - screenX, screen.y - screenY);
        if (distance <= 15) candidates.push({ point: { ...point, z: 0 }, screen, distance, snapType });
      };

      const solveExtremum = (component, snapType) => {
        const point = { x: start.x, y: start.y, z: 0 };
        const step = Math.max(1e-4, radius * 0.01);
        for (let iteration = 0; iteration < 8; iteration += 1) {
          const value = this.safeEvaluate(expression, point);
          const gradient = this.implicitGradient(expression, point);
          const constraint = gradient[component];
          const gradientX = this.implicitGradient(expression, { x: point.x + step, y: point.y });
          const gradientY = this.implicitGradient(expression, { x: point.x, y: point.y + step });
          const constraintX = (gradientX[component] - constraint) / step;
          const constraintY = (gradientY[component] - constraint) / step;
          const determinant = gradient.x * constraintY - gradient.y * constraintX;
          if (!Number.isFinite(value + constraint + determinant) || Math.abs(determinant) < 1e-10) return null;
          point.x += (-value * constraintY + constraint * gradient.y) / determinant;
          point.y += (-constraint * gradient.x + value * constraintX) / determinant;
        }
        return { point, snapType };
      };

      const xExtremum = solveExtremum("y", "x extremum");
      const yExtremum = solveExtremum("x", "y extremum");
      addCandidate(xExtremum?.point, xExtremum?.snapType);
      addCandidate(yExtremum?.point, yExtremum?.snapType);

      const xIntercept = { x: start.x, y: 0, z: 0 };
      const yIntercept = { x: 0, y: start.y, z: 0 };
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const xGradient = this.implicitGradient(expression, xIntercept);
        const yGradient = this.implicitGradient(expression, yIntercept);
        if (Math.abs(xGradient.x) > 1e-9) xIntercept.x -= this.safeEvaluate(expression, xIntercept) / xGradient.x;
        if (Math.abs(yGradient.y) > 1e-9) yIntercept.y -= this.safeEvaluate(expression, yIntercept) / yGradient.y;
      }
      addCandidate(xIntercept, "x intercept");
      addCandidate(yIntercept, "y intercept");
      return candidates.sort((a, b) => a.distance - b.distance)[0] || null;
    }

    tangentFor(expression, point) {
      if (expression.compiled?.kind === "y-of-x") {
        const slope = this.derivative(expression, point.x);
        if (!Number.isFinite(slope)) return null;
        return { x: 1, y: slope, z: 0 };
      }
      if (expression.compiled?.kind === "x-of-y") {
        const slope = this.derivative(expression, point.y);
        if (!Number.isFinite(slope)) return null;
        return { x: slope, y: 1, z: 0 };
      }
      if (expression.compiled?.kind === "implicit") {
        const gradient = this.implicitGradient(expression, point);
        if (!Number.isFinite(gradient.x + gradient.y) || Math.hypot(gradient.x, gradient.y) < 1e-8) return null;
        return { x: -gradient.y, y: gradient.x, z: 0 };
      }
      return null;
    }

    tangentEquation(point, direction) {
      if (Math.abs(direction.z || 0) > 1e-7) {
        return `\\mathbf r=\\left(${this.formatGridNumber(point.x)},${this.formatGridNumber(point.y)},${this.formatGridNumber(point.z || 0)}\\right)+s\\left(${this.formatGridNumber(direction.x)},${this.formatGridNumber(direction.y)},${this.formatGridNumber(direction.z)}\\right)`;
      }
      if (Math.abs(direction.x) < 1e-7) return `x=${this.formatGridNumber(point.x)}`;
      const slope = direction.y / direction.x;
      const intercept = point.y - slope * point.x;
      const sign = intercept >= 0 ? "+" : "";
      return `y=${this.formatGridNumber(slope)}x${sign}${this.formatGridNumber(intercept)}`;
    }

    createProbe(screenX, screenY) {
      if (this.tool !== "point" && this.tool !== "tangent") return null;
      const hit = this.hitTestCurve(screenX, screenY);
      if (!hit) return null;
      let point = hit.world;
      let screen = hit.screen;
      let snapType = "";
      const kind = hit.expression.compiled.kind;
      if (kind === "y-of-x" || kind === "x-of-y") {
        const input = kind === "y-of-x" ? point.x : point.y;
        const exact = this.explicitPoint(hit.expression, input);
        if (exact) {
          point = exact;
          screen = this.projectWorld(point) || screen;
        }
        const keyPoint = this.keyPointNear(hit.expression, input, screenX, screenY);
        if (keyPoint) {
          point = keyPoint.point;
          screen = keyPoint.screen;
          snapType = keyPoint.snapType;
        }
      } else if (kind === "implicit") {
        const keyPoint = this.implicitKeyPointNear(hit.expression, point, screenX, screenY);
        if (keyPoint) {
          point = keyPoint.point;
          screen = keyPoint.screen;
          snapType = keyPoint.snapType;
        }
      }
      const segmentDirection = {
        x: hit.geometry.worldB.x - hit.geometry.worldA.x,
        y: hit.geometry.worldB.y - hit.geometry.worldA.y,
        z: (hit.geometry.worldB.z || 0) - (hit.geometry.worldA.z || 0),
      };
      const direction = this.tool === "tangent" ? this.tangentFor(hit.expression, point) || segmentDirection : null;
      if (this.tool === "tangent" && !direction) return null;
      return {
        kind: this.tool,
        expressionId: hit.expression.id,
        color: hit.expression.color,
        point,
        screen,
        direction,
        equation: direction ? this.tangentEquation(point, direction) : "",
        snapType,
      };
    }

    updateToolHover() {
      const next = this.createProbe(this.pointer.x, this.pointer.y);
      const previousSignature = this.hoverProbe ? `${this.hoverProbe.expressionId}:${this.hoverProbe.kind}:${this.hoverProbe.point.x}:${this.hoverProbe.point.y}` : "";
      const nextSignature = next ? `${next.expressionId}:${next.kind}:${next.point.x}:${next.point.y}` : "";
      if (previousSignature === nextSignature) return;
      this.hoverProbe = next;
      this.requestRender();
    }

    annotationScreenPoint(point) {
      return this.mode === "2d" ? this.worldToScreen2d(point.x, point.y) : this.project3(point, this.cameraState());
    }

    drawTangent(vertices, point, direction, color, width = 2.2, extentKind = "line") {
      const normal = normalize3(direction);
      const visibleExtent = this.mode === "2d" ? Math.max(this.width, this.height) / this.view2d.scale * 1.2 : 0;
      const extent = Math.max(this.settings.range * 1.8, visibleExtent);
      const backward = extentKind === "ray" ? 0 : extentKind === "segment" ? extent * 0.35 : extent;
      const forward = extentKind === "segment" ? extent * 0.35 : extent;
      const a = { x: point.x - normal.x * backward, y: point.y - normal.y * backward, z: (point.z || 0) - normal.z * backward };
      const b = { x: point.x + normal.x * forward, y: point.y + normal.y * forward, z: (point.z || 0) + normal.z * forward };
      if (this.mode === "2d") this.addLine(vertices, this.worldToScreen2d(a.x, a.y), this.worldToScreen2d(b.x, b.y), width, color);
      else this.addProjectedLine(vertices, this.cameraState(), a, b, width, color);
    }

    drawPoint(vertices, point, color, radius = 5) {
      const screen = this.annotationScreenPoint(point);
      if (!screen) return null;
      this.addDisc(vertices, screen, radius + 2, this.settings.dark ? [0.12, 0.13, 0.14, 0.96] : [1, 1, 1, 0.96]);
      this.addDisc(vertices, screen, radius, color);
      return screen;
    }

    buildExpressionLabels(labels) {
      if (!this.objectLabelsVisible()) return;
      const center = { x: this.width * 0.5, y: this.height * 0.5 };
      for (const expression of this.visibleExpressions()) {
        if (!expression.showLabel) continue;
        let best = null;
        for (const geometry of this.hitGeometry) {
          if (geometry.expression.id !== expression.id) continue;
          const point = geometry.type === "line"
            ? { x: (geometry.a.x + geometry.b.x) * 0.5, y: (geometry.a.y + geometry.b.y) * 0.5 }
            : { x: (geometry.a.x + geometry.b.x + geometry.c.x) / 3, y: (geometry.a.y + geometry.b.y + geometry.c.y) / 3 };
          if (point.x < 8 || point.y < 8 || point.x > this.width - 8 || point.y > this.height - 8) continue;
          const distance = Math.hypot(point.x - center.x, point.y - center.y);
          if (!best || distance < best.distance) best = { point, distance };
        }
        if (!best) continue;
        const displayLabel = expression.graphLabel || expression.latex;
        labels.push({
          x: best.point.x + 10,
          y: best.point.y - 10,
          text: displayLabel,
          latex: expression.graphLabel ? null : expression.latex,
          color: expression.color,
          always: true,
          className: "graph-equation-label",
          editId: expression.id,
          editValue: displayLabel,
        });
      }
    }

    objectLabelsVisible() {
      return this.mode === "2d" ? this.view2d.scale >= 9 : this.camera.distance <= 135;
    }

    buildAnnotations(vertices, labels) {
      for (const annotation of this.annotations) {
        if (annotation.visible === false || annotation.layer?.visible === false || !annotation.point) continue;
        const color = hexToColor(annotation.color || "#2d70b3");
        if (annotation.annotationKind === "tangent" && annotation.direction) {
          this.drawTangent(vertices, annotation.point, annotation.direction, color, 2.4, annotation.extent || "line");
          const normal = normalize3(annotation.direction);
          const extent = Math.max(this.settings.range * 1.8, this.mode === "2d" ? Math.max(this.width, this.height) / this.view2d.scale : 0);
          const backward = annotation.extent === "ray" ? 0 : annotation.extent === "segment" ? extent * 0.35 : extent;
          const forward = annotation.extent === "segment" ? extent * 0.35 : extent;
          const a = { x: annotation.point.x - normal.x * backward, y: annotation.point.y - normal.y * backward, z: (annotation.point.z || 0) - normal.z * backward };
          const b = { x: annotation.point.x + normal.x * forward, y: annotation.point.y + normal.y * forward, z: (annotation.point.z || 0) + normal.z * forward };
          this.recordWorldLine(annotation, a, b);
        }
        const screen = this.drawPoint(vertices, annotation.point, color, 4.6);
        if (annotation.id === this.selectedExpressionId && annotation.direction) {
          const normal = normalize3(annotation.direction);
          const handleDistance = this.mode === "2d" ? 54 / this.view2d.scale : Math.max(1, this.settings.range * 0.08);
          this.drawPoint(vertices, {
            x: annotation.point.x + normal.x * handleDistance,
            y: annotation.point.y + normal.y * handleDistance,
            z: (annotation.point.z || 0) + normal.z * handleDistance,
          }, color, 3.7);
        }
        if (screen) this.recordLine(annotation, { x: screen.x - 6, y: screen.y }, { x: screen.x + 6, y: screen.y }, annotation.point, annotation.point);
        if (screen && this.objectLabelsVisible()) labels.push({
          x: screen.x + 12, y: screen.y - 12, text: annotation.graphLabel || annotation.label,
          color: annotation.color, always: true, className: "graph-annotation-label", editId: annotation.id,
          editValue: annotation.graphLabel || annotation.label,
        });
      }
      this.buildShapes(vertices, labels);
    }

    shapeScreenPoint(point) {
      return this.mode === "2d" ? this.worldToScreen2d(point.x, point.y) : this.project3(point, this.cameraState());
    }

    recordWorldLine(expression, a, b) {
      if (this.mode === "2d") {
        this.recordLine(expression, this.worldToScreen2d(a.x, a.y), this.worldToScreen2d(b.x, b.y), a, b);
        return;
      }
      const projected = this.projectSegment3(a, b, this.cameraState());
      const clipped = projected && this.clipScreenLine(projected[0], projected[1], 180);
      if (clipped) this.recordLine(expression, clipped[0], clipped[1], a, b);
    }

    drawShapeSegment(vertices, shape, a, b, extentKind = shape.extent || "segment") {
      const direction = { x: b.x - a.x, y: b.y - a.y, z: (b.z || 0) - (a.z || 0) };
      if (Math.hypot(direction.x, direction.y, direction.z) < 1e-9) return;
      if (extentKind !== "segment") {
        const origin = extentKind === "ray" ? a : {
          x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: ((a.z || 0) + (b.z || 0)) * 0.5,
        };
        this.drawTangent(vertices, origin, direction, hexToColor(shape.color), this.lineWidth(shape, 2.5), extentKind);
        const normal = normalize3(direction);
        const visibleExtent = this.mode === "2d" ? Math.max(this.width, this.height) / this.view2d.scale * 1.2 : this.settings.range * 1.8;
        const backward = extentKind === "ray" ? 0 : visibleExtent;
        const worldA = { x: origin.x - normal.x * backward, y: origin.y - normal.y * backward, z: (origin.z || 0) - normal.z * backward };
        const worldB = { x: origin.x + normal.x * visibleExtent, y: origin.y + normal.y * visibleExtent, z: (origin.z || 0) + normal.z * visibleExtent };
        this.recordWorldLine(shape, worldA, worldB);
      } else {
        const screenA = this.shapeScreenPoint(a);
        const screenB = this.shapeScreenPoint(b);
        if (this.mode === "2d") this.addLine(vertices, screenA, screenB, this.lineWidth(shape, 2.5), hexToColor(shape.color));
        else this.addProjectedLine(vertices, this.cameraState(), a, b, this.lineWidth(shape, 2.5), hexToColor(shape.color));
        this.recordWorldLine(shape, a, b);
      }
    }

    buildShapes(vertices, labels) {
      for (const shape of this.annotations) {
        if (shape.type !== "shape" || shape.visible === false || shape.layer?.visible === false) continue;
        const color = hexToColor(shape.color);
        if (["line", "ray", "segment", "secant"].includes(shape.shapeKind) && shape.points?.length >= 2) {
          this.drawShapeSegment(vertices, shape, shape.points[0], shape.points[1], shape.extent);
        }
        if (shape.shapeKind === "tangent" && shape.points?.[0] && shape.direction) {
          this.drawTangent(vertices, shape.points[0], shape.direction, color, this.lineWidth(shape, 2.5), shape.extent);
          const normal = normalize3(shape.direction);
          const extent = Math.max(this.settings.range * 1.8, 20);
          const a = { x: shape.points[0].x - normal.x * extent, y: shape.points[0].y - normal.y * extent, z: (shape.points[0].z || 0) - normal.z * extent };
          const b = { x: shape.points[0].x + normal.x * extent, y: shape.points[0].y + normal.y * extent, z: (shape.points[0].z || 0) + normal.z * extent };
          this.recordWorldLine(shape, a, b);
        }
        if ((shape.shapeKind === "circle" || shape.shapeKind === "arc") && shape.center && Number.isFinite(shape.radius)) {
          const startAngle = shape.shapeKind === "arc" ? Math.atan2(shape.points[0].y - shape.center.y, shape.points[0].x - shape.center.x) : 0;
          let endAngle = shape.shapeKind === "arc" ? Math.atan2(shape.points[2].y - shape.center.y, shape.points[2].x - shape.center.x) : Math.PI * 2;
          if (shape.shapeKind === "arc") {
            const middleAngle = Math.atan2(shape.points[1].y - shape.center.y, shape.points[1].x - shape.center.x);
            const tau = Math.PI * 2;
            const counterclockwiseSpan = (endAngle - startAngle + tau) % tau;
            const middleSpan = (middleAngle - startAngle + tau) % tau;
            endAngle = middleSpan <= counterclockwiseSpan ? startAngle + counterclockwiseSpan : startAngle - (tau - counterclockwiseSpan);
          }
          const samples = clamp(Math.round(shape.radius * (this.mode === "2d" ? this.view2d.scale : 12)), 48, 720);
          let previous = null;
          let previousWorld = null;
          for (let index = 0; index <= samples; index += 1) {
            const angle = startAngle + (endAngle - startAngle) * index / samples;
            const world = { x: shape.center.x + Math.cos(angle) * shape.radius, y: shape.center.y + Math.sin(angle) * shape.radius, z: shape.center.z || 0 };
            const screen = this.shapeScreenPoint(world);
            if (previous && screen) {
              this.addLine(vertices, previous, screen, this.lineWidth(shape, 2.5), color);
              this.recordLine(shape, previous, screen, previousWorld, world);
            }
            previous = screen;
            previousWorld = world;
          }
        }
        if (shape.id === this.selectedExpressionId) {
          for (const point of shape.points || []) this.drawPoint(vertices, point, color, 4.2);
          if (shape.direction && shape.points?.[0]) {
            const normal = normalize3(shape.direction);
            const handleDistance = this.mode === "2d" ? 54 / this.view2d.scale : Math.max(1, this.settings.range * 0.08);
            this.drawPoint(vertices, {
              x: shape.points[0].x + normal.x * handleDistance,
              y: shape.points[0].y + normal.y * handleDistance,
              z: (shape.points[0].z || 0) + normal.z * handleDistance,
            }, color, 3.7);
          }
        }
        const anchor = shape.center || shape.points?.[0];
        const screen = anchor && this.shapeScreenPoint(anchor);
        if (shape.showLabel && screen && this.objectLabelsVisible()) labels.push({
          x: screen.x + 12, y: screen.y - 12, text: shape.graphLabel || shape.label,
          color: shape.color, always: true, className: "graph-annotation-label", editId: shape.id,
          editValue: shape.graphLabel || shape.label,
        });
      }
      this.buildShapePreview(vertices);
    }

    buildShapePreview(vertices) {
      if (this.tool !== "shape" && this.tool !== "curve") return;
      const color = [0.09, 0.63, 0.98, 0.72];
      const snapColor = [0.22, 0.72, 0.37, 0.96];
      const points = [...(this.shapeDraft?.points || [])];
      const constraints = [...(this.shapeDraft?.constraints || [])];
      if (this.pointer.drag?.mode === "shape") {
        if (!points.length) {
          points.push(this.pointer.drag.start);
          constraints.push(this.pointer.drag.startConstraint || null);
        }
        points.push(this.pointer.drag.current);
        constraints.push(this.pointer.drag.currentConstraint || null);
      } else if (this.shapeHoverPoint) {
        points.push(this.shapeHoverPoint);
        constraints.push(this.shapeHoverConstraint || null);
      }
      if (this.shapeHoverPoint) this.drawPoint(vertices, this.shapeHoverPoint, this.shapeHoverSnapped ? snapColor : color, this.shapeHoverSnapped ? 4.5 : 3.2);
      const activeConstraint = constraints[constraints.length - 1];
      if (activeConstraint?.kind === "tangent") {
        const extent = this.mode === "2d" ? 32 / this.view2d.scale : Math.max(0.8, this.settings.range * 0.035);
        const direction = activeConstraint.direction;
        const a = { x: activeConstraint.point.x - direction.x * extent, y: activeConstraint.point.y - direction.y * extent, z: activeConstraint.point.z || 0 };
        const b = { x: activeConstraint.point.x + direction.x * extent, y: activeConstraint.point.y + direction.y * extent, z: activeConstraint.point.z || 0 };
        this.drawShapeSegment(vertices, { id: "constraint-preview", type: "shape", extent: "segment", color: "#38b85e" }, a, b, "segment");
      }
      if (this.tool === "curve") {
        if (points.length >= 2) this.drawCurveTemplatePreview(vertices, this.curveKind, points[0], points[1], color);
        for (const point of points) this.drawPoint(vertices, point, color, 3.5);
        return;
      }
      if (this.shapeKind === "tangent-curve") {
        const hit = this.hitTestCurve(this.pointer.x, this.pointer.y, 18, true);
        if (!hit) return;
        const segment = {
          x: hit.geometry.worldB.x - hit.geometry.worldA.x,
          y: hit.geometry.worldB.y - hit.geometry.worldA.y,
          z: (hit.geometry.worldB.z || 0) - (hit.geometry.worldA.z || 0),
        };
        const direction = this.tangentFor(hit.expression, hit.world) || segment;
        this.drawTangent(vertices, hit.world, direction, color, 2, "line");
        return;
      }
      if (points.length < 2) return;
      if (this.shapeKind === "circle-center" || this.shapeKind === "circle-diameter") {
        const { center, radius } = this.circleFromTwoPoints(this.shapeKind, points, constraints);
        this.drawPreviewCircle(vertices, center, radius, 0, Math.PI * 2, color);
        for (const point of points) this.drawPoint(vertices, point, color, 3.5);
        return;
      }
      if ((this.shapeKind === "circle-three-point" || this.shapeKind === "arc-three-point") && points.length >= 3) {
        const circle = this.circleThroughConstrainedPoints(points, constraints);
        if (circle) {
          let start = 0;
          let end = Math.PI * 2;
          if (this.shapeKind === "arc-three-point") {
            start = Math.atan2(points[0].y - circle.center.y, points[0].x - circle.center.x);
            const middle = Math.atan2(points[1].y - circle.center.y, points[1].x - circle.center.x);
            const finish = Math.atan2(points[2].y - circle.center.y, points[2].x - circle.center.x);
            const tau = Math.PI * 2;
            const counterclockwise = (finish - start + tau) % tau;
            end = (middle - start + tau) % tau <= counterclockwise ? start + counterclockwise : start - (tau - counterclockwise);
          }
          this.drawPreviewCircle(vertices, circle.center, circle.radius, start, end, color);
        }
      } else {
        const extent = { "line-two-point": "line", "ray-two-point": "ray", "secant-curve": "line" }[this.shapeKind] || "segment";
        const preview = { id: "shape-preview", type: "shape", color: "#18a0fb", extent };
        const constrainedPoints = this.linePointsWithConstraints(points, constraints);
        this.drawShapeSegment(vertices, preview, constrainedPoints[0], constrainedPoints[1], extent);
      }
      for (const point of points) this.drawPoint(vertices, point, color, 3.5);
    }

    drawCurveTemplatePreview(vertices, kind, a, b, color) {
      if (kind === "line" && Math.abs(b.x - a.x) < 1e-5) {
        const bounds = this.mode === "2d" ? [this.screenToWorld2d(0, 0).y, this.screenToWorld2d(0, this.height).y] : [-this.settings.range, this.settings.range];
        this.drawShapeSegment(vertices, { id: "curve-preview", type: "shape", extent: "line", color: "#18a0fb" },
          { x: a.x, y: bounds[0], z: 0 }, { x: a.x, y: bounds[1], z: 0 }, "line");
        return;
      }
      const left = this.mode === "2d" ? this.screenToWorld2d(0, 0).x : -this.settings.range;
      const right = this.mode === "2d" ? this.screenToWorld2d(this.width, 0).x : this.settings.range;
      let previous = null;
      for (let index = 0; index <= 180; index += 1) {
        const x = left + (right - left) * index / 180;
        const y = this.curveTemplateValue(kind, a, b, x);
        const world = Number.isFinite(y) ? { x, y, z: 0 } : null;
        const screen = world ? this.shapeScreenPoint(world) : null;
        if (previous && screen && Math.hypot(screen.x - previous.x, screen.y - previous.y) < Math.max(this.width, this.height) * 0.45) {
          this.addLine(vertices, previous, screen, 2.2, color);
        }
        previous = screen;
      }
    }

    drawPreviewCircle(vertices, center, radius, start, end, color) {
      let previous = null;
      for (let index = 0; index <= 120; index += 1) {
        const angle = start + (end - start) * index / 120;
        const screen = this.shapeScreenPoint({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius, z: center.z || 0 });
        if (previous && screen) this.addLine(vertices, previous, screen, 2, color);
        previous = screen;
      }
    }

    buildHoverProbe(vertices, labels) {
      const probe = this.hoverProbe;
      if (!probe) return;
      const color = hexToColor(probe.color);
      if (probe.kind === "tangent" && probe.direction) this.drawTangent(vertices, probe.point, probe.direction, [...color.slice(0, 3), 0.72], 2);
      const screen = this.drawPoint(vertices, probe.point, color, 4.8);
      if (!screen) return;
      const coordinates = [probe.point.x, probe.point.y, ...(Math.abs(probe.point.z || 0) > 1e-9 ? [probe.point.z] : [])]
        .map((value) => this.formatGridNumber(value)).join(", ");
      labels.push({
        x: screen.x + 14,
        y: screen.y - 14,
        text: `${probe.snapType ? `${probe.snapType} · ` : ""}(${coordinates})`,
        color: probe.color,
        always: true,
        className: "graph-probe-label",
      });
    }

    visibleExpressions() {
      return this.expressions.filter((expression) => expression.visible && expression.layer?.visible !== false && expression.compiled && !expression.error);
    }

    plotRange3d() {
      const needed = Math.max(this.settings.range, this.camera.distance * 2.5, Math.hypot(this.camera.target.x, this.camera.target.y) * 1.25);
      if (needed <= this.settings.range) return this.settings.range;
      return Math.min(1e8, this.settings.range * 2 ** Math.ceil(Math.log2(needed / this.settings.range)));
    }

    mapLayerPoint(expression, point) {
      if (!point || this.mode !== "3d") return point;
      const layer = expression.layer || this.layers.find((candidate) => candidate.id === expression.layerId) || this.layers[0];
      const scale = Math.max(3, Math.min(10, this.plotRange3d() * 0.1));
      if (layer?.space === "sphere") {
        const longitude = point.x / scale;
        const latitude = clamp(point.y / scale, -Math.PI * 0.5, Math.PI * 0.5);
        const radius = scale + (point.z || 0) * 0.18;
        return {
          x: radius * Math.cos(latitude) * Math.cos(longitude),
          y: radius * Math.cos(latitude) * Math.sin(longitude),
          z: radius * Math.sin(latitude),
        };
      }
      if (layer?.space === "torus") {
        const major = scale;
        const minor = scale * 0.36 + (point.z || 0) * 0.12;
        const u = point.x / scale;
        const v = point.y / scale;
        return { x: (major + minor * Math.cos(v)) * Math.cos(u), y: (major + minor * Math.cos(v)) * Math.sin(u), z: minor * Math.sin(v) };
      }
      if (layer?.space === "hyperbolic") {
        const x = point.x * 0.45;
        const y = point.y * 0.45;
        return { x, y, z: (point.z || 0) + (x * x - y * y) / Math.max(scale, 1) };
      }
      if (layer?.coordinateSystem === "cylindrical") {
        return { x: point.x * Math.cos(point.y), y: point.x * Math.sin(point.y), z: point.z || 0 };
      }
      if (layer?.coordinateSystem === "spherical") {
        const radius = point.x;
        const theta = point.y;
        const phi = point.z || 0;
        return { x: radius * Math.cos(phi) * Math.cos(theta), y: radius * Math.cos(phi) * Math.sin(theta), z: radius * Math.sin(phi) };
      }
      if (layer?.coordinateSystem === "toroidal") {
        const major = scale;
        const minor = Math.max(0.1, Math.abs(point.z || scale * 0.3));
        return { x: (major + minor * Math.cos(point.y)) * Math.cos(point.x), y: (major + minor * Math.cos(point.y)) * Math.sin(point.x), z: minor * Math.sin(point.y) };
      }
      return point;
    }

    gridStep() {
      const raw = 78 / this.view2d.scale;
      const power = 10 ** Math.floor(Math.log10(raw));
      const normalized = raw / power;
      return (normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10) * power;
    }

    gridMajorStep3d(state = this.cameraState()) {
      const pixelsPerUnit = state.focal / Math.max(this.camera.distance, 0.001);
      return 5 * 10 ** Math.ceil(Math.log10(70 / Math.max(pixelsPerUnit * 5, 0.001)));
    }

    formatGridNumber(value) {
      const absolute = Math.abs(value);
      if (absolute > 0 && (absolute >= 10000 || absolute < 0.001)) return value.toExponential(1);
      return Number(value.toPrecision(7)).toString();
    }

    buildParametric2d(vertices, expression) {
      const color = hexToColor(expression.color);
      const samples = clamp((expression.resolution || 72) * 10, 240, 1800);
      let previous = null;
      let previousWorld = null;
      for (let index = 0; index <= samples; index += 1) {
        const t = index / samples * Math.PI * 2;
        const values = this.safeEvaluatePoint(expression, { t });
        const world = values ? { x: values[0], y: values[1], z: values[2] || 0 } : null;
        const point = world ? this.worldToScreen2d(world.x, world.y) : null;
        if (previous && point && Math.hypot(point.x - previous.x, point.y - previous.y) < Math.max(this.width, this.height) * 0.5) {
          this.addStyledLine(vertices, previous, point, this.lineWidth(expression, 2.6), color, expression);
          this.recordLine(expression, previous, point, previousWorld, world);
        }
        previous = point;
        previousWorld = world;
      }
    }

    buildRadial2d(vertices, expression) {
      const color = hexToColor(expression.color);
      const samples = 720;
      let previous = null;
      let previousWorld = null;
      for (let index = 0; index <= samples; index += 1) {
        const theta = index / samples * Math.PI * 2;
        const radius = this.safeEvaluate(expression, { theta });
        const world = Number.isFinite(radius) ? { x: radius * Math.cos(theta), y: radius * Math.sin(theta), z: 0 } : null;
        const point = world ? this.worldToScreen2d(world.x, world.y) : null;
        if (previous && point && Math.hypot(point.x - previous.x, point.y - previous.y) < Math.max(this.width, this.height) * 0.5) {
          this.addStyledLine(vertices, previous, point, this.lineWidth(expression, 2.6), color, expression);
          this.recordLine(expression, previous, point, previousWorld, world);
        }
        previous = point;
        previousWorld = world;
      }
    }

    buildComplex2d(vertices, expression, bounds) {
      const columns = clamp(expression.resolution || 72, 24, 160);
      const rows = clamp(Math.round(columns * this.height / Math.max(this.width, 1)), 18, 160);
      const strategy = expression.visualization || "domain-coloring";
      const cellWidth = this.width / columns;
      const cellHeight = this.height / rows;
      for (let row = 0; row < rows; row += 1) {
        const y = bounds.top - (row + 0.5) / rows * (bounds.top - bounds.bottom);
        for (let column = 0; column < columns; column += 1) {
          const x = bounds.left + (column + 0.5) / columns * (bounds.right - bounds.left);
          const value = this.safeEvaluateComplex(expression, { re: x, im: y });
          if (!value) continue;
          const color = this.complexColor(value, strategy, this.settings.dark ? 0.72 : 0.66);
          const a = { x: column * cellWidth, y: row * cellHeight };
          const b = { x: a.x + cellWidth + 1, y: a.y };
          const c = { x: b.x, y: a.y + cellHeight + 1 };
          const d = { x: a.x, y: c.y };
          this.addTriangle(vertices, a, b, c, color);
          this.addTriangle(vertices, a, c, d, color);
          const worldA = this.screenToWorld2d(a.x, a.y);
          const worldB = this.screenToWorld2d(b.x, b.y);
          const worldC = this.screenToWorld2d(c.x, c.y);
          const worldD = this.screenToWorld2d(d.x, d.y);
          this.recordTriangle(expression, a, b, c, worldA, worldB, worldC);
          this.recordTriangle(expression, a, c, d, worldA, worldC, worldD);
        }
      }
    }

    buildRecurrence2d(vertices, expression, bounds) {
      const columns = clamp(expression.resolution || 72, 24, 160);
      const rows = clamp(Math.round(columns * this.height / Math.max(this.width, 1)), 18, 160);
      const cellWidth = this.width / columns;
      const cellHeight = this.height / rows;
      for (let row = 0; row < rows; row += 1) {
        const im = bounds.top - (row + 0.5) / rows * (bounds.top - bounds.bottom);
        for (let column = 0; column < columns; column += 1) {
          const re = bounds.left + (column + 0.5) / columns * (bounds.right - bounds.left);
          const color = this.recurrenceColor(this.recurrenceEscape(expression, { re, im }), this.settings.dark ? 0.94 : 0.9);
          const a = { x: column * cellWidth, y: row * cellHeight };
          const b = { x: a.x + cellWidth + 1, y: a.y };
          const c = { x: b.x, y: a.y + cellHeight + 1 };
          const d = { x: a.x, y: c.y };
          this.addTriangle(vertices, a, b, c, color);
          this.addTriangle(vertices, a, c, d, color);
          const worldA = this.screenToWorld2d(a.x, a.y);
          const worldB = this.screenToWorld2d(b.x, b.y);
          const worldC = this.screenToWorld2d(c.x, c.y);
          const worldD = this.screenToWorld2d(d.x, d.y);
          this.recordTriangle(expression, a, b, c, worldA, worldB, worldC);
          this.recordTriangle(expression, a, c, d, worldA, worldC, worldD);
        }
      }
    }

    build2d(vertices, labels) {
      const topLeft = this.screenToWorld2d(0, 0);
      const bottomRight = this.screenToWorld2d(this.width, this.height);
      const bounds = { left: topLeft.x, right: bottomRight.x, top: topLeft.y, bottom: bottomRight.y };
      const expressions = this.visibleExpressions();

      for (const expression of expressions) {
        if (expression.compiled.kind === "complex") this.buildComplex2d(vertices, expression, bounds);
        if (expression.compiled.kind === "recurrence-complex") this.buildRecurrence2d(vertices, expression, bounds);
        if (expression.compiled.kind === "fractal-3d") this.buildMandelbulb2d(vertices, expression);
      }
      for (const expression of expressions) {
        if (expression.compiled.kind === "z-of-xy") this.buildSurfaceMap(vertices, expression, bounds);
      }
      this.build2dGrid(vertices, labels, bounds);
      for (const expression of expressions) {
        if (expression.compiled.kind === "y-of-x") this.buildFunctionY(vertices, expression, bounds);
        if (expression.compiled.kind === "x-of-y") this.buildFunctionX(vertices, expression, bounds);
        if (expression.compiled.kind === "implicit") this.buildImplicit2d(vertices, expression, bounds);
        if (expression.compiled.kind === "parametric-2d" || expression.compiled.kind === "parametric-3d") this.buildParametric2d(vertices, expression);
        if (expression.compiled.kind === "radial") this.buildRadial2d(vertices, expression);
      }
    }

    buildSurfaceMap(vertices, expression, bounds) {
      const columns = clamp(expression.resolution || 72, 24, 160);
      const rows = clamp(Math.round(columns * this.height / Math.max(this.width, 1)), 18, 160);
      const base = hexToColor(expression.color);
      const white = this.settings.dark ? [0.13, 0.14, 0.16, 1] : [1, 1, 1, 1];
      const values = [];
      for (let row = 0; row <= rows; row += 1) {
        values[row] = [];
        const y = bounds.top - row / rows * (bounds.top - bounds.bottom);
        for (let column = 0; column <= columns; column += 1) {
          const x = bounds.left + column / columns * (bounds.right - bounds.left);
          values[row][column] = this.safeEvaluate(expression, { x, y });
        }
      }

      const cellWidth = this.width / columns;
      const cellHeight = this.height / rows;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const samples = [values[row][column], values[row][column + 1], values[row + 1][column + 1], values[row + 1][column]];
          if (samples.some((value) => !Number.isFinite(value))) continue;
          const value = samples.reduce((sum, sample) => sum + sample, 0) / 4;
          const level = 0.5 + 0.5 * Math.tanh(value * 0.9);
          const color = mixColor(white, base, 0.12 + level * 0.52, this.settings.dark ? 0.62 : 0.48);
          const x = column * cellWidth;
          const y = row * cellHeight;
          this.addTriangle(vertices, { x, y }, { x: x + cellWidth + 1, y }, { x: x + cellWidth + 1, y: y + cellHeight + 1 }, color);
          this.addTriangle(vertices, { x, y }, { x: x + cellWidth + 1, y: y + cellHeight + 1 }, { x, y: y + cellHeight + 1 }, color);
        }
      }

      const contourColor = hexToColor(expression.color, this.settings.dark ? 0.62 : 0.48);
      for (const level of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) {
        const segments = this.marchingSegments(values, columns, rows, level, (column, row) => ({
          x: column / columns * this.width,
          y: row / rows * this.height,
        }));
        for (const [a, b] of segments) {
          this.addStyledLine(vertices, a, b, this.lineWidth(expression, level === 0 ? 1.5 : 0.8), contourColor, expression);
          this.recordLine(expression, a, b, this.screenToWorld2d(a.x, a.y), this.screenToWorld2d(b.x, b.y));
        }
      }
    }

    buildMandelbulb2d(vertices, expression) {
      const steps = clamp(expression.resolution || 72, 24, 160);
      const iterations = clamp(expression.iterations || 32, 8, 48);
      const scale = Math.min(this.settings.range * 0.18, 6);
      const color = hexToColor(expression.color, this.settings.dark ? 0.88 : 0.78);
      const cell = scale * 2 / steps;
      for (let row = 0; row < steps; row += 1) {
        const y = -scale + (row + 0.5) * cell;
        for (let column = 0; column < steps; column += 1) {
          const x = -scale + (column + 0.5) * cell;
          if (!this.mandelbulbInside({ x: x * 1.35 / scale, y: y * 1.35 / scale, z: 0 }, expression.compiled.power || 8, iterations)) continue;
          const world = [
            { x: x - cell * 0.5, y: y - cell * 0.5, z: 0 }, { x: x + cell * 0.5, y: y - cell * 0.5, z: 0 },
            { x: x + cell * 0.5, y: y + cell * 0.5, z: 0 }, { x: x - cell * 0.5, y: y + cell * 0.5, z: 0 },
          ];
          const screen = world.map((point) => this.worldToScreen2d(point.x, point.y));
          this.addTriangle(vertices, screen[0], screen[1], screen[2], color);
          this.addTriangle(vertices, screen[0], screen[2], screen[3], color);
          this.recordTriangle(expression, screen[0], screen[1], screen[2], world[0], world[1], world[2]);
          this.recordTriangle(expression, screen[0], screen[2], screen[3], world[0], world[2], world[3]);
        }
      }
    }

    build2dGrid(vertices, labels, bounds) {
      const step = this.gridStep();
      const origin = this.worldToScreen2d(0, 0);
      if (!this.settings.labels) return;
      const labelY = clamp(origin.y + 15, 9, this.height - 14);
      for (let x = Math.floor(bounds.left / step) * step; x <= bounds.right; x += step) {
        if (Math.abs(x) < step * 0.1) continue;
        labels.push({ x: this.worldToScreen2d(x, 0).x, y: labelY, text: this.formatGridNumber(x) });
      }
      const labelX = clamp(origin.x - 7, 26, this.width - 10);
      for (let y = Math.floor(bounds.bottom / step) * step; y <= bounds.top; y += step) {
        if (Math.abs(y) < step * 0.1) continue;
        labels.push({ x: labelX, y: this.worldToScreen2d(0, y).y, text: this.formatGridNumber(y) });
      }
    }

    buildFunctionY(vertices, expression, bounds) {
      const color = hexToColor(expression.color);
      const samples = Math.max(260, Math.ceil(this.width * 1.2));
      let previous = null;
      let previousWorld = null;
      for (let index = 0; index <= samples; index += 1) {
        const screenX = index / samples * this.width;
        const x = bounds.left + index / samples * (bounds.right - bounds.left);
        const y = this.safeEvaluate(expression, { x });
        const point = { x: screenX, y: this.worldToScreen2d(x, y).y };
        const worldPoint = { x, y, z: 0 };
        if (previous && Number.isFinite(point.y) && Math.abs(point.y - previous.y) < this.height * 0.72) {
          if (expression.fillArea) {
            const previousAxis = this.worldToScreen2d(previousWorld.x, 0);
            const currentAxis = this.worldToScreen2d(worldPoint.x, 0);
            const fill = [color[0], color[1], color[2], 0.14];
            this.addTriangle(vertices, previous, previousAxis, currentAxis, fill);
            this.addTriangle(vertices, previous, currentAxis, point, fill);
          }
          this.addStyledLine(vertices, previous, point, this.lineWidth(expression, 2.6), color, expression);
          this.recordLine(expression, previous, point, previousWorld, worldPoint);
        }
        previous = Number.isFinite(point.y) ? point : null;
        previousWorld = Number.isFinite(point.y) ? worldPoint : null;
      }
    }

    buildFunctionX(vertices, expression, bounds) {
      const color = hexToColor(expression.color);
      const samples = Math.max(260, Math.ceil(this.height * 1.2));
      let previous = null;
      let previousWorld = null;
      for (let index = 0; index <= samples; index += 1) {
        const screenY = index / samples * this.height;
        const y = bounds.top - index / samples * (bounds.top - bounds.bottom);
        const x = this.safeEvaluate(expression, { y });
        const point = { x: this.worldToScreen2d(x, y).x, y: screenY };
        const worldPoint = { x, y, z: 0 };
        if (previous && Number.isFinite(point.x) && Math.abs(point.x - previous.x) < this.width * 0.72) {
          if (expression.fillArea) {
            const previousAxis = this.worldToScreen2d(0, previousWorld.y);
            const currentAxis = this.worldToScreen2d(0, worldPoint.y);
            const fill = [color[0], color[1], color[2], 0.14];
            this.addTriangle(vertices, previous, previousAxis, currentAxis, fill);
            this.addTriangle(vertices, previous, currentAxis, point, fill);
          }
          this.addStyledLine(vertices, previous, point, this.lineWidth(expression, 2.6), color, expression);
          this.recordLine(expression, previous, point, previousWorld, worldPoint);
        }
        previous = Number.isFinite(point.x) ? point : null;
        previousWorld = Number.isFinite(point.x) ? worldPoint : null;
      }
    }

    sampleImplicit(expression, bounds, columns, rows) {
      const values = [];
      for (let row = 0; row <= rows; row += 1) {
        values[row] = [];
        const y = bounds.top - row / rows * (bounds.top - bounds.bottom);
        for (let column = 0; column <= columns; column += 1) {
          const x = bounds.left + column / columns * (bounds.right - bounds.left);
          values[row][column] = this.safeEvaluate(expression, { x, y });
        }
      }
      return values;
    }

    marchingSegments(values, columns, rows, level, pointForGrid) {
      const segments = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const cell = [
            values[row][column] - level,
            values[row][column + 1] - level,
            values[row + 1][column + 1] - level,
            values[row + 1][column] - level,
          ];
          if (cell.some((value) => !Number.isFinite(value))) continue;
          const gridPoints = [
            pointForGrid(column, row),
            pointForGrid(column + 1, row),
            pointForGrid(column + 1, row + 1),
            pointForGrid(column, row + 1),
          ];
          const crossings = [];
          for (let edge = 0; edge < 4; edge += 1) {
            const next = (edge + 1) % 4;
            if ((cell[edge] < 0) === (cell[next] < 0) && cell[edge] !== 0 && cell[next] !== 0) continue;
            const denominator = Math.abs(cell[edge]) + Math.abs(cell[next]);
            const amount = denominator ? Math.abs(cell[edge]) / denominator : 0.5;
            crossings.push({
              x: gridPoints[edge].x + (gridPoints[next].x - gridPoints[edge].x) * amount,
              y: gridPoints[edge].y + (gridPoints[next].y - gridPoints[edge].y) * amount,
              z: (gridPoints[edge].z || 0) + ((gridPoints[next].z || 0) - (gridPoints[edge].z || 0)) * amount,
            });
          }
          if (crossings.length === 2) segments.push([crossings[0], crossings[1]]);
          if (crossings.length === 4) {
            segments.push([crossings[0], crossings[1]]);
            segments.push([crossings[2], crossings[3]]);
          }
        }
      }
      return segments;
    }

    buildImplicit2d(vertices, expression, bounds) {
      const columns = clamp(Math.round(this.width / 9), 50, 150);
      const rows = clamp(Math.round(this.height / 9), 38, 110);
      const values = this.sampleImplicit(expression, bounds, columns, rows);
      const segments = this.marchingSegments(values, columns, rows, 0, (column, row) => ({
        x: column / columns * this.width,
        y: row / rows * this.height,
      }));
      const color = hexToColor(expression.color);
      for (const [a, b] of segments) {
        this.addStyledLine(vertices, a, b, this.lineWidth(expression, 2.5), color, expression);
        this.recordLine(expression, a, b, this.screenToWorld2d(a.x, a.y), this.screenToWorld2d(b.x, b.y));
      }
    }

    build3d(vertices, labels) {
      const state = this.cameraState();
      const axisExtent = Math.min(this.plotRange3d(), Math.max(this.camera.distance * 2, 10));
      const expressions = this.visibleExpressions();
      this.buildLayerSpaces(vertices, state);
      for (const expression of expressions) {
        if (["z-of-xy", "x-of-yz", "y-of-xz"].includes(expression.compiled.kind)) this.buildSurface3d(vertices, state, expression);
        if (expression.compiled.kind === "implicit-3d") this.buildImplicitSurface3d(vertices, state, expression);
        if (expression.compiled.kind === "complex") this.buildComplex3d(vertices, state, expression);
        if (expression.compiled.kind === "recurrence-complex") this.buildRecurrence3d(vertices, state, expression);
        if (expression.compiled.kind === "fractal-3d") this.buildMandelbulb3d(vertices, state, expression);
      }
      for (const expression of expressions) {
        if (expression.compiled.kind === "y-of-x" || expression.compiled.kind === "x-of-y") this.buildCurve3d(vertices, state, expression);
        if (expression.compiled.kind === "implicit") this.buildImplicitCurve3d(vertices, state, expression);
        if (expression.compiled.kind === "parametric-2d" || expression.compiled.kind === "parametric-3d") this.buildParametric3d(vertices, state, expression);
        if (expression.compiled.kind === "radial") this.buildRadial3d(vertices, state, expression);
      }
      if (this.settings.axes) this.build3dAxes(vertices, labels, state, axisExtent);
    }

    buildLayerSpaces(vertices, state) {
      const color = this.settings.dark ? [0.44, 0.68, 0.88, 0.22] : [0.18, 0.44, 0.7, 0.18];
      const scale = Math.max(3, Math.min(10, this.plotRange3d() * 0.1));
      for (const layer of this.layers) {
        if (layer.visible === false || layer.space === "r3") continue;
        const drawPath = (points) => {
          for (let index = 1; index < points.length; index += 1) this.addProjectedLine(vertices, state, points[index - 1], points[index], 1, color);
        };
        const mapper = (point) => this.mapLayerPoint({ layer }, point);
        if (layer.space === "sphere") {
          for (let latitude = -Math.PI / 3; latitude <= Math.PI / 3 + 0.01; latitude += Math.PI / 6) {
            drawPath(Array.from({ length: 73 }, (_, index) => mapper({ x: (index / 72 * Math.PI * 2 - Math.PI) * scale, y: latitude * scale, z: 0 })));
          }
          for (let longitude = -Math.PI; longitude < Math.PI; longitude += Math.PI / 6) {
            drawPath(Array.from({ length: 37 }, (_, index) => mapper({ x: longitude * scale, y: (-Math.PI / 2 + index / 36 * Math.PI) * scale, z: 0 })));
          }
        } else if (layer.space === "torus") {
          for (let v = 0; v < Math.PI * 2; v += Math.PI / 6) {
            drawPath(Array.from({ length: 73 }, (_, index) => mapper({ x: index / 72 * Math.PI * 2 * scale, y: v * scale, z: 0 })));
          }
          for (let u = 0; u < Math.PI * 2; u += Math.PI / 6) {
            drawPath(Array.from({ length: 37 }, (_, index) => mapper({ x: u * scale, y: index / 36 * Math.PI * 2 * scale, z: 0 })));
          }
        } else if (layer.space === "hyperbolic") {
          for (let line = -scale; line <= scale; line += scale / 4) {
            drawPath(Array.from({ length: 49 }, (_, index) => mapper({ x: -scale + index / 48 * scale * 2, y: line, z: 0 })));
            drawPath(Array.from({ length: 49 }, (_, index) => mapper({ x: line, y: -scale + index / 48 * scale * 2, z: 0 })));
          }
        }
      }
    }

    addProjectedLine(vertices, state, a, b, width, color) {
      const projected = this.projectSegment3(a, b, state);
      if (!projected) return;
      const clipped = this.clipScreenLine(projected[0], projected[1], 180);
      if (clipped) this.addLine(vertices, clipped[0], clipped[1], width, color);
    }

    projectSegment3(a, b, state) {
      const near = 0.08;
      const depthFor = (point) => dot3({
        x: point.x - state.position.x,
        y: point.y - state.position.y,
        z: point.z - state.position.z,
      }, state.forward);
      let start = a;
      let end = b;
      let startDepth = depthFor(start);
      let endDepth = depthFor(end);
      if (startDepth <= near && endDepth <= near) return null;
      if (startDepth <= near || endDepth <= near) {
        const amount = (near - startDepth) / (endDepth - startDepth);
        const clippedPoint = {
          x: start.x + (end.x - start.x) * amount,
          y: start.y + (end.y - start.y) * amount,
          z: start.z + (end.z - start.z) * amount,
        };
        if (startDepth <= near) {
          start = clippedPoint;
          startDepth = near;
        } else {
          end = clippedPoint;
          endDepth = near;
        }
      }
      const projectedStart = this.project3(start, state);
      const projectedEnd = this.project3(end, state);
      return projectedStart && projectedEnd ? [projectedStart, projectedEnd] : null;
    }

    clipScreenLine(a, b, margin = 0) {
      const minX = -margin;
      const minY = -margin;
      const maxX = this.width + margin;
      const maxY = this.height + margin;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      let start = 0;
      let end = 1;
      const tests = [
        [-dx, a.x - minX],
        [dx, maxX - a.x],
        [-dy, a.y - minY],
        [dy, maxY - a.y],
      ];
      for (const [p, q] of tests) {
        if (Math.abs(p) < 0.000001) {
          if (q < 0) return null;
          continue;
        }
        const amount = q / p;
        if (p < 0) start = Math.max(start, amount);
        else end = Math.min(end, amount);
        if (start > end) return null;
      }
      return [
        { x: a.x + dx * start, y: a.y + dy * start },
        { x: a.x + dx * end, y: a.y + dy * end },
      ];
    }

    build3dAxes(vertices, labels, state, extent) {
      const axes = [
        { color: "#c74440", end: { x: extent, y: 0, z: 0 }, label: "x", ground: true },
        { color: "#388c46", end: { x: 0, y: extent, z: 0 }, label: "y", ground: true },
        { color: "#2d70b3", start: { x: 0, y: 0, z: -extent * 0.45 }, end: { x: 0, y: 0, z: extent * 0.75 }, label: "z" },
      ];
      for (const axis of axes) {
        if (!axis.ground) this.addProjectedLine(vertices, state, axis.start, axis.end, 1.8, hexToColor(axis.color));
        const point = this.project3(axis.end, state);
        if (point && this.settings.labels) labels.push({ x: point.x + 6, y: point.y - 6, text: axis.label, color: axis.color, axis: true });
      }
      if (!this.settings.labels) return;
      const step = this.gridMajorStep3d(state);
      const addTick = (world, value, color, offsetX, offsetY) => {
        const point = this.project3(world, state);
        if (!point || point.x < 8 || point.x > this.width - 8 || point.y < 8 || point.y > this.height - 8) return;
        labels.push({ x: point.x + offsetX, y: point.y + offsetY, text: this.formatGridNumber(value), color });
      };
      const limit = Math.min(extent, step * 24);
      for (let value = -Math.floor(limit / step) * step; value <= limit + step * 0.1; value += step) {
        if (Math.abs(value) < step * 0.1) continue;
        addTick({ x: value, y: 0, z: 0 }, value, "#c74440", 4, 12);
        addTick({ x: 0, y: value, z: 0 }, value, "#388c46", 4, 12);
        if (value >= -extent * 0.45 && value <= extent * 0.75) addTick({ x: 0, y: 0, z: value }, value, "#2d70b3", 5, -5);
      }
    }

    buildSurface3d(vertices, state, expression) {
      const range = this.plotRange3d();
      const cacheKey = `surface:${expression.compiled.kind}:${expression.id}:${range}`;
      let worldPolygons = this.geometryCache.get(cacheKey);
      if (!worldPolygons) {
        const steps = clamp(expression.resolution || 72, 24, 160);
        const maxZ = range * 1.5;
        const points = [];
        for (let row = 0; row <= steps; row += 1) {
          points[row] = [];
          const v = -range + row / steps * range * 2;
          for (let column = 0; column <= steps; column += 1) {
            const u = -range + column / steps * range * 2;
            let point = null;
            if (expression.compiled.kind === "z-of-xy") {
              const z = this.safeEvaluate(expression, { x: u, y: v });
              if (Number.isFinite(z) && Math.abs(z) <= maxZ) point = { x: u, y: v, z };
            } else if (expression.compiled.kind === "x-of-yz") {
              const x = this.safeEvaluate(expression, { y: u, z: v });
              if (Number.isFinite(x) && Math.abs(x) <= maxZ) point = { x, y: u, z: v };
            } else {
              const y = this.safeEvaluate(expression, { x: u, z: v });
              if (Number.isFinite(y) && Math.abs(y) <= maxZ) point = { x: u, y, z: v };
            }
            if (point) point = this.mapLayerPoint(expression, point);
            points[row][column] = point;
          }
        }

        worldPolygons = [];
        for (let row = 0; row < steps; row += 1) {
          for (let column = 0; column < steps; column += 1) {
            const corners = [points[row][column], points[row][column + 1], points[row + 1][column + 1], points[row + 1][column]];
            if (corners.some((point) => !point)) continue;
            const sideA = { x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y, z: corners[1].z - corners[0].z };
            const sideB = { x: corners[3].x - corners[0].x, y: corners[3].y - corners[0].y, z: corners[3].z - corners[0].z };
            const normal = normalize3(cross3(sideA, sideB));
            const light = clamp(0.36 + Math.abs(dot3(normal, normalize3({ x: -0.4, y: -0.6, z: 1 }))) * 0.64, 0, 1);
            worldPolygons.push({ corners, light });
          }
        }
        this.geometryCache.set(cacheKey, worldPolygons);
      }
      const polygons = [];
      for (const polygon of worldPolygons) {
        const projected = polygon.corners.map((point) => this.project3(point, state));
        if (projected.some((point) => !point)) continue;
        polygons.push({ projected, corners: polygon.corners, depth: projected.reduce((sum, point) => sum + point.depth, 0) / 4, light: polygon.light });
      }
      polygons.sort((a, b) => b.depth - a.depth);
      const base = hexToColor(expression.color);
      const white = this.settings.dark ? [0.2, 0.2, 0.22, 1] : [1, 1, 1, 1];
      for (const polygon of polygons) {
        const selected = expression.id === this.selectedExpressionId;
        const color = mixColor(white, base, Math.min(1, 0.5 + polygon.light * 0.45 + (selected ? 0.08 : 0)), this.settings.dark ? 0.86 : selected ? 0.88 : 0.76);
        this.addTriangle(vertices, polygon.projected[0], polygon.projected[1], polygon.projected[2], color);
        this.addTriangle(vertices, polygon.projected[0], polygon.projected[2], polygon.projected[3], color);
        this.recordTriangle(expression, polygon.projected[0], polygon.projected[1], polygon.projected[2], polygon.corners?.[0], polygon.corners?.[1], polygon.corners?.[2]);
        this.recordTriangle(expression, polygon.projected[0], polygon.projected[2], polygon.projected[3], polygon.corners?.[0], polygon.corners?.[2], polygon.corners?.[3]);
      }
    }

    buildCurve3d(vertices, state, expression) {
      const range = this.plotRange3d();
      const cacheKey = `curve:${expression.id}:${range}`;
      let worldPoints = this.geometryCache.get(cacheKey);
      if (!worldPoints) {
        const samples = clamp(Math.round(range * 30), 480, 1800);
        worldPoints = [];
        for (let index = 0; index <= samples; index += 1) {
          const input = -range + index / samples * range * 2;
          const point = expression.compiled.kind === "y-of-x"
            ? { x: input, y: this.safeEvaluate(expression, { x: input }), z: 0 }
            : { x: this.safeEvaluate(expression, { y: input }), y: input, z: 0 };
          worldPoints.push(this.mapLayerPoint(expression, point));
        }
        this.geometryCache.set(cacheKey, worldPoints);
      }
      const color = hexToColor(expression.color);
      let previous = null;
      let previousWorld = null;
      for (const point of worldPoints) {
        const projected = this.project3(point, state);
        if (previous && projected && Math.hypot(projected.x - previous.x, projected.y - previous.y) < Math.max(this.width, this.height) * 0.35) {
          this.addStyledLine(vertices, previous, projected, this.lineWidth(expression, 3), color, expression);
          this.recordLine(expression, previous, projected, previousWorld, point);
        }
        previous = projected;
        previousWorld = projected ? point : null;
      }
    }

    buildParametric3d(vertices, state, expression) {
      const cacheKey = `parametric:${expression.id}`;
      let worldPoints = this.geometryCache.get(cacheKey);
      if (!worldPoints) {
        worldPoints = [];
        const samples = clamp((expression.resolution || 72) * 12, 288, 2400);
        for (let index = 0; index <= samples; index += 1) {
          const t = index / samples * Math.PI * 2;
          const values = this.safeEvaluatePoint(expression, { t });
          worldPoints.push(values ? this.mapLayerPoint(expression, { x: values[0], y: values[1], z: values[2] || 0 }) : null);
        }
        this.geometryCache.set(cacheKey, worldPoints);
      }
      this.buildWorldPolyline(vertices, state, expression, worldPoints);
    }

    buildRadial3d(vertices, state, expression) {
      const cacheKey = `radial:${expression.id}`;
      let worldPoints = this.geometryCache.get(cacheKey);
      if (!worldPoints) {
        worldPoints = [];
        const samples = 900;
        for (let index = 0; index <= samples; index += 1) {
          const theta = index / samples * Math.PI * 2;
          const radius = this.safeEvaluate(expression, { theta });
          worldPoints.push(Number.isFinite(radius)
            ? this.mapLayerPoint(expression, { x: radius * Math.cos(theta), y: radius * Math.sin(theta), z: 0 })
            : null);
        }
        this.geometryCache.set(cacheKey, worldPoints);
      }
      this.buildWorldPolyline(vertices, state, expression, worldPoints);
    }

    buildWorldPolyline(vertices, state, expression, worldPoints) {
      const color = hexToColor(expression.color);
      let previous = null;
      let previousWorld = null;
      for (const point of worldPoints) {
        const projected = point ? this.project3(point, state) : null;
        if (previous && projected && Math.hypot(projected.x - previous.x, projected.y - previous.y) < Math.max(this.width, this.height) * 0.35) {
          this.addStyledLine(vertices, previous, projected, this.lineWidth(expression, 3), color, expression);
          this.recordLine(expression, previous, projected, previousWorld, point);
        }
        previous = projected;
        previousWorld = projected ? point : null;
      }
    }

    buildImplicitCurve3d(vertices, state, expression) {
      const range = this.plotRange3d();
      const cacheKey = `implicit:${expression.id}:${range}`;
      let worldSegments = this.geometryCache.get(cacheKey);
      if (!worldSegments) {
        const bounds = { left: -range, right: range, top: range, bottom: -range };
        const columns = clamp(Math.round(range * 6), 96, 220);
        const rows = columns;
        const values = this.sampleImplicit(expression, bounds, columns, rows);
        worldSegments = this.marchingSegments(values, columns, rows, 0, (column, row) => this.mapLayerPoint(expression, ({
          x: bounds.left + column / columns * (bounds.right - bounds.left),
          y: bounds.top - row / rows * (bounds.top - bounds.bottom),
          z: 0,
        })));
        this.geometryCache.set(cacheKey, worldSegments);
      }
      const color = hexToColor(expression.color);
      for (const [a, b] of worldSegments) {
        const projectedA = this.project3(a, state);
        const projectedB = this.project3(b, state);
        this.addStyledLine(vertices, projectedA, projectedB, this.lineWidth(expression, 3), color, expression);
        this.recordLine(expression, projectedA, projectedB, a, b);
      }
    }

    buildComplex3d(vertices, state, expression) {
      const strategy = expression.visualization || "domain-coloring";
      const range = this.plotRange3d();
      const cacheKey = `complex:${strategy}:${expression.id}:${range}`;
      let worldPolygons = this.geometryCache.get(cacheKey);
      if (!worldPolygons) {
        const steps = clamp(expression.resolution || 72, 24, 128);
        const points = [];
        for (let row = 0; row <= steps; row += 1) {
          points[row] = [];
          const y = -range + row / steps * range * 2;
          for (let column = 0; column <= steps; column += 1) {
            const x = -range + column / steps * range * 2;
            const value = this.safeEvaluateComplex(expression, { re: x, im: y });
            if (!value) {
              points[row][column] = null;
              continue;
            }
            const magnitude = Math.hypot(value.re, value.im);
            const phase = Math.atan2(value.im, value.re);
            const z = strategy === "domain-coloring"
              ? 0
              : strategy === "phase"
                ? phase / Math.PI * range * 0.18
                : clamp(Math.log1p(magnitude) * range * 0.09, 0, range * 0.85);
            points[row][column] = { point: { x, y, z }, value };
          }
        }
        worldPolygons = [];
        for (let row = 0; row < steps; row += 1) {
          for (let column = 0; column < steps; column += 1) {
            const samples = [points[row][column], points[row][column + 1], points[row + 1][column + 1], points[row + 1][column]];
            if (samples.some((sample) => !sample)) continue;
            const average = {
              re: samples.reduce((sum, sample) => sum + sample.value.re, 0) / 4,
              im: samples.reduce((sum, sample) => sum + sample.value.im, 0) / 4,
            };
            worldPolygons.push({
              corners: samples.map((sample) => sample.point),
              color: this.complexColor(average, strategy, this.settings.dark ? 0.88 : 0.8),
            });
          }
        }
        this.geometryCache.set(cacheKey, worldPolygons);
      }
      const polygons = [];
      for (const polygon of worldPolygons) {
        const projected = polygon.corners.map((point) => this.project3(point, state));
        if (projected.some((point) => !point)) continue;
        polygons.push({
          ...polygon,
          projected,
          depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length,
        });
      }
      polygons.sort((a, b) => b.depth - a.depth);
      for (const polygon of polygons) {
        const color = expression.id === this.selectedExpressionId
          ? [...polygon.color.slice(0, 3), Math.min(1, polygon.color[3] + 0.14)]
          : polygon.color;
        this.addTriangle(vertices, polygon.projected[0], polygon.projected[1], polygon.projected[2], color);
        this.addTriangle(vertices, polygon.projected[0], polygon.projected[2], polygon.projected[3], color);
        this.recordTriangle(expression, polygon.projected[0], polygon.projected[1], polygon.projected[2], polygon.corners[0], polygon.corners[1], polygon.corners[2]);
        this.recordTriangle(expression, polygon.projected[0], polygon.projected[2], polygon.projected[3], polygon.corners[0], polygon.corners[2], polygon.corners[3]);
      }
    }

    buildRecurrence3d(vertices, state, expression) {
      const range = this.plotRange3d();
      const cacheKey = `recurrence:${expression.id}:${range}`;
      let worldPolygons = this.geometryCache.get(cacheKey);
      if (!worldPolygons) {
        const steps = clamp(expression.resolution || 72, 24, 128);
        const points = [];
        for (let row = 0; row <= steps; row += 1) {
          points[row] = [];
          const y = -range + row / steps * range * 2;
          for (let column = 0; column <= steps; column += 1) {
            const x = -range + column / steps * range * 2;
            const result = this.recurrenceEscape(expression, { re: x, im: y });
            const amount = result ? clamp(result.iteration / result.limit, 0, 1) : 0;
            const z = result?.escaped ? amount * range * 0.26 : range * 0.32;
            points[row][column] = { point: { x, y, z }, result };
          }
        }
        worldPolygons = [];
        for (let row = 0; row < steps; row += 1) {
          for (let column = 0; column < steps; column += 1) {
            const samples = [points[row][column], points[row][column + 1], points[row + 1][column + 1], points[row + 1][column]];
            const result = samples[0].result;
            worldPolygons.push({
              corners: samples.map((sample) => sample.point),
              color: this.recurrenceColor(result, this.settings.dark ? 0.92 : 0.84),
            });
          }
        }
        this.geometryCache.set(cacheKey, worldPolygons);
      }
      this.renderColoredPolygons(vertices, state, expression, worldPolygons);
    }

    renderColoredPolygons(vertices, state, expression, worldPolygons) {
      const polygons = [];
      for (const polygon of worldPolygons) {
        const projected = polygon.corners.map((point) => this.project3(point, state));
        if (projected.some((point) => !point)) continue;
        polygons.push({ ...polygon, projected, depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length });
      }
      polygons.sort((a, b) => b.depth - a.depth);
      for (const polygon of polygons) {
        const color = expression.id === this.selectedExpressionId
          ? [...polygon.color.slice(0, 3), Math.min(1, polygon.color[3] + 0.12)]
          : polygon.color;
        this.addTriangle(vertices, polygon.projected[0], polygon.projected[1], polygon.projected[2], color);
        this.addTriangle(vertices, polygon.projected[0], polygon.projected[2], polygon.projected[3], color);
        this.recordTriangle(expression, polygon.projected[0], polygon.projected[1], polygon.projected[2], polygon.corners[0], polygon.corners[1], polygon.corners[2]);
        this.recordTriangle(expression, polygon.projected[0], polygon.projected[2], polygon.projected[3], polygon.corners[0], polygon.corners[2], polygon.corners[3]);
      }
    }

    mandelbulbInside(point, power, iterations) {
      let x = point.x;
      let y = point.y;
      let z = point.z;
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const radius = Math.hypot(x, y, z);
        if (radius > 2) return false;
        if (radius < 1e-9) {
          x = point.x;
          y = point.y;
          z = point.z;
          continue;
        }
        const theta = Math.acos(clamp(z / radius, -1, 1));
        const phi = Math.atan2(y, x);
        const raised = radius ** power;
        const sinTheta = Math.sin(theta * power);
        x = raised * sinTheta * Math.cos(phi * power) + point.x;
        y = raised * sinTheta * Math.sin(phi * power) + point.y;
        z = raised * Math.cos(theta * power) + point.z;
      }
      return true;
    }

    buildMandelbulb3d(vertices, state, expression) {
      const cacheKey = `mandelbulb:${expression.id}`;
      let worldPolygons = this.geometryCache.get(cacheKey);
      if (!worldPolygons) {
        const steps = clamp(Math.round((expression.resolution || 72) * 0.38), 12, 48);
        const iterations = clamp(expression.iterations || 32, 8, 48);
        const scale = Math.min(this.settings.range * 0.18, 6);
        const minimum = -1.35;
        const cell = 2.7 / steps;
        const occupied = new Uint8Array(steps * steps * steps);
        const indexFor = (x, y, z) => (z * steps + y) * steps + x;
        for (let z = 0; z < steps; z += 1) {
          for (let y = 0; y < steps; y += 1) {
            for (let x = 0; x < steps; x += 1) {
              const point = { x: minimum + (x + 0.5) * cell, y: minimum + (y + 0.5) * cell, z: minimum + (z + 0.5) * cell };
              occupied[indexFor(x, y, z)] = this.mandelbulbInside(point, expression.compiled.power || 8, iterations) ? 1 : 0;
            }
          }
        }
        const directions = [
          { delta: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], light: 0.55 },
          { delta: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], light: 0.75 },
          { delta: [0, -1, 0], corners: [[1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1]], light: 0.48 },
          { delta: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], light: 0.68 },
          { delta: [0, 0, -1], corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], light: 0.42 },
          { delta: [0, 0, 1], corners: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]], light: 0.95 },
        ];
        const base = hexToColor(expression.color);
        const white = this.settings.dark ? [0.18, 0.19, 0.22, 1] : [1, 1, 1, 1];
        worldPolygons = [];
        for (let z = 0; z < steps; z += 1) for (let y = 0; y < steps; y += 1) for (let x = 0; x < steps; x += 1) {
          if (!occupied[indexFor(x, y, z)]) continue;
          for (const face of directions) {
            const nx = x + face.delta[0];
            const ny = y + face.delta[1];
            const nz = z + face.delta[2];
            if (nx >= 0 && ny >= 0 && nz >= 0 && nx < steps && ny < steps && nz < steps && occupied[indexFor(nx, ny, nz)]) continue;
            const corners = face.corners.map(([cx, cy, cz]) => ({
              x: (minimum + (x + cx) * cell) * scale / 1.35,
              y: (minimum + (y + cy) * cell) * scale / 1.35,
              z: (minimum + (z + cz) * cell) * scale / 1.35,
            }));
            worldPolygons.push({ corners, color: mixColor(white, base, 0.48 + face.light * 0.46, 0.92) });
          }
        }
        this.geometryCache.set(cacheKey, worldPolygons);
      }
      this.renderColoredPolygons(vertices, state, expression, worldPolygons);
    }

    interpolateIso(a, b, valueA, valueB) {
      const denominator = valueA - valueB;
      const amount = Math.abs(denominator) < 1e-12 ? 0.5 : clamp(valueA / denominator, 0, 1);
      return {
        x: a.x + (b.x - a.x) * amount,
        y: a.y + (b.y - a.y) * amount,
        z: a.z + (b.z - a.z) * amount,
      };
    }

    tetrahedronTriangles(points, values) {
      const inside = [];
      const outside = [];
      values.forEach((value, index) => (value < 0 ? inside : outside).push(index));
      if (!inside.length || inside.length === 4) return [];
      const edgePoint = (a, b) => this.interpolateIso(points[a], points[b], values[a], values[b]);
      if (inside.length === 1 || inside.length === 3) {
        const loneInside = inside.length === 1;
        const lone = loneInside ? inside[0] : outside[0];
        const others = loneInside ? outside : inside;
        const triangle = others.map((index) => edgePoint(lone, index));
        return [loneInside ? triangle : [triangle[0], triangle[2], triangle[1]]];
      }
      const [a, b] = inside;
      const [c, d] = outside;
      const ac = edgePoint(a, c);
      const ad = edgePoint(a, d);
      const bc = edgePoint(b, c);
      const bd = edgePoint(b, d);
      return [[ac, ad, bc], [ad, bd, bc]];
    }

    buildImplicitSurface3d(vertices, state, expression) {
      const range = this.plotRange3d();
      const cacheKey = `implicit-surface:${expression.id}:${range}`;
      let worldTriangles = this.geometryCache.get(cacheKey);
      if (!worldTriangles) {
        const steps = clamp(Math.round((expression.resolution || 72) * 0.62), 20, 72);
        const coordinates = Array.from({ length: steps + 1 }, (_, index) => {
          const normalized = index / steps * 2 - 1;
          return Math.sign(normalized) * range * Math.abs(normalized) ** 1.55;
        });
        const size = steps + 1;
        const values = new Float64Array(size * size * size);
        const valueIndex = (x, y, z) => (z * size + y) * size + x;
        for (let z = 0; z <= steps; z += 1) {
          for (let y = 0; y <= steps; y += 1) {
            for (let x = 0; x <= steps; x += 1) {
              values[valueIndex(x, y, z)] = this.safeEvaluate(expression, {
                x: coordinates[x], y: coordinates[y], z: coordinates[z],
              });
            }
          }
        }
        const tetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
        worldTriangles = [];
        for (let z = 0; z < steps; z += 1) {
          for (let y = 0; y < steps; y += 1) {
            for (let x = 0; x < steps; x += 1) {
              const corners = [
                [x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z],
                [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1],
              ];
              const cubePoints = corners.map(([cx, cy, cz]) => ({ x: coordinates[cx], y: coordinates[cy], z: coordinates[cz] }));
              const cubeValues = corners.map(([cx, cy, cz]) => values[valueIndex(cx, cy, cz)]);
              if (cubeValues.some((value) => !Number.isFinite(value))) continue;
              for (const tetrahedron of tetrahedra) {
                const tetraPoints = tetrahedron.map((index) => cubePoints[index]);
                const tetraValues = tetrahedron.map((index) => cubeValues[index]);
                for (const triangle of this.tetrahedronTriangles(tetraPoints, tetraValues)) {
                  const sideA = { x: triangle[1].x - triangle[0].x, y: triangle[1].y - triangle[0].y, z: triangle[1].z - triangle[0].z };
                  const sideB = { x: triangle[2].x - triangle[0].x, y: triangle[2].y - triangle[0].y, z: triangle[2].z - triangle[0].z };
                  const normal = normalize3(cross3(sideA, sideB));
                  const light = clamp(0.34 + Math.abs(dot3(normal, normalize3({ x: -0.4, y: -0.6, z: 1 }))) * 0.66, 0, 1);
                  worldTriangles.push({ corners: triangle, light });
                }
              }
            }
          }
        }
        this.geometryCache.set(cacheKey, worldTriangles);
      }
      const triangles = [];
      for (const triangle of worldTriangles) {
        const projected = triangle.corners.map((point) => this.project3(point, state));
        if (projected.some((point) => !point)) continue;
        triangles.push({ ...triangle, projected, depth: projected.reduce((sum, point) => sum + point.depth, 0) / 3 });
      }
      triangles.sort((a, b) => b.depth - a.depth);
      const base = hexToColor(expression.color);
      const white = this.settings.dark ? [0.2, 0.2, 0.22, 1] : [1, 1, 1, 1];
      for (const triangle of triangles) {
        const selected = expression.id === this.selectedExpressionId;
        const color = mixColor(white, base, Math.min(1, 0.52 + triangle.light * 0.42 + (selected ? 0.08 : 0)), selected ? 0.9 : 0.8);
        this.addTriangle(vertices, triangle.projected[0], triangle.projected[1], triangle.projected[2], color);
        this.recordTriangle(expression, triangle.projected[0], triangle.projected[1], triangle.projected[2], triangle.corners[0], triangle.corners[1], triangle.corners[2]);
      }
    }
  }

  window.OrbifoldGraphEngine = GraphEngine;
}());
