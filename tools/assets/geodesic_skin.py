"""Opt-in surface-distance skinning for source components with unreliable bone heat.

Seeds stay on the measured anatomical component; weights and source surfaces
are preserved outside the arm-owned islands. Explicit prop bindings run last.
"""
import heapq, math
from mathutils import Vector

def solve(contact,fields):
 mesh,segments,fit=contact.mesh,contact.segments,contact.fit
 names={g.name:g.index for g in mesh.vertex_groups}
 adjacency=[[] for v in mesh.data.vertices]
 for e in mesh.data.edges:
  a,b=e.vertices;d=(mesh.data.vertices[a].co-mesh.data.vertices[b].co).length
  adjacency[a].append((b,d));adjacency[b].append((a,d))
 relevant=set().union(*contact.owners.values())
 for ci in relevant:
  part=contact.components[ci]
  if len(part)<100:continue
  distances={}
  for name,(start,end,_) in segments.items():
   if name.startswith(('upper_arm.','forearm.','hand.')) and name.split('.',1)[1] in fit.get('missingLimbs',[]):continue
   if name in contact.owners and ci not in contact.owners[name]:continue
   if name.startswith(('upper_leg.','lower_leg.','foot.')) or name in ('hips','spine','chest'):
    seed=min(mesh.data.vertices,key=lambda v:(v.co-start.lerp(end,.5)).length_squared)
    if contact.component[seed.index]!=ci:continue
   # Disconnected distal anatomy must not pick up nearby thigh/torso anchors.
   hand_owned=any(ci in owners for bone,owners in contact.owners.items() if bone.startswith('hand.'))
   extent=max(mesh.data.vertices[i].co.z for i in part)-min(mesh.data.vertices[i].co.z for i in part)
   if hand_owned and extent<.25 and not name.startswith(('upper_arm','forearm','hand')):continue
   seeds={}
   queries=[]
   for t in (.15,.35,.55,.75,.9):
    center=start.lerp(end,t);queries.append(center)
    if name in ('hips','spine','chest','neck','head'):
     radius=abs(fit['arms'][0][0][0]-fit['arms'][1][0][0])*.4
     if name in ('neck','head'):radius*=.5
     queries.extend(center+Vector(offset) for offset in [(0,-radius,0),(0,radius,0),(radius,0,0),(-radius,0,0)])
   for p in queries:
    if name in fit.get('componentSeeds',{}):p=Vector(fit['componentSeeds'][name])
    v=min(part,key=lambda i:(mesh.data.vertices[i].co-p).length_squared)
    gap=(mesh.data.vertices[v].co-p).length
    limit=.1 if name.startswith(('upper_arm','forearm','hand')) else .19
    if gap>limit:continue
    seeds[v]=min(seeds.get(v,1e9),.012)
   if not seeds:continue
   dist={i:float('inf') for i in part};queue=[]
   for i,d in seeds.items():dist[i]=d;heapq.heappush(queue,(d,i))
   while queue:
    d,i=heapq.heappop(queue)
    if d!=dist[i]:continue
    for j,edge in adjacency[i]:
     candidate=d+edge
     if candidate<dist[j]:dist[j]=candidate;heapq.heappush(queue,(candidate,j))
   distances[name]=dist
  for i in part:
   ranked=sorted(((d[i],name) for name,d in distances.items()))[:4]
   if not ranked:continue
   values=[1/d**5 for d,n in ranked];den=sum(values)
   fields[i]={names[n]:w/den for (_,n),w in zip(ranked,values)}
 return fields
