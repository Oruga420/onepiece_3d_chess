# Articulated character combat

The current release enables reviewed rigs for Luffy, Zoro and Sanji. The other
63 slots retain their existing models while their candidate rigs undergo visual
repair. This is a partial articulated-roster release, not acceptance of all 66 rigs.

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

Review rest, guard, contact and recovery from the front and side before adopting
a candidate. Normalized weights alone do not prove quality: inspect stretched
cloth, displaced shoes, weapon attachment and joint collapse. Preserve raw paid
Meshy outputs in `tools/assets/raw/`.

`node tools/assets/adopt_rigs.mjs crew/role` validates a staged candidate without
changing published assets. Add `--apply` only after reviewing it. The script
checks source/candidate hashes, embedded texture bytes, triangle counts and skin
attributes before updating the asset and manifest. `--all` selects all 66 slots.

## Verification

`tests/skeletal-combat.test.mjs` exercises actual skinned vertex movement,
instance isolation, cleanup, anatomy limits and restoration.
`tests/rig-assets.test.mjs` checks all published skeletons and normalized weights.
Set `RIG_REQUIRE_ALL=1` to enforce the outstanding full 66-character acceptance
gate; `RIG_ASSET_ROOT=.local/rigging/candidates` checks the entire staged roster.
`tests/skeletal-effects.test.mjs` checks effects and drawn weapons against moving
joints. `scripts/verify-skeletal-combat.mjs` verifies authenticated browser
captures with effects hidden for articulation evidence. Existing chess, fruit,
online, voice and audio tests remain required.
Use `--pilot-release` for the current three-character release, without asset
substitution; `--staged-pilots` is restricted to localhost and is not deployment proof.

No animation changes the authoritative chess position. The game commits a legal
move once; the renderer only presents that result.
