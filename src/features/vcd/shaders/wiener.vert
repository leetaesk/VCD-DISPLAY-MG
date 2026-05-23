#version 300 es
//
// wiener.vert — fullscreen quad pass-through.
// Shared by every FFT/Wiener stage.
//
// We render to an FBO covering the entire texture, so we draw two
// triangles in clip space [-1, +1]². v_uv is the corresponding [0, 1]²
// coordinate, which equals the normalized pixel coordinate of the
// target texture (with the standard half-pixel offset applied later
// inside the fragment shader when sampling integer cells).
//

in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
