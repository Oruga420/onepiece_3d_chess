"""Offline fitted skeleton pilots. Stage only; never overwrite published assets.
Run: blender --background --factory-startup --python tools/assets/rig_characters.py -- mugiwara/king
"""
import argparse, hashlib, json, math, shutil, sys
from pathlib import Path
import bpy, bmesh
from mathutils import Vector
from mathutils.kdtree import KDTree
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from rig_components import rigid_bindings, apply_bindings
from hand_contact import HandContact
OUT=ROOT/'.local/rigging'
# Coordinates are measured in normalized Blender space: X right, -Y front, Z up.
FITS={
 'mugiwara/king':dict(center=0,hip=.45,waist=.60,chest=.75,neck=.83,head=.89,
  arms=[[(.095,.0,.79),(.14,-.012,.64),(.145,-.032,.51),(.145,-.04,.47)],[(-.095,.0,.79),(-.14,-.012,.64),(-.145,-.032,.51),(-.145,-.04,.47)]],
  legs=[[(.06,0,.45),(.075,.005,.255),(.117,.015,.055),(.12,-.055,.028)],[(-.06,0,.45),(-.075,.005,.255),(-.117,.015,.055),(-.12,-.055,.028)]]),
 'mugiwara/queen':dict(center=.05,hip=.46,waist=.60,chest=.77,neck=.84,head=.90,
  arms=[[(.145,.005,.80),(.18,-.005,.665),(.195,-.015,.515),(.198,-.02,.445)],[(-.045,0,.80),(-.105,-.075,.695),(.005,-.145,.66),(.045,-.16,.65)]],
  legs=[[(.10,.01,.46),(.11,.015,.255),(.15,.01,.06),(.15,-.06,.025)],[(0,.01,.46),(-.005,.015,.255),(-.025,.01,.06),(-.05,-.06,.025)]]),
 'mugiwara/bishop':dict(center=0,hip=.48,waist=.60,chest=.78,neck=.86,head=.92,
  arms=[[(.085,.055,.81),(.14,.08,.68),(.075,.005,.585),(.07,-.005,.56)],[(-.08,.045,.81),(-.115,.06,.66),(-.13,.065,.52),(-.13,.067,.485)]],
  legs=[[(.052,.04,.48),(.075,.035,.27),(.10,.045,.055),(.10,-.045,.022)],[(-.048,.035,.48),(-.05,.03,.27),(-.07,.035,.055),(-.1,-.045,.022)]])}
fit_file=ROOT/'tools/assets/rig_fits.json'
if fit_file.exists():
 for key,value in json.loads(fit_file.read_text()).items():FITS.setdefault(key,value)
prop_file=ROOT/'tools/assets/prop_bindings.json'
PROP_BINDINGS=json.loads(prop_file.read_text()) if prop_file.exists() else {}

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rig(ident,render=True):
 source=ROOT/'assets/models'/(ident+'.glb'); backup=OUT/'originals'/(ident+'.glb')
 backup.parent.mkdir(parents=True,exist_ok=True)
 if backup.exists() and sha(backup)!=sha(source): raise RuntimeError('Source changed since backup '+ident)
 if not backup.exists():shutil.copy2(source,backup)
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(source))
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']; original_meshes={}
 for obj in meshes:
  obj.data.transform(obj.matrix_world);obj.parent=None;obj.matrix_world.identity()
  original_meshes[obj.name]=obj.data.copy()
  # glTF splits UV seam vertices; weld positions while keeping per-corner UVs.
  bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001);bm.to_mesh(obj.data);bm.free();obj.data.update()
 # Retain original loops/material/UV; no remesh/decimation.
 f=dict(FITS[ident]);props=PROP_BINDINGS.get(ident,{})
 if props:
  if props['sourceSha256']!=sha(source):raise RuntimeError('Prop recipe source hash mismatch '+ident)
  f['rigidComponents']=f.get('rigidComponents',[])+props.get('rigidComponents',[])
  f['rigidVertexSets']=f.get('rigidVertexSets',[])+props.get('rigidVertexSets',[])
  f['weaponCapsules']=props.get('weaponCapsules',f.get('weaponCapsules',[]))
 x=f['center'];segments={}
 def seg(name,a,b,parent=None):segments[name]=(Vector(a),Vector(b),parent)
 y=f.get('bodyY',0)
 seg('hips',(x,y,f['hip']),(x,y,f['waist']))
 seg('spine',(x,y,f['waist']),(x,y,f['chest']),'hips')
 seg('chest',(x,y,f['chest']),(x,y,f['neck']),'spine')
 seg('neck',(x,y,f['neck']),(x,y,f['head']),'chest')
 seg('head',(x,y,f['head']),(x,y,f.get('headTail',.99)),'neck')
 for name,ends in f.get('bodyJoints',{}).items():
  segments[name]=(Vector(ends[0]),Vector(ends[1]),segments[name][2])
 for side,arm,leg in zip(['L','R'],f['arms'],f['legs']):
  seg('upper_arm.'+side,arm[0],arm[1],'chest');seg('forearm.'+side,arm[1],arm[2],'upper_arm.'+side);seg('hand.'+side,arm[2],arm[3],'forearm.'+side)
  seg('upper_leg.'+side,leg[0],leg[1],'hips');seg('lower_leg.'+side,leg[1],leg[2],'upper_leg.'+side);seg('foot.'+side,leg[2],leg[3],'lower_leg.'+side)
 for extra in f.get('extraArms',[]):
  side=extra['suffix'];points=extra['points']
  seg('upper_arm.'+side,points[0],points[1],'chest');seg('forearm.'+side,points[1],points[2],'upper_arm.'+side);seg('hand.'+side,points[2],points[3],'forearm.'+side)
 for extra in f.get('extraLegs',[]):
  side=extra['suffix'];points=extra['points']
  seg('upper_leg.'+side,points[0],points[1],'hips');seg('lower_leg.'+side,points[1],points[2],'upper_leg.'+side);seg('foot.'+side,points[2],points[3],'lower_leg.'+side)
 data=bpy.data.armatures.new('FittedHumanoid');arm=bpy.data.objects.new('character-rig',data);bpy.context.collection.objects.link(arm)
 arm['combatRig']={'motionProfile':f.get('motionProfile','humanoid'),'limbLimits':f.get('limbLimits',{'arms':1.,'legs':1.,'shoulders':1.,'elbows':1.}),'missingLimbs':f.get('missingLimbs',[]),'maxJointAngles':f.get('maxJointAngles',{'upper_arm.L':1.35,'upper_arm.R':1.35,'forearm.L':.9,'forearm.R':.9})}
 if f.get('pocketContacts'):
  settings=dict(arm['combatRig']);settings['pocketContacts']=f['pocketContacts'];arm['combatRig']=settings
 bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 for name,(a,b,parent) in segments.items():
  bone=data.edit_bones.new(name);bone.head=a;bone.tail=b;bone.align_roll(Vector((0,-1,0)))
  if parent:bone.parent=data.edit_bones[parent]
 prop_joints=f.get('propJoints',[])
 for prop in prop_joints:
  name,parent=prop['name'],prop['parent']
  if not name.startswith('weapon.') or name in data.edit_bones or parent not in data.edit_bones or not parent.startswith('hand.'):
   raise ValueError('Invalid fitted prop joint')
  bone=data.edit_bones.new(name);bone.head=Vector(prop['head']);bone.tail=Vector(prop['tail'])
  if (bone.tail-bone.head).length<1e-5:raise ValueError('Prop bone needs a distinct handle axis')
  bone.align_roll(Vector((0,-1,0)));bone.parent=data.edit_bones[parent]
  # Exclude the prop from automatic heat solving so nearby legs and garments
  # cannot acquire weapon weights. Only exact curated selectors may bind it.
  bone.use_deform=False
 bpy.ops.object.mode_set(mode='OBJECT')
 if prop_joints:
  settings=dict(arm['combatRig'])
  settings['propGrips']=[{'bone':prop['name'],'parent':prop['parent'],'target':list(data.bones[prop['parent']].matrix_local.inverted() @ Vector(prop['palm']))} for prop in prop_joints]
  arm['combatRig']=settings
 bpy.ops.object.select_all(action='DESELECT')
 for mesh in meshes:mesh.select_set(True)
 arm.select_set(True);bpy.context.view_layer.objects.active=arm
 bpy.ops.object.parent_set(type='ARMATURE_AUTO')
 uncovered=0;component_audits=[]
 for mesh in meshes:
  for prop in prop_joints:mesh.vertex_groups.new(name=prop['name'])
  prop_weights=rigid_bindings(mesh.data,f.get('rigidComponents',[]),f.get('rigidVertexSets',[]))
  contact=HandContact(mesh,segments,f) if f.get('armComponentGating',True) and f.get('motionProfile')!='quadruped' else None
  for v in mesh.data.vertices:
   # Heat diffusion on tiny disconnected accessories can assign remote limbs.
   # Remove only anatomically impossible influence, then renormalize the local skin.
   for index,weight in [(g.group,g.weight) for g in v.groups]:
    name=mesh.vertex_groups[index].name
    if name.startswith(('upper_arm','forearm','hand')):
     length=(segments[name][1]-segments[name][0]).length
     default_radius=max(.023,min(.065,length*(.50 if name.startswith('hand') else .23)))
     radius=f.get('armRadii',{}).get(name,default_radius)
     separation=distance(v.co,*segments[name][:2])
     # Smooth capsule confidence, with no remote sleeve/skirt influence.
     confidence=max(0,min(1,(radius*1.5-separation)/(radius*.65)))
     if contact:confidence*=contact.allowed(v,name)
     if confidence<=0:mesh.vertex_groups[index].remove([v.index])
     else:mesh.vertex_groups[index].add([v.index],weight*confidence,'REPLACE')
   if ident=='mugiwara/king' and ((v.co.z < .445 and v.co.y < -.045 and v.co.x > .09) or (v.co.y>.065 and v.co.z>.58)):
    for index in [g.group for g in v.groups]:mesh.vertex_groups[index].remove([v.index])
    mesh.vertex_groups['hips' if v.co.z<.445 else 'chest'].add([v.index],1,'REPLACE')
   if ident=='mugiwara/queen' and v.co.z<.63 and ((v.co.y<-.08 and v.co.x<.03) or v.co.y>.08):
    for index in [g.group for g in v.groups]:mesh.vertex_groups[index].remove([v.index])
    mesh.vertex_groups['hips'].add([v.index],1,'REPLACE')
   if ident=='mugiwara/bishop' and .45<v.co.z<.62 and abs(v.co.x)<.115 and min(distance(v.co,*segments[n][:2]) for n in ['hand.L','hand.R'])>.045:
    for index in [g.group for g in v.groups]:mesh.vertex_groups[index].remove([v.index])
    blend=max(0,min(1,(v.co.z-.55)/.07))
    mesh.vertex_groups['hips'].add([v.index],1-blend,'REPLACE');mesh.vertex_groups['spine'].add([v.index],blend,'REPLACE')
   # Shoes/sandals are rigid accessories below the ankle. Keep each complete
   # shoe with its foot, including disconnected soles missed by bone heat.
   if v.co.z < min(a[2][2] for a in f['legs'])+.012:
    paws=[name for name in segments if name.startswith('foot.')]+(['hand.L','hand.R'] if f.get('motionProfile')=='quadruped' else [])
    foot=min(paws,key=lambda n:distance(v.co,*segments[n][:2]))
    for index in [g.group for g in v.groups]:mesh.vertex_groups[index].remove([v.index])
    mesh.vertex_groups[foot].add([v.index],1,'REPLACE')
   for region in f.get('rigidRegions',[]):
    if all(region['min'][i]<=v.co[i]<=region['max'][i] for i in range(3)):
     # A costume box may overlap a hand resting on a hip. Preserve the
     # anatomical capsule with a smooth boundary instead of pinning skin to
     # the pelvis and tearing it away when the arm lifts.
     protected=[]
     if not region['bone'].startswith(('upper_arm','forearm','hand')):
      for name in segments:
       if not name.startswith(('upper_arm','forearm','hand')):continue
       length=(segments[name][1]-segments[name][0]).length
       radius=f.get('armRadii',{}).get(name,max(.023,min(.065,length*(.5 if name.startswith('hand') else .23))))
       confidence=max(0,min(1,(radius*1.5-distance(v.co,*segments[name][:2]))/(radius*.65)))
       if contact:confidence*=contact.allowed(v,name)
       if confidence>0:protected.append((name,confidence))
     protection=max((weight for _,weight in protected),default=0)
     old={g.group:g.weight for g in v.groups if g.weight>1e-6}
     if protection and not old:
      # Bone heat can fail on non-manifold generated meshes. Seed actual limb
      # influence here before the costume blend, rather than normalizing a
      # lone pelvis weight back to 100% and losing the protection.
      old={mesh.vertex_groups[name].index:weight/(distance(v.co,*segments[name][:2])+.018)**2 for name,weight in protected}
     total=sum(old.values())
     mixed={index:weight/total*protection for index,weight in old.items()} if total else {}
     target=mesh.vertex_groups[region['bone']].index
     mixed[target]=mixed.get(target,0)+(1-protection)
     for index in [g.group for g in v.groups]:mesh.vertex_groups[index].remove([v.index])
     for index,weight in mixed.items():
      if weight>0:mesh.vertex_groups[index].add([v.index],weight,'REPLACE')
   # The distal capsule is an anatomical anchor, not just a filter on heat
   # weights. Otherwise a fingertip mislabeled as thigh by bone heat retains
   # that label even after its correctly fitted hand envelope is widened.
   hand_names=[name for name in segments if name.startswith('hand.')]
   hand=min(hand_names,key=lambda name:distance(v.co,*segments[name][:2]))
   hand_radius=f.get('armRadii',{}).get(hand,max(.023,min(.065,(segments[hand][1]-segments[hand][0]).length*.5)))
   hand_distance=distance(v.co,*segments[hand][:2])
   hand_strength=max(0,min(1,(hand_radius*1.2-hand_distance)/(hand_radius*.4)))
   if contact:hand_strength=contact.anchor_strength(v,hand)
   if hand_strength>0 and f.get('motionProfile')!='quadruped':
    old={g.group:g.weight for g in v.groups if g.weight>1e-6};total=sum(old.values())
    mixed={index:weight/total*(1-hand_strength) for index,weight in old.items()} if total else {}
    target=mesh.vertex_groups[hand].index;mixed[target]=mixed.get(target,0)+hand_strength
    for index in [g.group for g in v.groups]:mesh.vertex_groups[index].remove([v.index])
    for index,weight in mixed.items():
     if weight>0:mesh.vertex_groups[index].add([v.index],weight,'REPLACE')
   weights=[(g.group,g.weight) for g in v.groups if g.weight>1e-6]
   if not weights:
    uncovered+=1
    arm_names=[n for n in segments if n.startswith(('upper_arm','forearm','hand'))]
    closest_arm=min(arm_names,key=lambda n:distance(v.co,*segments[n][:2]))
    length=(segments[closest_arm][1]-segments[closest_arm][0]).length
    radius=f.get('armRadii',{}).get(closest_arm,max(.023,min(.065,length*(.5 if closest_arm.startswith('hand') else .23))))
    near_arm=distance(v.co,*segments[closest_arm][:2])<radius*1.3 and (not contact or contact.allowed(v,closest_arm))
    if near_arm:
     side=closest_arm.split('.',1)[1];allowed=['upper_arm.'+side,'forearm.'+side,'hand.'+side]
     if v.co.z>f['chest']:allowed+=['chest']
    else:
     allowed=[n for n in segments if not n.startswith(('upper_arm','forearm','hand'))]
    ranked=sorted(allowed,key=lambda name:distance(v.co,*segments[name][:2]))[:4]
    values=[1/(distance(v.co,*segments[n][:2])+.018)**4 for n in ranked];den=sum(values)
    weights=[(mesh.vertex_groups[n].index,w/den) for n,w in zip(ranked,values)]
   weights=sorted(weights,key=lambda item:item[1],reverse=True)[:4];total=sum(w for _,w in weights)
   for index in [g.group for g in v.groups]:mesh.vertex_groups[index].remove([v.index])
   for g,w in weights:mesh.vertex_groups[g].add([v.index],w/total,'REPLACE')
  apply_bindings(mesh,prop_weights)
  # Geodesic relaxation removes hard spatial region boundaries and propagates
  # weights across UV-welded topology, rather than leaving torn adjacent faces.
  adjacency=[[] for _ in mesh.data.vertices]
  for edge in mesh.data.edges:
   a,b=edge.vertices;length=max((mesh.data.vertices[a].co-mesh.data.vertices[b].co).length,.0001)
   adjacency[a].append((b,1/length));adjacency[b].append((a,1/length))
  fields=[{g.group:g.weight for g in v.groups} for v in mesh.data.vertices]
  for _ in range(24):
   relaxed=[]
   for i,neighbors in enumerate(adjacency):
    if not neighbors:relaxed.append(fields[i]);continue
    den=sum(w for _,w in neighbors);weights={g:w*.55 for g,w in fields[i].items()}
    for j,edge_weight in neighbors:
     for g,w in fields[j].items():weights[g]=weights.get(g,0)+.45*edge_weight*w/den
    relaxed.append(weights)
   fields=relaxed
  if contact:
   fields=contact.finish(fields);component_audits.append(contact.audit)
  for v,weights in zip(mesh.data.vertices,fields):
   pairs=sorted(weights.items(),key=lambda item:item[1],reverse=True)[:4];den=sum(w for _,w in pairs)
   for index in [g.group for g in v.groups]:mesh.vertex_groups[index].remove([v.index])
   for index,w in pairs:mesh.vertex_groups[index].add([v.index],w/den,'REPLACE')
  # Only complete, verified source components may be rigidly bound. A spatial
  # capsule can intersect unrelated legs or clothing and create long tears.
  apply_bindings(mesh,prop_weights)
  # Transfer weights back onto the untouched source topology. The welded proxy
  # exists only to solve heat/diffusion; source UV seams, normals and even
  # degenerate source triangles remain byte-for-byte geometrically represented.
  points=KDTree(len(mesh.data.vertices))
  for v in mesh.data.vertices:points.insert(v.co,v.index)
  points.balance();solved=[[(g.group,g.weight) for g in v.groups] for v in mesh.data.vertices]
  group_names=[g.name for g in mesh.vertex_groups]
  mesh.data=original_meshes[mesh.name]
  mesh.vertex_groups.clear()
  for name in group_names:mesh.vertex_groups.new(name=name)
  for v in mesh.data.vertices:
   _,index,dist=points.find(v.co)
   if dist>1e-5:raise RuntimeError('Source topology transfer drift')
   for group,weight in solved[index]:mesh.vertex_groups[group].add([v.index],weight,'REPLACE')
 for prop in prop_joints:
  data.bones[prop['name']].use_deform=True
  segments[prop['name']]=(Vector(prop['head']),Vector(prop['tail']),prop['parent'])
 dest=OUT/'candidates'/(ident+'.glb');dest.parent.mkdir(parents=True,exist_ok=True)
 bpy.ops.export_scene.gltf(filepath=str(dest),export_format='GLB',use_selection=True,export_image_format='AUTO',export_animations=False,export_extras=True,export_skins=True,export_all_influences=False,export_cameras=False,export_lights=False)
 report=OUT/'reviews'/ident;report.mkdir(parents=True,exist_ok=True)
 metadata={'id':ident,'originalSha256':sha(source),'sha256':sha(dest),'bytes':dest.stat().st_size,'unweightedFallbackVertices':uncovered,'componentOwnership':component_audits,'bones':{name:{'head':list(a),'tail':list(b),'parent':parent,'localAxesBlender': [list(row) for row in data.bones[name].matrix_local.to_3x3()]} for name,(a,b,parent) in segments.items()},'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)}
 (report/'metrics.json').write_text(json.dumps(metadata,indent=2))
 if render:render_poses(ident,arm,report)
 print('RIG_STAGED',ident,uncovered,flush=True)
def distance(p,a,b):
 d=b-a;t=max(0,min(1,(p-a).dot(d)/d.length_squared));return (p-a-d*t).length
POSES={
 'rest':{},
 'guard':{'upper_arm.L':(-.55,0,.10),'forearm.L':(-.9,0,0),'upper_arm.R':(-.55,0,-.10),'forearm.R':(-.9,0,0),'lower_leg.L':(.12,0,0),'lower_leg.R':(.12,0,0)},
 'punch':{'chest':(0,.08,-.14),'upper_arm.L':(-1.35,0,.10),'forearm.L':(-.30,0,0),'upper_arm.R':(-.4,0,-.1),'forearm.R':(-1.1,0,0),'upper_leg.L':(-.15,0,0),'lower_leg.L':(.3,0,0)},
 'sword':{'chest':(0,.05,.20),'upper_arm.L':(-1.10,0,.35),'forearm.L':(-.70,0,.10),'upper_arm.R':(-.65,0,-.30),'forearm.R':(-1,0,0)},
 'kick':{'spine':(.12,0,0),'upper_leg.L':(-1.1,0,.08),'lower_leg.L':(.5,0,0),'foot.L':(.1,0,0),'upper_arm.L':(-.5,0,.25),'forearm.L':(-.6,0,0),'upper_arm.R':(-.4,0,-.25),'forearm.R':(-.7,0,0)}}
def render_poses(ident,arm,output):
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=4;scene.render.threads_mode='FIXED';scene.render.threads=4
 scene.render.resolution_x=384;scene.render.resolution_y=384;scene.render.resolution_percentage=100
 scene.world=bpy.data.worlds.new('Studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.15,.2,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
 for pos,energy,size in [((2,-3,4),220,3),((-3,-1,2),140,2),((1,3,3),180,2)]:
  d=bpy.data.lights.new('Softbox','AREA');d.energy=energy;d.size=size;o=bpy.data.objects.new('Softbox',d);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,.5))-o.location).to_track_quat('-Z','Y').to_euler()
 d=bpy.data.cameras.new('QA');cam=bpy.data.objects.new('QA',d);scene.collection.objects.link(cam);scene.camera=cam;d.type='ORTHO';d.ortho_scale=1.4
 for pose,angles in POSES.items():
  for b in arm.pose.bones:b.rotation_mode='XYZ';b.rotation_euler=(0,0,0)
  for name,angle in angles.items():arm.pose.bones[name].rotation_euler=(-angle[0],angle[1],angle[2])
  bpy.context.view_layer.update()
  for view,pos in [('front',(0,-2.5,.7)),('side',(2.5,0,.7))]:
   cam.location=pos;cam.rotation_euler=(Vector((0,0,.5))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(output/(pose+'-'+view+'.png'));bpy.ops.render.render(write_still=True)
 for b in arm.pose.bones:b.rotation_euler=(0,0,0)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('ids',nargs='*',default=list(FITS));parser.add_argument('--no-render',action='store_true');args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 for ident in args.ids:rig(ident,not args.no_render)
