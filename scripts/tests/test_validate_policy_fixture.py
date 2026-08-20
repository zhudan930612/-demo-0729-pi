# -*- coding: utf-8 -*-
"""validate-policy-fixture.py 参数化单测：龙江村/12 村统一 strict 校验、成片指标与报告字段检查、路径发现。"""

import importlib.util
import json
import random
import shutil
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))


def load_module(name: str, script: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PC = load_module("pc", "prepare-policy-confirmation.py")
GF = load_module("gf", "generate-policy-fixture.py")
VF = load_module("vf", "validate-policy-fixture.py")


def make_parcel_source(count: int = 600, seed: int = 42, spacing: float = 0.001) -> Path:
    """混合布局：80% 地块在 0.001 网格密集成片簇（内部连通），20% 远处孤立（互不相邻）。"""
    tmp = Path(tempfile.mkdtemp())
    random.seed(seed)
    feats = []
    cluster = int(count * 0.8)
    cols = 30
    for i in range(1, count + 1):
        area_mu = round(random.uniform(0.5, 6.0), 2)
        if i <= cluster:
            row = (i - 1) // cols
            col = (i - 1) % cols
            lon = 120.86 + col * spacing
            lat = 29.76 + row * spacing
        else:
            lon = 121.20 + (i - cluster) * 0.01
            lat = 29.90 + (i - cluster) * 0.01
        feats.append({
            "type": "Feature",
            "properties": {"id": i, "area_m2": round(area_mu * 666.67, 2), "area_mu": area_mu,
                           "label_lng": lon, "label_lat": lat},
            "geometry": {"type": "Polygon", "coordinates": [[[lon, lat], [lon + 0.0005, lat],
                                                             [lon + 0.0005, lat + 0.0005], [lon, lat + 0.0005], [lon, lat]]]},
        })
    src = tmp / "parcels.geojson"
    src.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    return src


def build_fixture(code: str = "330604102018", count: int = 600):
    """在临时目录完整跑确认 + fixture + 复制 parcels 到校验期望路径，返回 (tmp, code)。"""
    src = make_parcel_source(count)
    tmp = src.parent
    parcel_dest = tmp / "web/public/data/parcels" / f"{code}.geojson"
    parcel_dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, parcel_dest)

    pc_orig = (PC.source_path, PC.output_path, PC.regions_config_path)
    PC.source_path = lambda c: parcel_dest
    conf_name = "parcel-confirmation-v1.json" if code == "330604102014" else f"parcel-confirmation-{code}.json"
    conf = tmp / "web/src/data" / conf_name
    conf.parent.mkdir(parents=True, exist_ok=True)
    PC.output_path = lambda c: conf
    if code == "330604102014":
        # 标注区域模式：写入覆盖簇区域的多边形配置（一部分参保地块进大户、区域外进团单）
        cfg = tmp / "regions.json"
        cfg.write_text(json.dumps({
            "villageCode": code,
            "assignmentModel": "user-annotated-regions-v1",
            "regions": [{"party": "party-0001",
                         "polygon": [[120.85, 29.75], [120.90, 29.75], [120.90, 29.80], [120.85, 29.80]]}],
        }, ensure_ascii=False), encoding="utf-8")
        PC.regions_config_path = lambda c: cfg
    elif code == "330604102015":
        # 大钱村区域模式：两个 bbox 矩形（无归并），覆盖簇区域 → 两个大户、区域外团单
        cfg = tmp / "regions.json"
        cfg.write_text(json.dumps({
            "villageCode": code,
            "assignmentModel": "user-annotated-regions-v1",
            "mergeMeters": 0.0,
            "regions": [
                {"party": "party-0001",
                 "polygon": [[120.85, 29.75], [120.885, 29.75], [120.885, 29.80], [120.85, 29.80]]},
                {"party": "party-0002",
                 "polygon": [[120.885, 29.75], [120.92, 29.75], [120.92, 29.80], [120.885, 29.80]]},
            ],
        }, ensure_ascii=False), encoding="utf-8")
        PC.regions_config_path = lambda c: cfg
    elif code == "330604102016":
        # 清潭村区域模式：regions 为空 = 无大户区域，全部参保地块一块一户进团单
        cfg = tmp / "regions.json"
        cfg.write_text(json.dumps({
            "villageCode": code,
            "assignmentModel": "user-annotated-regions-v1",
            "mergeMeters": 0.0,
            "regions": [],
        }, ensure_ascii=False), encoding="utf-8")
        PC.regions_config_path = lambda c: cfg
    elif code == "330604102017":
        # 新魏家庄村区域模式：单个 bbox 矩形（无归并）
        cfg = tmp / "regions.json"
        cfg.write_text(json.dumps({
            "villageCode": code,
            "assignmentModel": "user-annotated-regions-v1",
            "mergeMeters": 0.0,
            "regions": [{"party": "party-0001",
                         "polygon": [[120.85, 29.75], [120.90, 29.75], [120.90, 29.80], [120.85, 29.80]]}],
        }, ensure_ascii=False), encoding="utf-8")
        PC.regions_config_path = lambda c: cfg
    else:
        PC.regions_config_path = lambda c: tmp / "unused-regions.json"  # 聚类村不读取
    try:
        PC.generate(code)
    finally:
        PC.source_path, PC.output_path, PC.regions_config_path = pc_orig

    gf_orig = (GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT)
    GF.find_village = lambda c: {"properties": {"code": c, "name": "清潭村"}}
    GF.parcel_path = lambda c: parcel_dest
    GF.confirmation_path = lambda c: conf
    GF.ROOT = tmp
    try:
        GF.generate(code)
    finally:
        GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT = gf_orig
    return tmp, code


def policy_file(tmp: Path, code: str) -> Path:
    if code == "330604102014":
        return tmp / "web/src/data/policy-v1.json"
    return tmp / "web/src/data" / f"policy-{code}.json"


class ValidatePolicyFixtureTest(unittest.TestCase):
    def test_fixture_paths_longjiang_legacy_names(self):
        policy, cult, parcel, confirm = VF.fixture_paths("330604102014")
        self.assertEqual(policy.name, "policy-v1.json")
        self.assertEqual(cult.name, "cultivation-v1.json")
        self.assertEqual(confirm.name, "parcel-confirmation-v1.json")

    def test_fixture_paths_new_village(self):
        policy, cult, parcel, confirm = VF.fixture_paths("330604102016")
        self.assertEqual(policy.name, "policy-330604102016.json")
        self.assertEqual(confirm.name, "parcel-confirmation-330604102016.json")

    def test_valid_identity_and_luhn(self):
        self.assertTrue(VF.valid_identity("330604197601221121"))
        self.assertTrue(VF.valid_luhn("6217993323793116731"))
        self.assertFalse(VF.valid_identity("33060419760122112X"))
        self.assertFalse(VF.valid_luhn("6217993323793116730"))

    def test_validation_passes_for_new_village(self):
        tmp, code = build_fixture()
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            VF.validate_village(code)
        finally:
            VF.DATA, VF.ROOT = vf_orig

    def test_longjiang_validation_passes_after_regeneration(self):
        # 龙江村授权重生成后按统一 strict 语义校验（legacy 文件名映射）
        tmp, _ = build_fixture("330604102014")
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            VF.validate_village("330604102014")
        finally:
            VF.DATA, VF.ROOT = vf_orig

    def test_validation_fails_on_isolated_parcel_in_report(self):
        # 验收 1.1：报告孤岛列表非空 → 判定失败
        tmp, code = build_fixture()
        fx = json.loads(policy_file(tmp, code).read_text(encoding="utf-8"))
        metrics = fx["report"]["spatialReview"]["insuredPartyMetrics"]
        big = next(m for m in metrics if m["insuredPartyId"].startswith("party-"))
        big["isolatedParcelIds"] = ["1"]
        policy_file(tmp, code).write_text(json.dumps(fx, ensure_ascii=False), encoding="utf-8")
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            with self.assertRaises(AssertionError):
                VF.validate_village(code)
        finally:
            VF.DATA, VF.ROOT = vf_orig

    def test_validation_fails_when_report_missing_share(self):
        # 验收 3.4：报告缺少大户覆盖占比 → 判定失败
        tmp, code = build_fixture()
        fx = json.loads(policy_file(tmp, code).read_text(encoding="utf-8"))
        del fx["report"]["bigFarmCoverageShareOfInsuredArea"]
        policy_file(tmp, code).write_text(json.dumps(fx, ensure_ascii=False), encoding="utf-8")
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            with self.assertRaises(AssertionError):
                VF.validate_village(code)
        finally:
            VF.DATA, VF.ROOT = vf_orig

    def test_validation_fails_on_duplicate_party_id(self):
        # 审查 S5：parties 内重复 id（如历史 party 与确认 party 撞车）必须判定失败
        tmp, code = build_fixture()
        fx = json.loads(policy_file(tmp, code).read_text(encoding="utf-8"))
        fx["parties"][1]["id"] = fx["parties"][0]["id"]
        policy_file(tmp, code).write_text(json.dumps(fx, ensure_ascii=False), encoding="utf-8")
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            with self.assertRaises(AssertionError):
                VF.validate_village(code)
        finally:
            VF.DATA, VF.ROOT = vf_orig

    def test_longjiang_region_mode_uninsured_zero_and_outside_pool_roster(self):
        # 区域模式（plan-merge100）：未参保全部转参保（83→0）；区域外团单池全部一块一户进团单（忽略 50 亩规则）
        tmp = Path(tempfile.mkdtemp())
        src = tmp / "parcels.geojson"
        features = []
        for i in range(1, 21):  # 区域内 20 块 × 3 亩 = 60 亩（原 id 17 未参保已转参保，仍属区域内）
            row = (i - 1) // 5
            col = (i - 1) % 5
            features.append({"type": "Feature", "properties": {"id": i, "area_m2": 2000, "area_mu": 3.0,
                                                                 "label_lng": 120.000 + col * 0.001,
                                                                 "label_lat": 30.000 + row * 0.001},
                             "geometry": {"type": "Polygon", "coordinates": []}})
        features.append({"type": "Feature", "properties": {"id": 21, "area_m2": 34267, "area_mu": 51.4,
                                                               "label_lng": 120.100, "label_lat": 30.100},
                         "geometry": {"type": "Polygon", "coordinates": []}})
        for i in range(22, 31):  # 区域外小地块（1 亩）
            features.append({"type": "Feature", "properties": {"id": i, "area_m2": 667, "area_mu": 1.0,
                                                                 "label_lng": 120.110 + (i - 22) * 0.01,
                                                                 "label_lat": 30.110 + (i - 22) * 0.01},
                             "geometry": {"type": "Polygon", "coordinates": []}})
        src.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        parcel_dest = tmp / "web/public/data/parcels" / "330604102014.geojson"
        parcel_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, parcel_dest)
        pc_orig = (PC.source_path, PC.output_path, PC.regions_config_path)
        PC.source_path = lambda c: parcel_dest
        conf = tmp / "web/src/data/parcel-confirmation-v1.json"
        conf.parent.mkdir(parents=True, exist_ok=True)
        PC.output_path = lambda c: conf
        cfg = tmp / "regions.json"
        cfg.write_text(json.dumps({"villageCode": "330604102014", "assignmentModel": "user-annotated-regions-v1",
                                   "mergeMeters": 100.0,
                                   "regions": [{"party": "party-0001",
                                                 "polygon": [[120.000, 30.000], [120.010, 30.000],
                                                              [120.010, 30.010], [120.000, 30.010]]}]},
                                  ensure_ascii=False), encoding="utf-8")
        PC.regions_config_path = lambda c: cfg
        try:
            PC.generate("330604102014")
        finally:
            PC.source_path, PC.output_path, PC.regions_config_path = pc_orig
        # 确认产物：未参保 0；区域外团单池（含 >50 亩单块）不出单一型指标
        q = json.loads(conf.read_text(encoding="utf-8"))
        self.assertTrue(all(r["insured"] for r in q["records"]), "区域模式未参保应全部转参保")
        single_metrics = {m["insuredPartyId"]: m for m in q["spatialReview"]
                          if m["insuredPartyId"].startswith("party-")}
        self.assertEqual(list(single_metrics), ["party-0001"])
        roster = [m for m in q["spatialReview"] if m["insuredPartyId"] == "roster-one-parcel-per-party"][0]
        self.assertEqual(roster["parcelCount"], 10)  # 21-30
        gf_orig = (GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT)
        GF.find_village = lambda c: {"properties": {"code": c, "name": "龙江村"}}
        GF.parcel_path = lambda c: parcel_dest
        GF.confirmation_path = lambda c: conf
        GF.ROOT = tmp
        try:
            GF.generate("330604102014")
        finally:
            GF.find_village, GF.parcel_path, GF.confirmation_path, GF.ROOT = gf_orig
        fx = json.loads((tmp / "web/src/data/policy-v1.json").read_text(encoding="utf-8"))
        single = [p for p in fx["policies"] if p["status"] != "已到期" and p["insuredMode"] == "single_insured"]
        self.assertEqual([p["insuredPartyId"] for p in single], ["party-0001"])
        items = fx["enrollmentItems"]
        self.assertEqual(len(items), 10)
        self.assertTrue(all(len(i["parcelCoverageIds"]) == 1 for i in items), "团单必须一块一户")
        parcel21_cov = [c for c in fx["parcelCoverages"] if c["parcelId"] == "21" and c["policyId"] != "policy-2024-history"]
        self.assertEqual(len(parcel21_cov), 1)
        self.assertEqual(parcel21_cov[0]["policyId"], "policy-2025-roster")
        self.assertIsNotNone(parcel21_cov[0]["enrollmentItemId"], "区域外 >50 亩单块按区域划分仍进团单")
        # 全链路校验通过（含未参保 0 与区域模式检查）
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            VF.validate_village("330604102014")
        finally:
            VF.DATA, VF.ROOT = vf_orig

    def test_daqian_region_mode_validation_passes(self):
        # 大钱村区域模式 e2e：两 bbox 矩形（无归并），区域内含未参保转参保、区域外未参保保留；全链路校验通过
        tmp, _ = build_fixture("330604102015")
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            VF.validate_village("330604102015")
        finally:
            VF.DATA, VF.ROOT = vf_orig
        # 确认产物：区域模式、区域内大户、区域外保留未参保
        q = json.loads((tmp / "web/src/data/parcel-confirmation-330604102015.json").read_text(encoding="utf-8"))
        self.assertEqual(q["assignmentModel"], "user-annotated-regions-v1")
        un = {r["parcelId"] for r in q["records"] if not r["insured"]}
        self.assertGreater(len(un), 0, "区域外未参保应保留")
        big = [m for m in q["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        self.assertEqual(len(big), 2)
        self.assertTrue(all(m["isolatedParcelIds"] == [] for m in big))
        fx = json.loads((tmp / "web/src/data/policy-330604102015.json").read_text(encoding="utf-8"))
        single = [p for p in fx["policies"] if p["status"] != "已到期" and p["insuredMode"] == "single_insured"]
        self.assertEqual(len(single), 2)
        self.assertTrue(all(len(i["parcelCoverageIds"]) == 1 for i in fx["enrollmentItems"]))

    def test_xinweijiazhuang_region_mode_validation_passes(self):
        # 新魏家庄村区域模式 e2e：单 bbox 红框（无归并），区域内未参保转参保、区域外未参保保留；全链路校验通过
        tmp, _ = build_fixture("330604102017")
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            VF.validate_village("330604102017")
        finally:
            VF.DATA, VF.ROOT = vf_orig
        q = json.loads((tmp / "web/src/data/parcel-confirmation-330604102017.json").read_text(encoding="utf-8"))
        self.assertEqual(q["assignmentModel"], "user-annotated-regions-v1")
        un = {r["parcelId"] for r in q["records"] if not r["insured"]}
        self.assertGreater(len(un), 0, "区域外未参保应保留")
        big = [m for m in q["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        self.assertEqual(len(big), 1)
        self.assertTrue(all(m["isolatedParcelIds"] == [] for m in big))
        fx = json.loads((tmp / "web/src/data/policy-330604102017.json").read_text(encoding="utf-8"))
        single = [p for p in fx["policies"] if p["status"] != "已到期" and p["insuredMode"] == "single_insured"]
        self.assertEqual(len(single), 1)
        self.assertTrue(all(len(i["parcelCoverageIds"]) == 1 for i in fx["enrollmentItems"]))

    def test_qingtan_region_mode_validation_passes(self):
        # 清潭村区域模式 e2e：regions 为空（无大户），全部参保地块一块一户进团单、未参保保留；全链路校验通过
        tmp, _ = build_fixture("330604102016")
        vf_orig = (VF.DATA, VF.ROOT)
        VF.DATA = tmp / "web/src/data"
        VF.ROOT = tmp
        try:
            VF.validate_village("330604102016")
        finally:
            VF.DATA, VF.ROOT = vf_orig
        q = json.loads((tmp / "web/src/data/parcel-confirmation-330604102016.json").read_text(encoding="utf-8"))
        self.assertEqual(q["assignmentModel"], "user-annotated-regions-v1")
        big = [m for m in q["spatialReview"] if m["insuredPartyId"].startswith("party-")]
        self.assertEqual(len(big), 0, "清潭村应无大户区域")
        un = {r["parcelId"] for r in q["records"] if not r["insured"]}
        self.assertGreater(len(un), 0, "未参保应保留")
        summary = [m for m in q["spatialReview"] if m["insuredPartyId"] == "coverage-summary"][0]
        self.assertEqual(summary["bigFarmCount"], 0)
        self.assertEqual(summary["bigFarmCoverageShareOfInsuredArea"], 0)
        fx = json.loads((tmp / "web/src/data/policy-330604102016.json").read_text(encoding="utf-8"))
        single = [p for p in fx["policies"] if p["status"] != "已到期" and p["insuredMode"] == "single_insured"]
        self.assertEqual(len(single), 0)
        roster = [p for p in fx["policies"] if p["status"] != "已到期" and p["insuredMode"] == "insured_roster"]
        self.assertEqual(len(roster), 1)
        self.assertTrue(all(len(i["parcelCoverageIds"]) == 1 for i in fx["enrollmentItems"]))

    def test_discover_village_codes_excludes_v1(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "web/src/data").mkdir(parents=True)
        (tmp / "web/src/data" / "policy-v1.json").write_text("{}", encoding="utf-8")
        (tmp / "web/src/data" / "policy-330604102016.json").write_text("{}", encoding="utf-8")
        (tmp / "web/src/data" / "policy-330683104307.json").write_text("{}", encoding="utf-8")
        (tmp / "web/src/data" / "policy-bad.txt").write_text("{}", encoding="utf-8")
        vf_orig = VF.DATA
        VF.DATA = tmp / "web/src/data"
        try:
            codes = VF.discover_village_codes()
        finally:
            VF.DATA = vf_orig
        self.assertEqual(codes, ["330604102016", "330683104307"])


if __name__ == "__main__":
    unittest.main()
