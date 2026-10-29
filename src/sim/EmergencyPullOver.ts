import { clamp, wrapAngle, wrapDiff } from '../core/math.ts';
import { bodyContact } from '../core/collision.ts';
import { stanleyControl } from '../control/Stanley.ts';
import type { ADASFrame } from './ADAS.ts';
import type { Trajectory } from '../planner/Trajectory.ts';
import { assistanceAvailability } from './AssistancePolicy.ts';

export type PullOverState = 'off' | 'preparing' | 'assessing' | 'changing-lane' | 'entering-shoulder' | 'stopping' | 'fallback' | 'hold' | 'cancelled';
export interface PullOverStatus {
  state: PullOverState; message: string; targetLane: number | null;
  targetD: number | null; onShoulder: boolean; active: boolean;
}
export interface PullOverRuntime {
  status: PullOverStatus; startD: number; targetD: number; timer: number;
  waitTime: number; duration: number; checkClock: number; targetSpeed: number;
}
export const emptyPullOverStatus = (): PullOverStatus => ({ state:'off', message:'Chưa có yêu cầu dừng khẩn cấp', targetLane:null, targetD:null, onShoulder:false, active:false });

/** Composite, simulation-only emergency stop manoeuvre. It does NOT diagnose
 * medical events. All steering/braking goes through the existing vehicle and
 * swept-body contact system; no position correction or teleport is used. */
export class EmergencyPullOver {
  status = emptyPullOverStatus();
  private startD = 0;
  private targetD = 0;
  private timer = 0;
  private waitTime = 0;
  private duration = 5;
  private checkClock = 0;
  private targetSpeed = 14;
  reset():void { this.status=emptyPullOverStatus(); this.startD=this.targetD=this.timer=this.waitTime=this.checkClock=0; this.duration=5; this.targetSpeed=14; }
  captureState():PullOverRuntime { return { status:{...this.status}, startD:this.startD,targetD:this.targetD,timer:this.timer,waitTime:this.waitTime,duration:this.duration,checkClock:this.checkClock,targetSpeed:this.targetSpeed }; }
  restoreState(s?:PullOverRuntime):void {
    this.reset(); if(!s)return;
    this.status={...s.status};this.startD=s.startD;this.targetD=s.targetD;this.timer=s.timer;
    this.waitTime=s.waitTime;this.duration=s.duration;this.checkClock=s.checkClock;this.targetSpeed=s.targetSpeed;
  }
  update(frame:ADASFrame, requested:boolean, enabled:boolean) {
    const { ego,road,egoD,egoS,dt }=frame, a=assistanceAvailability(frame);
    const crawlSpeed=14*Math.sqrt(clamp(ego.surfaceMu,.35,1));
    if(!enabled && requested && this.status.active && !['fallback','hold'].includes(this.status.state))this.fallback(egoD,'Đã tắt tấp lề · ngừng chuyển làn, phanh có kiểm soát');
    if(!requested || (!enabled&&!this.status.active)){
      if(this.status.active){this.status={...emptyPullOverStatus(),state:'cancelled',message:'Người lái tiếp quản hoặc đã tắt hỗ trợ tấp lề'};}
      else if(this.status.state!=='cancelled')this.status=emptyPullOverStatus();
      return null;
    }
    if(!this.status.active){
      this.startD=this.targetD=road.inEmergencyShoulder(egoD)?road.shoulderCenter:road.laneCenter(road.laneOf(egoD));
      this.timer=this.waitTime=this.checkClock=0;
      this.status={state:'preparing',message:'Tài xế không phản hồi · giảm tốc, tìm đường tấp lề',targetLane:road.laneOf(egoD),targetD:this.targetD,onShoulder:false,active:true};
      if(ego.v<.5)this.fallback(egoD,'Xe đã dừng · không tự khởi hành lại');
    }
    if(this.status.state==='hold')return {steer:0,accel:-ego.maxDecel,park:true};
    const canMove = road.rightHandMotorway && road.shoulderWidth>=ego.dims.width+.7 && a.lane && a.sensors.frontRadar && a.sensors.rearRadar &&
      a.conditions.gear==='D' && a.conditions.engineOn && !a.conditions.epb && a.conditions.doorsClosed && a.conditions.escAvailable && !a.conditions.absActive;
    if(!canMove && !['fallback','stopping'].includes(this.status.state)){
      const reason=!road.shoulderWidth?'Không có làn khẩn cấp trên bản đồ này':!a.lane?'Không nhận diện được làn':
        !a.sensors.rearRadar?'Radar sau không sẵn sàng':!a.sensors.frontRadar?'Radar trước không sẵn sàng':'Điều kiện xe không cho phép tấp lề';
      this.fallback(road.inEmergencyShoulder(egoD)?road.shoulderCenter:road.laneCenter(road.laneOf(egoD)),`${reason} · dừng có kiểm soát`);
    }
    if(this.status.state==='preparing' && ego.v<=crawlSpeed+.5)this.setState('assessing','Quét xe phía sau và khoảng trống làn bên phải');
    if(this.status.state==='assessing'){
      const lane=road.laneOf(egoD), next=lane<road.numLanes-1?lane+1:null;
      const nextD=next===null?road.shoulderCenter:road.laneCenter(next);
      this.checkClock-=dt;this.waitTime+=dt;
      if(this.checkClock<=0){
        this.checkClock=.15;
        if(this.clearMove(frame,nextD,5,next===null)){
          this.startD=egoD;this.targetD=nextD;this.timer=0;this.duration=5;this.waitTime=0;
          this.status.targetLane=next;this.status.targetD=nextD;
          this.setState(next===null?'entering-shoulder':'changing-lane',next===null?'Đang tấp vào làn dừng khẩn cấp':'Đang chuyển từng làn về phía lề phải');
        }else this.status.message='Chưa đủ khoảng trống an toàn · đang chờ trước khi chuyển làn';
      }
      if(this.waitTime>=6)this.fallback(road.laneCenter(lane),'Đường tấp lề bị chặn · dừng trong làn hiện tại');
    }
    const moving=this.status.state==='changing-lane'||this.status.state==='entering-shoulder';
    if(moving){
      this.timer+=dt;this.checkClock-=dt;
      if(this.checkClock<=0){
        this.checkClock=.15;
        if(!this.clearMove(frame,this.targetD,Math.max(1,this.duration-this.timer),this.status.state==='entering-shoulder')){
          // Check a return before choosing it. If neither corridor is clear,
          // arrest lateral motion at the current offset and brake there.
          const original=road.laneCenter(road.laneOf(this.startD));
          const recovery=this.timer<this.duration*.5 && this.clearMove(frame,original,3,false)?original:egoD;
          this.fallback(recovery,'Nguy hiểm mới trên đường tấp lề · hủy chuyển làn và phanh');
        }
      }
      if(this.status.state==='changing-lane'||this.status.state==='entering-shoulder'){
        const heading=frame.path.cartesianAt(egoS).heading;
        if(this.timer>=this.duration && Math.abs(egoD-this.targetD)<.23 && Math.abs(wrapAngle(ego.yaw-heading))<.06){
          if(this.status.state==='entering-shoulder')this.setState('stopping','Đã vào làn khẩn cấp · đang phanh dừng');
          else {this.targetD=road.laneCenter(road.laneOf(egoD));this.waitTime=0;this.checkClock=0;this.setState('assessing','Đã ổn định trong làn · kiểm tra bước tấp lề tiếp theo');}
        }else if(this.timer>10)this.fallback(egoD,'Không bám được quỹ đạo tấp lề · phanh có kiểm soát');
      }
    }
    this.status.onShoulder=road.inEmergencyShoulder(egoD,ego.dims.width/2);
    const stopping=this.status.state==='fallback'||this.status.state==='stopping';
    if(stopping && ego.v<.06){this.setState('hold',this.status.onShoulder?'Đã dừng trên làn khẩn cấp · số P, phanh đỗ và đèn cảnh báo':'Đã dừng trong làn · số P, phanh đỗ và đèn cảnh báo');return {steer:0,accel:-ego.maxDecel,park:true};}
    const ref=this.reference(0);
    const k=frame.path.signedCurvatureAt(egoS), laneK=k/Math.max(.5,1-k*egoD);
    const referenceHeading=frame.path.cartesianAt(egoS).heading+Math.atan2(ref.vd,Math.max(ego.v,2));
    // Lane-camera loss forbids relocation. The fallback stop uses BlueLine's
    // ideal map/localisation to follow the current lane through a bend. This
    // is a simulation assumption, not camera performance or real redundancy.
    const steer=clamp(Math.atan(ego.dims.wheelbase*(laneK+ref.add/Math.max(ego.v**2,16)))+
      stanleyControl(wrapAngle(referenceHeading-ego.yaw),egoD-ref.d,ego.v,{k:3,kSoft:1.2,maxSteer:ego.maxSteer}),-ego.maxSteer,ego.maxSteer);
    this.targetSpeed=stopping?0:crawlSpeed;
    let accel=stopping?-Math.min(2.5,ego.maxDecel*ego.surfaceMu*.65):clamp((this.targetSpeed-ego.v)*.7,-2,.6);
    // Independent swept forecast with the ACTUAL steering command protects
    // against late cut-ins and obstacles during preparation or a fallback.
    if(this.imminent(frame,steer))accel=-ego.maxDecel;
    return {steer,accel,park:false};
  }
  private setState(state:PullOverState,message:string){this.status.state=state;this.status.message=message;this.status.targetD=this.targetD;}
  private fallback(d:number,message:string){this.startD=this.targetD=d;this.timer=0;this.status.targetLane=null;this.setState('fallback',message);}
  private reference(ahead:number){
    if(this.status.state!=='changing-lane'&&this.status.state!=='entering-shoulder')return {d:this.targetD,vd:0,add:0};
    const t=clamp((this.timer+ahead)/this.duration,0,1), delta=this.targetD-this.startD;
    return {d:this.startD+delta*t**3*(10-15*t+6*t*t),vd:delta*30*t*t*(1-t)**2/this.duration,
      add:delta*60*t*(1-t)*(1-2*t)/this.duration**2};
  }
  private clearMove(frame:ADASFrame,targetD:number,duration:number,shoulder:boolean):boolean {
    const {ego,egoS,egoD,path,road,obstacles}=frame;
    const speed=Math.max(ego.v,2),brake=Math.max(1,2*ego.surfaceMu),stopTime=speed/brake;
    const horizon=shoulder?duration+stopTime+.7:duration+1;
    const k=path.signedCurvatureAt(egoS), rate=speed/Math.max(.5,1-k*egoD);
    for(let t=0;t<=horizon;t+=.25){
      const u=clamp(t/duration,0,1),blend=u**3*(10-15*u+6*u*u);
      const d=egoD+(targetD-egoD)*blend;
      const vd=(targetD-egoD)*30*u*u*(1-u)**2/duration;
      const brakeTime=Math.min(Math.max(0,t-duration),stopTime);
      const distance=shoulder&&t>duration?rate*duration+speed*brakeTime-.5*brake*brakeTime**2:rate*t;
      const w=path.toCartesian(egoS+Math.max(0,distance),d), yaw=w.heading+Math.atan2(vd,speed);
      for(const o of obstacles){
        const p=path.toCartesian(o.s+o.v*t,o.d+o.vd*t);
        if(bodyContact({...w,yaw,...ego.dims},{...p,yaw:p.heading,length:o.length,width:o.width},.55))return false;
        if(!o.roadBoundary && Math.abs(o.d+o.vd*t-targetD)<(o.width+ego.dims.width)/2+.4 && t<=duration+1){
          const gap=wrapDiff(o.s+o.v*t,egoS+rate*t,path.length), clearance=(ego.dims.length+o.length)/2;
          const margin=gap>=0?Math.max(12,speed*.6):Math.max(15,Math.max(o.v,0)*.7);
          if(Math.abs(gap)-clearance<margin)return false;
        }
      }
    }
    return road.shoulderWidth>0;
  }
  private imminent(frame:ADASFrame,steer:number):boolean {
    const {ego,path,obstacles}=frame, k=Math.tan(steer)/ego.dims.wheelbase;
    const decel=Math.max(1,ego.maxDecel*ego.surfaceMu), horizon=Math.min(4,ego.v/decel+.7);
    for(let t=0;t<=horizon;t+=.15){
      const brakeTime=Math.min(t,ego.v/decel),distance=Math.max(0,ego.v*brakeTime-.5*decel*brakeTime*brakeTime),yaw=ego.yaw+k*distance;
      const x=Math.abs(k)<1e-5?ego.x+Math.cos(ego.yaw)*distance:ego.x+(Math.sin(yaw)-Math.sin(ego.yaw))/k;
      const y=Math.abs(k)<1e-5?ego.y+Math.sin(ego.yaw)*distance:ego.y-(Math.cos(yaw)-Math.cos(ego.yaw))/k;
      for(const o of obstacles){const p=path.toCartesian(o.s+o.v*t,o.d+o.vd*t);
        if(bodyContact({x,y,yaw,...ego.dims},{...p,yaw:p.heading,length:o.length,width:o.width},.4))return true;}
    }
    return false;
  }
  preview(frame:ADASFrame):Trajectory|null {
    if(!this.status.active||['hold','fallback'].includes(this.status.state))return null;
    const points=[];
    for(let t=0;t<=6;t+=.15){const d=this.reference(t).d,s=frame.egoS+frame.ego.v*t,w=frame.path.toCartesian(s,d);points.push({t,s,d,x:w.x,y:w.y,v:this.targetSpeed});}
    return {points,targetSpeed:this.targetSpeed,targetLane:frame.road.laneOf(this.targetD),cost:0,colliding:false,feasible:true};
  }
}
