"""Run only in a separate Blender --background process; normalize and render actual GLB."""
import bpy
from mathutils import Vector
import math
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
identifier = sys.argv[sys.argv.index('--') + 1]
source = root / 'tools/assets/raw' / (identifier + '.glb')
destination = root / 'assets/models' / (identifier + '.glb')
output = root / 'tools/assets/reviews' / identifier
destination.parent.mkdir(parents=True, exist_ok=True)
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
if not meshes:
    raise RuntimeError('No mesh')
points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
low = Vector([min(p[i] for p in points) for i in range(3)])
high = Vector([max(p[i] for p in points) for i in range(3)])
height = high.z - low.z
if height <= 0:
    raise RuntimeError('Degenerate asset')
anchor = bpy.data.objects.new('NORMALIZED_CHARACTER', None)
bpy.context.collection.objects.link(anchor)
for obj in list(bpy.context.scene.objects):
    if obj != anchor and obj.parent is None:
        obj.parent = anchor
anchor.scale = (1 / height,) * 3
anchor.location = (-(low.x + high.x) / (2 * height), -(low.y + high.y) / (2 * height), -low.z / height)
triangles = sum(sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in meshes)
if triangles > 15000:
    for obj in meshes:
        modifier = obj.modifiers.new('Game budget', 'DECIMATE')
        modifier.ratio = 14500 / triangles
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
for img in bpy.data.images:
    if img.type == 'IMAGE' and max(img.size) > 512:
        factor = 512 / max(img.size)
        img.scale(max(1, round(img.size[0] * factor)), max(1, round(img.size[1] * factor)))
bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB', export_image_format='JPEG',
    export_jpeg_quality=85, export_cameras=False, export_lights=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = 384
scene.render.resolution_y = 384
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new('Studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.12, .15, .2, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .6
for position, energy, size in [((2,-3,4),220,3),((-3,-1,2),140,2),((1,3,3),180,2)]:
    data = bpy.data.lights.new('Softbox', 'AREA')
    data.energy = energy
    data.shape = 'DISK'
    data.size = size
    light = bpy.data.objects.new('Softbox', data)
    scene.collection.objects.link(light)
    light.location = position
    light.rotation_euler = (Vector((0,0,.5)) - light.location).to_track_quat('-Z', 'Y').to_euler()
data = bpy.data.cameras.new('QA Camera')
camera = bpy.data.objects.new('QA Camera', data)
scene.collection.objects.link(camera)
scene.camera = camera
data.type = 'ORTHO'
data.ortho_scale = 1.55
for label, angle in [('front',0),('side',math.pi/2),('back',math.pi),('board',-math.pi/4)]:
    camera.location = (2.5*math.sin(angle),-2.5*math.cos(angle),1.3 if label=='board' else .75)
    camera.rotation_euler = (Vector((0,0,.5)) - camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = str(output / (label + '.png'))
    bpy.ops.render.render(write_still=True)
(output/'metrics.json').write_text(json.dumps({'source':str(source.relative_to(root)),
    'triangles':sum(sum(len(p.vertices)-2 for p in obj.data.polygons) for obj in meshes),
    'textures':[{'name':img.name,'width':img.size[0],'height':img.size[1]} for img in bpy.data.images if img.type=='IMAGE'],
    'views':['front','side','back','board']}),encoding='utf8')
print('MODEL_PREPARED', identifier, flush=True)
