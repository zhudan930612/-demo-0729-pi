import { defineStore } from 'pinia'
import type { LocationPopupKind, WeatherBundle, WeatherQuery, WeatherSelection } from '../features/weather/weatherTypes'

export type WeatherPhase='closed'|'loading'|'ready'|'error'|'refreshing'
export const useWeatherStore=defineStore('weather',{
 state:()=>({phase:'closed' as WeatherPhase,generation:0,query:null as WeatherQuery|null,defaultQuery:null as WeatherQuery|null,bundle:null as WeatherBundle|null,defaultBundle:null as WeatherBundle|null,errorMessage:'',selection:null as WeatherSelection|null,locationPopup:'none' as LocationPopupKind,lastSuccessAt:0}),
 getters:{
  isOpen:s=>s.phase!=='closed',
  hasPartialFailure:s=>Boolean(s.errorMessage||s.bundle&&(s.bundle.alerts.status==='partial'||s.bundle.alerts.status==='error'||['current','minutely','hourly'].some(k=>{const module=(s.bundle as unknown as Record<string,{status:string;stale?:boolean;refreshError?:unknown}>)[k];return module?.status==='error'||module?.stale&&module.refreshError})||s.bundle.alerts.data.some(region=>region.stale&&region.refreshError))),
 },
 actions:{
  open(){this.$reset();this.phase='loading';this.generation+=1},
  begin(query:WeatherQuery,refresh=false){const same=this.query&&this.query.contextLevel===query.contextLevel&&this.query.contextCode===query.contextCode&&this.query.target===query.target&&this.query.lat===query.lat&&this.query.lon===query.lon;if(!refresh&&!same)this.bundle=null;this.query=query;this.errorMessage='';this.phase=refresh&&this.bundle?'refreshing':'loading';if(!refresh||!same)this.selection=null;if(query.target!=='picked'&&!refresh)this.locationPopup='none';return ++this.generation},
  receive(generation:number,key:string,bundle:WeatherBundle){if(this.generation!==generation||!this.query)return false;const currentKey=`${this.query.contextLevel}|${this.query.contextCode}|${this.query.target}|${this.query.lat??''}|${this.query.lon??''}`;if(currentKey!==key)return false;this.bundle=bundle;if(bundle.target!=='picked'){this.defaultBundle=bundle;this.defaultQuery={...this.query}}this.phase='ready';this.lastSuccessAt=Date.now();return true},
  fail(generation:number,message:string){if(this.generation!==generation)return false;this.phase=this.bundle?'ready':'error';this.errorMessage=message;return true},
  selectAlert(selection:WeatherSelection|null){this.selection=selection;this.locationPopup='none'},
  openLocation(kind:Exclude<LocationPopupKind,'none'>){this.locationPopup=kind;this.selection=null},
  closeLocation(){const wasPicked=this.locationPopup==='picked';this.locationPopup='none';if(wasPicked&&this.defaultBundle){this.bundle=this.defaultBundle;this.query=this.defaultQuery?{...this.defaultQuery}:null;this.phase='ready';this.errorMessage=''}return wasPicked},
  close(){const next=this.generation+1;this.$reset();this.generation=next},
 }
})
