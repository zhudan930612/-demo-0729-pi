<template>
  <MapView @zoom-change="currentZoom = $event" />
  <Breadcrumb :zoom="currentZoom" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import MapView from './components/MapView.vue'
import Breadcrumb from './components/Breadcrumb.vue'

const currentZoom = ref(7)
</script>
