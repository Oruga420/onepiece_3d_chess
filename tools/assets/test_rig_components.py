"""Blender regression probes for fail-closed painted prop selections."""
import sys
from pathlib import Path
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rig_components import rigid_bindings

mesh = bpy.data.meshes.new('selection-regression')
mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0),(2,2,2)], [(0,1),(1,2)], [])
source = [tuple(vertex.co) for vertex in mesh.vertices]
recipe = {'bone':'hand.L', 'points':[[0,0,0],[1,0,0]], 'expectedVertices':2}
assert rigid_bindings(mesh, [], [recipe]) == {0:'hand.L',1:'hand.L'}
for bad in [dict(recipe, expectedVertices=3), dict(recipe, points=[[0,0,0],[9,9,9]])]:
    try:
        rigid_bindings(mesh, [], [bad])
    except ValueError:
        pass
    else:
        raise AssertionError('An invalid selection was silently accepted')
try:
    rigid_bindings(mesh, [], [recipe,dict(recipe,bone='hand.R')])
except ValueError:
    pass
else:
    raise AssertionError('Conflicting hand ownership was silently accepted')
assert [tuple(vertex.co) for vertex in mesh.vertices] == source
print('RIG_COMPONENT_SELECTION_TESTS_PASS valid/missing/count/conflict/geometry')
