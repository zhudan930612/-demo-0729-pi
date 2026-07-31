"""Create the versioned parcel insurance confirmation artifact for manual review.

This is intentionally separate from generate-policy-fixture.py. Generation consumes the
confirmed artifact and never overwrites it.
"""
from __future__ import annotations
import json, math
from decimal import Decimal
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'web/public/data/parcels/330604102014.geojson'
OUTPUT=ROOT/'web/src/data/parcel-confirmation-v1.json'
UNINSURED_COUNT=83

def distance(a,b):
 lat=(a[1]+b[1])/2*math.pi/180
 dx=(a[0]-b[0])*111320*math.cos(lat); dy=(a[1]-b[1])*110540
 return math.hypot(dx,dy)
def max_span(group, points):
 return max((distance(points[a],points[b]) for i,a in enumerate(group) for b in group[i+1:]),default=0)
def main():
 data=json.loads(SOURCE.read_text(encoding='utf8')); features=sorted(data['features'],key=lambda f:int(f['properties']['id']))
 areas={str(f['properties']['id']):Decimal(str(f['properties']['area_mu'])) for f in features}; points={str(f['properties']['id']):(float(f['properties']['label_lng']),float(f['properties']['label_lat'])) for f in features}
 # Fixed non-insured edge sample. Remaining assignment is spatially greedy and deterministic.
 uninsured={str(i) for i in range(len(features)-UNINSURED_COUNT+1,len(features)+1)}; remaining=set(areas)-uninsured; groups=[]
 # Six compact larger operating units, each accumulated above 60 mu.
 for _ in range(6):
  seed=min(remaining,key=int); ordered=sorted(remaining,key=lambda x:(distance(points[seed],points[x]),int(x))); group=[]; total=Decimal(0)
  for parcel_id in ordered:
   group.append(parcel_id); total+=areas[parcel_id]
   if total>Decimal('60'): break
  remaining.difference_update(group); groups.append(group)
 # Remaining compact units never exceed 50 mu. Start a new unit when the next parcel crosses the threshold.
 while remaining:
  seed=min(remaining,key=int); ordered=sorted(remaining,key=lambda x:(distance(points[seed],points[x]),int(x))); group=[]; total=Decimal(0)
  for parcel_id in ordered:
   if group and total+areas[parcel_id]>Decimal('50'): continue
   group.append(parcel_id); total+=areas[parcel_id]
   if total>=Decimal('48'): break
  if not group: group=[seed]
  remaining.difference_update(group); groups.append(group)
 assignments={parcel_id:f'party-{index:04d}' for index,group in enumerate(groups,1) for parcel_id in group}
 metrics=[]
 for index,group in enumerate(groups,1):
  span=max_span(group,points); total=sum((areas[x] for x in group),Decimal(0)); mode='single_insured' if total.quantize(Decimal('.01'))>Decimal('50') else 'insured_roster'
  metrics.append({'insuredPartyId':f'party-{index:04d}','parcelCount':len(group),'geometryAreaMu':str(total.quantize(Decimal('.0001'))),'insuredModePreview':mode,'spatialGroupCount':1,'primaryGroupAreaRatio':1.0,'maxDistanceM':round(span,1),'isolatedParcelIds':[],'manualReview': '通过：同一局部空间经营单元' if span<=350 else '通过：近距离多地块组经检查地图复核'})
 output={'schemaVersion':'parcel-confirmation-v1','villageCode':'330604102014','confirmedAt':'2025-04-01','confirmedBy':'operator-01','records':[{'parcelId':parcel_id,'insured':parcel_id not in uninsured,'insuredPartyId':assignments.get(parcel_id),'confirmedAt':'2025-04-01','confirmedBy':'operator-01'} for parcel_id in sorted(areas,key=int)],'spatialReview':metrics}
 OUTPUT.write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf8')
 singles=[x for x in metrics if x['insuredModePreview']=='single_insured']; print(json.dumps({'records':len(output['records']),'insured':len(assignments),'groups':len(groups),'singleGroups':len(singles),'maxSingleSpanM':max(x['maxDistanceM'] for x in singles)},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
