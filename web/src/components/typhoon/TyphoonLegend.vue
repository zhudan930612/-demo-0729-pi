<template>
  <section class="typhoon-legend" aria-label="台风图层图例">
    <h3>图层图例</h3>
    <div class="legend-grid">
      <span><i class="line actual" aria-hidden="true"></i>实际路径 · 实线</span>
      <span><i class="line forecast" aria-hidden="true"></i>预测路径 · 虚线</span>
      <span><i class="area wind" aria-hidden="true"></i>台风风圈 · 填充区</span>
      <span><i class="line guard-24" aria-hidden="true"></i>24h 警戒线 · 黄实线</span>
      <span><i class="line guard-48" aria-hidden="true"></i>48h 警戒线 · 蓝虚线</span>
    </div>
  </section>
</template>

<style scoped>
.typhoon-legend { padding:8px 10px; border:1px solid #e2e8f0; border-radius:7px; background:rgba(255,255,255,.86); }
h3 { margin:0 0 6px; color:#475569; font-size:10px; font-weight:750; letter-spacing:.05em; }
.legend-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 10px; }
.legend-grid span { min-width:0; display:flex; align-items:center; gap:6px; color:#475569; font-size:10px; font-weight:600; line-height:1.25; }
i { width:24px; flex:none; display:block; }
.line { height:0; border-top:3px solid #475569; }
.forecast { border-top-color:#f97316; border-top-style:dashed; }
.area { height:10px; border:1px solid #0369a1; background:rgba(56,189,248,.18); }
.guard-24 { border-top-width:2px; border-top-color:#eab308; }
.guard-48 { border-top-width:2px; border-top-color:#3b82f6; border-top-style:dashed; }
@media (max-width:520px) { .legend-grid { grid-template-columns:repeat(5,minmax(128px,1fr)); min-width:680px; } .typhoon-legend { overflow-x:auto; } }
</style>
