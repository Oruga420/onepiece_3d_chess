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
 const count = variant.includes('triple') || variant.includes('santoryu') ? 3 : variant.includes('dual') ? 2 : 1;
 switch (attack.family) {
  case 'rubber': {
   const mochi = variant === 'mochi', arms = mochi ? 4 : 2;
   for (let i = 0; i < arms; i++) {
    const arm = mesh(`${mochi ? 'mochi' : 'rubber'}-stretched-arm-${i}`, cylinder, material(mochi ? '#f5e6ce' : '#bd7655', .88, true));
    const fist = mesh(`rubber-haki-fist-${i}`, new THREE.SphereGeometry(.12, 12, 8), material(accent, .94, true));
    const shock = ring(`rubber-fist-pressure-${i}`, .15, .012);
    animations.push(({p, strike}) => {
     const stagger = i * .014, thrust = Math.sin(ramp(p, .552 + stagger, .65 + stagger) * Math.PI);
     const x = (i % 2 ? 1 : -1) * (.15 + Math.floor(i / 2) * .045), y = .48 + i * .045;
     const end = localAttacker.z + .12 + thrust * Math.max(.2, -localAttacker.z + .15);
     stretch(arm, x, y, localAttacker.z, x * .35, y + .035, end, mochi ? .075 : .052);
     fist.position.set(x * .35, y + .035, end); fist.scale.set(1.3, 1, 1.1 + thrust * .5);
     shock.position.copy(fist.position); shock.scale.setScalar(.6 + thrust * 1.4);
     arm.visible = fist.visible = shock.visible = strike > 0 && thrust > .02;
    });
   }
   break;
  }
  case 'sword': {
   const radius = variant === 'daggers' ? .37 : variant === 'longblade' ? .80 : .62;
   for (let i = 0; i < count; i++) {
    const blade = mesh(`sword-cut-${i}`, new THREE.TorusGeometry(radius, .025, 4, 48, Math.PI * 1.35));
    const edge = mesh(`sword-edge-${i}`, new THREE.TorusGeometry(radius, .009, 3, 48, Math.PI * 1.35), material(accent));
    animations.push(({p, strike}) => {
     const swing = ramp(p, .55 + i * .014, .69 + i * .014);
     blade.position.set((i - (count - 1) / 2) * .11, .52, -.03);
     blade.rotation.set(.2 + i * .55, .2 * i, -.9 + swing * 3.8 + i * 1.05);
     blade.scale.setScalar(.45 + strike * .8); edge.position.copy(blade.position); edge.rotation.copy(blade.rotation); edge.scale.copy(blade.scale);
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
   const magma = variant === 'magma', winged = variant === 'phoenix' || variant === 'pteranodon';
   if (winged) for (const sign of [-1, 1]) {
    const wing = line(`fire-${variant}-wing-${sign}`, [[0, .63, -.25], [sign * .32, .88, -.18], [sign * .70, .90, -.06], [sign * .95, .72, .12]], .065, material(accent, .8));
    animations.push(({p, strike}) => { wing.rotation.z = sign * Math.sin(p * 20) * .20; wing.scale.setScalar(.6 + strike * .5); });
   }
   for (let i = 0; i < 9; i++) {
    const flame = mesh(`${magma ? 'magma' : 'fire'}-tongue-${i}`, new THREE.ConeGeometry(.09 + i % 3 * .02, .45, 7), material(i % 2 ? accent : color, .85));
    animations.push(({p, strike}) => {
     const angle = i * 2.399 + p * (magma ? 2 : 9), radius = .16 + strike * .22;
     flame.position.set(Math.cos(angle) * radius, .12 + Math.sin(i + p * 14) * .08 + strike * .18, Math.sin(angle) * radius - .07);
     flame.rotation.z = Math.cos(angle) * -.55; flame.rotation.x = Math.sin(angle) * .55;
     flame.scale.setScalar(.4 + strike * (magma ? 1.4 : 1));
    });
   }
   const wheel = ring(magma ? 'magma-crater-rim' : 'burning-kick-wheel', .43, magma ? .07 : .032, material(accent));
   animations.push(({p, strike}) => { wheel.position.set(0, magma ? .04 : .42, -.12); wheel.rotation.set(magma ? Math.PI / 2 : .2, 0, p * 12); wheel.scale.setScalar(.4 + strike); });
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
   for (let i = 0; i < 12; i++) {
    const puff = mesh(`smoke-coil-${i}`, new THREE.SphereGeometry(.11 + i % 3 * .025, 8, 6), material(i % 2 ? color : accent, .33, true));
    animations.push(({p, strike}) => { const a = i * .8 + p * 8; puff.position.set(Math.cos(a) * .3, .10 + i * .065, Math.sin(a) * .3); puff.scale.setScalar(.5 + strike * 1.7); });
   }
   break;
  }
 }
 // The common unit cylinder is allocated eagerly but still has one owner.
 geometries.add(cylinder);
 scene?.add(group);
 let disposed = false;
 const api = {
  count: group.children.length,
  update(p) {
   if (disposed) return;
   localAttacker.copy(attacker.position).sub(origin).applyQuaternion(rotation);
   const charge = ramp(p, .30, .55), strike = envelope(p, .55, .62, .79), fade = 1 - ramp(p, .73, .86);
   group.visible = p >= .30 && p < .86;
   const intensity = (.18 * charge + .82 * strike) * fade;
   for (const mat of materials) mat.opacity = mat.userData.strength * intensity;
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
