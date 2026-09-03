// Placeholder art until real Aseprite exports replace resources/sprites/<mascot>.{png,json}.
// Run with: node scripts/make-placeholder-sprites.mjs
//
// Each mascot in scripts/lib/mascots/ is a table of frame specs, a palette and a few drawing
// functions; scripts/lib/sheet.mjs turns that into the sheet, the Aseprite JSON, the tray icons
// and the settings icon that resources/sprites and resources/icons expect. The JSON follows the
// Aseprite "hash" export, plus a `meta.wisp` extension: `meta.wisp.bob.offsetX[i]` and
// `offsetY[i]` say how far frame i moves the eyes away from their idle position, so the renderer
// can place the expression overlay on the eyes of a frame that bobs, walks or hops. Real art
// either fills it in by hand or leaves it out (zero offsets).
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { MASCOTS } from './lib/mascots/index.mjs';
import { writeMascotFiles } from './lib/sheet.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const mascot of MASCOTS) writeMascotFiles(mascot, root);

const ids = MASCOTS.map((m) => m.id).join(', ');
stdout.write(`wrote resources/sprites/<id>.{png,json} and resources/icons/<id>/*.png for ${ids}\n`);
