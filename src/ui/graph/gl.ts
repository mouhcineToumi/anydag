/**
 * The Graph page's drawing (#459): raw WebGL2, no library.
 *
 * **Positions live in one float texture** (`RG32F`, `TEX_W` texels a row), and every dot and every
 * line looks its ends up there by index. So a step of the simulation is one small upload, and a pan
 * or a zoom is two uniforms and no upload at all.
 *
 * - **Links are instanced quads**, four vertices a link, widened in the vertex shader and given their
 *   own anti-aliasing in the fragment shader (the context has none: `antialias: false`).
 * - **Files are points drawn as discs**, each with a sliver of paper round it so a line stops short of
 *   the dot instead of running into it, and a glow round the one under the pointer.
 * - **Hover is one byte per file** in a second texture (2 the file, 1 a neighbour, 0 the rest) and
 *   a fade uniform: lighting a file is one upload of `n` bytes, and the fade costs nothing.
 * - **A file carries a palette slot, never a colour.** The palette is a uniform array of
 *   `SLOT_TOKENS.length` colours the page resolves from the theme, so a theme change is a uniform.
 *
 * Nothing here knows a theme, a field or React: the page hands it numbers.
 */

/** Texels a row of the position and state textures. */
export const TEX_W = 1024;

/** The rows a texture needs for `n` files. */
export const texRows = (n: number): number => Math.max(1, Math.ceil(n / TEX_W));

/** WebGL2 could not be had: the page says so, and there is no second renderer. */
export class NoWebGL extends Error {}

/** The colours of one frame, each `[r, g, b]` from 0 to 1. */
export interface Paint {
  /** The palette, three floats a slot. */
  palette: Float32Array;
  paper: readonly number[];
  accent: readonly number[];
  /** A link's colour, and how much of it is laid down at rest. */
  edge: readonly number[];
  edgeAlpha: number;
}

/** The sizes of one frame, in CSS px (the shader multiplies by `dpr`). */
export interface Sizes {
  dotMin: number;
  ring: number;
  halo: number;
  link: number;
}

/** Where the camera is and what is lit, for one frame. */
export interface Frame {
  /** Canvas size in CSS px, and device pixels per CSS px. */
  w: number;
  h: number;
  dpr: number;
  /** Camera: zoom and offset in CSS px. */
  z: number;
  x: number;
  y: number;
  /** How much bigger a dot is drawn at this zoom (`dotZoom`). */
  dot: number;
  /** The hover's fade, 0 to 1. */
  hover: number;
}

/** How much of a file or a link that is not lit is left while one is. */
const DIM = 0.16;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPos;
uniform sampler2D uState;
uniform vec2 uScale;
uniform vec2 uOffset;
uniform float uHover;
vec2 at(int i) { return texelFetch(uPos, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0).rg; }
float state(int i) { return texelFetch(uState, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0).r * 255.0; }
`;

const NODE_VS = `${COMMON}
in float aRadius;
in float aSlot;
uniform float uZoom;
uniform float uDpr;
uniform float uDotMin;
uniform float uHalo;
uniform vec3 uPalette[16];
uniform vec3 uAccent;
uniform float uDim;
out vec3 vColor;
out float vAlpha;
out float vR;
out float vRing;
out float vSize;
void main() {
  float st = state(gl_VertexID);
  gl_Position = vec4(at(gl_VertexID) * uScale + uOffset, 0.0, 1.0);
  float hot = step(1.5, st) * uHover;
  float r = max(aRadius * uZoom, uDotMin) * uDpr * (1.0 + 0.18 * hot);
  vR = r;
  vRing = hot;
  vSize = 2.0 * r + 2.0 * uHalo * uDpr;
  gl_PointSize = vSize;
  vColor = mix(uPalette[int(aSlot)], uAccent, hot);
  vAlpha = mix(1.0, st > 0.5 ? 1.0 : uDim, uHover);
}`;

const NODE_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
in float vR;
in float vRing;
in float vSize;
uniform float uDpr;
uniform float uRing;
uniform float uHalo;
uniform vec3 uPaper;
uniform vec3 uAccent;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - 0.5) * vSize;
  float body = clamp(vR - d + 0.5, 0.0, 1.0);
  float gap = clamp(vR + uRing * uDpr - d + 0.5, 0.0, 1.0) * min(1.0, vR / (2.5 * uDpr));
  float halo = vRing * 0.22 * clamp(vR + uHalo * uDpr - d + 0.5, 0.0, 1.0);
  vec4 c = vec4(uAccent, 1.0) * halo;
  c = mix(c, vec4(uPaper, 1.0), gap * (1.0 - vRing));
  c = mix(c, vec4(vColor, 1.0), body);
  o = c * vAlpha;
}`;

const EDGE_VS = `${COMMON}
in ivec2 aEnds;
uniform vec2 uHalf;
uniform float uWidth;
uniform vec3 uEdge;
uniform vec3 uAccent;
uniform float uEdgeAlpha;
uniform float uDim;
out vec3 vColor;
out float vAlpha;
out float vSide;
void main() {
  vec2 a = (at(aEnds.x) * uScale + uOffset) * uHalf;
  vec2 b = (at(aEnds.y) * uScale + uOffset) * uHalf;
  vec2 dir = b - a;
  float len = max(length(dir), 0.0001);
  dir /= len;
  float side = float(gl_VertexID & 1) * 2.0 - 1.0;
  float hw = uWidth * 0.5 + 1.0;
  vec2 p = mix(a, b, float(gl_VertexID >> 1)) + vec2(-dir.y, dir.x) * side * hw;
  gl_Position = vec4(p / uHalf, 0.0, 1.0);
  vSide = side * hw;
  float hot = max(step(1.5, state(aEnds.x)), step(1.5, state(aEnds.y)));
  vColor = mix(uEdge, uAccent, hot * uHover);
  vAlpha = mix(uEdgeAlpha, mix(uEdgeAlpha * uDim, 0.9, hot), uHover);
}`;

const EDGE_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
in float vSide;
uniform float uWidth;
out vec4 o;
void main() {
  o = vec4(vColor, 1.0) * (clamp(uWidth * 0.5 + 0.5 - abs(vSide), 0.0, 1.0) * vAlpha);
}`;

interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly node: Program;
  private readonly edge: Program;
  private readonly posTex: WebGLTexture;
  private readonly stateTex: WebGLTexture;
  private readonly nodeVao: WebGLVertexArrayObject;
  private readonly edgeVao: WebGLVertexArrayObject;
  private readonly nodeBuf: WebGLBuffer;
  private readonly edgeBuf: WebGLBuffer;
  private readonly shaders: WebGLShader[] = [];
  private n = 0;
  private m = 0;
  private rows = 1;
  private gone = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new NoWebGL("WebGL2 is not available");
    this.gl = gl;
    this.node = this.program(NODE_VS, NODE_FS);
    this.edge = this.program(EDGE_VS, EDGE_FS);
    this.posTex = gl.createTexture()!;
    this.stateTex = gl.createTexture()!;
    for (const t of [this.posTex, this.stateTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.nodeVao = gl.createVertexArray()!;
    this.edgeVao = gl.createVertexArray()!;
    this.nodeBuf = gl.createBuffer()!;
    this.edgeBuf = gl.createBuffer()!;

    gl.bindVertexArray(this.nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeBuf);
    const radius = gl.getAttribLocation(this.node.p, "aRadius");
    const slot = gl.getAttribLocation(this.node.p, "aSlot");
    gl.enableVertexAttribArray(radius);
    gl.vertexAttribPointer(radius, 1, gl.FLOAT, false, 8, 0);
    gl.enableVertexAttribArray(slot);
    gl.vertexAttribPointer(slot, 1, gl.FLOAT, false, 8, 4);
    gl.bindVertexArray(this.edgeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf);
    const ends = gl.getAttribLocation(this.edge.p, "aEnds");
    gl.enableVertexAttribArray(ends);
    gl.vertexAttribIPointer(ends, 2, gl.INT, 0, 0);
    gl.vertexAttribDivisor(ends, 1);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Whether the context was taken away (the GPU reset, too many contexts): the page makes a new one. */
  get lost(): boolean {
    return this.gl.isContextLost();
  }

  private program(vs: string, fs: string): Program {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost())
        throw new Error(`graph shader: ${gl.getShaderInfoLog(s) ?? "did not compile"}`);
      gl.attachShader(p, s);
      this.shaders.push(s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost())
      throw new Error(`graph program: ${gl.getProgramInfoLog(p) ?? "did not link"}`);
    const u: Program["u"] = {};
    const count = (gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number | null) ?? 0;
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(p, i)!.name.replace("[0]", "");
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  /**
   * A new graph: `n` files and the links `src[k]`–`dst[k]`. The textures are sized for it; positions,
   * dots and the lit state follow in their own calls.
   */
  graph(n: number, src: Int32Array, dst: Int32Array): void {
    const gl = this.gl;
    this.n = n;
    this.m = src.length;
    this.rows = texRows(n);
    const ends = new Int32Array(2 * this.m);
    for (let k = 0; k < this.m; k++) {
      ends[2 * k] = src[k]!;
      ends[2 * k + 1] = dst[k]!;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, ends, gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, this.posTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, TEX_W, this.rows, 0, gl.RG, gl.FLOAT, null);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, TEX_W, this.rows, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(TEX_W * this.rows));
  }

  /** Each file's radius (CSS px at zoom 1) and palette slot: one small buffer, and nothing else moves. */
  dots(radius: Float32Array, slot: Uint8Array): void {
    const attrs = new Float32Array(2 * this.n);
    for (let i = 0; i < this.n; i++) {
      attrs[2 * i] = radius[i]!;
      attrs[2 * i + 1] = slot[i]!;
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.nodeBuf);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, attrs, this.gl.STATIC_DRAW);
  }

  /** The positions, x then y per file, at least `TEX_W · rows · 2` long: one upload. */
  positions(pos: Float32Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.posTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, this.rows, gl.RG, gl.FLOAT, pos);
  }

  /** What is lit, a byte per file, at least `TEX_W · rows` long. */
  lit(state: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, this.rows, gl.RED, gl.UNSIGNED_BYTE, state);
  }

  draw(f: Frame, paint: Paint, sizes: Sizes): void {
    const gl = this.gl;
    if (this.gone) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.n) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.posTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    const sx = (2 * f.z) / f.w;
    const sy = (-2 * f.z) / f.h;
    const ox = (2 * f.x) / f.w - 1;
    const oy = 1 - (2 * f.y) / f.h;
    const common = (pr: Program) => {
      gl.useProgram(pr.p);
      gl.uniform1i(pr.u.uPos!, 0);
      gl.uniform1i(pr.u.uState!, 1);
      gl.uniform2f(pr.u.uScale!, sx, sy);
      gl.uniform2f(pr.u.uOffset!, ox, oy);
      gl.uniform1f(pr.u.uHover!, f.hover);
      gl.uniform3fv(pr.u.uAccent!, paint.accent);
      gl.uniform1f(pr.u.uDim!, DIM);
    };
    if (this.m) {
      common(this.edge);
      gl.uniform2f(this.edge.u.uHalf!, this.canvas.width / 2, this.canvas.height / 2);
      gl.uniform1f(this.edge.u.uWidth!, sizes.link * f.dpr);
      gl.uniform3fv(this.edge.u.uEdge!, paint.edge);
      gl.uniform1f(this.edge.u.uEdgeAlpha!, paint.edgeAlpha);
      gl.bindVertexArray(this.edgeVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.m);
    }
    common(this.node);
    gl.uniform1f(this.node.u.uZoom!, f.dot);
    gl.uniform1f(this.node.u.uDpr!, f.dpr);
    gl.uniform1f(this.node.u.uDotMin!, sizes.dotMin);
    gl.uniform1f(this.node.u.uRing!, sizes.ring);
    gl.uniform1f(this.node.u.uHalo!, sizes.halo);
    gl.uniform3fv(this.node.u.uPaper!, paint.paper);
    gl.uniform3fv(this.node.u.uPalette!, paint.palette);
    gl.bindVertexArray(this.nodeVao);
    gl.drawArrays(gl.POINTS, 0, this.n);
    gl.bindVertexArray(null);
  }

  /** Wait for the GPU: only the bench asks, to time a frame rather than the queuing of one. */
  finish(): void {
    this.gl.finish();
  }

  /** Every buffer, texture and program deleted, and the context itself given back. */
  dispose(): void {
    if (this.gone) return;
    this.gone = true;
    const gl = this.gl;
    gl.deleteBuffer(this.nodeBuf);
    gl.deleteBuffer(this.edgeBuf);
    gl.deleteVertexArray(this.nodeVao);
    gl.deleteVertexArray(this.edgeVao);
    gl.deleteTexture(this.posTex);
    gl.deleteTexture(this.stateTex);
    gl.deleteProgram(this.node.p);
    gl.deleteProgram(this.edge.p);
    for (const s of this.shaders) gl.deleteShader(s);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
