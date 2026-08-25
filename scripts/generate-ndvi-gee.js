// =============================================================================
// 农情监测·浙江省长势 NDVI 生产脚本（Google Earth Engine）
// -----------------------------------------------------------------------------
// 用途：对每个日期窗口，在云端对浙江省做 Sentinel-2 无云 NDVI 中值合成，
//       重采样到 250m，导出 GeoTIFF（就是最终的热力图栅格，不落原始瓦片）。
// 运行：打开 https://code.earthengine.google.com ，粘贴本脚本 → Run →
//       逐窗口在右侧 Tasks 点击 Run → Google Drive 导出（文件夹 zhejiang_ndvi）。
// 输出：每窗口一个 zhejiang_ndvi_d*.tif（Float NDVI 场，重采样 250m，浙江境内）。
// =============================================================================

// ---- 0. 区域：浙江省 ----
// 优先用 GAUL 省级边界；找不到浙江时回退到矩形 bbox（海洋/邻省会被 NDVI<0.1 掩掉）。
var gaul = ee.FeatureCollection("FAO/GAUL/2015/level1").filter(
  ee.Filter.or(
    ee.Filter.eq('ADM1_NAME', 'Zhejiang'),
    ee.Filter.eq('ADM1_NAME', 'Zhejiang Sheng'),
    ee.Filter.eq('CLASS_1', 'Zhejiang')
  )
);
var REGION = ee.Geometry(
  ee.Algorithms.If(gaul.size().gt(0), gaul.first().geometry(), ee.Geometry.Rectangle([118, 27, 123, 31.5]))
);
print('区域(浙江省) 面积(km2)≈', REGION.area().divide(1e6));
// 若想用仓库里的省界，请在 GEE Assets 上传 web/public/data/boundary/province.geojson 后改为：
// var REGION = ee.FeatureCollection('projects/你的项目/assets/zhejiang').geometry();

// ---- 1. Sentinel-2 L2A + 云掩膜 ----
// S2 cloud probability 掩云 + SCL 掩云影，再整除 10000 得反射率。
function maskS2clouds(image) {
  var cloudProb = ee.ImageCollection("COPERNICUS/S2_CLOUD_PROBABILITY")
    .filterBounds(image.geometry())
    .filterDate(image.date(), image.date().advance(1, 'day'))
    .median();
  var cloud = cloudProb.select('probability').gt(60);
  var scl = image.select('SCL');
  var cloudMask = cloud.or(
    scl.eq(3).or(scl.eq(8)).or(scl.eq(9)).or(scl.eq(10)).or(scl.eq(11))); // 云影/云
  return image.updateMask(cloudMask.not()).divide(10000);
}

var s2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
  .filterBounds(REGION)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 45))
  .map(maskS2clouds);

// ---- 2. 日期窗口（每 7 天一期；日期可按需改，这里用近期水稻生长季的晴空期） ----
// 说明：需求演示日期为 2026-06/07，但真实数据不要求与日期对应；此处用近期生长季真实晴空期即可。
var windows = [
  { label: 'd1', start: '2025-05-01', end: '2025-05-31' },
  { label: 'd2', start: '2025-06-01', end: '2025-06-30' },
  { label: 'd3', start: '2025-07-01', end: '2025-07-31' },
  { label: 'd4', start: '2025-08-01', end: '2025-09-05' }
];

// ---- 3. 每窗口：无云中值 NDVI 合成 + 非植被掩膜 ----
function ndviComposite(win) {
  var col = s2.filterDate(win.start, win.end).select(['B4', 'B8']);
  var count = col.size();
  var ndviSet = col.map(function (img) {
    // NDVI = (B8 - B4) / (B8 + B4)
    return img.normalizedDifference(['B8', 'B4']).toFloat()
      .set('system:time_start', img.date().millis());
  });
  var ndvi = ndviSet.reduce(ee.Reducer.median()).rename('NDVI');
  // 掩掉非植被（NDVI<0.1 → 透明：海洋、城市、云隙、裸地）、并裁到浙江
  return {
    image: ndvi.updateMask(ndvi.gt(0.1)).clip(REGION).set('window', win.label),
    count: count
  };
}

// ---- 4. 逐窗口：打印场景数 + 导出 GeoTIFF 到 Drive ----
windows.forEach(function (win) {
  var r = ndviComposite(win);
  print('窗口', win.label, win.start, '→', win.end, '有效场景数≈', r.count);
  Export.image.toDrive({
    image: r.image,
    description: 'zhejiang_ndvi_' + win.label,
    folder: 'zhejiang_ndvi',
    region: REGION,
    scale: 250,            // 百米级输出（250m），满足「百米级连栅格」
    crs: 'EPSG:4326',
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF'
  });
});
print('已创建', windows.length, '个导出任务（Google Drive 文件夹 zhejiang_ndvi）。');

// ---- 可选：把 4 期叠加为一张预览小图（不必导出，仅查看） ----
var vis = { min: 0.1, max: 0.85, palette: ['#991b1b', '#ea580c', '#facc15', '#22c55e', '#107a57'] };
Map.centerObject(REGION, 7);
Map.addLayer(ndviComposite(windows[0]).image, vis, 'NDVI ' + windows[0].label);
