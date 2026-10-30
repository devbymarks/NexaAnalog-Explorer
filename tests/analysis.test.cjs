const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../analysis.js');

function plane(rows=5, cols=5, cell=10, ax=2, ay=3) {
  const values = new Float64Array(rows*cols);
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) values[r*cols+c]=ax*c*cell+ay*r*cell;
  return {rows,cols,values,cellX:cell,cellY:cell,format:'test'};
}

test('parses ESRI ASCII header and masks declared NoData',()=>{
  const grid=A.parseAsciiGrid('ncols 3\nnrows 3\nxllcorner 0\nyllcorner 0\ncellsize 5\nNODATA_value -32768\n1 2 3\n4 -32768 6\n7 8 9\n');
  assert.equal(grid.rows,3);assert.equal(grid.cols,3);assert.equal(grid.cellX,5);
  assert.ok(Number.isNaN(grid.values[4]));assert.equal(grid.values[8],9);
});

test('rejects malformed and non-rectangular grids',()=>{
  assert.throws(()=>A.parseAsciiGrid('ncols 3\nnrows 2\ncellsize 1\n1 2 3\n4 5 6\n'),/ncols e nrows/);
  assert.throws(()=>A.parseCsvGrid('1,2,3\n4,5\n6,7,8'),/Linha 2/);
});

test('Horn slope matches the analytic slope of a plane',()=>{
  const result=A.computeTerrain(plane(),10);
  const expected=Math.atan(Math.hypot(2,3))*180/Math.PI;
  assert.ok(Math.abs(result.slope.mean-expected)<1e-10);
});

test('detrended local roughness is zero on a plane',()=>{
  const result=A.computeTerrain(plane(),10);
  assert.ok(result.roughness.mean<1e-10);
});

test('detrended local roughness detects a known bowl in meters',()=>{
  const rows=3,cols=3,values=new Float64Array(rows*cols);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)values[r*cols+c]=(r-1)**2+(c-1)**2;
  const result=A.computeTerrain({rows,cols,values},10);
  assert.ok(Math.abs(result.roughness.mean-2/3)<1e-10);
});

test('identical non-flat surfaces have zero distribution distances',()=>{
  const g=plane(8,8,10,1,2),m=A.computeTerrain(g,10),d=A.compare(m,m);
  assert.equal(d.slopeW1,0);assert.equal(d.roughnessW1,0);
});

test('changing the declared weights changes the exploratory distance',()=>{
  const d={slopeNormalized:.2,roughnessNormalized:.8};
  assert.equal(A.scoreDistance(d,.5),.5);
  assert.ok(A.scoreDistance(d,.9)<A.scoreDistance(d,.1));
});

test('does not rank when a reference IQR is zero',()=>{
  assert.equal(A.scoreDistance({slopeNormalized:null,roughnessNormalized:.2},.5),null);
});

test('synthetic demo is deterministic and labels a closest formula candidate',()=>{
  const d=A.syntheticExample(),ref=A.computeTerrain(d.reference,500);
  const distances=d.candidates.map(g=>A.compare(ref,A.computeTerrain(g,500)));
  const scores=distances.map(x=>A.scoreDistance(x,.5));
  assert.ok(scores.every(Number.isFinite));
  assert.equal(scores.indexOf(Math.min(...scores)),0);
});

test('comparison input gate accepts aligned data and rejects dimension/resolution mismatches',()=>{
  const grid=plane(4,4,500),base={source:'Product v1',resolution:500,grid};
  assert.equal(A.validateRecords([{...base,name:'ref'},{...base,name:'one'},{...base,name:'two'}],500),true);
  assert.throws(()=>A.validateRecords([{...base,name:'ref'},{...base,name:'one',grid:plane(5,4,500)},{...base,name:'two'}],500),/mesmo número de linhas/);
  assert.throws(()=>A.validateRecords([{...base,name:'ref'},{...base,name:'one',resolution:450},{...base,name:'two'}],500),/difere da resolução/);
});

function parseCsvLine(line){
  const out=[];let value='',quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(quoted&&ch==='"'&&line[i+1]==='"'){value+='"';i++;continue;}
    if(ch==='"'){quoted=!quoted;continue;}
    if(ch===','&&!quoted){out.push(value);value='';continue;}
    value+=ch;
  }
  out.push(value);return out;
}

test('CSV export preserves provenance, parameters and equal column counts',()=>{
  const d=A.syntheticExample(),refMetrics=A.computeTerrain(d.reference,500);
  const records=[{name:'Ref',source:'Dataset "v1", source',resolution:500,grid:d.reference,reference:true},...d.candidates.map((grid,i)=>({name:`Candidate ${i+1}`,source:'Synthetic formula',resolution:500,grid,reference:false}))];
  const series=records.map(record=>({record,metrics:A.computeTerrain(record.grid,500)}));
  for(let i=1;i<series.length;i++)series[i].distance=A.compare(refMetrics,series[i].metrics);
  const csv=A.buildCsv(series,500,.35,'2026-10-29T00:00:00.000Z').split('\r\n').map(parseCsvLine);
  assert.equal(csv.length,5);
  assert.ok(csv.every(row=>row.length===csv[0].length));
  assert.equal(csv[1][0],'reference');assert.equal(csv[1][2],'Dataset "v1", source');
  assert.equal(csv[1][26],'0.35');assert.equal(csv[1][29],'500');
});

test('all static app selectors have matching HTML ids and local assets exist',()=>{
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const ids=new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
  const referenced=new Set([...app.matchAll(/\$\(['"]#([\w-]+)['"]\)/g)].map(m=>m[1]));
  const missing=[...referenced].filter(id=>!ids.has(id));
  assert.deepEqual(missing,[]);
  for(const asset of ['styles.css','analysis.js','app.js'])assert.ok(fs.existsSync(path.join(root,asset)),`missing ${asset}`);
});

test('rejects a grid too small for a 3x3 neighborhood',()=>{
  const g={rows:2,cols:3,values:new Float64Array([1,2,3,4,5,6])};
  assert.throws(()=>A.computeTerrain(g,10),/janelas 3×3/);
});

