#version 300 es
//
// wiener.frag — M4 Wiener pre-filter (phase 1: fixed K, no content mask)
//
// Both inputs are in the frequency domain. Complex numbers are
// packed as RG: red = real part, green = imaginary part.
//
//      G(u,v) = F(u,v) · conj(H(u,v)) / ( |H(u,v)|² + K )
//
// Phase 2 will replace `u_K` with a sampled mask
// (text / image / background) per spec §4.10.
//

precision highp float;

uniform sampler2D u_image_fft;   // F = FFT(image)
uniform sampler2D u_psf_fft;     // H = FFT(PSF)
uniform float     u_K;           // Wiener regularization constant (scalar)

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    vec2 F = texture(u_image_fft, v_uv).rg;
    vec2 H = texture(u_psf_fft,   v_uv).rg;

    // |H|² and conj(H)
    float H_mag2 = dot(H, H);            // H.x*H.x + H.y*H.y
    vec2  H_conj = vec2(H.x, -H.y);

    // F * conj(H)  (complex multiply)
    vec2 numer = vec2(
        F.x * H_conj.x - F.y * H_conj.y,
        F.x * H_conj.y + F.y * H_conj.x
    );

    float denom = H_mag2 + u_K;
    fragColor = vec4(numer / denom, 0.0, 1.0);
}
