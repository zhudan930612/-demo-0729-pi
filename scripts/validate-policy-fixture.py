"""Validate V1 policy/cultivation fixtures against the local pilot GeoJSON."""
from __future__ import annotations
import hashlib, json, math, re, subprocess, tempfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
POLICY=ROOT/'web/src/data/policy-v1.json'; CULT=ROOT/'web/src/data/cultivation-v1.json'; PARCEL=ROOT/'web/public/data/parcels/330604102014.geojson'; CONFIRM=ROOT/'web/src/data/parcel-confirmation-v1.json'

def check(ok: bool, message: str):
 print(('✅' if ok else '❌'),message)
 if not ok: raise AssertionError(message)
def main():
 p=json.loads(POLICY.read_text(encoding='utf8')); c=json.loads(CULT.read_text(encoding='utf8')); g=json.loads(PARCEL.read_text(encoding='utf8')); q=json.loads(CONFIRM.read_text(encoding='utf8'))
 areas={str(f['properties']['id']):Decimal(str(f['properties']['area_mu'])) for f in g['features']}; policies={x['id']:x for x in p['policies']}; parties={x['id'] for x in p['parties']}; items={x['id']:x for x in p['enrollmentItems']}
 check(p['schemaVersion']=='policy-v1' and c['schemaVersion']=='cultivation-v1','schema 版本正确')
 check(len(q['records'])==len(areas)==1533 and len({x['parcelId'] for x in q['records']})==len(areas),'确认清单覆盖每个基础地块且唯一')
 current=[x for x in p['parcelCoverages'] if policies[x['policyId']]['status']=='保障中']; current_ids=[x['parcelId'] for x in current]
 check(len(current_ids)==len(set(current_ids)),'当前有效保单无重复承保')
 check(len(current_ids)>=1380 and len(areas)-len(current_ids)<=math.floor(len(areas)*.1),'当前参保覆盖率不低于 90%')
 by_party={}
 for x in current: by_party.setdefault(x['insuredPartyId'],[]).append(x)
 violations=[]
 for party,covs in by_party.items():
  total=sum((Decimal(x['insuredAreaMu']) for x in covs),Decimal(0)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
  roster=any(i['insuredPartyId']==party for i in items.values())
  if (total<=Decimal('50'))!=roster: violations.append((party,str(total)))
 check(not violations,'全部被保险人符合 50.00 亩分类且不拆分')
 check(all(Decimal(x['insuredAreaMu'])>0 and Decimal(x['insuredAreaMu'])<=areas[x['parcelId']] for x in p['parcelCoverages']),'承保面积均大于 0 且不超过几何面积')
 check(all(re.fullmatch(r'\d{22}',x['policyNo']) for x in p['policies']),'保单号均为项目唯一 22 位数字')
 check(len({x['policyNo'] for x in p['policies']})==len(p['policies']),'保单号项目内唯一')
 check(all(x['insuredPartyId'] in parties for x in p['parcelCoverages']),'主体引用完整')
 current_records={x['parcelId'] for x in c['records'] if x['year']==2025 and x['crop']=='水稻'}
 check(set(current_ids)<=current_records,'全部当前参保基础地块具备 2025 水稻初始档案')
 check(bool(current_records-set(current_ids)),'部分当前未参保地块具备初始档案')
 forbidden=re.compile(r'身份证|手机号码|银行卡|银行账号|开户行|手写签名|某保险公司|演示数据|合成数据|虚构示例')
 check(not forbidden.search(POLICY.read_text(encoding='utf8')),'fixture 未出现禁止的敏感字段或弱化标识')
 print(f"报告: 基础 {len(areas)} 块，当前参保 {len(current_ids)} 块，未参保 {len(areas)-len(current_ids)} 块，被保险人 {len(by_party)} 户，保单 {len(p['policies'])} 张。")
if __name__=='__main__': main()
