#!/usr/bin/env bash
# 推理完成后一键处理单村：export 地块 → 参保确认 → 保单造数 → 校验。
# 用法: bash scripts/process-village.sh 330604102015
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
V="$1"
if [ -z "$V" ]; then echo "用法: $0 <村代码>"; exit 2; fi
P="05-遥感数据/parcel-pilot/$V"

GPK=$(ls "$P"/delineated/*.gpkg 2>/dev/null | grep -v '\.simp\.' | head -1 || true)
if [ -z "$GPK" ]; then echo "❌ $V 未找到模型输出 gpkg"; exit 1; fi
echo "════ $V export ════"
python scripts/prepare-parcel-pilot.py export "$GPK" --village "$V"
echo "════ $V 参保确认 ════"
python scripts/prepare-policy-confirmation.py --village "$V"
echo "════ $V 保单造数 ════"
python scripts/generate-policy-fixture.py --village "$V"
echo "════ $V 校验 ════"
python scripts/validate-policy-fixture.py --village "$V" 2>&1 | grep -cE '^✅' | xargs -I{} echo "通过 {} 项"
python scripts/validate-policy-fixture.py --village "$V" 2>&1 | grep -E '^❌' || echo "✅ $V 全部校验通过"
