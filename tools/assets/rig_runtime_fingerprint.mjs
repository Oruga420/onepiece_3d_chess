import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Attack definitions select the actual choreography, so changing only a
// character's family/variant must invalidate its previous visual approval.
export const rigRuntimeFiles=Object.freeze([
 'src/skeletal-combat.mjs','src/combat.mjs','src/renderer.mjs',
 'src/attack-effects.mjs','src/attacks.mjs',
]);
export function rigRuntimeHash(root){
 const hashes=rigRuntimeFiles.map(file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'));
 return createHash('sha256').update(hashes.join(':')).digest('hex');
}
