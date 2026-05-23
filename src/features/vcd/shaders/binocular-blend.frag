#version 300 es
//
// binocular-blend.frag — Weighted linear blend of two H textures.
//
//   H_blended(u, v) = w_od · H_od(u, v) + w_os · H_os(u, v)
//
// By linearity of the FFT, blending H is equivalent to blending the
// underlying PSFs in image space — so this produces the "fused" PSF
// for a point on the screen between the two eyes' contribution.
//
// Caller computes (w_od, w_os) from the gaze position each frame:
//   gaze near right of screen   → w_od ≫ w_os
//   gaze near left  of screen   → w_od ≪ w_os
//   gaze near center            → w_od ≈ w_os ≈ 0.5
//

precision highp float;

uniform sampler2D u_h_od;
uniform sampler2D u_h_os;
uniform float     u_w_od;
uniform float     u_w_os;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    vec2 hOd = texture(u_h_od, v_uv).rg;
    vec2 hOs = texture(u_h_os, v_uv).rg;
    fragColor = vec4(u_w_od * hOd + u_w_os * hOs, 0.0, 1.0);
}
