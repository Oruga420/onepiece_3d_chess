# Clickables inventory

Evidence: original index.html and script.js, manually completed from actual handlers. Generated inventory missed canvas, keyboard, dynamic fruit and message controls. Game changes require authenticated player access and proposal/confirmation. Audio, selection and camera changes execute immediately.

| File:line | Control | Handler | Kind | Role gate | Grouped tool | Reason |
|---|---|---|---|---|---|---|
| index.html:76 | Retry | location.reload | skip | browser user |  | Browser reload requires user control |
| index.html:120 | Music | toggleMusic | view | authenticated player | set_audio |  |
| index.html:121 | Music volume | musicEl.volume | view | authenticated player | set_audio |  |
| index.html:122 | Sound effects | toggleSoundEffects | view | authenticated player | set_audio |  |
| index.html:127 | mugiwara | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:128 | buggy | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:129 | shanks | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:130 | bigmom | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:131 | kaido | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:132 | doflamingo | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:133 | heart | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:134 | kid | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:135 | blackbeard | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:136 | whitebeard | selectCrew | consequential | authenticated player | propose_settings |  |
| index.html:184 | New game | resetGame | consequential | authenticated player | propose_game_action |  |
| index.html:185 | Undo move | undoMove | consequential | authenticated player | propose_game_action |  |
| index.html:186 | Change crew | showCrewSelection | view | authenticated player | open_crew_selection |  |
| index.html:187 | Reset camera | resetCamera | view | authenticated player | set_camera |  |
| index.html:188 | Fix board | performComprehensiveOverlapCheck | skip | browser user |  | Remove repair control after state invariant fix |
| index.html:189 | AI toggle | aiEnabled | consequential | authenticated player | propose_settings |  |
| index.html:190 | AI difficulty | aiDifficulty | consequential | authenticated player | propose_settings |  |
| index.html:219 | Victory new game | resetGame | consequential | authenticated player | propose_game_action |  |
| index.html:220 | Victory change crew | showCrewSelection | view | authenticated player | open_crew_selection |  |
| script.js:2644 | Reload page | location.reload | skip | browser user |  | Browser reload requires user control |
| script.js:647 | Board selection and movement | handleSquareClick | view / consequential | authenticated player | select_piece / propose_move | Canvas raycast surface missed by generator |
| script.js:651 | Board hover | mousemove | skip | authenticated player |  | Decorative pointer feedback |
| script.js:656 | Keyboard camera controls | keydown | skip | authenticated player |  | Replace unbounded movement with bounded camera presets |
| script.js:663 | Dismiss message | messageElement click | view | authenticated player | dismiss_message |  |
| script.js:2285 | Available devil fruit | useDevilFruit | skip | authenticated player |  | Remove nonstandard chess power-up controls from classic chess |
| script.js:1012 | Select piece and highlight legal squares | selectPiece / showPossibleMoves | view | authenticated player | select_piece | Authoritative legal engine required |

## Proposed consolidated registry

| Tool | Kind | Schema actions |
|---|---|---|
| get_board | read | No parameters; returns turn, squares, characters, check/result |
| select_piece | view | piece alias or origin square; returns actual legal destinations |
| propose_move | consequential | origin or unambiguous character alias, destination A1-H8, optional promotion queen/rook/bishop/knight |
| propose_game_action | consequential | action new_game/undo |
| propose_settings | consequential | action crew/ai_enabled/ai_difficulty; validated value |
| open_crew_selection | view | No parameters |
| set_camera | view | preset board/overhead/player; bounded only |
| set_audio | view | channel music/effects, optional enabled and volume 0-1 |
| dismiss_message | view | No parameters |
| confirm_action | control | confirmation words and current proposal ID |
| stop_action | control | No parameters; cancel pending proposal/countdown |

Proposed count: 11 tools (9 domain, 2 control). If final UI removes or adds actions, update this table and registry count assertion together. Grouping is by distinct operation; duplicate HTML buttons do not create duplicate tools.

## Spanish chess vocabulary and ambiguity

Accept rey/king, reina/dama/queen, torre/rook, alfil/bishop, caballo/knight, peon/peón/pawn, character names and case-insensitive A1-H8 IDs. Normalize accents and whitespace. Current Straw Hat mapping: Luffy king, Zoro queen, Nami rook, Sanji bishop, Usopp knight, Chopper pawn. Marine mapping: Sengoku king, Akainu queen, Garp rook, Smoker bishop, Tashigi knight, Marine pawn. Other crews derive aliases from pirateCrews rather than a second hardcoded list.

Never select arbitrarily when two active pieces match a name/type: return candidate origin IDs and ask which, e.g. Sanji C1 or F1. An explicit origin resolves ambiguity. Selecting reina only illuminates legal destinations; it does not move. A move to D7 must use the current legal engine and be revalidated immediately before execution. Character names King and Queen in Beast Pirates conflict with English piece names: origin square or explicit character prefix must disambiguate.

## Durable token quota

Token grants must share a durable rate limit across Vercel instances, keyed by authenticated session. Home .env and readily available personal config inventory revealed no KV_REST_API_URL, KV_REST_API_TOKEN, UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN names. No company configuration was inspected. Use a REST Redis atomic increment with expiry (transaction or Lua), default 20 grants/10 minutes/session, and fail closed with 503 when storage is unconfigured/unavailable. A process-local Map is not sufficient proof. Vercel project-specific existing environment names still need inspection by deploy owner.
