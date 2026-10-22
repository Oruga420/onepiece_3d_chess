# Five measured rig repairs

This package preserves the selected Alvida, Ace, Penguin, Queen and Van Augur
recipes without changing the default generator or published models. Reference
hashes identify the candidates delivered to central QA; they are not an approval
record. No models were regenerated while preparing this package.

## Files and differences from the current generator

- `recipes.json`: complete fit snapshots, source/reference hashes and scoped prop
  fingerprints. It contains all measured surface points; no `.local` fit or
  contact JSON is needed to replay them.
- `skin.py`: frozen solver used by these five recipes. The normal generator's
  `geodesic_skin.py` remains untouched.
- `rebuild.py`: a linear, offline replay: validate inputs, read originals from
  Git, rig in a new staging folder, restore original surfaces, write evidence.

| Recipe | Scoped difference | Existing behavior preserved |
| --- | --- | --- |
| `buggy/queen` — Alvida | Measured raised-arm elbow depth, sleeve/skin component markers and `upper_arm.R` boundary queries | Mace bindings and motion amplitudes |
| `whitebeard/rook` — Ace | Geodesic skinning on the original body | All fitted joints, props and amplitudes |
| `heart/knight` — Penguin | Measured `lower_leg` hem queries, including explicit source-component ownership when the bone midpoint is nearest the boot | All four frozen whole-hand/whole-boot bindings |
| `kaido/rook` — Queen | Organic-arm surface anchors and per-model `geodesicPower: 2` | All joint fits, fist bindings and amplitudes |
| `blackbeard/bishop` — Van Augur | Measured wrists and sleeve component markers; forearm cuff-ring queries | Rifle bindings and motion amplitudes |

Compared with the current default geodesic solver, the frozen solver also keeps
arm queries on their source component, excludes distal arm surfaces from torso
seed selection, and distinguishes ownership markers (`componentSeeds`) from
explicit surface query sets (`geodesicSeeds`). Measured query sets may establish
a leg component even when the midpoint heuristic selects an adjacent boot.
The weight exponent defaults to 5; only Queen requests 2. This is skin-weight
blending, not a reduction of animation angles. The solver is scoped to these
five complete-limbed characters, not a replacement for other character profiles.

## Reproducibility boundary

All five original GLBs were verified against Git objects at commit
`ad0d35d21a98694fe8247b4047d2170814162339`. The runner reads those objects directly
and verifies their SHA-256; it does not read current published GLBs or fetch from
the network. A checkout must retain that commit's history. A shallow checkout
without those objects needs its history restored before running.

The runner requires the canonical generator, `rig_components.py`,
`hand_contact.py`, `restore_rig_surface.py` and `prop_bindings.json` from this
revision. Their fingerprints are validated before replay. The recipes do not
require an ignored/private cache. Per-character prop fingerprints prevent
silently replaying changed weapon or attachment recipes. Review-image paths in
fit metadata are annotations, not generator inputs.

The existing Blender **5.1.1**, Python and Git installations are required. No
dependencies are installed and no provider API is called. Generator fingerprints
and the frozen solver fingerprint are recorded in `recipes.json`; if they drift,
review the change and refresh the pins deliberately. Export bytes can vary with
toolchain changes. Text fingerprints normalize CRLF to LF for Git checkouts.
`run.json` reports whether rebuilt bytes match each reference;
it never treats a matching hash as visual approval.

## Execution order

Run these commands from the repository root. The first command is read-only and
does not start Blender:

```powershell
python tools/assets/repair-recipes/rebuild.py --check
```

To replay into a **new** local staging directory, using the existing Blender:

```powershell
& "$env:ProgramFiles/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup --threads 4 --python-exit-code 1 --python tools/assets/repair-recipes/rebuild.py -- --out .local/repair-replay-01
```

Append `--ids blackbeard/bishop` after `--out ...` to replay one character, or
provide a comma-separated subset. An existing output directory is refused.
Inputs are staged under `input/`, raw rigs under `raw/`, restored rigs under
`candidates/`, and matching metadata under `reviews/`. The script never changes
`assets/models`, its manifest, prior candidate banks, or any deployment.

Each restored GLB has a sibling `.restore.json`. The canonical restoration
helper checks source textures, verbatim UV/index preservation, strict source
surface and direct skin-shader normal parity, double-precision inverse binds,
and deformed-vertex parity at tolerance `1e-5`.

Then run the actual rig subset tests:

```powershell
$env:RIG_ASSET_ROOT='.local/repair-replay-01/candidates'
$env:RIG_ASSET_IDS='buggy/queen,whitebeard/rook,heart/knight,kaido/rook,blackbeard/bishop'
node --test tests/rig-assets.test.mjs
```

The rig test's optional legacy source comparison uses
`.local/rigging/originals`; a fresh replay does not populate that shared cache.
The replay's strict restoration reports always compare against the original Git
sources, independently of that optional test path.

Finally, use the project's central browser review against the staged candidate
directory and the current runtime, including measured worst-stress poses. No
browser verification or regeneration was run as part of packaging. The earlier
private contact/visual evidence is not bundled here, and fresh visual approval
must not be inferred from this package. Normal adoption and production gates
remain separate.
