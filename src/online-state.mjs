import { DEVIL_FRUITS, fromSquare } from './rules.mjs';

const TYPES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
const PLAYERS = ['pirate', 'marine'];
const FRUITS = DEVIL_FRUITS.map(fruit => fruit.id);
const POSITION_KEYS = ['board', 'turn', 'castling', 'enPassant', 'halfmove', 'fullmove', 'claimedDraw', 'availableDevilFruits', 'fruitPly'];
const RECORD_KEYS = ['piece', 'captured', 'from', 'to', 'promotion', 'enPassant', 'castle', 'kind', 'fruit', 'fruitName', 'transformed'];
const fail = detail => { throw new Error(`Invalid online state: ${detail}`); };
const check = (condition, detail) => { if (!condition) fail(detail); };

function object(value, keys, label) {
 check(value !== null && typeof value === 'object' && !Array.isArray(value), label);
 check([Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} prototype`);
 check(Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key)), `${label} fields`);
 check(Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => 'value' in descriptor), `${label} accessors`);
}
function integer(value, label) {
 check(Number.isSafeInteger(value) && value >= 0, label);
 return value;
}
function string(value, label, max = 1024) {
 check(typeof value === 'string' && value.length > 0 && value.length <= max, label);
 return value;
}
function piece(value) {
 object(value, ['type', 'player', 'id'], 'piece');
 check(TYPES.includes(value.type) && PLAYERS.includes(value.player), 'piece type/player');
 return { type: value.type, player: value.player, id: string(value.id, 'piece id', 256) };
}
function position(value) {
 object(value, POSITION_KEYS, 'position');
 check(Array.isArray(value.board) && value.board.length === 8, 'board');
 const board = Array.from(value.board, row => {
  check(Array.isArray(row) && row.length === 8, 'board row');
  return Array.from(row, item => item === null ? null : piece(item));
 });
 const pieces = board.flat().filter(Boolean);
 check(new Set(pieces.map(item => item.id)).size === pieces.length, 'duplicate piece id');
 for (const player of PLAYERS) check(pieces.filter(item => item.player === player && item.type === 'king').length === 1, 'one king per player');
 check(PLAYERS.includes(value.turn), 'turn');
 check(typeof value.castling === 'string' && /^K?Q?k?q?$/.test(value.castling), 'castling');
 check(value.enPassant === null || !!fromSquare(value.enPassant), 'en passant');
 check(value.claimedDraw === null || ['threefold-repetition', 'fifty-move'].includes(value.claimedDraw), 'claimed draw');
 check(Array.isArray(value.availableDevilFruits) && value.availableDevilFruits.every(fruit => FRUITS.includes(fruit)) && new Set(value.availableDevilFruits).size === value.availableDevilFruits.length, 'devil fruits');
 return {
  board, turn: value.turn, castling: value.castling, enPassant: value.enPassant,
  halfmove: integer(value.halfmove, 'halfmove'), fullmove: integer(value.fullmove, 'fullmove'),
  claimedDraw: value.claimedDraw, availableDevilFruits: Array.from(value.availableDevilFruits),
  fruitPly: integer(value.fruitPly, 'fruit ply'),
 };
}
function record(value) {
 object(value, RECORD_KEYS, 'history record');
 check(!!fromSquare(value.from) && !!fromSquare(value.to), 'history squares');
 const result = { piece: piece(value.piece), captured: value.captured === null ? null : piece(value.captured), from: value.from, to: value.to };
 if ('promotion' in value) { check(['queen', 'rook', 'bishop', 'knight'].includes(value.promotion), 'promotion'); result.promotion = value.promotion; }
 if ('enPassant' in value) { check(value.enPassant === true, 'history en passant'); result.enPassant = true; }
 if ('castle' in value) { check(['king', 'queen'].includes(value.castle), 'history castle'); result.castle = value.castle; }
 if ('kind' in value) {
  check(value.kind === 'devil_fruit' && value.from === value.to && FRUITS.includes(value.fruit), 'history devil fruit');
  result.kind = value.kind;
  result.fruit = value.fruit;
  result.fruitName = string(value.fruitName, 'fruit name', 128);
  result.transformed = piece(value.transformed);
 } else check(!['fruit', 'fruitName', 'transformed'].some(key => key in value), 'history fruit fields');
 return result;
}

/** Validate untrusted JSON and return fresh, allowlisted objects before touching a game. */
export function validateOnlineState(state) {
 object(state, ['position', 'history', 'repetitions', 'version'], 'state');
 const cleanPosition = position(state.position);
 check(Array.isArray(state.history), 'history');
 const history = Array.from(state.history, record);
 check(Array.isArray(state.repetitions), 'repetitions');
 const repetitions = Array.from(state.repetitions, entry => {
  check(Array.isArray(entry) && entry.length === 2, 'repetition entry');
  return [string(entry[0], 'repetition key'), integer(entry[1], 'repetition count')];
 });
 check(new Set(repetitions.map(entry => entry[0])).size === repetitions.length, 'duplicate repetition key');
 return { position: cleanPosition, history, repetitions, version: integer(state.version, 'version') };
}

/** Full chess state, including variant power-ups and draw counters. No undo snapshots. */
export function packGame(game) {
 const history = game.history.map(({ before: _before, ...entry }) => entry);
 return validateOnlineState({ position: game._snapshot(), history, repetitions: [...game.repetitions], version: game.version });
}

/** Restore in place for existing UI references. Online controllers must disable undo. */
export function restoreGame(game, state) {
 const clean = validateOnlineState(state);
 game._restore(clean.position);
 game.history = clean.history;
 game.repetitions = new Map(clean.repetitions);
 game.version = clean.version;
 return game;
}
