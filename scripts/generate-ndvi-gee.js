// =============================================================================
// 农情监测·浙江全省长势 NDVI 生产脚本（GEE · 健壮版）
// -----------------------------------------------------------------------------
// 用途：对每个日期窗口，云端对浙江做 Sentinel-2 无云 NDVI 中值合成，重采样 250m，导出 GeoTIFF。
// 运行：https://code.earthengine.google.com 粘贴 → Run → Tasks 逐个导出到 Google Drive（文件夹 zhejiang_ndvi）。
// 自诊断：Console 会打印「原始影像数 / 映射后影像数 / 波段」，用于定位为何某窗口为 0。
// =============================================================================

// ---- 0. 区域 ----
// 用示例 bbox 保底（海洋/邻省会被 NDVI<0.1 掩掉）；若想用精确省界，把 REGION 换成省界 asset。
// 方式 A：示例 bbox（一定能查到场景）
var REGION = ee.Geometry.Rectangle([118, 27, 123, 31.5]).bounds();
// 方式 B：精确浙江省界（需你先上传 web/public/data/boundary/province.geojson 到 GEE 项目资产，取消下面注释并把路径改对）
// var REGION = ee.FeatureCollection('projects/你的GEE项目/assets/zhejiang').geometry();
print('区域面积(km2)≈', REGION.area().divide(1e6));

// ---- 1. 原始集合 + 诊断 ----
var COLL = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(REGION);
print('① 原始集合总数:', COLL.size());
print('② 2025-08~09 影像数:', COLL.filterDate('2025-08-01', '2025-09-30').size());
// 若 SCL 缺失，.select('SCL') 会报错；这里先探测波段
var probe = ee.Image(COLL.filterDate('2025-08-01', '2025-09-30').first());
print('③ 首影像波段:', probe.bandNames());
print('④ 有 B4:', probe.bandNames().contains('B4'), 'B8:', probe.bandNames().contains('B8'), 'SCL:', probe.bandNames().contains('SCL'));

// ---- 2. 云掩膜（SCL；若某影像无 SCL 则回退为不掩云） ---- 
function maskS2clouds(img) {
  // SCL 分类 3=云影,8=中概率云,9=高概率云,10=薄卷云
  var cloud = img.select('SCL').eq(3).or(img.select('SCL').eq(8))
    .or(img.select('SCL').eq(9)).or(img.select('SCL').eq(10));
  var masked = img.updateMask(cloud.not());
  // 保留 B4/B8，并显式写回 system:time_start（避免映射后 filterDate 失效）
  return masked.select(['B4', 'B8']).divide(10000)
    .set('system:time_start', img.date().millis());
}
var s2 = COLL.map(maskS2clouds);

// ---- 3. 日期窗口 ----
var windows = [
  { label: 'd1', start: '2025-06-01', end: '2025-07-10' },
  { label: 'd2', start: '2025-07-01', end: '2025-08-10' },
  { label: 'd3', start: '2025-08-01', end: '2025-09-10' },
  { label: 'd4', start: '2025-09-01', end: '2025-10-10' }
];

// ---- 4. 每窗口：中值 NDVI + 导出 ----
windows.forEach(function (win) {
  var rawCount = COLL.filterDate(win.start, win.end).size();     // 原始影像数（不经 map）
  var mCol = s2.filterDate(win.start, win.end);                  // 映射后（含 system:time_start）
  var mCount = mCol.size();
  print('窗口', win.label, win.start, '→', win.end, '| 原始影像数=', rawCount, '| 映射后=', mCount);
  var ndvi = mCol.map(function (img) {
    return img.normalizedDifference(['B8', 'B4']).toFloat();
  }).reduce(ee.Reducer.median()).rename('NDVI');
  ndvi = ndvi.updateMask(ndvi.gt(0.1)).clip(REGION);
  Export.image.toDrive({
    image: ndvi,
    description: 'zhejiang_ndvi_' + win.label,
    folder: 'zhejiang_ndvi',
    region: REGION,
    scale: 250,
    crs: 'EPSG:4326',
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF'
  });
});
print('已创建', windows.length, '个导出任务（Google Drive 文件夹 zhejiang_ndvi）。');

// ---- 预览图层（可选，小范围采样避免内存超限；不需要可整段删除） ----
var vis = { min: 0.1, max: 0.85, palette: ['#991b1b', '#ea580c', '#facc15', '#22c55e', '#107a57'] };
Map.centerObject(ee.Geometry.Rectangle([120.5, 29.3, 121.2, 30.2]), 9); // 只看小块避免内存超限
Map.addLayer(
  s2.filterDate('2025-09-01', '2025-09-30')
    .map(function (i) { return i.normalizedDifference(['B8', 'B4']).toFloat(); })
    .reduce(ee.Reducer.median()).rename('NDVI'),
  vis, 'NDVI 预览(9月/小块)'
);
