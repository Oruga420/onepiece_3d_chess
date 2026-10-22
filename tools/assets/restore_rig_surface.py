"""Restore an original GLB surface while preserving an already approved skin.

Run with Blender's bundled mathutils (no scene import, exporter, or weight solver):
  blender --background --factory-startup --python-exit-code 1 --python tools/assets/restore_rig_surface.py -- \
    --input accepted.glb --original original.glb --output staged.glb

This supports the project's single-primitive character assets, with any bone
count. Ambiguous coincident weights or incompatible transforms fail closed. Original
positions/normals are transformed to world rest coordinates without welding or
averaging; original UV/index buffers are copied verbatim. Existing rig nodes,
skin hierarchy, textures, and matched weight values stay unchanged. Inverse bind
matrices are recomputed from exact glTF rest nodes in double precision, then
serialized float32. Strict posed-vertex parity guards that numeric correction.
"""
import argparse
import copy
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

TOLERANCE = 1e-5
FORMATS = {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    data = path.read_bytes()
    if data[:4] != b'glTF' or struct.unpack_from('<I', data, 4)[0] != 2:
        raise ValueError('Expected glTF 2 GLB: ' + str(path))
    document = binary = None
    cursor = 12
    while cursor < len(data):
        length, kind = struct.unpack_from('<II', data, cursor)
        chunk = data[cursor + 8:cursor + 8 + length]
        if kind == 0x4e4f534a:
            document = json.loads(chunk)
        elif kind == 0x004e4942:
            binary = chunk
        cursor += 8 + length
    if document is None or binary is None or len(document.get('buffers', [])) != 1:
        raise ValueError('Expected one embedded GLB buffer')
    return document, binary


def accessor(document, binary, index):
    item = document['accessors'][index]
    if item.get('sparse') or item.get('normalized'):
        raise ValueError('Sparse or normalized skin/surface accessor is unsupported')
    view = document['bufferViews'][item['bufferView']]
    code, size = FORMATS[item['componentType']]
    width = WIDTHS[item['type']]
    start = view.get('byteOffset', 0) + item.get('byteOffset', 0)
    stride = view.get('byteStride', width * size)
    return [struct.unpack_from('<' + code * width, binary, start + row * stride)
            for row in range(item['count'])]


def matrix(values):
    return [[values[c * 4 + r] for c in range(4)] for r in range(4)]


def multiply(a, b):
    return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def inverse_matrix(value):
    rows = [list(row) + [1.0 if r == c else 0.0 for c in range(4)] for r, row in enumerate(value)]
    for column in range(4):
        pivot = max(range(column, 4), key=lambda row: abs(rows[row][column]))
        rows[column], rows[pivot] = rows[pivot], rows[column]
        divisor = rows[column][column]
        if abs(divisor) < 1e-15:
            raise ValueError('Singular rest joint transform')
        rows[column] = [number / divisor for number in rows[column]]
        for row in range(4):
            if row == column:
                continue
            factor = rows[row][column]
            rows[row] = [a - factor*b for a, b in zip(rows[row], rows[column])]
    return [row[4:] for row in rows]


def compose(node, rotation_delta=None):
    # Match Three.Matrix4.compose using Python doubles. mathutils matrices and
    # quaternion conversions are float32 and cannot diagnose a 1e-5 boundary.
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    if rotation_delta:
        a, b, c, d = rotation_delta
        x, y, z, w = (x*d+w*a+y*c-z*b, y*d+w*b+z*a-x*c,
                       z*d+w*c+x*b-y*a, w*d-x*a-y*b-z*c)
    sx, sy, sz = node.get('scale', [1, 1, 1])
    tx, ty, tz = node.get('translation', [0, 0, 0])
    return [[(1-2*(y*y+z*z))*sx, 2*(x*y-w*z)*sy, 2*(x*z+w*y)*sz, tx],
            [2*(x*y+w*z)*sx, (1-2*(x*x+z*z))*sy, 2*(y*z-w*x)*sz, ty],
            [2*(x*z-w*y)*sx, 2*(y*z+w*x)*sy, (1-2*(x*x+y*y))*sz, tz], [0, 0, 0, 1]]


def node_worlds(document, probe=0):
    nodes = document['nodes']
    parents = {child: i for i, node in enumerate(nodes) for child in node.get('children', [])}
    worlds = {}

    def world(index):
        if index not in worlds:
            node = nodes[index]
            if 'matrix' in node:
                local = matrix(node['matrix'])
            else:
                delta = None
                if probe and 'mesh' not in node:
                    angle = math.sin(index + probe) * .55 * probe
                    sine = math.sin(angle / 2) / math.sqrt(1.13)
                    delta = (sine, .3*sine, .2*sine, math.cos(angle / 2))
                local = compose(node, delta)
            worlds[index] = multiply(world(parents[index]), local) if index in parents else local
        return worlds[index]

    return [world(i) for i in range(len(nodes))]


def require_identity(value, description):
    error = max(abs(value[r][c] - (1 if r == c else 0)) for r in range(4) for c in range(4))
    if error > TOLERANCE:
        raise ValueError(f'{description} is not identity; lossless surface copy is unsafe ({error})')


def weighted_matrix(transforms, joints, weights):
    return [[sum(transforms[joint][r][c] * weight for joint, weight in zip(joints, weights))
             for c in range(4)] for r in range(4)]


def transformed_point(transform, point):
    vector = (*point, 1)
    divisor = sum(transform[3][c] * vector[c] for c in range(4))
    return [sum(transform[r][c] * vector[c] for c in range(4)) / divisor for r in range(3)]


def transformed_normal(transform, normal):
    a, b, c = transform[0][:3]
    d, e, f = transform[1][:3]
    g, h, i = transform[2][:3]
    cofactors = ((e*i-f*h, f*g-d*i, d*h-e*g), (c*h-b*i, a*i-c*g, b*g-a*h),
                 (b*f-c*e, c*d-a*f, a*e-b*d))
    determinant = a*cofactors[0][0] + b*cofactors[0][1] + c*cofactors[0][2]
    if determinant <= 0:
        raise ValueError('Degenerate or mirrored skin normal transform')
    result = [sum(row[k]*normal[k] for k in range(3)) for row in cofactors]
    length = math.sqrt(sum(value*value for value in result))
    return [value/length for value in result]


def skinned_normal(transform, normal):
    # Three r160 skinnormal_vertex uses skinMatrix directly, not inverse-transpose.
    result = [sum(transform[r][c]*normal[c] for c in range(3)) for r in range(3)]
    length = math.sqrt(sum(value*value for value in result))
    return [value/length for value in result]


def image_hashes(document, binary):
    result = []
    for image in document.get('images', []):
        if 'bufferView' not in image:
            raise ValueError('External image cannot be proven byte-identical')
        view = document['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        result.append(hashlib.sha256(binary[start:start + view['byteLength']]).hexdigest())
    return result


def single_mesh(document):
    nodes = [(i, n) for i, n in enumerate(document['nodes']) if 'mesh' in n]
    if len(nodes) != 1:
        raise ValueError('This repair requires exactly one mesh node')
    index, node = nodes[0]
    primitives = document['meshes'][node['mesh']]['primitives']
    if len(primitives) != 1 or primitives[0].get('mode', 4) != 4:
        raise ValueError('This repair requires exactly one triangle primitive')
    return index, node, primitives[0]


def restore(input_path, original_path, output_path):
    if output_path.resolve() in {input_path.resolve(), original_path.resolve()}:
        raise ValueError('Output must not overwrite an input')
    accepted, accepted_binary = read_glb(input_path)
    original, original_binary = read_glb(original_path)
    mesh_index, mesh_node, approved_primitive = single_mesh(accepted)
    source_index, source_node, source_primitive = single_mesh(original)
    if 'skin' not in mesh_node or 'skin' in source_node:
        raise ValueError('Expected an approved skinned mesh and an unskinned original')
    approved_worlds, source_worlds = node_worlds(accepted), node_worlds(original)
    require_identity(approved_worlds[mesh_index], 'Approved mesh world transform')
    source_transform = Matrix(source_worlds[source_index])
    if source_transform.determinant() <= 0:
        raise ValueError('Mirrored original surface needs explicit winding handling')
    skin = accepted['skins'][mesh_node['skin']]
    inverses = accessor(accepted, accepted_binary, skin['inverseBindMatrices'])
    previous_inverse_matrices = [matrix(inverse) for inverse in inverses]
    previous_rest_transforms = [multiply(approved_worlds[joint], inverse) for joint, inverse in zip(skin['joints'], previous_inverse_matrices)]
    maximum_bind_residual = max(abs(transform[r][c] - (1 if r == c else 0))
                               for transform in previous_rest_transforms for r in range(4) for c in range(4))
    corrected_inverses = []
    for joint in skin['joints']:
        inverse = inverse_matrix(approved_worlds[joint])
        corrected_inverses.append(struct.unpack('<16f', struct.pack('<16f', *(inverse[r][c] for c in range(4) for r in range(4)))))
    inverse_matrices = [matrix(inverse) for inverse in corrected_inverses]
    rest_transforms = [multiply(approved_worlds[joint], inverse) for joint, inverse in zip(skin['joints'], inverse_matrices)]
    corrected_bind_residual = max(abs(transform[r][c] - (1 if r == c else 0))
                                 for transform in rest_transforms for r in range(4) for c in range(4))
    textures = image_hashes(accepted, accepted_binary)
    if textures != image_hashes(original, original_binary):
        raise ValueError('Approved and original embedded texture bytes differ')
    if approved_primitive.get('material') != source_primitive.get('material'):
        raise ValueError('Material slot mismatch')
    for required in ['POSITION', 'NORMAL', 'TEXCOORD_0']:
        if required not in source_primitive['attributes']:
            raise ValueError('Original surface is missing ' + required)
    positions = accessor(accepted, accepted_binary, approved_primitive['attributes']['POSITION'])
    source_positions = [tuple(source_transform @ Vector(position)) for position in
                        accessor(original, original_binary, source_primitive['attributes']['POSITION'])]
    joints = accessor(accepted, accepted_binary, approved_primitive['attributes']['JOINTS_0'])
    weights = accessor(accepted, accepted_binary, approved_primitive['attributes']['WEIGHTS_0'])
    approved_count = accepted['accessors'][approved_primitive['indices']]['count']
    source_count = original['accessors'][source_primitive['indices']]['count']
    if approved_count != source_count:
        raise ValueError('Triangle topology counts differ; repair would alter approved geometry')
    tree = KDTree(len(positions))
    for i, position in enumerate(positions):
        tree.insert(Vector(position), i)
    tree.balance()

    def field(index):
        result = {}
        for joint, weight in zip(joints[index], weights[index]):
            if weight:
                result[joint] = result.get(joint, 0) + weight
        return result

    mapped, maximum_distance = [], 0
    for position in source_positions:
        point = Vector(position)
        _, index, distance = tree.find(point)
        if distance >= TOLERANCE:
            raise ValueError(f'No identical approved rest vertex within tolerance: {distance}')
        reference = field(index)
        # Coincident UV/normal splits must agree on their skin. Otherwise a
        # position-only transfer could silently choose a different deformation.
        for _, alternative, separation in tree.find_range(point, min(TOLERANCE, distance + 1e-7)):
            other = field(alternative)
            if max((abs(reference.get(k, 0) - other.get(k, 0)) for k in reference.keys() | other.keys()), default=0) > 1e-7:
                raise ValueError('Ambiguous coincident approved vertex weights')
        mapped.append(index)
        maximum_distance = max(maximum_distance, distance)

    output = copy.deepcopy(accepted)
    binary = bytearray(accepted_binary)
    imported_views, imported_accessors = {}, {}

    def append_view(data, template=None):
        binary.extend(b'\0' * (-len(binary) % 4))
        view = copy.deepcopy(template or {})
        view.update(buffer=0, byteOffset=len(binary), byteLength=len(data))
        binary.extend(data)
        output['bufferViews'].append(view)
        return len(output['bufferViews']) - 1

    def import_accessor(index):
        if index in imported_accessors:
            return imported_accessors[index]
        item = copy.deepcopy(original['accessors'][index])
        if item.get('sparse'):
            raise ValueError('Sparse original surface is unsupported')
        view_index = item['bufferView']
        if view_index not in imported_views:
            view = original['bufferViews'][view_index]
            start = view.get('byteOffset', 0)
            imported_views[view_index] = append_view(original_binary[start:start + view['byteLength']], view)
        item['bufferView'] = imported_views[view_index]
        output['accessors'].append(item)
        imported_accessors[index] = len(output['accessors']) - 1
        return imported_accessors[index]

    def transformed_accessor(index, values):
        item = copy.deepcopy(original['accessors'][index])
        if item['componentType'] != 5126:
            raise ValueError('Transformed surface must use float32 attributes')
        data = b''.join(struct.pack('<' + 'f' * len(value), *value) for value in values)
        item.update(bufferView=append_view(data, {'target': 34962}), byteOffset=0)
        if 'min' in item:
            item['min'] = [min(value[i] for value in values) for i in range(len(values[0]))]
        if 'max' in item:
            item['max'] = [max(value[i] for value in values) for i in range(len(values[0]))]
        output['accessors'].append(item)
        return len(output['accessors']) - 1

    inverse_accessor = output['accessors'][skin['inverseBindMatrices']]
    inverse_bytes = b''.join(struct.pack('<16f', *inverse) for inverse in corrected_inverses)
    inverse_accessor.update(bufferView=append_view(inverse_bytes), byteOffset=0)

    primitive = copy.deepcopy(source_primitive)
    primitive['indices'] = import_accessor(source_primitive['indices'])
    primitive['attributes'] = {name: import_accessor(index) for name, index in source_primitive['attributes'].items()}
    primitive['attributes']['POSITION'] = transformed_accessor(source_primitive['attributes']['POSITION'], source_positions)
    normal_transform = source_transform.to_3x3().inverted().transposed()
    normals = [tuple((normal_transform @ Vector(normal)).normalized()) for normal in
               accessor(original, original_binary, source_primitive['attributes']['NORMAL'])]
    maximum_surface_position = maximum_surface_normal = maximum_shader_normal = 0
    for position, normal, index in zip(source_positions, normals, mapped):
        transform = weighted_matrix(rest_transforms, joints[index], weights[index])
        actual_position, actual_normal = transformed_point(transform, position), transformed_normal(transform, normal)
        shader_normal = skinned_normal(transform, normal)
        maximum_surface_position = max(maximum_surface_position, *(abs(a-b) for a, b in zip(position, actual_position)))
        maximum_surface_normal = max(maximum_surface_normal, *(abs(a-b) for a, b in zip(normal, actual_normal)))
        maximum_shader_normal = max(maximum_shader_normal, *(abs(a-b) for a, b in zip(normal, shader_normal)))
    if max(maximum_surface_position, maximum_surface_normal, maximum_shader_normal) > TOLERANCE:
        raise ValueError(f'Actual world surface exceeds tolerance: position={maximum_surface_position}, normal={maximum_surface_normal}, shaderNormal={maximum_shader_normal}')
    parity = []
    for probe in range(4):
        worlds = node_worlds(accepted, probe)
        transforms = [multiply(worlds[joint], inverse) for joint, inverse in zip(skin['joints'], inverse_matrices)]
        previous_transforms = [multiply(worlds[joint], inverse) for joint, inverse in zip(skin['joints'], previous_inverse_matrices)]
        maximum = 0
        for position, index in zip(source_positions, mapped):
            transform = weighted_matrix(transforms, joints[index], weights[index])
            previous = weighted_matrix(previous_transforms, joints[index], weights[index])
            before, after = transformed_point(previous, positions[index]), transformed_point(transform, position)
            distance = math.dist(before, after)
            # Check both normalized homogeneous coordinates (surface validator)
            # and Three's direct weighted vertex sum (actual skinning shader).
            maximum = max(maximum, distance, distance*sum(weights[index]))
        if maximum > TOLERANCE:
            raise ValueError(f'Deformed position parity exceeds tolerance in pose {probe}: {maximum}')
        parity.append({'probe': probe, 'maximumDeformedPositionDelta': maximum})
    primitive['attributes']['NORMAL'] = transformed_accessor(source_primitive['attributes']['NORMAL'], normals)
    if 'TANGENT' in source_primitive['attributes']:
        tangents = [tuple((source_transform.to_3x3() @ Vector(tangent[:3])).normalized()) + (tangent[3],)
                    for tangent in accessor(original, original_binary, source_primitive['attributes']['TANGENT'])]
        primitive['attributes']['TANGENT'] = transformed_accessor(source_primitive['attributes']['TANGENT'], tangents)
    for name, values in [('JOINTS_0', joints), ('WEIGHTS_0', weights)]:
        item = copy.deepcopy(accepted['accessors'][approved_primitive['attributes'][name]])
        code, _ = FORMATS[item['componentType']]
        data = b''.join(struct.pack('<' + code * 4, *values[index]) for index in mapped)
        item.update(bufferView=append_view(data, {'target': 34962}), byteOffset=0, count=len(mapped))
        item.pop('min', None)
        item.pop('max', None)
        output['accessors'].append(item)
        primitive['attributes'][name] = len(output['accessors']) - 1
    output['meshes'][mesh_node['mesh']]['primitives'] = [primitive]
    output['buffers'][0]['byteLength'] = len(binary)
    encoded = json.dumps(output, separators=(',', ':'), ensure_ascii=True).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    payload = (struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(encoded) + 8 + len(binary))
               + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
               + struct.pack('<II', len(binary), 0x004e4942) + binary)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(payload)
    verified, verified_binary = read_glb(output_path)
    assert verified['nodes'] == accepted['nodes'] and verified['skins'] == accepted['skins']
    assert image_hashes(verified, verified_binary) == textures
    report = {'input': str(input_path), 'original': str(original_path), 'output': str(output_path),
              'inputSha256': hashlib.sha256(input_path.read_bytes()).hexdigest(),
              'outputSha256': hashlib.sha256(payload).hexdigest(), 'sourceVertices': len(mapped),
              'triangles': source_count // 3, 'maximumRestMappingDistance': maximum_distance,
              'textureSha256': textures, 'nodesAndSkinsUnchanged': True,
              'doublePrecisionBindResidual': maximum_bind_residual,
              'correctedFloat32BindResidual': corrected_bind_residual,
              'inverseBindMatricesRecomputed': True,
              'maximumWorldSurfacePositionDelta': maximum_surface_position,
              'maximumWorldSurfaceNormalDelta': maximum_surface_normal,
              'maximumDirectSkinShaderNormalDelta': maximum_shader_normal,
              'deformedPositionParity': parity,
              'originalUvAndIndicesCopiedVerbatim': True, 'worldSurfacePreservedWithoutWelding': True,
              'weightsCopiedWithoutSolvingOrNormalization': True}
    output_path.with_suffix('.restore.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--original', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args(args)
    restore(options.input, options.original, options.output)
