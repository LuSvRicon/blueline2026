export const VEHICLE_MODELS = [
  {id:"vf9",name:"VinFast VF 9",file:"vf9.glb",author:"Giang Trần",license:"CC BY 4.0",source:"https://sketchfab.com/3d-models/vinfast-vf9-model-no-interior-cac6cb95b9084d0abee37dccb46fa10b"},
  {id:"santafe",name:"Hyundai Santa Fe 2023",file:"santafe.glb",author:"dannzjs",license:"CC BY 4.0",source:"https://sketchfab.com/3d-models/huyndai-santafe-2023-728a76b5184e47b3bdbf3849b561dcef"},
  {id:"everest",name:"Ford Everest Sport 2023",file:"everest.glb",author:"Asadawut.Kaewma",license:"CC BY 4.0",source:"https://sketchfab.com/3d-models/ford-everest-sport-2023-c37bec0353a94f90a3acbe09ceb3aecf"},
  {id:"civic",name:"Honda Civic Type R 2023",file:"civic.glb",author:"Ddiaz Design",license:"CC BY-NC-SA 4.0 · phi thương mại",source:"https://sketchfab.com/3d-models/2023-honda-civic-type-r-8c9484184a2b4254aafd67418b8c18db"},
] as const;
export type VehicleModelId = typeof VEHICLE_MODELS[number]["id"];
let selected:VehicleModelId="vf9";
try {const saved=localStorage.getItem("blueline-vehicle-model");if(VEHICLE_MODELS.some(model=>model.id===saved))selected=saved as VehicleModelId;}catch{/* Storage is optional. */}
let status="Đang tải mô hình xe…";
export const selectedVehicleModel=()=>selected;
export const vehicleModelStatus=()=>status;
export function selectVehicleModel(id:string):void {if(!VEHICLE_MODELS.some(model=>model.id===id))return;selected=id as VehicleModelId;status="Đang tải mô hình xe…";try{localStorage.setItem("blueline-vehicle-model",selected);}catch{/* Storage is optional. */}}
export function setVehicleModelStatus(value:string):void {status=value;}
