"""Validate V1 policy/cultivation fixtures against the local pilot GeoJSON."""
from __future__ import annotations
import hashlib, json, math, re, subprocess, tempfile
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
POLICY=ROOT/'web/src/data/policy-v1.json'; CULT=ROOT/'web/src/data/cultivation-v1.json'; PARCEL=ROOT/'web/public/data/parcels/330604102014.geojson'; CONFIRM=ROOT/'web/src/data/parcel-confirmation-v1.json'

def check(ok: bool, message: str):
 print(('✅' if ok else '❌'),message)
 if not ok: raise AssertionError(message)

def valid_identity(value: str) -> bool:
 if not re.fullmatch(r'\d{17}[\dX]',value): return False
 try: date.fromisoformat(f'{value[6:10]}-{value[10:12]}-{value[12:14]}')
 except ValueError: return False
 weights=(7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2); codes='10X98765432'
 return value[-1]==codes[sum(int(d)*w for d,w in zip(value[:17],weights))%11]

def age_on(value: str, business: date) -> int:
 born=date.fromisoformat(f'{value[6:10]}-{value[10:12]}-{value[12:14]}')
 return business.year-born.year-((business.month,business.day)<(born.month,born.day))

def valid_luhn(value: str) -> bool:
 if not re.fullmatch(r'\d+',value): return False
 total=0
 for index,digit in enumerate(reversed(value)):
  number=int(digit)
  if index%2==1:
   number*=2
   if number>9: number-=9
  total+=number
 return total%10==0

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
 current_policies=[policy for policy in p['policies'] if policy['status']!='已到期']
 single_current=[policy for policy in current_policies if policy['insuredMode']=='single_insured']
 roster_current=[policy for policy in current_policies if policy['insuredMode']=='insured_roster']
 check(len(current_policies)==5 and len(single_current)==4 and len(roster_current)==1,'2025 当前保单严格为 4 张单一型 + 1 张清单型')
 roster_policy_id=roster_current[0]['id']
 roster_coverages=[coverage for coverage in current if coverage['policyId']==roster_policy_id]
 roster_item_ids={item['id'] for item in items.values() if item['enrollmentListId']==roster_current[0]['enrollmentListId']}
 check(len(roster_coverages)==len(roster_item_ids) and all(len(items[item_id]['parcelCoverageIds'])==1 for item_id in roster_item_ids),'分户清单严格一块一户')
 multi_parcel_parties=[party for party,covs in by_party.items() if len(covs)>1]
 check(len(multi_parcel_parties)==4 and all(any(policy['insuredPartyId']==party for policy in single_current) for party in multi_parcel_parties),'仅四个红区为一户多块单一型保单')
 check(q.get('assignmentModel')=='four-approximate-regions-plus-one-parcel-roster','确认清单使用四区加一块一户模型')
 check(all(Decimal(x['insuredAreaMu'])>0 and Decimal(x['insuredAreaMu'])<=areas[x['parcelId']] for x in p['parcelCoverages']),'承保面积均大于 0 且不超过几何面积')
 check(all(re.fullmatch(r'\d{22}',x['policyNo']) for x in p['policies']),'保单号均为项目唯一 22 位数字')
 check(len({x['policyNo'] for x in p['policies']})==len(p['policies']),'保单号项目内唯一')
 check(all(x['insuredPartyId'] in parties for x in p['parcelCoverages']),'主体引用完整')
 current_records={x['parcelId'] for x in c['records'] if x['year']==2025 and x['crop']=='水稻'}
 check(set(current_ids)<=current_records,'全部当前参保基础地块具备 2025 水稻初始档案')
 check(bool(current_records-set(current_ids)),'部分当前未参保地块具备初始档案')
 roster_parties = [party for party in p['parties'] if party['id'].startswith('party-') and party['id'] not in {'party-roster'}]
 current_party_names = [party['name'] for party in roster_parties if party['id'] != 'party-0300']
 check(all(re.fullmatch(r'[\u4e00-\u9fff]{2,3}', name) for name in current_party_names),'清单主体姓名仅含 2 至 3 个汉字')
 check(len(current_party_names)==len(set(current_party_names)),'清单主体姓名不重复')
 check(any(len(name)==2 for name in current_party_names) and any(len(name)==3 for name in current_party_names),'清单主体姓名包含两字名和三字名')
 current_parties = [party for party in roster_parties if party['id'] != 'party-0300']
 identities = [party.get('identityOrOrgCode','') for party in current_parties]
 check(all(valid_identity(value) for value in identities),'清单主体身份证日期和校验码正确')
 check(all(35<=age_on(value,date.fromisoformat(p['businessDate']))<=60 for value in identities),'清单主体年龄均为 35 至 60 岁')
 check(len(identities)==len(set(identities)),'清单主体身份证号唯一')
 check(all(re.fullmatch(r'1\d{10}', party.get('contactPhone', '')) for party in current_parties),'清单主体联系方式格式正确')
 accounts = [party.get('bankAccount','') for party in current_parties]
 check(all(value.startswith('621799') and len(value)==19 and valid_luhn(value) for value in accounts),'清单主体邮储银行卡号格式和 Luhn 校验正确')
 check(len(accounts)==len(set(accounts)),'清单主体银行卡号唯一')
 check(not all(int(accounts[index])-int(accounts[index-1])==1 for index in range(1,len(accounts))),'清单主体银行卡号不使用顺序递增')
 check(all(party.get('bankName')=='中国邮政储蓄银行' for party in current_parties),'清单主体开户行统一为中国邮政储蓄银行')
 print(f"报告: 基础 {len(areas)} 块，当前参保 {len(current_ids)} 块，未参保 {len(areas)-len(current_ids)} 块，当前被保险人 {len(by_party)} 户，当前保单 {len(current_policies)} 张（4 单一型 + 1 清单型），历史保单 {len(p['policies'])-len(current_policies)} 张。")
if __name__=='__main__': main()
