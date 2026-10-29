import {wrapDiff} from '../core/math.ts';
import {Road} from '../world/Road.ts';
import {trafficFootprint,type TrafficCar} from './TrafficManager.ts';

/** Simulator diagnostics, deliberately separate from inferred sensor tracks. */
export function stoppedTrafficAhead(road:Road,cars:TrafficCar[],s:number,d:number):string|null{
 const lead=cars.filter(c=>{const ds=wrapDiff(c.s,s,road.path.length);return ds>0&&ds<65&&Math.abs(c.d-d)<(trafficFootprint(c).width+2)/2+.2;})
  .sort((a,b)=>wrapDiff(a.s,s,road.path.length)-wrapDiff(b.s,s,road.path.length))[0];
 if(!lead||Math.abs(lead.v)>.5)return null;
 const labels:Record<NonNullable<TrafficCar['stopReason']>,string>={none:'Xe trước đang khởi hành',vehicle:'Xe trước đang xếp hàng / nhường xe',red:'Xe trước chờ đèn đỏ',yellow:'Xe trước dừng theo đèn vàng',pedestrian:'Xe trước nhường người đi bộ',
  'cross-traffic':'Xe trước nhường xe cắt ngang','bus-stop':'Xe buýt đang đón trả khách',collision:lead.impactPause&&lead.impactPause>0?'Xe trước tạm dừng sau va chạm':'Xe trước chờ đường trống sau va chạm',breakdown:'Xe hỏng / vật cản cố định',merge:'Xe trước chờ khoảng trống để nhập làn'};
 return labels[lead.stopReason??(lead.disabled||lead.kind==='stalled'?'breakdown':'none')];
}
