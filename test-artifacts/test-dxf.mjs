import * as acad from '../node_modules/.pnpm/@node-projects+acad-ts@3.2.0/node_modules/@node-projects/acad-ts/dist/index.js';
const doc = new acad.CadDocument();
const chunks = [];
const writer = new acad.DxfWriter({ write: s => chunks.push(s) }, doc, false);
writer.configuration.writeOptionalValues = true;
writer.configuration.writeAllHeaderVariables = false;
console.log('Testing addHeaderVariable:');
for (const v of ['$TILEMODE', '$EXTMIN', '$EXTMAX', '$LIMMIN', '$LIMMAX', '$SPLINETYPE']) {
  try {
    writer.configuration.addHeaderVariable(v);
    console.log('Success:', v);
  } catch(e) {
    console.log('Error for', v, ':', e.message);
  }
}
try {
  writer.write();
  console.log('writer.write succeeded! Chunks length:', chunks.length);
} catch(e) {
  console.log('writer.write failed:', e.message);
}
