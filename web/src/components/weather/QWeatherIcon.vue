<template><i :class="iconClass(code, fallback)" aria-hidden="true"></i></template>
<script setup lang="ts">import {iconClass} from '../../features/weather/weatherAdapter';withDefaults(defineProps<{code?:string|null;fallback?:string}>(),{fallback:'999'})</script>
