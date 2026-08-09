/**
 * Terrain shader. The environment texture is painted on the worker and drawn
 * here as a single world-space quad, plus a subtle instrument grid that fades
 * in as you zoom so the view keeps a sense of scale.
 */
export const TERRAIN_WGSL = /* wgsl */ `
struct Camera {
  center   : vec2<f32>,
  scale    : f32,
  time     : f32,
  viewport : vec2<f32>,
  worldSize: f32,
  pad      : f32,
};

@group(0) @binding(0) var<uniform> cam : Camera;
@group(0) @binding(1) var terrainTex : texture_2d<f32>;
@group(0) @binding(2) var terrainSampler : sampler;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) world : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
  );
  let uv = corners[vi];
  let world = uv * cam.worldSize;
  let v = (world - cam.center) * cam.scale;
  var o : VSOut;
  o.pos = vec4<f32>(v.x / (cam.viewport.x * 0.5), -v.y / (cam.viewport.y * 0.5), 0.0, 1.0);
  o.uv = uv;
  o.world = world;
  return o;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  var col = textureSample(terrainTex, terrainSampler, in.uv).rgb;

  // Grid whose spacing steps by powers of ten as you zoom, like a scope
  // graticule. Fades out entirely when it would alias.
  let decade = pow(10.0, floor(log(120.0 / cam.scale) / log(10.0)));
  let g = abs(fract(in.world / decade - 0.5) - 0.5) / fwidth(in.world / decade);
  let line = 1.0 - min(min(g.x, g.y), 1.0);
  let fade = clamp(cam.scale * decade / 90.0, 0.0, 1.0);
  col += vec3<f32>(0.28, 0.42, 0.52) * line * 0.10 * fade;

  return vec4<f32>(col, 1.0);
}
`;
