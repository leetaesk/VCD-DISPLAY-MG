#version 300 es
//
// gray-pack.frag — Video frame → grayscale complex texture.
//
// One pass that does three things at once so the rest of the
// real-time pipeline can treat all textures as square N×N RGBA32F
// complex (R=real, G=imag, BA=ignored):
//
//   1. Center-crop the (possibly non-square) video to a square,
//      respecting u_videoAspect = width / height.
//   2. Mirror horizontally for selfie convention when u_mirror > 0.5.
//   3. Convert RGB to luminance (BT.601) and pack as the real part of
//      a complex value (imag = 0).
//
// No FLIP_Y_WEBGL is used during the video upload, so videoTex Y=0
// is the BOTTOM of the frame in GL coordinates. We don't compensate
// here — the same convention runs through FFT/Wiener/IFFT and only
// the final output.frag flips Y for visual display. Keeping the
// pipeline coordinate-consistent like this avoids subtle off-by-one
// shifts in the convolution result.
//

precision highp float;

uniform sampler2D u_video;
uniform float u_videoAspect;
uniform float u_mirror;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    vec2 uv = v_uv;

    // Center crop: shrink the *sampling* range so the output N×N grid
    // maps to the largest centered square inside the source video.
    if (u_videoAspect >= 1.0) {
        // Wide video — crop horizontally.
        uv.x = 0.5 + (v_uv.x - 0.5) / u_videoAspect;
    } else {
        // Tall video — crop vertically.
        uv.y = 0.5 + (v_uv.y - 0.5) * u_videoAspect;
    }

    if (u_mirror > 0.5) {
        uv.x = 1.0 - uv.x;
    }

    // If the crop went out of [0,1] (e.g. extreme aspect), clamp so we
    // sample edge pixels instead of garbage.
    uv = clamp(uv, vec2(0.0), vec2(1.0));

    vec3 rgb = texture(u_video, uv).rgb;
    float gray = dot(rgb, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(gray, 0.0, 0.0, 1.0);
}
