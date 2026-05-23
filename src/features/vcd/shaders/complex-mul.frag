#version 300 es
//
// complex-mul.frag — Pointwise complex multiplication of two textures.
//
//   G(u, v) = A(u, v) · B(u, v)
//
// Used by the real-time camera pipeline to apply the eye PSF in the
// frequency domain *after* Wiener pre-filtering. Without that second
// multiply we would only have the pre-distorted display content
// (which looks deliberately weird to a normal viewer); with it we
// have an estimate of what the prescription-matched eye would
// actually perceive — i.e. the same quantity that preview-page
// panel ④ shows.
//
// In the "보정 없음" path we skip the Wiener step entirely and use
// this shader directly: F · H → IFFT gives the eye-blurred view of
// the raw camera frame.
//

precision highp float;

uniform sampler2D u_a;
uniform sampler2D u_b;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    vec2 a = texture(u_a, v_uv).rg;
    vec2 b = texture(u_b, v_uv).rg;
    // (a.x + i·a.y) · (b.x + i·b.y)
    //   = (a.x·b.x − a.y·b.y) + i·(a.x·b.y + a.y·b.x)
    fragColor = vec4(
        a.x * b.x - a.y * b.y,
        a.x * b.y + a.y * b.x,
        0.0, 1.0
    );
}
