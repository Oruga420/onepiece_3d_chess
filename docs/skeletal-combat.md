# Articulated character combat

This revision enables reviewed, weighted skeletons for all 66 characters: the
60 pirate roles and six Marine roles. Every character has independent visual
approval tied to its GLB bytes and the animation runtime.

The renderer supports actual glTF skins. Each board piece owns its skeleton and
bone texture while sharing immutable mesh geometry, materials and image textures
with the character cache. A pawn moving its elbow must not move another pawn.

`src/skeletal-combat.mjs` retargets shoulder, elbow, hip and knee directions from
the character's original pose. Punches, cuts, kicks, casting, gun/slingshot poses
and quadruped attacks use the same capture timeline as the audio. Defender joints
brace, counter and recoil. All joint transforms are restored on completion,
cancellation and reset. Reduced motion skips the choreography.

Rig metadata is stored as `combatRig` on the exported armature: `motionProfile`,
`limbLimits`, `maxJointAngles` and `missingLimbs` describe anatomical exceptions.
Additional limb chains animate Cracker's extra arms and legs. A fitted weapon
joint brings Kaido's club from its source rest pose into his palm. Beckman's
pocket contact uses two-bone IK to retain the hand's position and orientation
while the other arm and legs continue their attack.
Do not remove these limits to make a cloaked character move more dramatically:
first inspect its deformed mesh. Zoro's original hip scabbards remain attached to
his costume; the attack draws rigid blades attached to his moving hands. Sanji's
flame emitter follows his animated foot.

## Offline asset workflow

`tools/assets/rig_characters.py` stages Blender armatures and weights. It uses
explicit character fits from `tools/assets/rig_fits.json` and preserves source
textures and triangles. Run Blender in a separate background process, not in an
artist's open scene. This workflow calls no generation provider.

Staging lives under ignored `.local/rigging/`:

- `originals/`: immutable optimized rest-pose models, before skinning.
- `candidates/`: weighted glTF candidates.
- `reviews/`: posed images and metrics tied to candidate hashes.
- `qa/`: distortion diagnostics and browser evidence.

Review rest, guard, attack, defense and the measured worst-stress pose from
the front and side before adopting a candidate. Normalized weights alone do not prove quality: inspect stretched
cloth, displaced shoes, weapon attachment and joint collapse. Preserve raw paid
Meshy outputs in `tools/assets/raw/`.

`node tools/assets/adopt_rigs.mjs crew/role` validates a staged candidate without
changing published assets. Add `--apply` only after reviewing it. The script
checks source/candidate hashes, embedded texture bytes, triangle counts and skin
attributes before updating the asset and manifest. `--all` selects all 66 slots.
Every `--apply` requires a current visual score of at least 90, including when
the model bytes are already published. Changes to choreography invalidate the
approval: the shared fingerprint includes `src/attacks.mjs` as well as the
skeletal, combat, renderer and attack-effects modules.

Surface restoration retains the original triangles, UVs, normals and embedded
textures; weighted bind matrices are checked against actual skin transforms.
Whole-component prop recipes and measured anatomical ownership prevent a hand
from dragging nearby trousers, belts or capes. Do not replace a reviewed model
with a new generic solver result without repeating visual acceptance. Pica's
source-specific coincident UV corners must retain their face-specific hand
weights after surface restoration.

`transfer_visual_approval.py` can carry an existing independent judgment to a
new runtime only when the candidate bytes and all ten decoded PNG images are
exactly identical. It preserves the original judgment and records a separate
equivalence proof. Any changed or missing image requires a fresh visual review.
The five scoped replay recipes in `tools/assets/repair-recipes/` recover their
originals from Git; their read-only preflight is separate from visual approval.

## Verification

`tests/skeletal-combat.test.mjs` exercises actual skinned vertex movement,
instance isolation, cleanup, anatomy limits and restoration.
`tests/rig-assets.test.mjs` checks all published skeletons and normalized weights.
Set `RIG_REQUIRE_ALL=1` to enforce the full 66-character acceptance
gate; `RIG_ASSET_ROOT=.local/rigging/candidates` checks the entire staged roster.
`tests/skeletal-effects.test.mjs` checks effects and drawn weapons against moving
joints. `scripts/verify-skeletal-combat.mjs` verifies authenticated browser
captures with effects hidden for articulation evidence. Existing chess, fruit,
online, voice and audio tests remain required.
Use `--all-characters` for release verification. It exercises all 66 legal
capture fixtures, independent pawn skeletons in all eleven factions, cancellation
and reduced motion, and records the actual served model hashes and build ID.
Pilot-only and staged substitution modes cannot satisfy the full-roster gate.

No animation changes the authoritative chess position. The game commits a legal
move once; the renderer only presents that result.

The [roster acceptance report](reports/skeletal-roster-release.json) records all
66 model hashes, visual scores, original-surface checks and full local gameplay
evidence. [The in-game example](reports/skeletal-combat-example.png) hides effects
to make the articulated limbs visible. Production verification remains a
separate check of the actual deployment revision and served asset bytes.
