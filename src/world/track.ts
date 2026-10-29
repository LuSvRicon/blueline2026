// Track definitions — the road network the ego drives. Coordinates are metres.
//
// The default is a CITY LOOP: long straight "streets" joined by rounded 90°
// junction turns, so the ego actually drives an urban block circuit (slowing
// hard for the corners) rather than a lazy oval. The loop is closed so the ego
// drives forever. Junction turn radii are large enough (~30 m) to keep the
// Frenet frame well-behaved while still reading as square city blocks.

export interface TrackDef {
  id: TrackId;
  name: string;
  controlPoints: [number, number][];
  /** Approximate corner centres (world x,y) — junctions get lights + cross-streets. */
  junctions: [number, number][];
  road?: RoadProfile;
}
export interface RoadProfile {
  lanes: number; opposing: number; laneWidth: number; speedKph: number;
  environment: 'urban'|'suburban'|'rural'; motorway?: boolean; median?: number;
  traffic: number; description: string;
  /** Paved emergency strip on the outer edge of each motorway carriageway. */
  emergencyShoulder?: number;
}
export type TrackId = "city" | "boulevard" | "ring-road" | "motorway" | "national" | "two-way" | "neighborhood";

// Walk the perimeter of a rounded rectangle emitting UNIFORMLY-spaced points
// (straights + quarter-circle corners), so the Catmull-Rom spline stays clean
// through the junctions (uneven spacing makes it overshoot).
function cityLoop(halfW: number, halfH: number, r: number): { pts: [number, number][]; corners: [number, number][] } {
  const pts: [number, number][] = [];
  const corners: [number, number][] = [];
  const step = 9; // ~metres between points

  const emitStraight = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  };
  const emitArc = (cx: number, cy: number, a0: number, a1: number) => {
    const n = Math.max(3, Math.round((Math.abs(a1 - a0) * r) / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    corners.push([cx, cy]);
  };

  // Corners counter-clockwise from the bottom-right.
  const C = [
    { cx: halfW - r, cy: -halfH + r, a0: -Math.PI / 2, a1: 0 },
    { cx: halfW - r, cy: halfH - r, a0: 0, a1: Math.PI / 2 },
    { cx: -halfW + r, cy: halfH - r, a0: Math.PI / 2, a1: Math.PI },
    { cx: -halfW + r, cy: -halfH + r, a0: Math.PI, a1: 1.5 * Math.PI },
  ];
  for (let i = 0; i < 4; i++) {
    emitArc(C[i].cx, C[i].cy, C[i].a0, C[i].a1);
    const ex = C[i].cx + r * Math.cos(C[i].a1);
    const ey = C[i].cy + r * Math.sin(C[i].a1);
    const next = C[(i + 1) % 4];
    const sx = next.cx + r * Math.cos(next.a0);
    const sy = next.cy + r * Math.sin(next.a0);
    emitStraight(ex, ey, sx, sy);
  }
  return { pts, corners };
}

const loop = cityLoop(360, 250, 40);

export const CIRCUIT: TrackDef = {
  id: "city",
  name: "Phố đô thị",
  controlPoints: loop.pts,
  junctions: loop.corners,
};

export const DEFAULT_TRACK = CIRCUIT;

const boulevard = cityLoop(520, 330, 65);
const ring: [number, number][] = Array.from({ length: 180 }, (_, i) => {
  const angle = i * Math.PI * 2 / 180;
  return [650 * Math.cos(angle), 380 * Math.sin(angle)];
});
const motorway=cityLoop(1050,650,220),national=cityLoop(710,430,110),twoWay=cityLoop(410,270,60),small=cityLoop(240,170,32);
export const TRACKS: TrackDef[] = [CIRCUIT,
  { id: "boulevard", name: "Đại lộ ngoại ô", controlPoints: boulevard.pts, junctions: boulevard.corners },
  { id: "ring-road", name: "Đường vành đai", controlPoints: ring, junctions: [] },
  {id:'motorway',name:'Cao tốc · 3 làn mỗi chiều',controlPoints:motorway.pts,junctions:[],road:{lanes:3,opposing:3,laneWidth:3.75,speedKph:100,environment:'rural',motorway:true,median:2,emergencyShoulder:3.5,traffic:48,description:'Lưu thông bên phải, ba làn mỗi chiều và làn dừng khẩn cấp ngoài cùng rộng 3,5 m. Hai chiều tách dải phân cách; giao thông nền không dùng làn khẩn cấp, không có xe máy, đèn đỏ hay người đi bộ.'}},
  {id:'national',name:'Quốc lộ · 2 làn mỗi chiều',controlPoints:national.pts,junctions:[],road:{lanes:2,opposing:2,laneWidth:3.5,speedKph:70,environment:'suburban',traffic:42,description:'Xe tải, xe buýt, ô tô và xe máy; làn đối diện có xe ngược chiều, vạch vàng phân chia hai hướng.'}},
  {id:'two-way',name:'Đường hai chiều · 1 làn mỗi chiều',controlPoints:twoWay.pts,junctions:[],road:{lanes:1,opposing:1,laneWidth:3.5,speedKph:50,environment:'suburban',traffic:32,description:'Một làn mỗi chiều, xe đi bên phải. AI và chuyển làn hỗ trợ không vượt sang phần đường ngược chiều.'}},
  {id:'neighborhood',name:'Đường nhỏ khu dân cư',controlPoints:small.pts,junctions:[],road:{lanes:1,opposing:1,laneWidth:3.2,speedKph:30,environment:'urban',traffic:28,description:'Đường hẹp hai chiều, giới hạn 30 km/h; giao thông nền chủ yếu xe máy và ô tô, không sinh xe tải lớn hay xe buýt.'}},
];
export function getTrack(id?: string): TrackDef { return TRACKS.find(track => track.id === id) ?? DEFAULT_TRACK; }
