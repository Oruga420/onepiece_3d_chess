// Visual attack descriptors only: never affect chess legality, damage or turns.
// Family is a reusable rendering/audio palette, not a Devil Fruit classification.
export const ATTACK_FAMILIES = Object.freeze([
 'rubber', 'sword', 'lightning', 'fire', 'projectile', 'beast', 'blunt', 'candy',
 'dragon', 'string', 'stone', 'room', 'metal', 'darkness', 'quake', 'smoke',
]);

const palettes = {
 rubber: ['#e74a38', '#ffd2a2'], sword: ['#a5ffc9', '#efffff'],
 lightning: ['#ffd52b', '#b9e9ff'], fire: ['#ff681e', '#ffe58c'],
 projectile: ['#ffd28a', '#fff4ce'], beast: ['#e6b064', '#fff0bd'],
 blunt: ['#d6b286', '#fff4d9'], candy: ['#f67ad6', '#b0f5ff'],
 dragon: ['#1fbcf0', '#ffae39'], string: ['#f4a2e5', '#ffffff'],
 stone: ['#ad95c9', '#d9d6e7'], room: ['#42d7ed', '#e8ffff'],
 metal: ['#92b7cd', '#ef654c'], darkness: ['#6b28b9', '#b779f7'],
 quake: ['#bde9ff', '#ffffff'], smoke: ['#b6c8ce', '#f4ffff'],
};
const attack = (id, character, label, family, style, variant, power = 1, color, accent) => Object.freeze({
 id, character, label, family, color: color ?? palettes[family][0], accent: accent ?? palettes[family][1],
 style, variant, power, sound: family,
});

// Explicit slots retain identity even where a crew member has no named canon move.
export const CHARACTER_ATTACKS = Object.freeze({
 'mugiwara/king': attack('mugiwara/king', 'Luffy', 'Puño elástico', 'rubber', 'brawl', 'elastic-punch', 1.35),
 'mugiwara/queen': attack('mugiwara/queen', 'Zoro', 'Corte de tres espadas', 'sword', 'slash', 'triple', 1.3),
 'mugiwara/rook': attack('mugiwara/rook', 'Nami', 'Tormenta del Clima-Tact', 'lightning', 'charge', 'thunder', 1.15),
 'mugiwara/bishop': attack('mugiwara/bishop', 'Sanji', 'Patada en llamas', 'fire', 'vault', 'kick', 1.2),
 'mugiwara/knight': attack('mugiwara/knight', 'Usopp', 'Disparo de tirachinas', 'projectile', 'brawl', 'slingshot', .95, '#93cf48', '#fff5b0'),
 'mugiwara/pawn': attack('mugiwara/pawn', 'Chopper', 'Embestida de cuernos', 'beast', 'charge', 'horn', .95),

 'buggy/king': attack('buggy/king', 'Buggy', 'Cuchillas de Buggy', 'sword', 'slash', 'daggers', 1, '#ff94a8'),
 'buggy/queen': attack('buggy/queen', 'Alvida', 'Golpe de maza', 'blunt', 'charge', 'club', 1.1),
 'buggy/rook': attack('buggy/rook', 'Mohji', 'Latigazo del domador', 'blunt', 'slash', 'whip', .9),
 'buggy/bishop': attack('buggy/bishop', 'Cabaji', 'Corte acrobático', 'sword', 'vault', 'acrobat', .95),
 'buggy/knight': attack('buggy/knight', 'Richie', 'Zarpazo del león', 'beast', 'vault', 'lion', 1.05),
 'buggy/pawn': attack('buggy/pawn', 'Crew', 'Abordaje de Buggy', 'blunt', 'brawl', 'brawl', .8, '#fa7f9f'),

 'shanks/king': attack('shanks/king', 'Shanks', 'Tajo del pelirrojo', 'sword', 'slash', 'haki', 1.4, '#e43d5c', '#ffdddf'),
 'shanks/queen': attack('shanks/queen', 'Beckman', 'Disparo de Beckman', 'projectile', 'brawl', 'rifle', 1.15),
 'shanks/rook': attack('shanks/rook', 'Yasopp', 'Disparo del francotirador', 'projectile', 'brawl', 'rifle', 1.1, '#f3b65a'),
 'shanks/bishop': attack('shanks/bishop', 'Lucky Roux', 'Carga de Lucky Roux', 'blunt', 'charge', 'cannonball', 1.15),
 'shanks/knight': attack('shanks/knight', 'Rockstar', 'Tajo de Rockstar', 'sword', 'slash', 'cutlass', 1),
 'shanks/pawn': attack('shanks/pawn', 'Crew', 'Abordaje del pelirrojo', 'sword', 'slash', 'cutlass', .8, '#dd7386'),

 'bigmom/king': attack('bigmom/king', 'Big Mom', 'Furia de los homies', 'lightning', 'charge', 'homies', 1.5, '#ffb534', '#ff86b9'),
 'bigmom/queen': attack('bigmom/queen', 'Katakuri', 'Puño de mochi', 'rubber', 'brawl', 'mochi', 1.3, '#f2dfd1', '#b25684'),
 'bigmom/rook': attack('bigmom/rook', 'Cracker', 'Espada del soldado galleta', 'sword', 'charge', 'biscuit', 1.1, '#d5a263', '#fff0bd'),
 'bigmom/bishop': attack('bigmom/bishop', 'Smoothie', 'Tajo de Smoothie', 'sword', 'slash', 'longblade', 1.15, '#dc95f2'),
 'bigmom/knight': attack('bigmom/knight', 'Perospero', 'Prisión de caramelo', 'candy', 'charge', 'prison', 1.2),
 'bigmom/pawn': attack('bigmom/pawn', 'Crew', 'Abordaje de Totto Land', 'sword', 'slash', 'cutlass', .8, '#ffa8d9'),

 'kaido/king': attack('kaido/king', 'Kaido', 'Aliento del dragón', 'dragon', 'charge', 'breath', 1.5),
 'kaido/queen': attack('kaido/queen', 'King', 'Picado de fuego', 'fire', 'vault', 'pteranodon', 1.3, '#ff842b', '#e8c3ff'),
 'kaido/rook': attack('kaido/rook', 'Queen', 'Ráfaga cibernética', 'metal', 'charge', 'laser', 1.25, '#f4d93e', '#e9ffff'),
 'kaido/bishop': attack('kaido/bishop', 'Jack', 'Carga del mamut', 'beast', 'charge', 'mammoth', 1.35),
 'kaido/knight': attack('kaido/knight', 'Whos Who', 'Zarpazo de dientes de sable', 'beast', 'vault', 'saber', 1.2, '#eaa777'),
 'kaido/pawn': attack('kaido/pawn', 'Crew', 'Asalto de las Bestias', 'blunt', 'brawl', 'brawl', .85, '#b083bc'),

 'doflamingo/king': attack('doflamingo/king', 'Doflamingo', 'Jaula de hilos', 'string', 'slash', 'cage', 1.35),
 'doflamingo/queen': attack('doflamingo/queen', 'Vergo', 'Golpe de bambú', 'blunt', 'charge', 'staff', 1.15, '#7d8b99'),
 'doflamingo/rook': attack('doflamingo/rook', 'Trebol', 'Lazos pegajosos', 'string', 'charge', 'sticky', 1, '#a4bd37', '#e5ef82'),
 'doflamingo/bishop': attack('doflamingo/bishop', 'Diamante', 'Espada ondulante', 'sword', 'slash', 'ribbon', 1.15, '#e86474'),
 'doflamingo/knight': attack('doflamingo/knight', 'Pica', 'Puño de piedra', 'stone', 'charge', 'giant', 1.35),
 'doflamingo/pawn': attack('doflamingo/pawn', 'Crew', 'Asalto Donquixote', 'blunt', 'brawl', 'brawl', .8, '#e591ca'),

 'heart/king': attack('heart/king', 'Law', 'ROOM: corte espacial', 'room', 'slash', 'cut', 1.35),
 'heart/queen': attack('heart/queen', 'Bepo', 'Golpe del oso', 'beast', 'vault', 'bear', 1.05, '#edf4fa', '#e6b06a'),
 'heart/rook': attack('heart/rook', 'Jean Bart', 'Carga de Jean Bart', 'blunt', 'charge', 'shoulder', 1.2),
 'heart/bishop': attack('heart/bishop', 'Shachi', 'Golpe de Shachi', 'blunt', 'brawl', 'brawl', .95, '#eaa46b'),
 'heart/knight': attack('heart/knight', 'Penguin', 'Golpe de Penguin', 'blunt', 'brawl', 'brawl', .95, '#f2c666'),
 'heart/pawn': attack('heart/pawn', 'Crew', 'Abordaje de los Heart', 'blunt', 'brawl', 'brawl', .8, '#edcc72'),

 'kid/king': attack('kid/king', 'Kid', 'Puño magnético', 'metal', 'charge', 'magnet', 1.4),
 'kid/queen': attack('kid/queen', 'Killer', 'Cuchillas gemelas', 'sword', 'slash', 'dual', 1.2, '#7cdbef'),
 'kid/rook': attack('kid/rook', 'Heat', 'Aliento de fuego', 'fire', 'charge', 'flame', 1.05),
 'kid/bishop': attack('kid/bishop', 'Wire', 'Golpe de bastón', 'blunt', 'slash', 'staff', 1),
 'kid/knight': attack('kid/knight', 'Shark', 'Golpe de Shark', 'blunt', 'brawl', 'brawl', .95, '#ce9595'),
 'kid/pawn': attack('kid/pawn', 'Crew', 'Abordaje de Kid', 'blunt', 'brawl', 'brawl', .85, '#d57d64'),

 'blackbeard/king': attack('blackbeard/king', 'Blackbeard', 'Vórtice de oscuridad', 'darkness', 'charge', 'vortex', 1.5),
 'blackbeard/queen': attack('blackbeard/queen', 'Burgess', 'Carga del luchador', 'blunt', 'charge', 'shoulder', 1.35),
 'blackbeard/rook': attack('blackbeard/rook', 'Shiryu', 'Tajo furtivo', 'sword', 'slash', 'stealth', 1.25, '#a664db'),
 'blackbeard/bishop': attack('blackbeard/bishop', 'Van Augur', 'Disparo de Van Augur', 'projectile', 'brawl', 'rifle', 1.2, '#d69ee8'),
 'blackbeard/knight': attack('blackbeard/knight', 'Laffitte', 'Golpe de bastón', 'blunt', 'slash', 'staff', 1, '#c0a0dc'),
 'blackbeard/pawn': attack('blackbeard/pawn', 'Crew', 'Abordaje de Barbanegra', 'sword', 'slash', 'cutlass', .85, '#9b73c2'),

 'whitebeard/king': attack('whitebeard/king', 'Whitebeard', 'Fractura sísmica', 'quake', 'charge', 'fracture', 1.5),
 'whitebeard/queen': attack('whitebeard/queen', 'Marco', 'Picado del fénix', 'fire', 'vault', 'phoenix', 1.25, '#24cbff', '#9cffe8'),
 'whitebeard/rook': attack('whitebeard/rook', 'Ace', 'Puño de fuego', 'fire', 'brawl', 'flame', 1.3),
 'whitebeard/bishop': attack('whitebeard/bishop', 'Jozu', 'Carga de diamante', 'stone', 'charge', 'diamond', 1.25, '#a9e8ff', '#ffffff'),
 'whitebeard/knight': attack('whitebeard/knight', 'Vista', 'Corte de espadas gemelas', 'sword', 'slash', 'dual', 1.15, '#ee8ca4'),
 'whitebeard/pawn': attack('whitebeard/pawn', 'Crew', 'Abordaje de Barbablanca', 'sword', 'slash', 'cutlass', .85, '#c5d7f4'),

 'marines/king': attack('marines/king', 'Sengoku', 'Onda dorada de Buda', 'blunt', 'charge', 'buddha', 1.45, '#ffd14b', '#fff6c1'),
 'marines/queen': attack('marines/queen', 'Akainu', 'Puño de magma', 'fire', 'brawl', 'magma', 1.45, '#e83e1b', '#ff9d21'),
 'marines/rook': attack('marines/rook', 'Garp', 'Puño de hierro', 'blunt', 'brawl', 'fist', 1.45, '#cadcf3', '#ffffff'),
 'marines/bishop': attack('marines/bishop', 'Smoker', 'Embestida de humo', 'smoke', 'charge', 'plume', 1.2),
 'marines/knight': attack('marines/knight', 'Tashigi', 'Corte de katana', 'sword', 'slash', 'katana', 1, '#9bceff'),
 'marines/pawn': attack('marines/pawn', 'Marine', 'Disparo de fusil', 'projectile', 'brawl', 'rifle', .85, '#bdcfed'),
});

export function getCharacterAttack(crew, role, side = 'pirate') {
 if (side !== 'pirate' && side !== 'marine') return null;
 const key = `${side === 'marine' ? 'marines' : crew}/${role}`;
 return Object.hasOwn(CHARACTER_ATTACKS, key) ? CHARACTER_ATTACKS[key] : null;
}
