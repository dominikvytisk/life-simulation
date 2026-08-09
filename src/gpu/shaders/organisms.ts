/**
 * Organism shader. One instanced quad per organism; the body is drawn as a
 * signed-distance field in the fragment stage so shape comes from the
 * phenotype rather than from a sprite sheet.
 *
 * Morphology is *generated*, not assigned:
 *   muscle   -> elongation (fast things are streamlined)
 *   armor    -> a thicker shell rim
 *   diet     -> warm/cool body tint
 *   vision   -> visible eye
 *   energy   -> internal brightness
 * A creature that evolves toward a new niche looks different without anyone
 * drawing it.
 */
export const ORGANISM_WGSL = /* wgsl */ `
struct Camera {
  center   : vec2<f32>,
  scale    : f32,
  time     : f32,
  viewport : vec2<f32>,
  worldSize: f32,
  pad      : f32,
};

@group(0) @binding(0) var<uniform> cam : Camera;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) local     : vec2<f32>,
  @location(1) tint      : vec3<f32>,
  @location(2) props     : vec4<f32>, // elongation, armor, energy, flags
  @location(3) glow      : f32,
};

fn worldToClip(p : vec2<f32>) -> vec2<f32> {
  let v = (p - cam.center) * cam.scale;
  return vec2<f32>(v.x / (cam.viewport.x * 0.5), -v.y / (cam.viewport.y * 0.5));
}

fn hsl2rgb(h : f32, s : f32, l : f32) -> vec3<f32> {
  let k = vec3<f32>(0.0, 8.0, 4.0);
  let a = s * min(l, 1.0 - l);
  let t = (k + vec3<f32>(h * 12.0)) % vec3<f32>(12.0);
  return vec3<f32>(l, l, l) - a * clamp(min(t - vec3<f32>(3.0), vec3<f32>(9.0) - t), vec3<f32>(-1.0), vec3<f32>(1.0));
}

@vertex
fn vs(
  @builtin(vertex_index) vi : u32,
  @location(0) posXY   : vec2<f32>,
  @location(1) headRad : vec2<f32>,
  @location(2) hueEnergy : vec2<f32>,
  @location(3) shape   : vec3<f32>,   // elongation, diet, armor
  @location(4) flags   : f32,
) -> VSOut {
  // Unit quad, expanded so the SDF glow has room outside the body.
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let c = corners[vi];

  let heading = headRad.x;
  let radius  = headRad.y;
  // Minimum on-screen size keeps a 100k-organism world legible when zoomed out.
  let screenR = max(radius * cam.scale, 1.35);
  let extent  = screenR * 2.1 / cam.scale;

  let ca = cos(heading);
  let sa = sin(heading);
  let local = vec2<f32>(c.x * extent, c.y * extent);
  let rotated = vec2<f32>(local.x * ca - local.y * sa, local.x * sa + local.y * ca);

  var o : VSOut;
  o.pos = vec4<f32>(worldToClip(posXY + rotated), 0.0, 1.0);
  o.local = c;

  // Hue is a near-neutral genetic marker, so lineages drift apart in colour.
  // Diet warms the tint, which makes the carnivore/herbivore split visible the
  // moment it happens.
  let diet = shape.y;
  let base = hsl2rgb(fract(hueEnergy.x), 0.45 + diet * 0.3, 0.42 + hueEnergy.y * 0.22);
  o.tint = mix(base, vec3<f32>(0.95, 0.35, 0.28), diet * 0.55);
  o.props = vec4<f32>(shape.x, shape.z, hueEnergy.y, flags);
  o.glow = clamp(screenR / 9.0, 0.25, 1.0);
  return o;
}

fn sdEllipse(p : vec2<f32>, r : vec2<f32>) -> f32 {
  let k1 = length(p / r);
  let k2 = length(p / (r * r));
  return k1 * (k1 - 1.0) / max(k2, 1e-5);
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let elong = in.props.x;
  let armor = in.props.y;
  let energy = in.props.z;
  let flags = u32(in.props.w);

  // Body: an ellipse stretched along the heading axis by the muscle gene.
  let rx = 0.52 + elong * 0.34;
  let ry = 0.50 - elong * 0.14 + armor * 0.10;
  let p = in.local;
  let d = sdEllipse(p, vec2<f32>(rx, ry));

  let aa = 0.06;
  let body = 1.0 - smoothstep(-aa, aa, d);
  if (body <= 0.001 && d > 0.35) { discard; }

  var col = in.tint * (0.55 + energy * 0.6);

  // Shell rim scales with armor.
  let rim = smoothstep(-0.13 - armor * 0.1, -0.01, d) * (0.25 + armor * 0.75);
  col = mix(col, col * 0.45 + vec3<f32>(0.28, 0.30, 0.34) * armor, rim);

  // Forward-facing eye. Placed at the leading edge of the body.
  let eye = length(p - vec2<f32>(rx * 0.55, 0.0)) - 0.11;
  let eyeMask = (1.0 - smoothstep(-0.02, 0.03, eye)) * in.glow;
  col = mix(col, vec3<f32>(0.03, 0.05, 0.07), eyeMask * 0.9);

  // State cues, drawn as light rather than icons so they read at any zoom.
  if ((flags & 2u) != 0u) { col += vec3<f32>(0.55, 0.10, 0.06) * (1.0 - rim); }
  if ((flags & 4u) != 0u) { col += vec3<f32>(0.35, 0.12, 0.45); }
  if ((flags & 8u) != 0u) { col += vec3<f32>(0.10, 0.35, 0.12); }
  if ((flags & 16u) != 0u) {
    let pulse = 0.5 + 0.5 * sin(cam.time * 6.0);
    col += vec3<f32>(0.18, 0.30, 0.55) * pulse * 0.8;
  }

  var alpha = body;

  // Soft outer glow: what makes a dense population read as a living field
  // rather than a scatter plot.
  let halo = exp(-max(d, 0.0) * 7.0) * 0.5 * in.glow;
  col += in.tint * halo;
  alpha = max(alpha, halo * 0.7);

  // Selection ring.
  if ((flags & 1u) != 0u) {
    let ring = 1.0 - smoothstep(0.02, 0.09, abs(d - 0.30));
    col += vec3<f32>(0.95, 0.98, 1.0) * ring;
    alpha = max(alpha, ring);
  }

  // Juveniles are drawn translucent.
  if ((flags & 32u) != 0u) { alpha *= 0.65; }

  return vec4<f32>(col, alpha);
}
`;
