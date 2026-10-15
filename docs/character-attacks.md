# Character attack plan

1. Preserve the existing 66 crew/role slots. Add a frozen, explicit visual attack registry; promoted pieces resolve their current visible role.
2. Use 16 shared effect/sound families, with character-specific labels, variants, palettes and visual strength. Strength never changes chess rules.
3. Ground signature abilities in official ONE PIECE character descriptions. Generic crew and uncertain minor characters use ordinary melee/weapon effects; never invent canon technique names.
4. Verify all roster slots, valid families, immutable profiles, marine routing and role changes. This registry does not generate sound or charge providers.

Implementation and source references follow below.

## Registry contract

`CHARACTER_ATTACKS` is a flat frozen record keyed by `crew/role`. Every profile is frozen and contains `id`, `character`, Spanish `label`, `family`, hexadecimal `color` and `accent`, `style`, `variant`, `power`, and `sound`. `power` is only a visual amplitude multiplier. All sounds refer to one of the 16 shared family IDs.

`getCharacterAttack(crew, role, side = 'pirate')` selects `marines/role` for the marine side and otherwise uses the requested crew. Unknown roles, crews and sides return `null`; callers may choose an ordinary fallback for test fixtures. Call with the piece's current role after fruit transformations or promotion, matching the renderer's current character.

The Spanish labels are descriptive labels for this game's presentation, not claims that every label is an official named technique. Generic crew use ordinary boarding attacks. Shark, Shachi and Penguin retain ordinary strikes rather than invented supernatural powers. Physical attacks for minor characters intentionally share a family. This does not claim 66 bespoke skeletal clips.

Families are rendering/audio reuse categories, not canon fruit categories: Katakuri's mochi uses the elastic family with a mochi variant; Trebol's slime uses green sticky strands; Jozu uses diamond shards within the stone family; Queen's cyborg laser uses the metal family. These variants must remain visually distinguishable. Marco's blue phoenix flames, Ace's orange fire, Sanji's flaming kick and Akainu's dense red magma use distinct fire variants.

## Official reference evidence

Reviewed October 15, 2026. Each link is the official publisher's character guide or anime synopsis; descriptions below are short paraphrases. Effects are game interpretations of these abilities, not reproductions of anime footage or audio.

- [Luffy](https://one-piece.com/character/luffy/index.html): elastic body and punches.
- [Zoro](https://one-piece.com/character/zoro/index.html): three swords.
- [Nami](https://one-piece.com/character/nami/index.html): weather staff and lightning.
- [Sanji](https://one-piece.com/character/sanji/index.html): kicks with flaming feet.
- [Law](https://one-piece.com/news/o20201006_11603/index.html): ROOM and spatial manipulation.
- [Kaido](https://one-piece.com/character/Kaido/index.html): azure dragon transformation.
- [Marco](https://one-piece.com/character/marco/index.html): phoenix and regenerative flames.
- [Ace](https://one-piece.com/character/ace/index.html): fire manipulation.
- [Akainu](https://one-piece.com/character/Sakazuki/index.html): magma, distinct from Ace's flames.
- [Smoker](https://one-piece.com/character/smoker/index.html): smoke body.
- [Doflamingo](https://one-piece.com/character/doflamingo/index.html): string power.
- [Kid](https://one-piece.com/character/kid/index.html): magnetic fruit.
- [Katakuri](https://one-piece.com/character/Charlotte_Katakuri/index.html): mochi fruit; [official figure description](https://one-piece.com/figure/o4945/index.html) also describes a rotating arm strike.
- [Perospero](https://one-piece.com/character/perospero/index.html): candy constructions.
- [Pica](https://one-piece.com/character/Pica/index.html): assimilates rock.
- [Trebol](https://one-piece.com/character/trebol/index.html): sticky mucus strands and projectiles.
- [Diamante](https://one-piece.com/character/diamante/index.html): fluttering material.
- [Blackbeard](https://one-piece.com/character/Marshall_D_Teech/index.html): darkness and quake powers; this profile emphasizes darkness.
- [Whitebeard](https://one-piece.com/character/edward_newgate/index.html): quake fruit. Its crew roster also identifies Jozu's diamond fruit.
- [Shiryu](https://one-piece.com/character/Shiryu/index.html): invisibility, used as a stealth slash accent.
- [Jack](https://one-piece.com/character/Jack/index.html): mammoth; same official crew roster confirms King's pteranodon form.
- [Who's Who](https://one-piece.com/character/whos_who/index.html): saber-toothed cat.

- [Usopp](https://one-piece.com/character/usopp/): slingshot marksman.
- [Chopper](https://one-piece.com/character/chopper/index.html): reindeer forms and physical transformations.
- [Heat](https://one-piece.com/character/Heat/index.html): breathes fire.

## Slot mapping

| Slot | Character | Attack | Family / variant | Motion |
|---|---|---|---|---|
| mugiwara/king | Luffy | Puño elástico | rubber/elastic-punch | brawl |
| mugiwara/queen | Zoro | Corte de tres espadas | sword/triple | slash |
| mugiwara/rook | Nami | Tormenta del Clima-Tact | lightning/thunder | charge |
| mugiwara/bishop | Sanji | Patada en llamas | fire/kick | vault |
| mugiwara/knight | Usopp | Disparo de tirachinas | projectile/slingshot | brawl |
| mugiwara/pawn | Chopper | Embestida de cuernos | beast/horn | charge |
| buggy/king | Buggy | Cuchillas de Buggy | sword/daggers | slash |
| buggy/queen | Alvida | Golpe de maza | blunt/club | charge |
| buggy/rook | Mohji | Latigazo del domador | blunt/whip | slash |
| buggy/bishop | Cabaji | Corte acrobático | sword/acrobat | vault |
| buggy/knight | Richie | Zarpazo del león | beast/lion | vault |
| buggy/pawn | Crew | Abordaje de Buggy | blunt/brawl | brawl |
| shanks/king | Shanks | Tajo del pelirrojo | sword/haki | slash |
| shanks/queen | Beckman | Disparo de Beckman | projectile/rifle | brawl |
| shanks/rook | Yasopp | Disparo del francotirador | projectile/rifle | brawl |
| shanks/bishop | Lucky Roux | Carga de Lucky Roux | blunt/cannonball | charge |
| shanks/knight | Rockstar | Tajo de Rockstar | sword/cutlass | slash |
| shanks/pawn | Crew | Abordaje del pelirrojo | sword/cutlass | slash |
| bigmom/king | Big Mom | Furia de los homies | lightning/homies | charge |
| bigmom/queen | Katakuri | Puño de mochi | rubber/mochi | brawl |
| bigmom/rook | Cracker | Espada del soldado galleta | sword/biscuit | charge |
| bigmom/bishop | Smoothie | Tajo de Smoothie | sword/longblade | slash |
| bigmom/knight | Perospero | Prisión de caramelo | candy/prison | charge |
| bigmom/pawn | Crew | Abordaje de Totto Land | sword/cutlass | slash |
| kaido/king | Kaido | Aliento del dragón | dragon/breath | charge |
| kaido/queen | King | Picado de fuego | fire/pteranodon | vault |
| kaido/rook | Queen | Ráfaga cibernética | metal/laser | charge |
| kaido/bishop | Jack | Carga del mamut | beast/mammoth | charge |
| kaido/knight | Whos Who | Zarpazo de dientes de sable | beast/saber | vault |
| kaido/pawn | Crew | Asalto de las Bestias | blunt/brawl | brawl |
| doflamingo/king | Doflamingo | Jaula de hilos | string/cage | slash |
| doflamingo/queen | Vergo | Golpe de bambú | blunt/staff | charge |
| doflamingo/rook | Trebol | Lazos pegajosos | string/sticky | charge |
| doflamingo/bishop | Diamante | Espada ondulante | sword/ribbon | slash |
| doflamingo/knight | Pica | Puño de piedra | stone/giant | charge |
| doflamingo/pawn | Crew | Asalto Donquixote | blunt/brawl | brawl |
| heart/king | Law | ROOM: corte espacial | room/cut | slash |
| heart/queen | Bepo | Golpe del oso | beast/bear | vault |
| heart/rook | Jean Bart | Carga de Jean Bart | blunt/shoulder | charge |
| heart/bishop | Shachi | Golpe de Shachi | blunt/brawl | brawl |
| heart/knight | Penguin | Golpe de Penguin | blunt/brawl | brawl |
| heart/pawn | Crew | Abordaje de los Heart | blunt/brawl | brawl |
| kid/king | Kid | Puño magnético | metal/magnet | charge |
| kid/queen | Killer | Cuchillas gemelas | sword/dual | slash |
| kid/rook | Heat | Aliento de fuego | fire/flame | charge |
| kid/bishop | Wire | Golpe de bastón | blunt/staff | slash |
| kid/knight | Shark | Golpe de Shark | blunt/brawl | brawl |
| kid/pawn | Crew | Abordaje de Kid | blunt/brawl | brawl |
| blackbeard/king | Blackbeard | Vórtice de oscuridad | darkness/vortex | charge |
| blackbeard/queen | Burgess | Carga del luchador | blunt/shoulder | charge |
| blackbeard/rook | Shiryu | Tajo furtivo | sword/stealth | slash |
| blackbeard/bishop | Van Augur | Disparo de Van Augur | projectile/rifle | brawl |
| blackbeard/knight | Laffitte | Golpe de bastón | blunt/staff | slash |
| blackbeard/pawn | Crew | Abordaje de Barbanegra | sword/cutlass | slash |
| whitebeard/king | Whitebeard | Fractura sísmica | quake/fracture | charge |
| whitebeard/queen | Marco | Picado del fénix | fire/phoenix | vault |
| whitebeard/rook | Ace | Puño de fuego | fire/flame | brawl |
| whitebeard/bishop | Jozu | Carga de diamante | stone/diamond | charge |
| whitebeard/knight | Vista | Corte de espadas gemelas | sword/dual | slash |
| whitebeard/pawn | Crew | Abordaje de Barbablanca | sword/cutlass | slash |
| marines/king | Sengoku | Onda dorada de Buda | blunt/buddha | charge |
| marines/queen | Akainu | Puño de magma | fire/magma | brawl |
| marines/rook | Garp | Puño de hierro | blunt/fist | brawl |
| marines/bishop | Smoker | Embestida de humo | smoke/plume | charge |
| marines/knight | Tashigi | Corte de katana | sword/katana | slash |
| marines/pawn | Marine | Disparo de fusil | projectile/rifle | brawl |

