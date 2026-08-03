import L from 'leaflet'
import type { Geometry } from 'geojson'
import { pointInGeometry } from '../utils/geo'
export function shouldClaimCtrlWeatherClick(event:MouseEvent,active:boolean,editing:boolean){return active&&!editing&&event.ctrlKey&&event.button===0}
export function createWeatherInteractionController(map:L.Map,ports:{active():boolean;editing():boolean;provinceGeometry():Geometry|null;onPicked(lat:number,lon:number):void;onOutside():void}){
 const container=map.getContainer()
 const onPointer=(event:MouseEvent)=>{if(!shouldClaimCtrlWeatherClick(event,ports.active(),ports.editing()))return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();const latlng=map.mouseEventToLatLng(event);const geometry=ports.provinceGeometry();if(!geometry||!pointInGeometry([latlng.lng,latlng.lat],geometry)){ports.onOutside();return}ports.onPicked(latlng.lat,latlng.lng)}
 container.addEventListener('click',onPointer,true)
 return{destroy(){container.removeEventListener('click',onPointer,true)}}
}
