import test from 'node:test';
import assert from 'node:assert/strict';
import {CREWS, MARINES} from '../src/roster.mjs';
import {ATTACK_FAMILIES, CHARACTER_ATTACKS, getCharacterAttack} from '../src/attacks.mjs';

const roles = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

test('all 66 visible character slots have an explicit matching immutable attack', () => {
 const expected = [];
 for (const [crew, roster] of Object.entries({...CREWS, marines: MARINES})) {
  for (const role of roles) {
   const id = `${crew}/${role}`, profile = getCharacterAttack(crew, role);
   expected.push(id);
   assert.ok(profile, id);
   assert.equal(profile.id, id);
   assert.equal(profile.character, roster[role].name);
   assert.ok(Object.isFrozen(profile));
   assert.ok(profile.label.length > 5);
   assert.ok(['brawl', 'vault', 'slash', 'charge'].includes(profile.style));
   assert.match(profile.variant, /^[a-z][a-z-]+$/);
   assert.match(profile.color, /^#[0-9a-f]{6}$/i);
   assert.match(profile.accent, /^#[0-9a-f]{6}$/i);
   assert.ok(profile.power >= .8 && profile.power <= 1.5);
  }
 }
 assert.equal(expected.length, 66);
 assert.deepEqual(Object.keys(CHARACTER_ATTACKS).sort(), expected.sort());
 assert.ok(Object.isFrozen(CHARACTER_ATTACKS));
});

test('every attack sound maps to exactly the supported 16 shared families', () => {
 const expected = ['rubber', 'sword', 'lightning', 'fire', 'projectile', 'beast', 'blunt', 'candy', 'dragon', 'string', 'stone', 'room', 'metal', 'darkness', 'quake', 'smoke'];
 assert.deepEqual(ATTACK_FAMILIES, expected);
 assert.ok(Object.isFrozen(ATTACK_FAMILIES));
 for (const profile of Object.values(CHARACTER_ATTACKS)) {
  assert.ok(ATTACK_FAMILIES.includes(profile.family), profile.id);
  assert.equal(profile.sound, profile.family);
 }
 assert.deepEqual([...new Set(Object.values(CHARACTER_ATTACKS).map(p => p.family))].sort(), [...expected].sort());
});

test('Straw Hat identities have distinct abilities independent of chess movement', () => {
 assert.deepEqual(roles.map(role => getCharacterAttack('mugiwara', role).family),
  ['rubber', 'sword', 'lightning', 'fire', 'projectile', 'beast']);
 assert.equal(getCharacterAttack('mugiwara', 'queen').variant, 'triple');
 assert.equal(getCharacterAttack('mugiwara', 'bishop').variant, 'kick');
 assert.equal(getCharacterAttack('mugiwara', 'knight').style, 'brawl');
 assert.equal(getCharacterAttack('mugiwara', 'pawn').variant, 'horn');
});

test('signature power families and elemental variants do not collapse to role defaults', () => {
 for (const [crew, role, family] of [
  ['heart', 'king', 'room'], ['kid', 'king', 'metal'], ['kaido', 'king', 'dragon'],
  ['doflamingo', 'king', 'string'], ['blackbeard', 'king', 'darkness'], ['whitebeard', 'king', 'quake'],
  ['bigmom', 'knight', 'candy'], ['marines', 'bishop', 'smoke'],
 ]) assert.equal(getCharacterAttack(crew, role).family, family);
 const marco = getCharacterAttack('whitebeard', 'queen'), ace = getCharacterAttack('whitebeard', 'rook');
 const akainu = getCharacterAttack('marines', 'queen');
 assert.equal(marco.variant, 'phoenix'); assert.equal(ace.variant, 'flame'); assert.equal(akainu.variant, 'magma');
 assert.equal(marco.family, 'fire'); assert.equal(ace.family, 'fire'); assert.equal(akainu.family, 'fire');
 assert.equal(new Set([marco.color, ace.color, akainu.color]).size, 3);
 assert.equal(getCharacterAttack('bigmom', 'queen').variant, 'mochi');
 assert.equal(getCharacterAttack('doflamingo', 'rook').variant, 'sticky');
});

test('marine side overrides selected pirate crew and transformed role resolves new character', () => {
 for (const crew of Object.keys(CREWS)) {
  for (const role of roles) assert.equal(getCharacterAttack(crew, role, 'marine'), CHARACTER_ATTACKS[`marines/${role}`]);
 }
 assert.equal(getCharacterAttack('mugiwara', 'pawn').character, 'Chopper');
 assert.equal(getCharacterAttack('mugiwara', 'queen').character, 'Zoro');
 assert.equal(getCharacterAttack('heart', 'queen', 'marine').character, 'Akainu');
});

test('invalid identity never silently invents another character attack', () => {
 for (const args of [['missing', 'king'], ['mugiwara', 'missing'], ['mugiwara', 'king', 'spectator'], [undefined, undefined], ['__proto__', 'king']]) {
  assert.equal(getCharacterAttack(...args), null);
 }
});
