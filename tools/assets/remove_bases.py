"""Remove reviewed display supports from six optimized GLBs, without cutting feet.

Run with Blender --background --factory-startup --python tools/assets/remove_bases.py.
Writes reversible originals and candidates under .local/base-removal. Pass -- --apply
only after reviewing the generated front/side/back/board comparisons.
"""
import bpy
import bmesh
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.local/base-removal'
IDS = ['marines/rook', 'marines/queen', 'shanks/bishop', 'heart/pawn', 'bigmom/rook', 'bigmom/knight']
LIMITS = {'marines/rook': .037, 'marines/queen': .059, 'shanks/bishop': .038, 'bigmom/rook': .043}
REVIEWED_ORIGINALS = {
    'bigmom/knight': '6b00543ef2de7c86d12415438b1174e4342501218957c906921b5dd64725d35b',
    'bigmom/rook': '6ee8333e8de0ba73eb924f7a948132508a747527e22536efa38c9ba5189b13da',
    'heart/pawn': 'e816790a6ec17ca6711ab08ca53219f01c982e2f313ac9b9abe824adb0d46009',
    'marines/queen': '3b6fb1d8f3f92697b903a1711f8081be9fa59b11acd784b1e4f24d77ac9fcf06',
    'marines/rook': '30ce75c6ce06d3fe5f1bcea7e05fd0c5b147e9e5a17acf9eea4383c8f2616de7',
    'shanks/bishop': 'e38fe292fa3226015f52be154679dcda49eb94809f5bfe5f6503596455343161',
}


def components(bm):
    unseen = set(bm.verts)
    while unseen:
        first = unseen.pop()
        found, stack = {first}, [first]
        while stack:
            vertex = stack.pop()
            for edge in vertex.link_edges:
                other = edge.other_vert(vertex)
                if other in unseen:
                    unseen.remove(other)
                    found.add(other)
                    stack.append(other)
        yield found


def bounds(vertices):
    return ([min(v.co[i] for v in vertices) for i in range(3)],
            [max(v.co[i] for v in vertices) for i in range(3)])


def studio():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.render.resolution_x = scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new('Review studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.12, .15, .20, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .6
    for position, energy, size in [((2,-3,4),220,3),((-3,-1,2),140,2),((1,3,3),180,2)]:
        data = bpy.data.lights.new('Softbox', 'AREA')
        data.energy, data.shape, data.size = energy, 'DISK', size
        light = bpy.data.objects.new('Softbox', data)
        scene.collection.objects.link(light)
        light.location = position
        light.rotation_euler = (Vector((0,0,.5)) - light.location).to_track_quat('-Z','Y').to_euler()
    data = bpy.data.cameras.new('Review camera')
    camera = bpy.data.objects.new('Review camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    data.type, data.ortho_scale = 'ORTHO', 1.35
    return camera


def renders(camera, directory):
    directory.mkdir(parents=True, exist_ok=True)
    for label, angle in [('front',0),('side',math.pi/2),('back',math.pi),('board',-math.pi/4)]:
        camera.location = (2.5*math.sin(angle),-2.5*math.cos(angle),1.3 if label == 'board' else .65)
        camera.rotation_euler = (Vector((0,0,.5)) - camera.location).to_track_quat('-Z','Y').to_euler()
        bpy.context.scene.render.filepath = str(directory / f'{label}.png')
        bpy.ops.render.render(write_still=True)


def process(identifier):
    source = ROOT / 'assets/models' / f'{identifier}.glb'
    original = OUT / 'originals' / f'{identifier}.glb'
    candidate = OUT / 'candidates' / f'{identifier}.glb'
    original.parent.mkdir(parents=True, exist_ok=True)
    candidate.parent.mkdir(parents=True, exist_ok=True)
    if not original.exists():
        shutil.copy2(source, original)
    assert hashlib.sha256(original.read_bytes()).hexdigest() == REVIEWED_ORIGINALS[identifier], f'Unreviewed model geometry: {identifier}'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(original))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        obj.data.transform(world)
    camera = studio()
    before_dir = OUT / 'reviews' / identifier / 'before'
    if not all((before_dir / f'{view}.png').exists() for view in ['front','side','back','board']):
        renders(camera, before_dir)
    removed, cut = [], None
    before_triangles = sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
    for obj in meshes:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        source_normals = bm.loops.layers.float_vector.new('original_corner_normal')
        bm.faces.ensure_lookup_table()
        for polygon in obj.data.polygons:
            for loop, index in zip(bm.faces[polygon.index].loops, polygon.loop_indices):
                loop[source_normals] = obj.data.corner_normals[index].vector
        # UVs live on face loops, so joining coincident position vertices retains UV seams.
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000002)
        parts = list(components(bm))
        for part in parts:
            low, high = bounds(part)
            remove = False
            if identifier in LIMITS:
                remove = high[2] < LIMITS[identifier] and high[0]-low[0] > .4
            elif identifier == 'heart/pawn':
                # Two boots and their two separate soles remain intact. Other low
                # components are the pedestal and scattered pedestal gravel.
                sole = len(part) == 97 and high[2] < .069 and abs((high[0]+low[0])/2) > .13
                remove = high[2] < .09 and not sole
            elif identifier == 'bigmom/knight' and low[2] < .001 and high[2] < .4:
                # Candy support joins the vertical effect, but neither shoe joins it.
                # Bisect only this component, retaining all shoe/leg vertices.
                cut = .045
                faces = {f for v in part for f in v.link_faces}
                edges = {e for v in part for e in v.link_edges}
                result = bmesh.ops.bisect_plane(bm, geom=list(part)+list(edges)+list(faces),
                    dist=.000001, plane_co=(0,0,cut), plane_no=(0,0,1), clear_inner=True)
                boundary = [e for e in result['geom_cut'] if isinstance(e,bmesh.types.BMEdge) and e.is_boundary]
                if boundary:
                    bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
            if remove:
                removed.append({'vertices':len(part), 'low':low, 'high':high})
                bmesh.ops.delete(bm, geom=list(part), context='VERTS')
        bm.normal_update()
        normals = [tuple(loop[source_normals].normalized()) if loop[source_normals].length > .01 else tuple(face.normal)
                   for face in bm.faces for loop in face.loops]
        bm.to_mesh(obj.data)
        obj.data.normals_split_custom_set(normals)
        bm.free()
    assert removed or cut, f'No support removed: {identifier}'
    vertices = [v for obj in meshes for v in obj.data.vertices]
    low, high = bounds(vertices)
    height = high[2]-low[2]
    center = Vector(((low[0]+high[0])/2, (low[1]+high[1])/2, low[2]))
    for obj in meshes:
        for v in obj.data.vertices:
            v.co = (v.co-center)/height
        obj.data.update()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(candidate), export_format='GLB', use_selection=True,
        export_image_format='AUTO', export_cameras=False, export_lights=False)
    renders(camera, OUT / 'reviews' / identifier / 'after')
    metrics = {'identifier':identifier,'method':'component deletion; candy component-only lower bisect' if cut else 'component deletion',
        'cutPlaneOriginalHeightRatio':cut,'removedComponents':removed,'originalFeetMinimumZ':low[2],
        'beforeTriangles':before_triangles,'triangles':sum(sum(len(p.vertices)-2 for p in obj.data.polygons) for obj in meshes),
        'bytes':candidate.stat().st_size,'sha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),
        'originalSha256':hashlib.sha256(original.read_bytes()).hexdigest(),
        'textures':[{'width':img.size[0],'height':img.size[1]} for img in bpy.data.images if img.type=='IMAGE'],
        'normalizedHeight':1.0,'views':['front','side','back','board']}
    (OUT/'reviews'/identifier/'metrics.json').write_text(json.dumps(metrics,indent=2),encoding='utf8')
    print('BASE_REMOVAL_CANDIDATE', identifier, flush=True)
    return metrics


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    selected = [a for a in args if a in IDS] or IDS
    if '--apply' in args:
        for identifier in selected:
            source = OUT/'candidates'/f'{identifier}.glb'
            metrics = json.loads((OUT/'reviews'/identifier/'metrics.json').read_text())
            assert hashlib.sha256(source.read_bytes()).hexdigest() == metrics['sha256']
            destination = ROOT/'assets/models'/f'{identifier}.glb'
            actual_hash = hashlib.sha256(destination.read_bytes()).hexdigest()
            assert actual_hash in {metrics['originalSha256'], metrics['sha256']}, f'Asset changed since review: {identifier}'
            shutil.copy2(source, destination)
        print('APPLIED_REVIEWED_CANDIDATES', selected)
    else:
        results = [process(identifier) for identifier in selected]
        (OUT/'metrics.json').write_text(json.dumps(results,indent=2),encoding='utf8')
