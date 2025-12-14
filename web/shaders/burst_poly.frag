#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2  u_res;
uniform float u_time;
uniform float u_bend;
uniform float u_brightness;
uniform vec3  u_palA;
uniform vec3  u_palB;

// JS sets these unconditionally — declare them to avoid null uniform errors.
uniform float u_bpm;
uniform float u_beat;

// Poly: up to 6 simultaneous notes
uniform float u_notesT[6];  // seconds each note started
uniform float u_notesP[6];  // pitch 0..1
uniform float u_notesV[6];  // velocity 0..1

// Tunables
#define MAX_PARTS 300
const float DECAY_S   = 0.65;
const float SIZE_MIN  = 0.010;
const float SIZE_MAX  = 0.032;
const float SPEED_MIN = 0.55;
const float SPEED_MAX = 1.90;

float hash11(float x){ return fract(sin(x*127.1)*43758.5453123); }
vec2  hash21(float x){ float n=sin(x*127.1); return fract(vec2(43758.5453*n,23421.631*n)); }

float envFor(float tNow, float tStart, float vel, float baseBright){
  if (tStart < -999.0) return 0.0;
  float a0 = mix(0.35, 1.0, clamp(vel, 0.0, 1.0));
  a0 *= (0.7 + 0.6 * clamp(baseBright, 0.0, 1.0));
  float dt = max(0.0, tNow - tStart);
  return a0 * exp(-dt / DECAY_S);
}

void main(){
  vec2 uv = (gl_FragCoord.xy / u_res) * 2.0 - 1.0;
  uv.x *= u_res.x / u_res.y;

  float warp = 0.12*u_bend;
  uv += warp * vec2(0.5*sin(uv.y*3.0 + u_time*0.7),
                    0.5*cos(uv.x*3.0 - u_time*0.6));

  float envs[6];
  int activeCount = 0;
  for (int i=0;i<6;i++){
    envs[i] = envFor(u_time, u_notesT[i], u_notesV[i], u_brightness);
    activeCount += (envs[i] > 1e-3 ? 1 : 0);   // safer than int(bool)
  }
  if (activeCount == 0) { fragColor = vec4(0.0); return; }

  int perSlot = max(20, int(float(MAX_PARTS) / float(activeCount)));

  vec3 col = vec3(0.0);
  float aAccum = 0.0; // optional: drive alpha

  for (int s=0; s<6; s++){
    float env = envs[s];
    if (env <= 1e-3) continue;

    float pSize  = mix(SIZE_MIN,  SIZE_MAX,  env);
    float pSpeed = mix(SPEED_MIN, SPEED_MAX, env);

    float baseSeed = floor(u_notesP[s]*127.0) * 31.0 + floor(u_notesT[s]);

    for (int i=0; i<MAX_PARTS; i++){
      if (i >= perSlot) break;

      float fi = float(i);
      float seed = baseSeed + fi*5.1;

      vec2  origin = hash21(seed) * 2.0 - 1.0;
      origin.x *= u_res.x / u_res.y;
      origin *= mix(0.18, 0.82, hash11(seed+1.23));

      float ang = 6.2831853 * hash11(seed+2.7);
      float spd = pSpeed * (0.35 + 0.65*hash11(seed+5.2));

      float age = max(0.0, u_time - u_notesT[s]);
      vec2  dir = vec2(cos(ang), sin(ang));
      vec2  pos = origin + dir * (spd * age);

      pos += 0.06 * vec2(
        sin((pos.y+fi)*3.1 + u_time*0.8),
        cos((pos.x-fi)*2.9 - u_time*0.7)
      );

      float size = pSize * mix(1.0, 0.55, smoothstep(0.0, DECAY_S, age));

      float dist = length(uv - pos);
      float feather = size * 0.35;
      float a = 1.0 - smoothstep(size - feather, size, dist);

      float t = hash11(seed+7.13);
      vec3  pCol = mix(u_palA, u_palB, t);

      float lifeBoost = (1.0 - smoothstep(0.0, DECAY_S, age));
      pCol *= (0.30 + 0.70 * (lifeBoost * (0.7 + 0.6*env)));

      col += pCol * a;
      aAccum += a;
    }
  }

  float vig = smoothstep(1.10, 0.28, length(uv)) * 0.22;
  col *= (1.0 - vig);
  col = col / (1.0 + col);
  col *= (0.8 + 0.9 * u_brightness);

  // Optional: put accumulated softness into alpha for nicer compositing:
  float outA = clamp(aAccum * 0.5, 0.0, 1.0);
  fragColor = vec4(col, outA);
}
