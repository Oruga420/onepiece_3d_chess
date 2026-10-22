"""Frozen solver for the five scoped October 2026 repair recipes.

Keeps canonical generation isolated; see README.md for provenance and limits.
"""
import heapq, math
from mathutils import Vector

def solve(contact,fields):
 mesh,segments,fit=contact.mesh,contact.segments,contact.fit
 names={g.name:g.index for g in mesh.vertex_groups}
 power=float(fit.get('geodesicPower',5))
 if not 2<=power<=5:raise ValueError('Unsupported geodesic power')
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
   if name in contact.owners and ci not in contact.owners[name]:continue
   if name.startswith(('upper_leg.','lower_leg.','foot.')) or name in ('hips','spine','chest'):
    seed=min(mesh.data.vertices,key=lambda v:(v.co-start.lerp(end,.5)).length_squared)
    if contact.component[seed.index]!=ci:
     measured=fit.get('geodesicSeeds',{}).get(name,[])
     if not any(contact.component[min(mesh.data.vertices,key=lambda v:(v.co-Vector(point)).length_squared).index]==ci for point in measured):continue
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
   custom_queries=fit.get('geodesicSeeds',{}).get(name)
   if custom_queries:queries=[Vector(point) for point in custom_queries]
   eligible=part
   if not name.startswith(('upper_arm.','forearm.','hand.')):
    def outside_distal(i):
     point=mesh.data.vertices[i].co
     for arm_name,(a,b,_) in segments.items():
      if not arm_name.startswith(('forearm.','hand.')) or not contact.allowed(mesh.data.vertices[i],arm_name):continue
      axis=b-a;t=max(0,min(1,(point-a).dot(axis)/axis.length_squared))
      radius=fit.get('armRadii',{}).get(arm_name,max(.023,min(.065,axis.length*(.5 if arm_name.startswith('hand.') else .23))))
      if (point-a-axis*t).length<radius*1.55:return False
     return True
    eligible=[i for i in part if outside_distal(i)]
    if not eligible:continue
   for p in queries:
    if not custom_queries and name in fit.get('componentSeeds',{}):p=Vector(fit['componentSeeds'][name])
    elif custom_queries or name.startswith(('upper_arm.','forearm.','hand.')):
     surface=min(mesh.data.vertices,key=lambda v:(v.co-p).length_squared)
     if contact.component[surface.index]!=ci:continue
    v=min(eligible,key=lambda i:(mesh.data.vertices[i].co-p).length_squared)
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
   values=[1/d**power for d,n in ranked];den=sum(values)
   fields[i]={names[n]:w/den for (_,n),w in zip(ranked,values)}
 return fields
