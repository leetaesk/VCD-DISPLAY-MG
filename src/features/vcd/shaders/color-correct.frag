#version 300 es
//
// color-correct.frag — M2 field-remap + M3 color-correction in ONE pass.
//
// Pipeline inside the shader:
//   1. Display-space uv  (Y-flipped from clip-space)
//   2. M2 FIELD REMAP — at output positions where the user's Amsler
//      defect mask is non-zero, the texture sample is radially shifted
//      OUTWARD from screen center. The result: peripheral content
//      drifts into the defect region so the user's still-healthy
//      retina (outside the defect) can perceive it. Mask value scales
//      the shift, so weak defects pull less than strong ones.
//   3. Center-crop the (possibly non-square) source video to a square.
//   4. Mirror horizontally for selfie convention.
//   5. M3 COLOR CORRECTION — 3×3 matrix multiply on the RGB result.
//
// Identity inputs:
//   • empty mask   → defect=0   → no remap
//   • strength=0   → no remap regardless of mask
//   • identity mat → no color shift
//
// So a normal observer or anyone with no Amsler/color test sees the
// raw camera frame, untouched. Performance: ~2 texture lookups + a
// mat3·vec3 per output pixel — well under 1 ms at 256².
//

precision highp float;

uniform sampler2D u_video;
uniform sampler2D u_defectMask;
uniform float u_videoAspect;
uniform float u_mirror;
uniform mat3  u_colorMatrix;
uniform float u_remapStrength;

in  vec2 v_uv;
out vec4 fragColor;

// Maximum radial shift in normalized texture coords. ~15 % of the
// field — enough to noticeably move content out of a small central
// scotoma without warping the periphery into incoherence.
const float MAX_REMAP_SHIFT = 0.15;

void main() {
    // 1. Display-space uv (top of canvas → uv.y = 0)
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);

    // 2. M2 field remap — sample shift away from defect regions
    if (u_remapStrength > 0.001) {
        float defect = texture(u_defectMask, uv).r;
        if (defect > 0.05) {
            vec2 toCenter = uv - vec2(0.5, 0.5);
            float r = max(length(toCenter), 0.01);
            vec2 outward = toCenter / r;
            uv = uv + outward * defect * u_remapStrength * MAX_REMAP_SHIFT;
        }
    }

    // 3. Center-crop to square
    if (u_videoAspect >= 1.0) {
        uv.x = 0.5 + (uv.x - 0.5) / u_videoAspect;
    } else {
        uv.y = 0.5 + (uv.y - 0.5) * u_videoAspect;
    }

    // 4. Mirror for selfie
    if (u_mirror > 0.5) uv.x = 1.0 - uv.x;
    uv = clamp(uv, vec2(0.0), vec2(1.0));

    // 5. M3 color correction
    vec3 rgb = texture(u_video, uv).rgb;
    vec3 corrected = u_colorMatrix * rgb;
    fragColor = vec4(clamp(corrected, vec3(0.0), vec3(1.0)), 1.0);
}
