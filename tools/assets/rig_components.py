"""Bounded source-component selection for rigid props on a welded weight proxy."""
from mathutils import Vector
from mathutils.kdtree import KDTree


def connected_components(mesh):
    neighbors = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        neighbors[a].append(b)
        neighbors[b].append(a)
    unseen = set(range(len(mesh.vertices)))
    result = []
    while unseen:
        start = unseen.pop()
        found, stack = {start}, [start]
        while stack:
            for neighbor in neighbors[stack.pop()]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    found.add(neighbor)
                    stack.append(neighbor)
        result.append(sorted(found))
    return result


def select_component(mesh, components, recipe):
    seed = Vector(recipe['seed'])
    distance, index = min((min((mesh.vertices[i].co-seed).length for i in component), index)
                          for index, component in enumerate(components))
    if distance > recipe.get('maxSeedDistance', 1e-5):
        raise ValueError('Prop seed does not touch the expected source component')
    component = components[index]
    if not recipe.get('minVertices', 1) <= len(component) <= recipe['maxVertices']:
        raise ValueError('Prop component count mismatch; refusing a body bind')
    bounds = {label: [operation(mesh.vertices[i].co[axis] for i in component) for axis in range(3)]
              for label, operation in [('min', min), ('max', max)]}
    if max(b-a for a,b in zip(bounds['min'],bounds['max'])) > recipe['maxExtent']:
        raise ValueError('Prop component extent mismatch')
    tolerance = recipe.get('boundsTolerance',1e-5)
    if any(abs(bounds[label][axis]-recipe['expectedBounds'][label][axis]) > tolerance
           for label in ['min','max'] for axis in range(3)):
        raise ValueError('Prop component bounds mismatch')
    return index, component


def rigid_bindings(mesh, recipes, vertex_sets=()):
    if not recipes and not vertex_sets:
        return {}
    components = connected_components(mesh)
    result = {}
    for recipe in recipes:
        _, vertices = select_component(mesh, components, recipe)
        binding = recipe['bone']
        if 'surfaceSeed' in recipe:
            seed = Vector(recipe['surfaceSeed'])
            source = min(mesh.vertices,key=lambda vertex:(vertex.co-seed).length_squared)
            if (source.co-seed).length > recipe.get('maxSurfaceSeedDistance',1e-5):
                raise ValueError('Surface attachment seed does not match source geometry')
            if source.index in vertices:
                raise ValueError('Surface attachment cannot sample its own prop component')
            binding = {'surfaceVertex':source.index}
        for index in vertices:
            if index in result and result[index] != binding:
                raise ValueError('Conflicting rigid-component bone assignments')
            result[index] = binding
    if vertex_sets:
        tree = KDTree(len(mesh.vertices))
        for vertex in mesh.vertices:
            tree.insert(vertex.co, vertex.index)
        tree.balance()
        for recipe in vertex_sets:
            selected = set()
            for point in recipe['points']:
                _, index, separation = tree.find(Vector(point))
                if separation > recipe.get('maxPointDistance', 1e-5):
                    raise ValueError('Painted prop vertex does not match source geometry')
                selected.add(index)
            if len(selected) != recipe['expectedVertices']:
                raise ValueError('Painted prop vertex count mismatch')
            for index in selected:
                if index in result and result[index] != recipe['bone']:
                    raise ValueError('Conflicting painted prop bone assignments')
                result[index] = recipe['bone']
    return result


def apply_bindings(object, bindings):
    # Snapshot surface mixes first so the result does not depend on prop order.
    surface_weights={binding['surfaceVertex']:[(group.group,group.weight) for group in object.data.vertices[binding['surfaceVertex']].groups]
                     for binding in bindings.values() if isinstance(binding,dict)}
    for vertex_index, binding in bindings.items():
        vertex = object.data.vertices[vertex_index]
        for index in [group.group for group in vertex.groups]:
            object.vertex_groups[index].remove([vertex_index])
        if isinstance(binding,str):
            object.vertex_groups[binding].add([vertex_index],1,'REPLACE')
        else:
            weights=surface_weights[binding['surfaceVertex']]
            total=sum(weight for _,weight in weights)
            if total<=0:raise ValueError('Surface attachment seed has no solved weights')
            for group,weight in weights:object.vertex_groups[group].add([vertex_index],weight/total,'REPLACE')
