import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const assets={ola:'ola_electric_scooter_black_color',motorcycle:'low-poly_motorcycle__2',hanoi:'low_poly_hanoi_vietnamese_tube_houses_block',roads_pbr:'modular_road_pack_free__4k_textures',roads_city:'modular_city_road_pack__game_ready',roads_modular:'modular_roads_pack',tata:'tata_signa_cargo_truck__low_poly_game_ready_pbr',bus:'city_bus'};
fs.mkdirSync('public/models/world',{recursive:true});
const credits=[];
const cache=path.join(process.env.LOCALAPPDATA,'npm-cache','_npx');
const cli=fs.readdirSync(cache).map(dir=>path.join(cache,dir,'node_modules/@gltf-transform/cli/bin/cli.js')).find(file=>fs.existsSync(file));
if(!cli)throw new Error('Install @gltf-transform/cli@4.5.1 with npx first');
for(const [id,name]of Object.entries(assets)){
 const input=path.join(process.env.USERPROFILE,'Downloads',name+'.glb'),output=`public/models/world/${id}.glb`;
 const data=fs.readFileSync(input),json=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)));
 if(!fs.existsSync(output)){
  const result=spawnSync(process.execPath,[cli,'optimize',input,output,'--flatten','false','--join','false','--palette','false','--instance','false','--compress','meshopt','--texture-compress','webp','--texture-size','1024','--simplify-error','0.0003','--simplify-ratio','0.65'],{stdio:'pipe',encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr||result.stdout);
 }
 credits.push({id,file:id+'.glb',...json.asset.extras,originalBytes:data.length,bytes:fs.statSync(output).size,originalSHA256:crypto.createHash('sha256').update(data).digest('hex'),changes:'Textures resized to 1024/WebP, mesh simplified and meshopt compressed; runtime transforms/rigs described in project docs.'});
 console.log(id,data.length,'->',fs.statSync(output).size);
}
fs.writeFileSync('public/models/world/ATTRIBUTION.json',JSON.stringify(credits,null,2)+'\n');
