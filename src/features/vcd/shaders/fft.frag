#version 300 es
//
// fft.frag — One stage of a 2D Stockham radix-2 FFT.
//
// Stockham auto-sort: input and output are both in natural order;
// no bit-reversal step is needed. Each stage doubles the size of the
// "completed" sub-FFT. After log2(N) row passes followed by log2(N)
// column passes, the 2D DFT is in fragColor.
//
// Uniforms
//   u_src   : ping-pong source texture (RGBA32F, RG = complex)
//   u_N     : FFT size along the active axis (here always = texture size)
//   u_span  : sub-FFT half-size before this stage  (2^s,  s = 0..log2(N)-1)
//   u_dir   : -1.0 forward,  +1.0 inverse
//   u_axis  :  0 = FFT along x (row pass)   |   1 = FFT along y (column pass)
//
// For each output pixel at index k along the active axis:
//
//      q = floor(k / (2·span))      // butterfly group
//      r =  k  mod  (2·span)        // position within group
//      if r < span:                 // lower half  →  a + w·b
//          j = r;            sign = +1
//      else:                        // upper half  →  a − w·b
//          j = r − span;     sign = −1
//      a_src = q·span + j           // index of "a" sample in input
//      b_src = a_src + N/2          // index of "b" sample (offset N/2)
//      w     = exp(dir · 2πi · j / (2·span))
//      out   = a + sign·w·b
//
// (Verified against a 4-point DFT by hand — see vcd-shader.js comments.)
//

precision highp float;
precision highp sampler2D;

uniform sampler2D u_src;
uniform float u_N;
uniform float u_span;
uniform float u_dir;
uniform int   u_axis;

in  vec2 v_uv;
out vec4 fragColor;

const float TAU = 6.28318530717958647692;

vec2 cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

void main() {
    float N        = u_N;
    float span     = u_span;
    float two_span = 2.0 * span;

    // Integer pixel coordinate of the *output* pixel we're writing.
    // floor(v_uv * N) gives 0..N-1 with the half-pixel sampling convention.
    vec2 ip = floor(v_uv * N);

    float k, perp;
    if (u_axis == 0) { k = ip.x; perp = ip.y; }   // row pass: FFT along x
    else             { k = ip.y; perp = ip.x; }   // col pass: FFT along y

    // Stockham mapping
    float q = floor(k / two_span);
    float r = k - q * two_span;          // k mod (2·span)
    float j, sign_b;
    if (r < span) {
        j      = r;
        sign_b = 1.0;
    } else {
        j      = r - span;
        sign_b = -1.0;
    }

    float a_src = q * span + j;
    float b_src = a_src + N * 0.5;

    // Texture sample coordinates (half-pixel offset for nearest-neighbor).
    vec2 ca, cb;
    if (u_axis == 0) {
        ca = (vec2(a_src, perp) + 0.5) / N;
        cb = (vec2(b_src, perp) + 0.5) / N;
    } else {
        ca = (vec2(perp, a_src) + 0.5) / N;
        cb = (vec2(perp, b_src) + 0.5) / N;
    }

    vec2 a = texture(u_src, ca).rg;
    vec2 b = texture(u_src, cb).rg;

    // Twiddle factor w = exp(dir · 2πi · j / (2·span))
    float theta = u_dir * TAU * j / two_span;
    vec2  w     = vec2(cos(theta), sin(theta));
    vec2  wb    = cmul(w, b);

    fragColor = vec4(a + sign_b * wb, 0.0, 1.0);
}
