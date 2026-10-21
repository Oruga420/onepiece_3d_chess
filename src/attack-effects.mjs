import * as THREE from '../vendor/three/three.module.js';

const clamp = x => Math.max(0, Math.min(1, x));
const ramp = (p, a, b) => clamp((p - a) / (b - a));
const envelope = (p, a, b, c) => ramp(p, a, b) * (1 - ramp(p, b, c));

/** One capture owns these geometries and materials; nothing touches cached GLBs. */
export function createAttackEffects({scene, origin, direction, attacker, attack}) {
 const group = new THREE.Group(); group.name = 'character-attack-effects';
 group.position.copy(origin); group.rotation.y = Math.atan2(direction.x, direction.z);
 group.userData.attack = attack.id; group.userData.family = attack.family;
 const geometries = new Set(), materials = new Set(), animations = [];
 const color = attack.color, accent = attack.accent, variant = attack.variant || '';
 const localBody = new THREE.Vector3();
 const localAttacker = new THREE.Vector3(), rotation = new THREE.Quaternion().copy(group.quaternion).invert();
 const material = (tint = color, opacity = 1) => {
  const m = new THREE.MeshBasicMaterial({color: tint, transparent: true, opacity: 0, depthWrite: false,
   side: THREE.DoubleSide, blending: THREE.NormalBlending, toneMapped: false});
  m.userData.strength = opacity; materials.add(m); return m;
 };
 const mesh = (name, geometry, mat = material()) => {
  geometries.add(geometry); const object = new THREE.Mesh(geometry, mat); object.name = name; group.add(object); return object;
 };
 const line = (name, points, width, mat = material()) => mesh(name,
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), Math.max(12, points.length * 4), width, 5, false), mat);
 const ring = (name, radius, width, mat = material()) => mesh(name, new THREE.TorusGeometry(radius, width, 5, 48), mat);
 const ball = (name, size, mat = material()) => mesh(name, new THREE.IcosahedronGeometry(size, 1), mat);
 const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
 // Orient a unit Y cylinder between endpoints without allocating per frame.
 const delta = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
 const stretch = (object, x1, y1, z1, x2, y2, z2, width) => {
  delta.set(x2 - x1, y2 - y1, z2 - z1); const length = delta.length();
  object.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  object.quaternion.setFromUnitVectors(up, delta.normalize()); object.scale.set(width, Math.max(.001, length), width);
 };
 // Tapered swept blade: a thin cutting edge and a wide trailing wake, with
 // zero-width tips instead of a bent pipe. UVs carry a fading wake in the shader.
 const ribbon = (name, radius, width, tint, opacity = 1) => {
  const positions = [], uvs = [], indices = [], segments = 48, arc = Math.PI * 1.15;
  for (let i = 0; i <= segments; i++) {
   const t = i / segments, angle = (t - .5) * arc;
   const taper = Math.pow(Math.sin(t * Math.PI), .75);
   for (const edge of [0, 1]) {
    const r = radius - width * taper * edge;
    positions.push(Math.cos(angle) * r, Math.sin(angle) * r, 0); uvs.push(t, edge);
   }
   if (i < segments) { const a = i * 2; indices.push(a,a+1,a+2,a+1,a+3,a+2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2)); g.setIndex(indices); g.computeVertexNormals();
  const m = material(tint, opacity);
  m.onBeforeCompile = shader => {
   shader.vertexShader = 'varying vec2 wakeUv;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nwakeUv=uv;');
   shader.fragmentShader = 'varying vec2 wakeUv;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', 'diffuseColor.a *= pow(1.0-wakeUv.y,1.5)*sin(wakeUv.x*3.14159265);\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'tapered-sword-wake-v2';
  return mesh(name, g, m);
 };
 // Procedural surfaces need no texture downloads and share a single geometry.
 // Crossed planes retain volume from elevated board cameras; noise erodes the
 // boundary so neither flames nor smoke show a hard polygon silhouette.
 const plumeGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
 const plume = (name, tint, strength, smoke = false, seed = 0) => {
  const m = new THREE.ShaderMaterial({transparent:true, depthWrite:false, side:THREE.DoubleSide,
   toneMapped:false, blending:THREE.NormalBlending,
   uniforms:{time:{value:0},opacity:{value:0},tint:{value:new THREE.Color(tint)},accent:{value:new THREE.Color(accent)},seed:{value:seed},smoke:{value:smoke ? 1 : 0}},
   vertexShader:`varying vec2 tex; void main(){tex=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
   fragmentShader:`varying vec2 tex; uniform float time,opacity,seed,smoke; uniform vec3 tint,accent;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+seed)*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
    void main(){vec2 q=tex;float n=noise(q*5.0-vec2(time*.32,time*1.9));n+=.5*noise(q*11.-vec2(-time*.4,time*3.1));
     float sway=sin(q.y*8.-time*5.+seed)*.055*q.y;
     float flame=1.-abs(q.x-.5+sway)*2./max(.08,1.-q.y*.86);
     float fog=1.-length((q-.5)*vec2(1.8,1.65));
     float shape=mix(flame,fog,smoke);float alpha=smoothstep(.08,.55,shape+(n-.7)*.42);
     alpha*=smoothstep(0.,.12,q.y)*(1.-smoothstep(.75,1.,q.y))*opacity;
     vec3 rgb=mix(tint,accent,clamp((1.-q.y)*.7+n*.22,0.,1.)*(1.-smoke*.8));
     gl_FragColor=vec4(rgb,alpha);}`});
  // Common diagnostics and intensity contract matches the other effect materials.
  m.color = m.uniforms.tint.value; m.userData.strength = strength; materials.add(m);
  return mesh(name,plumeGeometry,m);
 };
 const curvedArm = (name, tint) => {
  const g = new THREE.BufferGeometry(), positions = new Float32Array(25*9*3), indices=[];
  for(let i=0;i<24;i++) for(let j=0;j<8;j++){const a=i*9+j;indices.push(a,a+1,a+9,a+1,a+10,a+9);}
  g.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));g.setIndex(indices);
  const m=new THREE.MeshStandardMaterial({color:tint,roughness:.48,metalness:.05,transparent:true,opacity:0,depthWrite:false,toneMapped:false});
  m.userData.strength=.95;materials.add(m);
  const arm=mesh(name,g,m);arm.frustumCulled=false;
  arm.userData.bend=(x,y,start,end,bow,width)=>{
   for(let i=0;i<=24;i++){const t=i/24,centerX=x*(1-t*.65)+Math.sin(t*Math.PI)*bow;
    for(let j=0;j<=8;j++){const a=j/8*Math.PI*2,index=(i*9+j)*3;
     positions[index]=centerX+Math.cos(a)*width;positions[index+1]=y+Math.sin(t*Math.PI)*.055+Math.sin(a)*width;positions[index+2]=THREE.MathUtils.lerp(start,end,t);
    }
   }
   g.attributes.position.needsUpdate=true;g.computeVertexNormals();
  };
  return arm;
 };
 const count = variant.includes('triple') || variant.includes('santoryu') ? 3 : variant.includes('dual') ? 2 : 1;
 switch (attack.family) {
  case 'rubber': {
   const mochi = variant === 'mochi', arms = mochi ? 4 : 2;
   for (let i=0;i<arms;i++) {
    const arm=curvedArm(`${mochi?'mochi':'rubber'}-stretched-arm-${i}`,mochi?'#f5e6ce':'#bd7655');
    const fistMat=new THREE.MeshStandardMaterial({color:mochi?'#e9d8bf':'#29151a',roughness:.30,metalness:.22,transparent:true,opacity:0,toneMapped:false});
    fistMat.userData.strength=.98;materials.add(fistMat);
    const fist=mesh(`rubber-haki-fist-${i}`,new THREE.SphereGeometry(.105,16,10),fistMat);
    const knuckles=Array.from({length:4},(_,j)=>mesh(`rubber-knuckle-${i}-${j}`,new THREE.SphereGeometry(.035,8,6),fistMat));
    animations.push(({p})=>{
     const offset=i*.018, thrust=ramp(p,.55+offset,.603+offset), retract=ramp(p,.65+offset,.76+offset);
     const reach=thrust*(1-retract), sign=i%2?1:-1, x=sign*(.17+Math.floor(i/2)*.055), y=.47+i*.038;
     const end=THREE.MathUtils.lerp(localAttacker.z+.10,.09,reach);
     arm.userData.bend(x,y,localAttacker.z,end,sign*.21*(1-reach),mochi?.074:.047);
     fist.position.set(x*.35,y+.02,end);fist.scale.set(1.22,1,1.25);
     fist.rotation.y=sign*(1-reach)*.45;
     for(let j=0;j<4;j++){knuckles[j].position.set(fist.position.x+(j-1.5)*.047,fist.position.y+.045,fist.position.z+.095);knuckles[j].visible=p>=.545+offset&&p<.77+offset;}
     arm.visible=fist.visible=p>=.545+offset&&p<.77+offset;
    });
   }
   break;
  }
  case 'sword': {
   const radius=variant==='daggers'?.40:variant==='longblade'?.88:.66;
   for(let i=0;i<count;i++) {
    const blade=ribbon(`sword-cut-${i}`,radius,.19,color,.82);
    const edge=ribbon(`sword-edge-${i}`,radius+.006,.025,accent,.96);
    animations.push(({p})=>{
     const swing=ramp(p,.55+i*.013,.675+i*.013), opacity=envelope(p,.55+i*.013,.605+i*.013,.72+i*.013);
     blade.position.set((i-(count-1)/2)*.09,.52,THREE.MathUtils.lerp(-.32,.16,swing));
     blade.rotation.set(.28+i*.33,i*.16,-1.15+swing*2.25+i*.9);
     blade.scale.setScalar(.85+Math.sin(swing*Math.PI)*.18);
     blade.material.opacity=opacity*.82;edge.material.opacity=opacity*.96;
     edge.position.copy(blade.position);edge.rotation.copy(blade.rotation);edge.scale.copy(blade.scale);
    });
   }
   break;
  }
  case 'lightning': {
   for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5, x = Math.cos(a), z = Math.sin(a);
    const bolt = line(`lightning-fork-${i}`, [[x * .24, 1.9, z * .24], [x * .35, 1.35, z * .17], [x * .14, 1.12, z * .32], [x * .37, .73, z * .13], [0, .43, 0]], .014 + (i === 0 ? .012 : 0));
    animations.push(({p}) => { bolt.visible = p >= .55 + i * .008 && p < .71; bolt.scale.y = .92 + Math.sin(p * 130 + i) * .08; });
   }
   const cloud = ball('lightning-cloud', .30, material('#7183a0', .40, true)); cloud.position.set(0, 1.8, 0); cloud.scale.set(1.8, .48, 1.1);
   break;
  }
  case 'fire': {
   const magma=variant==='magma', winged=variant==='phoenix'||variant==='pteranodon';
   const layers=winged?12:8;
   for(let i=0;i<layers;i++) {
    const flame=plume(`${magma?'magma':'fire'}-tongue-${i}`,i%3===0?accent:color,.83,false,i*2.13);
    animations.push(({p,strike})=>{
     const flight=ramp(p,.55,.62), age=ramp(p,.62,.81), sign=i%2?1:-1;
     const z=THREE.MathUtils.lerp(localAttacker.z+.20,.03,flight);
     const bodyHeight=(attacker.userData.combatBody||attacker.children[0])?.position.y||0;
     if(variant==='kick' && i<4){
      flame.position.set(localBody.x+(i%2?-.07:.07),localBody.y+.14,localBody.z+.12);
      flame.rotation.set(.18,i*Math.PI/2,-.18);flame.scale.set(.20+strike*.10,.38+strike*.20,1);
     } else if(winged){
      const feather=Math.floor(i/2)/5;flame.position.set(sign*(.10+feather*.72),.62+bodyHeight+Math.sin(feather*Math.PI)*.29,localAttacker.z+.12-feather*.14);
      flame.rotation.set(0,i%2*Math.PI/2,sign*(-.4-feather*.7));flame.scale.set(.27+strike*.13,.58+strike*.23,1);
     } else {
      const a=i*2.399, radial=(.07+age*.28)*(i%2?1:.6);
      flame.position.set(Math.cos(a)*radial,(magma?.54:.29)+age*.23+(i%3)*.075,z+Math.sin(a)*radial);
      flame.rotation.set(0,i*Math.PI*.37,Math.cos(a)*(.18+age*.32));
      flame.scale.set((magma?.38:.28)+strike*.20,(magma?.54:.66)+strike*.35,1);
     }
    });
   }
   if(magma) for(let i=0;i<6;i++) {
    const ember=ball(`magma-cooling-fragment-${i}`,.07,material(i%2?color:'#3b1714',.9));
    animations.push(({p})=>{const t=ramp(p,.62,.84),a=i*2.399;ember.visible=p>=.62;ember.position.set(Math.cos(a)*t*.6,.18+t*.8-t*t*.9,Math.sin(a)*t*.6);ember.rotation.set(t*5,i,t*3);});
   }
   break;
  }
  case 'projectile': {
   const bullet = ball('projectile-shot', variant === 'slingshot' ? .09 : .045, material(accent, 1, true));
   const trail = mesh('projectile-tracer', cylinder, material(color, .8));
   const sight = ring('projectile-target-reticle', .20, .007, material(color, .4)); sight.position.y = .52;
   animations.push(({p}) => {
    const flight = ramp(p, .55, .62), z = THREE.MathUtils.lerp(localAttacker.z, 0, flight);
    bullet.position.set(0, .51, z); stretch(trail, 0, .51, z - .24, 0, .51, z, .017);
    bullet.visible = trail.visible = p >= .55 && p < .64;
    sight.scale.setScalar(1.3 - ramp(p, .32, .60) * .5);
   });
   if (variant === 'slingshot') {
    const fork = line('slingshot-elastic-fork', [[-.18, .68, 0], [0, .44, -.1], [.18, .68, 0]], .018, material(accent, .8, true));
    animations.push(({p}) => { fork.position.z = localAttacker.z; fork.scale.z = 1 + envelope(p, .32, .52, .59) * 4; });
   } else {
    const muzzle = mesh('rifle-muzzle-star', new THREE.OctahedronGeometry(.12), material(accent));
    animations.push(({p}) => { muzzle.position.set(0, .51, localAttacker.z + .22); muzzle.visible = p >= .55 && p < .59; muzzle.scale.set(1, 1, 1.8); });
   }
   break;
  }
  case 'beast': {
   for (let i = 0; i < 4; i++) {
    const claw = line(`beast-claw-${i}`, [[-.38 + i * .18, .95, -.18], [-.22 + i * .18, .53, .02], [.03 + i * .18, .20, .09]], .022);
    animations.push(({strike}) => { claw.scale.y = .3 + strike * .8; claw.position.y = (1 - strike) * .4; });
   }
   if (variant === 'mammoth' || variant === 'horn') {
    for (const sign of [-1, 1]) {
     const tusk = line(`beast-${variant}-tusk-${sign}`, [[sign * .15, .36, -.25], [sign * .25, .28, .02], [sign * .29, .62, .28]], .045, material(accent, .8, true));
     animations.push(({strike}) => { tusk.scale.setScalar(.4 + strike); });
    }
   } else {
    const jaw = mesh(`beast-${variant}-fang`, new THREE.ConeGeometry(.14, .48, 5), material(accent)); jaw.rotation.z = Math.PI; jaw.position.set(0, .7, .1);
   }
   break;
  }
  case 'blunt': {
   const weapon = variant === 'staff' || variant === 'club' || variant === 'whip';
   const fist = mesh(weapon ? `blunt-${variant}` : 'blunt-giant-fist', weapon ? new THREE.CylinderGeometry(.035, variant === 'club' ? .12 : .035, .8, 10) : new THREE.IcosahedronGeometry(.23, 1), material(color, .85, true));
   const knuckles = mesh('blunt-knuckle-ridge', new THREE.BoxGeometry(.36, .13, .16), material(accent, .85, true)); knuckles.visible = !weapon;
   animations.push(({p, strike}) => {
    fist.position.set(0, .52, localAttacker.z + ramp(p, .55, .62) * -localAttacker.z);
    fist.scale.setScalar(.4 + strike * (variant === 'buddha' ? 1.7 : 1.1)); if (weapon) fist.rotation.x = ramp(p, .55, .66) * Math.PI;
    knuckles.position.copy(fist.position); knuckles.position.z += .13; knuckles.scale.copy(fist.scale);
   });
   for (let i = 0; i < 3; i++) { const wave = ring(`blunt-pressure-ring-${i}`, .27, .013); animations.push(({strike}) => { wave.position.set(0, .52, .10 + i * .14); wave.scale.setScalar(.5 + strike * (1 + i * .25)); }); }
   break;
  }
  case 'candy': {
   for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3, spike = mesh(`candy-prison-spike-${i}`, new THREE.ConeGeometry(.10, .85, 8), material(i % 2 ? accent : color, .8, true));
    animations.push(({strike}) => { spike.position.set(Math.cos(angle) * .37, .42 * strike, Math.sin(angle) * .37); spike.scale.y = Math.max(.001, strike); spike.rotation.z = -Math.cos(angle) * .35; spike.rotation.x = Math.sin(angle) * .35; });
   }
   const spiral = line('candy-binding-spiral', Array.from({length: 40}, (_, i) => [Math.cos(i * .5) * .34, i * .018, Math.sin(i * .5) * .34]), .035, material(accent, .8, true));
   animations.push(({p}) => { spiral.rotation.y = p * 5; });
   break;
  }
  case 'dragon': {
   const coils = line('dragon-serpentine-aura', Array.from({length: 45}, (_, i) => { const t = i / 44; return [Math.sin(t * Math.PI * 4) * .43, .25 + t * 1.3, -.65 + t * .9]; }), .065);
   const head = mesh('dragon-aura-head', new THREE.ConeGeometry(.19, .38, 6), material(accent)); head.rotation.x = Math.PI / 2; head.position.set(0, 1.55, .44);
   animations.push(({p, strike}) => { coils.rotation.y = p * 4; coils.scale.setScalar(.55 + strike * .55); head.position.y = .7 + strike * .85; });
   const breath = mesh('dragon-breath-cone', new THREE.ConeGeometry(.30, .85, 12), material(accent, .52));
   animations.push(({strike}) => { breath.rotation.x = -Math.PI / 2; breath.position.set(0, .60, -.35); breath.scale.set(strike, .2 + strike, strike); });
   break;
  }
  case 'string': {
   const sticky = variant === 'sticky';
   for (let i = 0; i < (sticky ? 6 : 11); i++) {
    const angle = i * Math.PI * 2 / 11;
    const wire = line(`${sticky ? 'slime-tether' : 'string-birdcage'}-${i}`, sticky ? [[Math.cos(angle) * .56, .01, Math.sin(angle) * .56], [Math.cos(angle) * .25, .34, Math.sin(angle) * .25], [0, .58, 0]] : [[Math.cos(angle) * .56, .01, Math.sin(angle) * .56], [Math.cos(angle) * .39, .8, Math.sin(angle) * .39], [0, 1.3, 0]], sticky ? .055 : .008, material(i % 3 ? color : accent, .8, sticky));
    animations.push(({strike}) => { wire.scale.set(1 - strike * .43, 1, 1 - strike * .43); });
   }
   break;
  }
  case 'stone': {
   for (let i = 0; i < 7; i++) {
    const rock = mesh(`${variant === 'diamond' ? 'diamond-crystal' : 'stone-eruption'}-${i}`, variant === 'diamond' ? new THREE.OctahedronGeometry(.18 + i % 3 * .04) : new THREE.DodecahedronGeometry(.18 + i % 3 * .04, 0), material(i % 2 ? color : accent, .9, true));
    animations.push(({p, strike}) => { const a = i * 2.399; rock.position.set(Math.cos(a) * .45, .10 + strike * (.2 + i % 3 * .15), Math.sin(a) * .45); rock.rotation.set(p * i, i, p * 3); rock.scale.set(1, .6 + strike, 1); });
   }
   break;
  }
  case 'room': {
   const dome = mesh('room-surgical-dome', new THREE.SphereGeometry(.95, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), material(color, .10));
   const rim = ring('room-boundary', .95, .014, material(accent, .65)); rim.rotation.x = Math.PI / 2; rim.position.y = .01;
   for (let i = 0; i < 3; i++) {
    const slice = mesh(`room-surgical-plane-${i}`, new THREE.PlaneGeometry(1.45, .025), material(accent, .8)); slice.position.y = .25 + i * .22; slice.rotation.y = i * .7;
    animations.push(({p, strike}) => { slice.scale.x = .1 + strike; slice.rotation.z = Math.sin(p * 8 + i) * .1; });
   }
   animations.push(({charge}) => { dome.scale.setScalar(.1 + charge * .95); rim.scale.copy(dome.scale); });
   break;
  }
  case 'metal': {
   if (variant === 'laser') {
    const beam = mesh('cyborg-laser-beam', cylinder, material(accent, .88));
    const core = mesh('cyborg-laser-core', cylinder, material('#ffffff', .85));
    const aperture = ring('cyborg-laser-aperture', .14, .025, material(color));
    animations.push(({p, strike}) => {
     stretch(beam, 0, .58, localAttacker.z, 0, .58, .12, .035 + strike * .025);
     stretch(core, 0, .58, localAttacker.z, 0, .58, .12, .012);
     beam.visible = core.visible = p >= .55 && p < .68; aperture.position.set(0, .58, localAttacker.z + .10); aperture.scale.setScalar(.3 + strike);
    });
    break;
   }
   for (let i = 0; i < 10; i++) {
    const shard = mesh(`metal-magnetic-scrap-${i}`, new THREE.BoxGeometry(.11 + i % 3 * .035, .08, .22), material(i % 2 ? color : accent, .85, true));
    animations.push(({p, strike}) => { const a = i * 2.399 + p * 10, r = .68 * (1 - strike * .7); shard.position.set(Math.cos(a) * r, .25 + i % 4 * .15, Math.sin(a) * r); shard.rotation.set(a, a * .6, p * 7); });
   }
   const field = ring('metal-magnetic-field', .65, .009, material(accent, .4)); field.rotation.x = Math.PI / 2; field.position.y = .08;
   break;
  }
  case 'darkness': {
   const core = mesh('darkness-black-hole', new THREE.SphereGeometry(.25, 20, 12), material('#050209', .95, true)); core.position.y = .48;
   for (let i = 0; i < 5; i++) {
    const tendril = line(`darkness-spiral-tendril-${i}`, Array.from({length: 22}, (_, n) => { const t = n / 21, a = i * Math.PI * 2 / 5 + t * 3; return [Math.cos(a) * (.1 + t * .65), .48 + Math.sin(t * Math.PI) * .2, Math.sin(a) * (.1 + t * .65)]; }), .025, material(i % 2 ? accent : color, .65));
    animations.push(({p, strike}) => { tendril.rotation.y = -p * 8; tendril.scale.setScalar(1 - strike * .4); core.scale.setScalar(.6 + strike * 1.1); });
   }
   break;
  }
  case 'quake': {
   for (let i = 0; i < 7; i++) {
    const a = i * Math.PI * 2 / 7, c = Math.cos(a), s = Math.sin(a);
    const crack = line(`quake-air-fracture-${i}`, [[0, .56, 0], [c * .2, .56 + s * .25, 0], [c * .35 - s * .08, .56 + s * .42 + c * .1, .01], [c * .75, .56 + s * .67, 0]], .014, material(accent));
    animations.push(({strike}) => { crack.scale.setScalar(.2 + strike); });
   }
   const bubble = mesh('quake-pressure-sphere', new THREE.SphereGeometry(.41, 20, 12), material(color, .10)); bubble.position.y = .56;
   break;
  }
  case 'smoke': {
   for(let i=0;i<14;i++) {
    const puff=plume(`smoke-coil-${i}`,i%3?color:accent,.34,true,i*3.71);
    animations.push(({p,strike})=>{
     const phase=(i/14+ramp(p,.32,.86)*.9)%1, spiral=i*2.399+p*5;
     const flight=ramp(p,.45,.62),radial=.10+phase*.30;
     puff.position.set(Math.cos(spiral)*radial,.14+phase*.92,THREE.MathUtils.lerp(localAttacker.z,0,flight)+Math.sin(spiral)*radial);
     puff.rotation.set(0,i*.73,Math.sin(spiral)*.35);puff.scale.set(.34+phase*.48,.48+strike*.35,1);
    });
   }
   break;
  }
 }
 // The common unit cylinder is allocated eagerly but still has one owner.
 geometries.add(cylinder); geometries.add(plumeGeometry);
 scene?.add(group);
 let disposed = false;
 const api = {
  count: group.children.length,
  update(p) {
   if (disposed) return;
   localAttacker.copy(attacker.position).sub(origin).applyQuaternion(rotation);
   const body=attacker.userData.combatBody||attacker.children[0]||attacker;
   body.getWorldPosition(localBody).sub(origin).applyQuaternion(rotation);
   const charge = ramp(p, .30, .55), strike = envelope(p, .55, .62, .79), fade = 1 - ramp(p, .73, .86);
   group.visible = p >= .30 && p < .86;
   const intensity = (.18 * charge + .82 * strike) * fade;
   for (const mat of materials) {
    mat.opacity = mat.userData.strength * intensity;
    if(mat.uniforms){mat.uniforms.opacity.value=mat.opacity;mat.uniforms.time.value=p*3.48;}
   }
   for (const update of animations) update({p, charge, strike});
  },
  dispose() {
   if (disposed) return;
   disposed = true; group.removeFromParent();
   for (const geometry of geometries) geometry.dispose();
   for (const mat of materials) mat.dispose();
   group.clear();
  },
 };
 api.update(0);
 return api;
}
