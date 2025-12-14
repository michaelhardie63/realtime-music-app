
const vertSrc = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = (a_pos + 1.0) * 0.5;
  gl_Position = vec4(a_pos,0.0,1.0);
}`;

export class Engine{
  constructor(canvas){
  this.canvas = canvas;
  this.gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    desynchronized: true
  });
  if (!this.gl) throw new Error('WebGL2 not supported');

    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0,0,0,1);

    this.time = 0;
    this.last = performance.now();
    this.uniforms = { u_bpm:120, u_beat:0, u_bend:0, u_brightness:.3, u_palette:[1,0,1, 0,1,1] };

    this.resize();
    addEventListener('resize', ()=>this.resize());
    this._initQuad();
  }

  resize(){
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width  * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h){
      this.canvas.width = w; this.canvas.height = h;
    }
    this.gl.viewport(0,0,w,h);
  }
  _initQuad(){
    const gl=this.gl;
    const quad = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    this.vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vb);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  }
  _compile(type,src){
    const gl=this.gl, sh=gl.createShader(type);
    gl.shaderSource(sh,src); gl.compileShader(sh);
    if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  _link(fsSrc){
    const gl=this.gl;
    const vs=this._compile(gl.VERTEX_SHADER, vertSrc);
    const fs=this._compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog=gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog,'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.vb);
    gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    this.prog=prog;
    this.u_time=gl.getUniformLocation(prog,'u_time');
    this.u_res =gl.getUniformLocation(prog,'u_res');
    this.u_bpm =gl.getUniformLocation(prog,'u_bpm');
    this.u_beat=gl.getUniformLocation(prog,'u_beat');
    this.u_bend=gl.getUniformLocation(prog,'u_bend');
    this.u_bright=gl.getUniformLocation(prog,'u_brightness');
    this.u_palA=gl.getUniformLocation(prog,'u_palA');
    this.u_palB=gl.getUniformLocation(prog,'u_palB');
    this.u_audio =gl.getUniformLocation(prog,'u_audio');
    this.u_note  =gl.getUniformLocation(prog,'u_note');
    this.u_noteT =gl.getUniformLocation(prog,'u_noteTime');
    this.u_energy  = gl.getUniformLocation(prog,'u_energy');
    this.u_valence = gl.getUniformLocation(prog,'u_valence');
    this.u_key     = gl.getUniformLocation(prog,'u_key');
    this.u_isMinor = gl.getUniformLocation(prog,'u_isMinor');
    this.u_section = gl.getUniformLocation(prog,'u_section');
    this.u_notesT = [];
    this.u_notesP = [];
    this.u_notesV = [];
    for (let i = 0; i < 6; i++) {
      this.u_notesT[i] = this.gl.getUniformLocation(this.prog, `u_notesT[${i}]`);
      this.u_notesP[i] = this.gl.getUniformLocation(this.prog, `u_notesP[${i}]`);
      this.u_notesV[i] = this.gl.getUniformLocation(this.prog, `u_notesV[${i}]`);
    }
  }
  setSlots(slotsArray) {
    // slotsArray: [{ t: seconds, p: pitch01, v: vel01 }, ...] length <= 6
    this.slots = slotsArray;
  }

  setScene(fsSrc){
  // (Re)compile and link the fragment shader program
  this._link(fsSrc);
}
  frame(){
  const gl=this.gl;
  if (!this.prog) { requestAnimationFrame(()=>this.frame()); return; }
  const now=performance.now(), dt=(now-this.last)/1000; this.last=now; this.time+=dt;

  gl.useProgram(this.prog);
  gl.uniform1f(this.u_time,this.time);
  gl.uniform2f(this.u_res,this.canvas.width,this.canvas.height);
  gl.uniform1f(this.u_bpm,this.uniforms.u_bpm);
  gl.uniform1f(this.u_beat,this.uniforms.u_beat);
  gl.uniform1f(this.u_bend,this.uniforms.u_bend);
  gl.uniform1f(this.u_bright,this.uniforms.u_brightness);
  gl.uniform3fv(this.u_palA,this.uniforms.u_palette.slice(0,3));
  gl.uniform3fv(this.u_palB,this.uniforms.u_palette.slice(3,6));
  if (this.u_audio) gl.uniform1f(this.u_audio, this.uniforms.u_audio ?? 0.0);
  if (this.u_note)  gl.uniform1f(this.u_note,  this.uniforms.u_note ?? 0.0);
  if (this.u_noteT) gl.uniform1f(this.u_noteT, this.uniforms.u_noteTime ?? 0.0);

  if (this.u_energy)  gl.uniform1f(this.u_energy,  this.uniforms.u_energy ?? 0.0);
  if (this.u_valence) gl.uniform1f(this.u_valence, this.uniforms.u_valence ?? 0.0);
  if (this.u_key)     gl.uniform1f(this.u_key,     this.uniforms.u_key ?? 0.0);
  if (this.u_isMinor) gl.uniform1f(this.u_isMinor, this.uniforms.u_isMinor ?? 0.0);
  if (this.u_section) gl.uniform1f(this.u_section, this.uniforms.u_section ?? 0.0);

  if (this.slots && this.u_notesT && this.u_notesT.length) {
  const S = this.slots;
  for (let i = 0; i < this.u_notesT.length; i++) {
    const s = S[i] || { t: -9999, p: 0, v: 0 };
    if (this.u_notesT[i]) this.gl.uniform1f(this.u_notesT[i], s.t);
    if (this.u_notesP[i]) this.gl.uniform1f(this.u_notesP[i], s.p);
    if (this.u_notesV[i]) this.gl.uniform1f(this.u_notesV[i], s.v);
  }
}

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  requestAnimationFrame(()=>this.frame());
}
}
