import type { Telemetry } from "../sim/Simulation.ts";
import { clamp } from "../core/math.ts";

/** Drawn on the physical instrument screen, using live simulation values. */
export function paintCockpitInstruments(ctx: CanvasRenderingContext2D, t: Telemetry, speedKph: number, limit: number | null): void {
  const w=768,h=288;
  ctx.save(); ctx.scale(ctx.canvas.width/w,ctx.canvas.height/h);
  ctx.fillStyle="#060e14";ctx.fillRect(0,0,w,h);
  const background=ctx.createLinearGradient(0,0,0,h);
  background.addColorStop(0,"#162630");background.addColorStop(.55,"#0b151e");background.addColorStop(1,"#060e14");
  ctx.fillStyle=background;ctx.fillRect(0,0,w,h);
  ctx.textAlign="center";ctx.textBaseline="middle";
  const gauge=(x:number,value:number,max:number,step:number,label:string)=>{
    const start=Math.PI*.72,end=Math.PI*2.28,r=102;
    const angle=(n:number)=>start+(end-start)*n/max;
    ctx.lineWidth=6;ctx.strokeStyle="#293944";ctx.beginPath();ctx.arc(x,147,r,start,end);ctx.stroke();
    ctx.strokeStyle=t.rearAeb||t.adas.aeb?"#ff6861":"#70d8df";
    ctx.beginPath();ctx.arc(x,147,r,start,angle(clamp(value,0,max)));ctx.stroke();
    for(let n=0;n<=max;n+=step){
      const a=angle(n),major=n%(step*2)===0;
      ctx.strokeStyle=label==="VÒNG/PHÚT" && n>=6?"#e77566":"#91a7b4";ctx.lineWidth=major?2:1;
      ctx.beginPath();ctx.moveTo(x+Math.cos(a)*(r-12),147+Math.sin(a)*(r-12));ctx.lineTo(x+Math.cos(a)*(r-5),147+Math.sin(a)*(r-5));ctx.stroke();
      if(major){ctx.font="500 16px Segoe UI, sans-serif";ctx.fillStyle="#95acba";ctx.fillText(String(n),x+Math.cos(a)*76,147+Math.sin(a)*76);}
    }
    ctx.fillStyle="#f2f8fc";ctx.font="500 58px Segoe UI, sans-serif";
    ctx.fillText(label==="VÒNG/PHÚT"?(value).toFixed(1):String(Math.round(value)),x,146);
    ctx.fillStyle="#89a7ba";ctx.font="500 13px Segoe UI, sans-serif";ctx.fillText(label,x,189);
  };
  gauge(143,t.rpm/1000,8,.5,"VÒNG/PHÚT");
  ctx.fillStyle="#688493";ctx.font="500 11px Segoe UI";ctx.fillText("× 1000",143,210);
  gauge(625,Math.abs(speedKph),240,10,"km/h");
  ctx.fillStyle="#9fb7c7";ctx.font="600 12px Segoe UI";ctx.fillText("BLUELINE",384,24);
  ctx.fillStyle=t.epbEngaged?"#ff7c71":"#e6f4f8";ctx.font="600 37px Segoe UI";ctx.fillText(t.gear,384,65);
  // Only illuminate lane assistance and ACC when the controller reports them.
  const laneColor=t.adas.laneCenteringActive?"#70e2be":"#435a69";
  ctx.lineWidth=3;ctx.strokeStyle=laneColor;
  for(const side of [-1,1]) {ctx.beginPath();ctx.moveTo(384+side*58,205);ctx.lineTo(384+side*22,103);ctx.stroke();}
  ctx.fillStyle=t.adas.accActive?"#70e2be":"#a7bdc9";ctx.fillRect(371,152,26,46);
  ctx.fillStyle="#0b202b";ctx.fillRect(375,160,18,10);
  if(t.adas.leadGap!==null){
    ctx.fillStyle="#ffc861";ctx.fillRect(374,111,20,23);
    ctx.font="600 16px Segoe UI";ctx.fillText(`${t.adas.leadGap.toFixed(1)} m`,384,229);
  }else{ctx.fillStyle="#6d8798";ctx.font="12px Segoe UI";ctx.fillText(t.controlMode==="adas"?"HỖ TRỢ LÁI":"ĐIỀU KHIỂN TAY",384,229);}
  if(limit!==null){
    ctx.fillStyle="#f2f6f8";ctx.beginPath();ctx.arc(485,62,24,0,Math.PI*2);ctx.fill();
    ctx.lineWidth=4;ctx.strokeStyle="#e85250";ctx.stroke();ctx.fillStyle="#13202a";ctx.font="700 21px Segoe UI";ctx.fillText(String(limit),485,63);
  }
  ctx.font="700 25px Segoe UI";ctx.fillStyle=t.indicator<0&&t.indicatorOn!==false?"#7df0b4":"#283e48";ctx.fillText("◀",48,28);
  ctx.fillStyle=t.indicator>0&&t.indicatorOn!==false?"#7df0b4":"#283e48";ctx.fillText("▶",720,28);
  const extra=t.adas.extra;
  const warning=t.adas.aeb||t.rearAeb?"PHANH TỰ ĐỘNG · GIỮ KHOẢNG CÁCH":t.adas.takeoverRequired?"HÃY TIẾP QUẢN ĐIỀU KHIỂN":extra.pedalMitigation?"PMC · NGẮT GA VÀ PHANH":t.adas.fcw?"CẢNH BÁO VA CHẠM":t.rctaActive?"CÓ PHƯƠNG TIỆN CẮT NGANG":
    t.adas.trafficLightStopping?t.adas.trafficLight==="yellow"?"ĐÈN VÀNG · DỪNG TRƯỚC VẠCH":"ĐÈN ĐỎ · DỪNG TRƯỚC VẠCH":extra.driverWarning!=="none"?extra.driverWarning==="hands"?"ĐẶT TAY LÊN VÔ-LĂNG":"HÃY CHÚ Ý LÁI XE":extra.leadDeparture?"XE PHÍA TRƯỚC ĐÃ KHỞI HÀNH":extra.blindSpotIntervention?"BCA · CÓ XE BÊN CẠNH":extra.emergencyLaneKeeping?"ELK · GIỮ XE TRONG ĐƯỜNG":"";
  // Keep urgent warnings above the wheel rim. The bottom strip is reserved
  // for powertrain status, where partial rim occlusion is physically natural.
  if(warning){
    ctx.fillStyle=t.adas.aeb||t.rearAeb?"#a7242d":"#533b1c";ctx.fillRect(100,4,568,28);
    ctx.fillStyle="#ffffff";ctx.font="600 15px Segoe UI";ctx.fillText(warning,384,18);
  }
  ctx.fillStyle="#0b1821";ctx.fillRect(0,254,w,34);
  ctx.fillStyle=t.epbEngaged?"#ffbd70":"#7896a8";ctx.font="600 14px Segoe UI";
  ctx.fillText(t.doorLeftOpen||t.doorRightOpen?"CỬA ĐANG MỞ · KHÓA D/R":t.epbEngaged?"(P) PHANH ĐỖ":!t.engineOn?"ĐỘNG CƠ ĐANG TẮT":t.adas.aebHolding?"AEB · GIỮ DỪNG":t.adas.accState==="resume-required"?"ACC · NHẤN RES ĐỂ ĐI":t.adas.accState==="cancelled"?"ACC ĐÃ HỦY · NHẤN RES ĐỂ BẬT":"",384,271);
  if(extra.highBeam){ctx.fillStyle="#73b6ff";ctx.font="600 13px Segoe UI";ctx.fillText("PHA",265,27);}
  ctx.restore();
}

/** Holographic Windshield Head-Up Display (AR-HUD) projected onto the lower windscreen in cockpit view. */
export function paintWindshieldHud(
  ctx: CanvasRenderingContext2D,
  t: Telemetry,
  speedKph: number,
  limit: number | null,
  seaFlashLeft = false,
  seaFlashRight = false,
): void {
  const w = 512, h = 192;
  ctx.save();
  ctx.scale(ctx.canvas.width / w, ctx.canvas.height / h);
  ctx.clearRect(0, 0, w, h);

  // Subtle holographic projector frame glow
  ctx.strokeStyle = t.adas.aeb || t.rearAeb ? "rgba(255, 82, 74, 0.55)" : "rgba(96, 236, 198, 0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, 42); ctx.lineTo(16, 18); ctx.lineTo(54, 18);
  ctx.moveTo(w - 16, 42); ctx.lineTo(w - 16, 18); ctx.lineTo(w - 54, 18);
  ctx.moveTo(16, h - 42); ctx.lineTo(16, h - 18); ctx.lineTo(54, h - 18);
  ctx.moveTo(w - 16, h - 42); ctx.lineTo(w - 16, h - 18); ctx.lineTo(w - 54, h - 18);
  ctx.stroke();

  // Left block: Digital Speed + Gear
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const overSpeed = limit !== null && Math.abs(speedKph) > limit + 2;
  ctx.fillStyle = t.adas.aeb || t.rearAeb ? "#ff6861" : overSpeed ? "#ffbe55" : "#6df5d0";
  ctx.font = "700 66px 'Segoe UI', sans-serif";
  ctx.fillText(String(Math.abs(speedKph)), 34, 118);

  ctx.fillStyle = "rgba(175, 242, 226, 0.88)";
  ctx.font = "700 17px 'Segoe UI', sans-serif";
  ctx.fillText("km/h", 36, 144);
  ctx.fillStyle = t.epbEngaged ? "#ff8a7a" : "#7ee6ff";
  ctx.font = "700 24px 'Segoe UI', sans-serif";
  ctx.fillText(t.gear, 102, 144);

  // Speed limit TSR ring in HUD
  if (limit !== null) {
    const cx = 186, cy = 96, r = 28;
    ctx.fillStyle = "rgba(12, 24, 32, 0.72)";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = overSpeed ? "#ff4e45" : "#ff635b";
    ctx.stroke();
    ctx.fillStyle = "#f4fbff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 23px 'Segoe UI', sans-serif";
    ctx.fillText(String(limit), cx, cy + 1);
  }

  // Center block: AR Lane Corridor + ACC Target / ALC Arrows
  const midX = 292;
  const laneActive = t.adas.laneCenteringActive || t.adas.laneKeepAssist;
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = t.adas.laneDeparture !== "none" ? "#ffae42" : laneActive ? "#5ef2c4" : "rgba(130, 185, 200, 0.42)";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(midX + side * 56, 152);
    ctx.lineTo(midX + side * 22, 62);
    ctx.stroke();
  }

  // Chevrons inside HUD corridor
  ctx.strokeStyle = laneActive ? "rgba(94, 242, 196, 0.75)" : "rgba(130, 185, 200, 0.3)";
  ctx.lineWidth = 2.5;
  for (const y of [136, 112, 88]) {
    const span = 12 + (y - 62) * 0.22;
    ctx.beginPath();
    ctx.moveTo(midX - span, y + 7);
    ctx.lineTo(midX, y);
    ctx.lineTo(midX + span, y + 7);
    ctx.stroke();
  }

  if (t.adas.leadGap !== null) {
    ctx.fillStyle = t.adas.aeb ? "#ff5c54" : t.adas.fcw ? "#ffbe4f" : "#6df5d0";
    ctx.fillRect(midX - 18, 66, 36, 7);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 18px 'Segoe UI', sans-serif";
    ctx.fillText(`${t.adas.leadGap.toFixed(1)} m`, midX, 166);
  } else {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(145, 215, 205, 0.8)";
    ctx.font = "600 14px 'Segoe UI', sans-serif";
    ctx.fillText(t.adas.accActive ? `ACC ${Math.round(t.targetSpeed * 3.6)} km/h` : t.controlMode === "adas" ? "ADAS SẴN SÀNG" : "LÁI TAY", midX, 166);
  }

  // Right block: ALC / Traffic Light / Parking / Door status
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = "700 17px 'Segoe UI', sans-serif";
  const rightX = w - 28;
  if (t.adas.alc === "active" || t.adas.alc === "armed") {
    ctx.fillStyle = "#5ef2c4";
    ctx.fillText(t.indicator < 0 ? "◀◀ ALC TRÁI" : "ALC PHẢI ▶▶", rightX, 78);
  } else if (t.trafficLight && t.trafficLight.distance < 95) {
    const tlColor = t.trafficLight.state === "red" ? "#ff645c" : t.trafficLight.state === "yellow" ? "#ffcb57" : "#5ef2c4";
    ctx.fillStyle = tlColor;
    ctx.fillText(`ĐÈN ${t.trafficLight.state === "red" ? "ĐỎ" : t.trafficLight.state === "yellow" ? "VÀNG" : "XANH"} · ${Math.round(t.trafficLight.distance)}m`, rightX, 78);
  } else {
    ctx.fillStyle = "rgba(135, 215, 205, 0.72)";
    ctx.fillText(t.adas.laneCenteringActive ? "LFA GIỮ LÀN" : "HUD KÍNH LÁI", rightX, 78);
  }

  const extra = t.adas.extra;
  if (seaFlashLeft || seaFlashRight || extra.safeExitLeft || extra.safeExitRight) {
    ctx.fillStyle = "#ff5a52";
    ctx.fillText("SEA · XE ÁP SÁT CỬA", rightX, 112);
  } else if (t.doorLeftOpen || t.doorRightOpen) {
    ctx.fillStyle = "#ffbe55";
    ctx.fillText(t.doorLeftOpen && t.doorRightOpen ? "MỞ 2 CỬA" : t.doorLeftOpen ? "CỬA TRÁI MỞ" : "CỬA PHẢI MỞ", rightX, 112);
  } else if (t.parkingAssist && t.parkingAssist.state !== "idle") {
    ctx.fillStyle = "#6df5d0";
    ctx.fillText(`${t.parkingAssist.bayOrientation === "perpendicular" ? "APA 90°" : "APA"} · ${Math.round(t.parkingAssist.progress * 100)}%`, rightX, 112);
  } else if (t.adas.blindSpotLeft || t.adas.blindSpotRight) {
    ctx.fillStyle = "#ffbe55";
    ctx.fillText(t.adas.blindSpotLeft ? "BSM ◀ ĐIỂM MÙ" : "ĐIỂM MÙ ▶ BSM", rightX, 112);
  }

  // Urgent Top Alert Banner on Windshield HUD
  const urgent = t.adas.aeb || t.rearAeb
    ? "PHANH KHẨN CẤP AEB"
    : seaFlashLeft || seaFlashRight
      ? "SEA · KHÓA MỞ CỬA DO XE ÁP SÁT"
      : t.adas.takeoverRequired
        ? "TIẾP QUẢN VÔ-LĂNG NGAY"
        : t.adas.fcw
          ? "CẢNH BÁO VA CHẠM PHÍA TRƯỚC"
          : "";
  if (urgent) {
    ctx.fillStyle = "rgba(190, 28, 36, 0.85)";
    ctx.fillRect(72, 14, w - 144, 30);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 16px 'Segoe UI', sans-serif";
    ctx.fillText(urgent, w / 2, 29);
  }
  ctx.restore();
}
