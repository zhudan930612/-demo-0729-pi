#!/usr/bin/env bash
# 一键准备运行数据：从 LFS 源数据生成前端运行数据 + 服务端私有天气数据。
#
# 用法（在仓库根或任意位置，需 Git Bash / bash；Windows 建议在 Git Bash 中执行）：
#   bash scripts/prepare-all.sh              # 完整生成（含影像切片，耗时约 15-40 分钟）
#   bash scripts/prepare-all.sh --skip-tiles # 跳过影像切片（约 6 分钟，影像瓦片用已有产物）
#
# 前置条件：
#   1. git lfs pull 已取得 01-行政区划/、05-遥感数据/ 实体
#   2. Python 依赖：pip install pyshp shapely rasterio pillow numpy
#
# 输出：
#   web/public/data/         前端边界/村界/manifest/rs.json
#   web/public/tiles/        吉林一号 XYZ 影像瓦片（--skip-tiles 时跳过）
#   .dev-runtime/weather-data/  服务端私有天气索引（含 weather/index-v2.json）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_TILES=0
for arg in "$@"; do
  case "$arg" in
    --skip-tiles) SKIP_TILES=1 ;;
    *) echo "未知参数: $arg（支持 --skip-tiles）" >&2; exit 2 ;;
  esac
done

STEP=0
step() { STEP=$((STEP + 1)); echo; echo "===== [$STEP] $* ====="; }

# 0. 源数据存在性检查
step "检查 LFS 源数据"
for p in "01-行政区划/浙江四级边界加村点" "01-行政区划/浙江村界数据/3浙江村界-备注省市县乡" "05-遥感数据"; do
  if [ ! -d "$p" ] && [ ! -f "$p" ]; then
    echo "缺少源数据: $p（请先 git lfs pull）" >&2
    exit 1
  fi
done
echo "源数据齐全（01-行政区划 / 05-遥感数据）"

# 1. 边界 + 村界 + 天气私有索引
step "prepare-boundaries.py（边界/村界/天气索引，约 2-6 分钟）"
python scripts/prepare-boundaries.py

# 2. 天气空间索引校验
step "weather_spatial_index.py --validate-only"
python scripts/weather_spatial_index.py --validate-only

# 3. 脚本单元测试（非敏感 fixture）
step "scripts 单元测试"
python -m unittest discover -s scripts/tests -p "test_*.py"

# 4. 影像切片（可选）
if [ "$SKIP_TILES" = "1" ]; then
  echo "跳过影像切片（--skip-tiles）"
else
  step "prepare-rs-tiles.py（影像切片，约 10-30 分钟）"
  python scripts/prepare-rs-tiles.py
fi

# 5. 数据链路校验
step "validate-data.py（13 项）"
python scripts/validate-data.py

echo
echo "✅ 全部完成。启动：pnpm --dir server start  +  pnpm --dir web dev"
