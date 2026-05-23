#version 300 es
//
// vcd-blend.frag — Combined Wiener pre-filter + eye-PSF re-blur in one pass,
//                  with an onboarding `strength` knob.
//
// Replaces the camera-page's previous two-pass (wiener.frag → complex-mul.frag)
// chain. The math:
//
//   no-VCD view:  F · H                        (eye blur on raw camera frame)
//   full-VCD view: F · |H|² / (|H|² + K)       (Wiener + extra ·H = the
//                                               same identity preview ④ uses)
//
// Onboarding strength s∈[0,1] blends between them per frequency:
//
//   factor(u,v) = (1−s)·H(u,v) + s · α(u,v),
//   where α(u,v) = |H|² / (|H|² + K)   (real, treated as (α, 0))
//
// Output = F · factor. At s=0 we exactly reproduce the no-VCD view, at s=1
// the full-VCD view; intermediate s smoothly interpolates without ringing
// because α is always real in [0,1].
//

precision highp float;

uniform sampler2D u_image_fft;
uniform sampler2D u_psf_fft;
uniform float     u_K;
uniform float     u_strength;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    vec2 F = texture(u_image_fft, v_uv).rg;
    vec2 H = texture(u_psf_fft,   v_uv).rg;

    float Hmag2 = dot(H, H);
    float alpha = Hmag2 / (Hmag2 + u_K);

    vec2 factor = vec2(
        (1.0 - u_strength) * H.x + u_strength * alpha,
        (1.0 - u_strength) * H.y
    );

    // F · factor  (complex)
    fragColor = vec4(
        F.x * factor.x - F.y * factor.y,
        F.x * factor.y + F.y * factor.x,
        0.0, 1.0
    );
}
