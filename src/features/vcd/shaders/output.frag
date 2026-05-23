#version 300 es
//
// output.frag — Complex texture → grayscale RGB on the canvas.
//
// Reads the .r channel of the source (the real part of the complex
// value), multiplies by u_scale (1.0 when reading grayTex directly,
// or 1/N² when reading an IFFT result that the FFT didn't normalize),
// clamps to [0,1], and writes it as grayscale.
//
// This is the *only* pass that flips Y for display. All internal
// textures share the same un-flipped GL coordinate convention so
// FFT/Wiener arithmetic is consistent. We invert Y here so the top
// of the video element ends up at the top of the canvas.
//

precision highp float;

uniform sampler2D u_src;
uniform float u_scale;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
    float v = texture(u_src, uv).r * u_scale;
    float g = clamp(v, 0.0, 1.0);
    fragColor = vec4(g, g, g, 1.0);
}
