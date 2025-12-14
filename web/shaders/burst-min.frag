#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2  u_res;
uniform float u_time;
uniform float u_bpm;
uniform float u_bend;
uniform float u_brightness;
uniform vec3  u_palA;
uniform vec3  u_palB;

uniform float u_audio;     // 0..~1 (optional)
uniform float u_note;      // 0..1   (last note’s pitch)
uniform float u_noteTime;  // seconds (last note time)

// ---- knobs ----
#define MAX_PARTS 220
const float DECAY_S   = 0.65;      // how long the burst hangs
const float SIZE_MIN  = 0.010;
const float SIZE_MAX  = 0.032;
const float SPEED_MIN = 0.55;
const float SPEED_MAX = 1.90;

// helpers
float hash11(float x){ return fract(sin(x*127.1)*43758.5453123); }
vec2  hash21(float x){ float n = sin(x*127.1); return fract(vec2(43758.5453*n,23421.631*n)); }

float burstEnv(float tNow, float tStart, float vel){
  float a0 = mix(0.35, 1.0, clamp(vel, 0.0, 1.0));
  float dt = max(0.0, tNow - tStart);
  return a0 * exp(-dt / DECAY_S);
}

void main(){
  // screen coords with aspect
  vec2 uv = (gl_FragCoord.xy / u_res) * 2.0 - 1.0;
  uv.x *= u_res.x / u_res.y;

  // warp for life
  float warp = 0.12*u_bend + 0.18*u_audio;
  uv += warp * vec2(0.5*sin(uv.y*3.0 + u_time*0.7),
                    0.5*cos(uv.x*3.0 - u_time*0.6));

  // envelope from last note
  float env = burstEnv(u_time, u_noteTime, u_brightness); // 0..1 decaying
  if (env < 1e-3) { fragColor = vec4(0.0); return; }

  // seed per-burst from note index (keeps look consistent during the burst)
  float baseSeed = floor(u_note * 127.0) * 17.0 + floor(u_noteTime);

  // particle budget and dynamics scale with env
  float pSize  = mix(SIZE_MIN,  SIZE_MAX,  env);
  float pSpeed = mix(SPEED_MIN, SPEED_MAX, env);

  // simple 2-color ramp (use your Engine’s u_palA/B)
  vec3 palA = u_palA;
  vec3 palB = u_palB;

  vec3 col = vec3(0.0);

  for(int i=0;i<MAX_PARTS;i++){
    float fi = float(i);
    float s  = baseSeed + fi*3.1;
    // emitter ring
    vec2  origin = hash21(s) * 2.0 - 1.0;
    origin.x *= u_res.x / u_res.y;
    origin *= mix(0.18, 0.82, hash11(s+1.23));

    float ang = 6.2831853 * hash11(s+2.7);
    float spd = pSpeed * (0.35 + 0.65*hash11(s+5.2));

    float age = max(0.0, u_time - u_noteTime);
    vec2  dir = vec2(cos(ang), sin(ang));
    vec2  pos = origin + dir * (spd * age);

    // soft wobble
    pos += 0.06 * vec2(
      sin((pos.y+fi)*3.1 + u_time*0.8),
      cos((pos.x-fi)*2.9 - u_time*0.7)
    );

    float size = pSize * mix(1.0, 0.55, smoothstep(0.0, DECAY_S, age));

    // correct soft disc
    float dist = length(uv - pos);
    float feather = size * 0.35;
    float a = 1.0 - smoothstep(size - feather, size, dist);

    // particle color
    float t = hash11(s+7.13);
    vec3  pCol = mix(palA, palB, t);

    // early-life boost
    float lifeBoost = (1.0 - smoothstep(0.0, DECAY_S, age));
    pCol *= (0.30 + 0.70 * (lifeBoost * (0.7 + 0.6*env)));

    col += pCol * a;
  }

  // vignette + tonemap + global brightness
  float vig = smoothstep(1.10, 0.28, length(uv)) * 0.22;
  col *= (1.0 - vig);
  col = col / (1.0 + col);
  col *= (0.8 + 0.9 * u_brightness);

  fragColor = vec4(col * env, 1.0);
}
