"""Topology-aware distal ownership for touching but separate generated surfaces.

Runs on the welded solve proxy only. No vertices, faces, UVs or textures change.
Weapon components intentionally remain separate; explicit prop anchors run later.
"""
from mathutils import Vector
from rig_components import connected_components, select_component


def segment_distance(point, start, end):
    axis = end - start
    t = (point - start).dot(axis) / axis.length_squared
    nearest = start + axis * max(0.0, min(1.0, t))
    return (point - nearest).length, t


class HandContact:
    def __init__(self, mesh, segments, fit):
        self.mesh, self.segments, self.fit = mesh, segments, fit
        self.components = connected_components(mesh.data)
        self.component = [-1] * len(mesh.data.vertices)
        counts = [len(part) for part in self.components]
        for key, part in enumerate(self.components):
            for index in part: self.component[index] = key
        self.owners, self.radii, self.audit = {}, {}, {}
        side_components = {}
        for name, (a,b,_) in segments.items():
            if not name.startswith(('upper_arm.','forearm.','hand.')):
                continue
            target = Vector(fit.get('componentSeeds',{}).get(name,a.lerp(b,.45)))
            seed = min(mesh.data.vertices, key=lambda v: (v.co-target).length_squared)
            side_components.setdefault(name.split('.',1)[1],set()).add(self.component[seed.index])
        for name in segments:
            if name.startswith(('upper_arm.','forearm.')):
                self.owners[name] = side_components[name.split('.',1)[1]]
        self.audit['armComponentOwnership'] = {side:sorted(parts) for side,parts in side_components.items()}
        for name, (a, b, _) in segments.items():
            if not name.startswith('hand.'):
                continue
            # The interior palm, not the fingertip sphere, identifies the skin
            # island. This avoids accidentally selecting a nearby thigh/bag.
            palm = Vector(fit.get('componentSeeds',{}).get(name,a.lerp(b,.45)))
            seed = min(mesh.data.vertices, key=lambda v: (v.co - palm).length_squared)
            self.owners[name] = {self.component[seed.index]}
            self.radii[name] = fit.get('armRadii', {}).get(name, max(.023, min(.065, (b-a).length*.5)))
            self.audit[name] = {'component': self.component[seed.index], 'seed': list(seed.co), 'componentVertices': counts[self.component[seed.index]]}

    def allowed(self, vertex, name):
        return name not in self.owners or self.component[vertex.index] in self.owners[name]

    def anchor_strength(self, vertex, name):
        if not self.allowed(vertex, name):
            return 0.0
        a, b, _ = self.segments[name]
        separation, t = segment_distance(vertex.co, a, b)
        length = (b-a).length
        # A nearly flat distal cap stops the old radius-sized sphere extending
        # through the fingertip into nearby leg geometry.
        distal = max(0.0, min(1.0, (1.0 + .004/length - t) / (.004/length)))
        proximal = max(0.0, min(1.0, (t+.18)/.38))
        radius = self.radii[name] * (1.10 - .18*max(0.0,min(1.0,t)))
        radial = max(0.0, min(1.0, (radius*1.55-separation)/(radius*.45)))
        return min(distal, proximal, radial)

    def finish(self, fields):
        if self.fit.get('skinMethod') == 'geodesic':
            from geodesic_skin import solve
            return solve(self, fields)
        names = {g.index:g.name for g in self.mesh.vertex_groups}
        indices = {v:k for k,v in names.items()}
        nonarms = [n for n in self.segments if not n.startswith(('upper_arm.', 'forearm.', 'hand.'))]
        pruned = 0
        for vertex, weights in zip(self.mesh.data.vertices, fields):
            for index in list(weights):
                name = names[index]
                if name in self.owners and not self.allowed(vertex, name):
                    del weights[index]
                    pruned += 1
            total = sum(weights.values())
            if total <= 1e-12:
                nearest = min(nonarms, key=lambda n: segment_distance(vertex.co,*self.segments[n][:2])[0])
                weights[indices[nearest]] = 1.0
            else:
                for index in weights: weights[index] /= total
            # Reapply the valid anatomical anchor after diffusion; diffusion
            # is not allowed to reintroduce thigh weights into finger islands.
            choices = [(self.anchor_strength(vertex,n),n) for n in self.radii]
            strength, hand = max(choices, default=(0.0,None))
            if strength > 0:
                for index in weights: weights[index] *= 1-strength
                weights[indices[hand]] = weights.get(indices[hand],0)+strength
        self.audit['prunedCrossComponentInfluences'] = pruned
        return fields

    def bind_components(self, fields, bindings):
        """Bind complete measured prop islands, refusing an unexpected selection."""
        indices = {g.name:g.index for g in self.mesh.vertex_groups}
        for spec in bindings:
            recipe=dict(spec)
            recipe.setdefault('maxExtent',max(b-a for a,b in zip(spec['expectedBounds']['min'],spec['expectedBounds']['max']))+1e-5)
            key, vertices = select_component(self.mesh.data,self.components,recipe)
            for index in vertices:fields[index]={indices[spec['bone']]:1.0}
            self.audit.setdefault('rigidComponents',[]).append({'bone':spec['bone'],'component':key,'vertices':len(vertices)})
        return fields
