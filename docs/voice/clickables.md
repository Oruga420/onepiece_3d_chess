# Voice and WebMCP controls — current implementation

Reviewed against index.html, src/app.mjs, src/commands.mjs, src/rules.mjs, src/voice.mjs and src/voice-registry.mjs on 2026-10-14. Replaces the original script.js inventory. Personal infrastructure only.

| UI / command | Implementation | Tool | Kind / access |
|---|---|---|---|
| Board state, fruit stock, eligible pawns | commands.runTool get_board | get_board | read / authenticated |
| Select character or square; illuminate destinations | commands.select | select_piece | view / current player |
| Move / capture / last-rank promotion | commands.move | propose_move | consequential / current player |
| Four fruit buttons; transform own pawn | app.useFruit → commands.runTool → game.useDevilFruit or server rooms.action | propose_fruit | consequential / current player, own pawn, available stock |
| New game, undo, claim draw | commands.execute | propose_game_action | consequential / local game; online permits claim draw |
| Crew / AI enabled / difficulty | commands.execute | propose_settings | consequential / local game |
| Crew selector | onOpenCrew | open_crew_selection | view |
| Three bounded camera views | onCamera | set_camera | view |
| Music / effects | onAudio | set_audio | view |
| Close voice panel | onDismiss | dismiss_message | view |
| Confirm external proposal | commands.confirm | confirm_action | control / WebMCP and text |
| Stop / cancel | commands.stop / voice.stop | stop_action | control |

Registry: 12 WebMCP tools; 11 immediate voice tools (confirm_action omitted). Voice and mouse orders execute immediately; no confirmation or countdown. External WebMCP and typed consequential requests retain the existing proposal contract. All writes share the command controller; online actions await authoritative server acknowledgement. Spectators and the wrong seat cannot change the game.

## Fruits

- gomu-gomu: Gomu Gomu no Mi → queen (reina).
- mera-mera: Mera Mera no Mi → knight (caballo).
- ope-ope: Ope Ope no Mi → rook (torre).
- gora-gora: Gora Gora no Mi → bishop (alfil).

propose_fruit requires an explicit square and fruit ID. get_board returns available stock, mapping and eligible own pawns; never invent a square when multiple pawns match. The same rules reject exhausted fruit, non-pawns, enemy pieces, game-over state and transformations that leave one's king in check. A fruit giving check passes the turn to the defender and evaluates mate; otherwise the transformation is free. An available fruit refills on the established move schedule. Neither fruit use nor promotion captures a king.

Examples: “Dale Gomu Gomu al peón de E2”, “Que Chopper de E2 coma Mera Mera”, “Convierte el peón de E2 en reina”.

## Separate controls

Microphone permission, login/password and invitation sharing require the browser/user. Online room create/join/leave/resign and free camera gestures remain UI controls, not newly claimed voice capabilities in this change. Current voice quotas, private provider agent, 300-second call limit, daily 20 calls, concurrency one and server-side secrets remain enforced.
