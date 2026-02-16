// Aurora Quest - A 2D Open World RPG
// Main Game Engine

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

// ============== GAME CONSTANTS ==============
const TILE_SIZE = 32;
const WORLD_SIZE = 256; // 256x256 tiles
const CHUNK_SIZE = 16;
const VIEW_TILES_X = Math.ceil(canvas.width / TILE_SIZE) + 2;
const VIEW_TILES_Y = Math.ceil(canvas.height / TILE_SIZE) + 2;

// ============== SEEDED RANDOM ==============
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }
    
    next() {
        this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
        return this.seed / 0x7fffffff;
    }
    
    range(min, max) {
        return min + this.next() * (max - min);
    }
    
    int(min, max) {
        return Math.floor(this.range(min, max + 1));
    }
}

// ============== PERLIN NOISE ==============
class PerlinNoise {
    constructor(seed) {
        this.seed = seed;
        this.permutation = [];
        const rng = new SeededRandom(seed);
        for (let i = 0; i < 256; i++) this.permutation[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = rng.int(0, i);
            [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
        }
        this.permutation = [...this.permutation, ...this.permutation];
    }
    
    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(a, b, t) { return a + t * (b - a); }
    grad(hash, x, y) {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
    }
    
    noise(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        const u = this.fade(x);
        const v = this.fade(y);
        const A = this.permutation[X] + Y;
        const B = this.permutation[X + 1] + Y;
        return this.lerp(
            this.lerp(this.grad(this.permutation[A], x, y), this.grad(this.permutation[B], x - 1, y), u),
            this.lerp(this.grad(this.permutation[A + 1], x, y - 1), this.grad(this.permutation[B + 1], x - 1, y - 1), u),
            v
        );
    }
    
    octave(x, y, octaves, persistence) {
        let total = 0, frequency = 1, amplitude = 1, maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            total += this.noise(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= 2;
        }
        return total / maxValue;
    }
}

// ============== WORLD GENERATION ==============
const terrainNoise = new PerlinNoise(12345);
const biomeNoise = new PerlinNoise(67890);
const detailNoise = new SeededRandom(11111);

const BIOMES = {
    PLAINS: { name: 'Plains', color: '#4a7c4e', treeChance: 0.02, enemyChance: 0.01 },
    FOREST: { name: 'Forest', color: '#2d5a3d', treeChance: 0.15, enemyChance: 0.03 },
    DESERT: { name: 'Desert', color: '#c9a857', treeChance: 0.005, enemyChance: 0.02 },
    SNOW: { name: 'Tundra', color: '#d4e5ed', treeChance: 0.03, enemyChance: 0.015 },
    SWAMP: { name: 'Swamp', color: '#3d4a3a', treeChance: 0.08, enemyChance: 0.04 },
    MOUNTAIN: { name: 'Mountain', color: '#6b6b7a', treeChance: 0.01, enemyChance: 0.02 },
    WATER: { name: 'Water', color: '#2a6a8a', treeChance: 0, enemyChance: 0 },
    DEEP_WATER: { name: 'Deep Water', color: '#1a4a6a', treeChance: 0, enemyChance: 0 }
};

function getBiome(x, y) {
    const elevation = terrainNoise.octave(x * 0.02, y * 0.02, 4, 0.5);
    const moisture = biomeNoise.octave(x * 0.015, y * 0.015, 4, 0.5);
    const temperature = biomeNoise.octave(x * 0.01 + 1000, y * 0.01 + 1000, 4, 0.5);
    
    if (elevation < -0.3) return BIOMES.DEEP_WATER;
    if (elevation < -0.1) return BIOMES.WATER;
    if (elevation > 0.6) return BIOMES.MOUNTAIN;
    if (temperature < -0.2) return BIOMES.SNOW;
    if (moisture < -0.2 && temperature > 0.2) return BIOMES.DESERT;
    if (moisture > 0.3 && elevation < 0.1) return BIOMES.SWAMP;
    if (moisture > 0 && elevation > 0.1) return BIOMES.FOREST;
    return BIOMES.PLAINS;
}

// ============== GAME STATE ==============
const gameState = {
    player: {
        x: WORLD_SIZE * TILE_SIZE / 2,
        y: WORLD_SIZE * TILE_SIZE / 2,
        vx: 0,
        vy: 0,
        speed: 150,
        health: 100,
        maxHealth: 100,
        stamina: 100,
        maxStamina: 100,
        level: 1,
        xp: 0,
        gold: 0,
        attack: 10,
        defense: 5,
        direction: 'down',
        animFrame: 0,
        attacking: false,
        attackCooldown: 0,
        equipment: { weapon: null, armor: null }
    },
    inventory: [],
    quests: [],
    activeQuest: null,
    time: 360, // 6:00 AM in minutes
    day: 1,
    discoveredAreas: new Set(),
    killedEnemies: 0,
    chestsOpened: 0
};

// ============== ENTITIES ==============
let entities = [];
let particles = [];
let projectiles = [];

class Entity {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.vx = 0;
        this.vy = 0;
        this.health = 100;
        this.maxHealth = 100;
        this.animFrame = 0;
        this.direction = 'down';
        this.aiTimer = 0;
        this.active = true;
    }
}

class Enemy extends Entity {
    constructor(x, y, enemyType) {
        super(x, y, 'enemy');
        this.enemyType = enemyType;
        const stats = ENEMY_TYPES[enemyType];
        this.health = stats.health;
        this.maxHealth = stats.health;
        this.attackDamage = stats.attack;
        this.speed = stats.speed;
        this.xpReward = stats.xp;
        this.goldReward = stats.gold;
        this.aggroRange = 200;
        this.attackRange = 40;
        this.attackCooldown = 0;
        this.color = stats.color;
    }
    
    update(dt) {
        if (!this.active) return;
        
        const dx = gameState.player.x - this.x;
        const dy = gameState.player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        this.attackCooldown = Math.max(0, this.attackCooldown - dt);
        
        if (dist < this.aggroRange && dist > this.attackRange) {
            const speed = this.speed;
            this.vx = (dx / dist) * speed;
            this.vy = (dy / dist) * speed;
        } else if (dist <= this.attackRange && this.attackCooldown <= 0) {
            this.attack();
        } else {
            this.aiTimer -= dt;
            if (this.aiTimer <= 0) {
                this.aiTimer = 2 + Math.random() * 3;
                const angle = Math.random() * Math.PI * 2;
                this.vx = Math.cos(angle) * this.speed * 0.3;
                this.vy = Math.sin(angle) * this.speed * 0.3;
            }
            this.vx *= 0.98;
            this.vy *= 0.98;
        }
        
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        
        // Update direction
        if (Math.abs(this.vx) > Math.abs(this.vy)) {
            this.direction = this.vx > 0 ? 'right' : 'left';
        } else if (this.vy !== 0) {
            this.direction = this.vy > 0 ? 'down' : 'up';
        }
        
        this.animFrame += dt * 8;
    }
    
    attack() {
        const damage = Math.max(1, this.attackDamage - gameState.player.defense);
        gameState.player.health -= damage;
        this.attackCooldown = 1;
        spawnParticles(gameState.player.x, gameState.player.y, '#ff0000', 5);
        updateUI();
    }
    
    takeDamage(amount) {
        this.health -= amount;
        spawnParticles(this.x, this.y, '#ffff00', 8);
        if (this.health <= 0) {
            this.die();
        }
    }
    
    die() {
        this.active = false;
        gameState.player.xp += this.xpReward;
        gameState.player.gold += this.goldReward;
        gameState.killedEnemies++;
        spawnParticles(this.x, this.y, '#ff00ff', 20);
        checkLevelUp();
        updateUI();
        checkQuestProgress();
    }
}

const ENEMY_TYPES = {
    slime: { health: 30, attack: 5, speed: 60, xp: 10, gold: 5, color: '#5cb85c' },
    goblin: { health: 50, attack: 10, speed: 80, xp: 25, gold: 15, color: '#8b4513' },
    skeleton: { health: 70, attack: 15, speed: 70, xp: 40, gold: 25, color: '#f5f5dc' },
    wolf: { health: 60, attack: 12, speed: 120, xp: 35, gold: 10, color: '#696969' },
    orc: { health: 100, attack: 20, speed: 60, xp: 60, gold: 40, color: '#556b2f' },
    demon: { health: 150, attack: 30, speed: 90, xp: 100, gold: 75, color: '#8b0000' },
    dragon: { health: 300, attack: 50, speed: 50, xp: 250, gold: 200, color: '#4a0080' }
};

class NPC extends Entity {
    constructor(x, y, npcData) {
        super(x, y, 'npc');
        this.name = npcData.name;
        this.dialog = npcData.dialog;
        this.quest = npcData.quest;
        this.shop = npcData.shop;
        this.color = npcData.color || '#ffd700';
        this.interacted = false;
    }
}

class Chest extends Entity {
    constructor(x, y, loot) {
        super(x, y, 'chest');
        this.loot = loot;
        this.opened = false;
    }
}

class Portal extends Entity {
    constructor(x, y, targetX, targetY, name) {
        super(x, y, 'portal');
        this.targetX = targetX;
        this.targetY = targetY;
        this.name = name;
        this.animFrame = 0;
    }
    
    update(dt) {
        this.animFrame += dt * 3;
    }
}

// ============== ITEMS ==============
const ITEMS = {
    // Weapons
    wooden_sword: { name: 'Wooden Sword', type: 'weapon', attack: 5, icon: '🗡️', rarity: 'common' },
    iron_sword: { name: 'Iron Sword', type: 'weapon', attack: 15, icon: '⚔️', rarity: 'uncommon' },
    steel_sword: { name: 'Steel Sword', type: 'weapon', attack: 30, icon: '🔪', rarity: 'rare' },
    flame_blade: { name: 'Flame Blade', type: 'weapon', attack: 50, icon: '🔥', rarity: 'epic' },
    dragon_slayer: { name: 'Dragon Slayer', type: 'weapon', attack: 100, icon: '🐉', rarity: 'legendary' },
    
    // Armor
    leather_armor: { name: 'Leather Armor', type: 'armor', defense: 5, icon: '🥋', rarity: 'common' },
    chainmail: { name: 'Chainmail', type: 'armor', defense: 15, icon: '⛓️', rarity: 'uncommon' },
    plate_armor: { name: 'Plate Armor', type: 'armor', defense: 30, icon: '🛡️', rarity: 'rare' },
    dragon_scale: { name: 'Dragon Scale', type: 'armor', defense: 60, icon: '🛡️', rarity: 'legendary' },
    
    // Consumables
    health_potion: { name: 'Health Potion', type: 'consumable', heal: 50, icon: '❤️', rarity: 'common' },
    greater_health_potion: { name: 'Greater Health Potion', type: 'consumable', heal: 100, icon: '💖', rarity: 'uncommon' },
    stamina_potion: { name: 'Stamina Potion', type: 'consumable', stamina: 50, icon: '💚', rarity: 'common' },
    
    // Misc
    gold_coin: { name: 'Gold Coin', type: 'gold', icon: '🪙', rarity: 'common' },
    key: { name: 'Mysterious Key', type: 'key', icon: '🗝️', rarity: 'rare' },
    gem: { name: 'Gem', type: 'misc', icon: '💎', rarity: 'rare' },
    ancient_artifact: { name: 'Ancient Artifact', type: 'misc', icon: '🏺', rarity: 'legendary' }
};

const RARITY_COLORS = {
    common: '#aaaaaa',
    uncommon: '#55ff55',
    rare: '#5555ff',
    epic: '#ff55ff',
    legendary: '#ffaa00'
};

// ============== QUESTS ==============
const QUESTS = {
    slimes: {
        title: 'Slime Slayer',
        description: 'Defeat 10 slimes',
        objectives: [{ type: 'kill', enemy: 'slime', count: 10, progress: 0 }],
        rewards: { xp: 100, gold: 50, item: 'iron_sword' }
    },
    explorer: {
        title: 'World Explorer',
        description: 'Discover 5 different biomes',
        objectives: [{ type: 'discover', count: 5, progress: 0 }],
        rewards: { xp: 200, gold: 100 }
    },
    treasure_hunter: {
        title: 'Treasure Hunter',
        description: 'Open 10 chests',
        objectives: [{ type: 'chest', count: 10, progress: 0 }],
        rewards: { xp: 150, gold: 75, item: 'key' }
    },
    dragon_slayer: {
        title: 'Dragon Slayer',
        description: 'Defeat the ancient dragon',
        objectives: [{ type: 'kill', enemy: 'dragon', count: 1, progress: 0 }],
        rewards: { xp: 500, gold: 500, item: 'dragon_slayer' }
    }
};

// ============== PARTICLES ==============
function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 200,
            vy: (Math.random() - 0.5) * 200,
            life: 0.5 + Math.random() * 0.5,
            color,
            size: 2 + Math.random() * 4
        });
    }
}

// ============== WORLD CACHING ==============
const worldCache = new Map();
const entityChunks = new Map();

function getTile(tileX, tileY) {
    if (tileX < 0 || tileX >= WORLD_SIZE || tileY < 0 || tileY >= WORLD_SIZE) {
        return { biome: BIOMES.WATER, tree: false, chest: false, portal: false };
    }
    
    const key = `${tileX},${tileY}`;
    if (worldCache.has(key)) return worldCache.get(key);
    
    const biome = getBiome(tileX, tileY);
    const rng = new SeededRandom(tileX * 10000 + tileY);
    
    const tile = {
        biome,
        tree: rng.next() < biome.treeChance,
        chest: rng.next() < 0.002,
        portal: rng.next() < 0.0005,
        decoration: rng.next() < 0.1 ? rng.int(0, 3) : -1
    };
    
    // Clear trees/water decorations in water
    if (biome === BIOMES.WATER || biome === BIOMES.DEEP_WATER) {
        tile.tree = false;
        tile.decoration = -1;
    }
    
    worldCache.set(key, tile);
    return tile;
}

function getChunkEntities(chunkX, chunkY) {
    const key = `${chunkX},${chunkY}`;
    if (entityChunks.has(key)) return entityChunks.get(key);
    
    const rng = new SeededRandom(chunkX * 100000 + chunkY + 99999);
    const chunkEntities = [];
    const biome = getBiome(chunkX * CHUNK_SIZE, chunkY * CHUNK_SIZE);
    
    // Spawn enemies based on biome
    if (rng.next() < biome.enemyChance * 5) {
        const enemyTypes = Object.keys(ENEMY_TYPES);
        // Weighted random - stronger enemies in certain areas
        let enemyType = 'slime';
        const roll = rng.next();
        if (roll > 0.95 && biome === BIOMES.MOUNTAIN) enemyType = 'dragon';
        else if (roll > 0.85) enemyType = 'demon';
        else if (roll > 0.70) enemyType = 'orc';
        else if (roll > 0.50) enemyType = 'skeleton';
        else if (roll > 0.30) enemyType = 'goblin';
        else if (roll > 0.15) enemyType = 'wolf';
        
        const x = (chunkX * CHUNK_SIZE + rng.int(0, CHUNK_SIZE)) * TILE_SIZE;
        const y = (chunkY * CHUNK_SIZE + rng.int(0, CHUNK_SIZE)) * TILE_SIZE;
        chunkEntities.push(new Enemy(x, y, enemyType));
    }
    
    // Spawn NPCs occasionally
    if (rng.next() < 0.001) {
        const npcs = [
            { name: 'Wandering Merchant', dialog: ['Greetings, traveler! Care to see my wares?', 'I have items from distant lands...'], shop: true, color: '#ffd700' },
            { name: 'Old Sage', dialog: ['The world holds many secrets...', 'Seek the ancient dragon if you dare...', 'It dwells in the mountains to the far north.'], quest: 'dragon_slayer', color: '#9370db' },
            { name: 'Village Elder', dialog: ['Welcome to these lands!', 'There are slimes causing trouble nearby...', 'Could you help us?'], quest: 'slimes', color: '#deb887' },
            { name: 'Explorer', dialog: ['I\'ve traveled these lands for years!', 'There are treasures hidden everywhere!', 'Keep exploring and you\'ll find them!'], quest: 'explorer', color: '#4682b4' }
        ];
        const npcData = npcs[rng.int(0, npcs.length - 1)];
        const x = (chunkX * CHUNK_SIZE + rng.int(0, CHUNK_SIZE)) * TILE_SIZE;
        const y = (chunkY * CHUNK_SIZE + rng.int(0, CHUNK_SIZE)) * TILE_SIZE;
        chunkEntities.push(new NPC(x, y, npcData));
    }
    
    // Spawn chests
    if (rng.next() < 0.01) {
        const lootTable = ['health_potion', 'gold_coin', 'iron_sword', 'gem', 'steel_sword'];
        const loot = [];
        const lootCount = rng.int(1, 3);
        for (let i = 0; i < lootCount; i++) {
            loot.push(lootTable[rng.int(0, lootTable.length - 1)]);
        }
        const x = (chunkX * CHUNK_SIZE + rng.int(0, CHUNK_SIZE)) * TILE_SIZE;
        const y = (chunkY * CHUNK_SIZE + rng.int(0, CHUNK_SIZE)) * TILE_SIZE;
        chunkEntities.push(new Chest(x, y, loot));
    }
    
    entityChunks.set(key, chunkEntities);
    return chunkEntities;
}

// ============== INPUT ==============
const keys = {};
let lastInteract = 0;

document.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') {
        e.preventDefault();
        interact();
    }
    if (e.key.toLowerCase() === 'e') {
        openChest();
    }
});

document.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
});

// ============== PLAYER UPDATE ==============
function updatePlayer(dt) {
    const p = gameState.player;
    
    // Stamina regen
    if (p.stamina < p.maxStamina) {
        p.stamina = Math.min(p.maxStamina, p.stamina + 20 * dt);
    }
    
    // Attack cooldown
    p.attackCooldown = Math.max(0, p.attackCooldown - dt);
    
    // Movement
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) { dy = -1; p.direction = 'up'; }
    if (keys['s'] || keys['arrowdown']) { dy = 1; p.direction = 'down'; }
    if (keys['a'] || keys['arrowleft']) { dx = -1; p.direction = 'left'; }
    if (keys['d'] || keys['arrowright']) { dx = 1; p.direction = 'right'; }
    
    // Sprint
    let speed = p.speed;
    if (keys['shift'] && p.stamina > 0 && (dx !== 0 || dy !== 0)) {
        speed *= 1.5;
        p.stamina -= 30 * dt;
    }
    
    if (dx !== 0 && dy !== 0) {
        dx *= 0.707;
        dy *= 0.707;
    }
    
    p.vx = dx * speed;
    p.vy = dy * speed;
    
    // Collision check
    const newX = p.x + p.vx * dt;
    const newY = p.y + p.vy * dt;
    
    const tileX = Math.floor(newX / TILE_SIZE);
    const tileY = Math.floor(newY / TILE_SIZE);
    const tile = getTile(tileX, tileY);
    
    if (tile.biome !== BIOMES.WATER && tile.biome !== BIOMES.DEEP_WATER && !tile.tree) {
        p.x = newX;
        p.y = newY;
    } else {
        // Slide along walls
        const oldTileX = Math.floor(p.x / TILE_SIZE);
        const oldTileY = Math.floor(p.y / TILE_SIZE);
        const tileCheckX = getTile(Math.floor(newX / TILE_SIZE), oldTileY);
        const tileCheckY = getTile(oldTileX, Math.floor(newY / TILE_SIZE));
        
        if (tileCheckX.biome !== BIOMES.WATER && tileCheckX.biome !== BIOMES.DEEP_WATER && !tileCheckX.tree) {
            p.x = newX;
        }
        if (tileCheckY.biome !== BIOMES.WATER && tileCheckY.biome !== BIOMES.DEEP_WATER && !tileCheckY.tree) {
            p.y = newY;
        }
    }
    
    // World bounds
    p.x = Math.max(TILE_SIZE, Math.min(WORLD_SIZE * TILE_SIZE - TILE_SIZE, p.x));
    p.y = Math.max(TILE_SIZE, Math.min(WORLD_SIZE * TILE_SIZE - TILE_SIZE, p.y));
    
    // Animation
    if (dx !== 0 || dy !== 0) {
        p.animFrame += dt * 10;
    }
    
    // Update time
    gameState.time += dt * 0.5; // 1 game hour = 2 real minutes
    if (gameState.time >= 1440) {
        gameState.time = 0;
        gameState.day++;
    }
    
    // Track discovered biomes
    const biomeName = tile.biome.name;
    if (!gameState.discoveredAreas.has(biomeName)) {
        gameState.discoveredAreas.add(biomeName);
        checkQuestProgress();
    }
    
    // Update UI
    updateUI();
}

// ============== INTERACTION ==============
function interact() {
    const p = gameState.player;
    const now = Date.now();
    
    if (p.attackCooldown > 0) return;
    
    // Check for nearby entities
    for (const entity of entities) {
        const dx = entity.x - p.x;
        const dy = entity.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (entity instanceof NPC && dist < 50) {
            showDialog(entity);
            return;
        }
    }
    
    // Attack
    p.attacking = true;
    p.attackCooldown = 0.4;
    setTimeout(() => p.attacking = false, 200);
    
    // Attack nearby enemies
    const attackRange = 50;
    const damage = p.attack + (p.equipment.weapon ? ITEMS[p.equipment.weapon].attack : 0);
    
    for (const entity of entities) {
        if (entity instanceof Enemy && entity.active) {
            const dx = entity.x - p.x;
            const dy = entity.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            // Direction-based attack
            let inRange = dist < attackRange;
            if (p.direction === 'up') inRange = inRange && dy < 0;
            if (p.direction === 'down') inRange = inRange && dy > 0;
            if (p.direction === 'left') inRange = inRange && dx < 0;
            if (p.direction === 'right') inRange = inRange && dx > 0;
            
            if (inRange) {
                entity.takeDamage(damage);
            }
        }
    }
}

function openChest() {
    const p = gameState.player;
    
    for (const entity of entities) {
        if (entity instanceof Chest && !entity.opened) {
            const dx = entity.x - p.x;
            const dy = entity.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < 50) {
                entity.opened = true;
                gameState.chestsOpened++;
                
                for (const itemId of entity.loot) {
                    if (itemId === 'gold_coin') {
                        const amount = 10 + Math.floor(Math.random() * 20);
                        gameState.player.gold += amount;
                    } else {
                        addToInventory(itemId);
                    }
                }
                
                spawnParticles(entity.x, entity.y, '#ffd700', 15);
                updateUI();
                checkQuestProgress();
                return;
            }
        }
    }
}

function showDialog(npc) {
    const dialogBox = document.getElementById('dialog-box');
    const dialogName = document.getElementById('dialog-name');
    const dialogText = document.getElementById('dialog-text');
    
    dialogName.textContent = npc.name;
    
    let dialogIndex = 0;
    const lines = npc.dialog;
    
    function showLine() {
        dialogText.textContent = lines[dialogIndex];
    }
    
    showLine();
    dialogBox.style.display = 'block';
    
    const handleClick = () => {
        dialogIndex++;
        if (dialogIndex < lines.length) {
            showLine();
        } else {
            dialogBox.style.display = 'none';
            document.removeEventListener('click', handleClick);
            
            // Offer quest
            if (npc.quest && !gameState.quests.includes(npc.quest)) {
                gameState.quests.push(npc.quest);
                gameState.activeQuest = QUESTS[npc.quest];
                updateQuestUI();
            }
        }
    };
    
    document.addEventListener('click', handleClick);
}

// ============== INVENTORY ==============
function addToInventory(itemId) {
    const existing = gameState.inventory.find(i => i.id === itemId);
    if (existing) {
        existing.count++;
    } else {
        gameState.inventory.push({ id: itemId, count: 1 });
    }
    updateInventoryUI();
}

function useItem(index) {
    const item = gameState.inventory[index];
    if (!item) return;
    
    const itemData = ITEMS[item.id];
    
    if (itemData.type === 'consumable') {
        if (itemData.heal) {
            gameState.player.health = Math.min(gameState.player.maxHealth, gameState.player.health + itemData.heal);
        }
        if (itemData.stamina) {
            gameState.player.stamina = Math.min(gameState.player.maxStamina, gameState.player.stamina + itemData.stamina);
        }
        item.count--;
        spawnParticles(gameState.player.x, gameState.player.y, '#00ff00', 10);
    } else if (itemData.type === 'weapon') {
        gameState.equipment.weapon = item.id;
        gameState.player.attack = 10 + itemData.attack;
    } else if (itemData.type === 'armor') {
        gameState.equipment.armor = item.id;
        gameState.player.defense = 5 + itemData.defense;
    }
    
    if (item.count <= 0) {
        gameState.inventory.splice(index, 1);
    }
    
    updateInventoryUI();
    updateUI();
}

function updateInventoryUI() {
    const panel = document.getElementById('inventory-panel');
    panel.innerHTML = '';
    
    for (let i = 0; i < 8; i++) {
        const slot = document.createElement('div');
        slot.className = 'inv-slot';
        
        if (gameState.inventory[i]) {
            const item = gameState.inventory[i];
            const itemData = ITEMS[item.id];
            slot.textContent = itemData.icon;
            slot.style.color = RARITY_COLORS[itemData.rarity];
            
            if (item.count > 1) {
                const count = document.createElement('span');
                count.className = 'inv-count';
                count.textContent = item.count;
                slot.appendChild(count);
            }
            
            slot.onclick = () => useItem(i);
            slot.title = itemData.name;
        }
        
        panel.appendChild(slot);
    }
}

// ============== LEVEL UP ==============
function checkLevelUp() {
    const xpNeeded = gameState.player.level * 100;
    while (gameState.player.xp >= xpNeeded) {
        gameState.player.xp -= xpNeeded;
        gameState.player.level++;
        gameState.player.maxHealth += 10;
        gameState.player.health = gameState.player.maxHealth;
        gameState.player.attack += 2;
        gameState.player.defense += 1;
        spawnParticles(gameState.player.x, gameState.player.y, '#ffff00', 30);
    }
}

// ============== QUEST PROGRESS ==============
function checkQuestProgress() {
    if (!gameState.activeQuest) return;
    
    for (const obj of gameState.activeQuest.objectives) {
        if (obj.type === 'kill') {
            obj.progress = gameState.killedEnemies;
        } else if (obj.type === 'discover') {
            obj.progress = gameState.discoveredAreas.size;
        } else if (obj.type === 'chest') {
            obj.progress = gameState.chestsOpened;
        }
    }
    
    // Check completion
    const completed = gameState.activeQuest.objectives.every(o => o.progress >= o.count);
    if (completed) {
        // Grant rewards
        const rewards = gameState.activeQuest.rewards;
        gameState.player.xp += rewards.xp;
        gameState.player.gold += rewards.gold;
        if (rewards.item) addToInventory(rewards.item);
        
        gameState.activeQuest = null;
        checkLevelUp();
    }
    
    updateQuestUI();
}

function updateQuestUI() {
    const title = document.getElementById('quest-title');
    const objectives = document.getElementById('quest-objectives');
    
    if (!gameState.activeQuest) {
        title.textContent = 'No Active Quest';
        objectives.innerHTML = '';
        return;
    }
    
    title.textContent = gameState.activeQuest.title;
    objectives.innerHTML = '';
    
    for (const obj of gameState.activeQuest.objectives) {
        const div = document.createElement('div');
        div.className = 'quest-objective' + (obj.progress >= obj.count ? ' completed' : '');
        div.textContent = `${obj.type}: ${obj.progress}/${obj.count}`;
        objectives.appendChild(div);
    }
}

// ============== UI UPDATE ==============
function updateUI() {
    const p = gameState.player;
    
    document.getElementById('player-level').textContent = p.level;
    document.getElementById('health-bar').style.width = (p.health / p.maxHealth * 100) + '%';
    document.getElementById('stamina-bar').style.width = (p.stamina / p.maxStamina * 100) + '%';
    document.getElementById('gold-count').textContent = p.gold;
    
    // Time display
    const hours = Math.floor(gameState.time / 60);
    const mins = Math.floor(gameState.time % 60);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    document.getElementById('time-display').textContent = 
        `Day ${gameState.day} - ${displayHours}:${mins.toString().padStart(2, '0')} ${ampm}`;
}

// ============== RENDERING ==============
function render() {
    const p = gameState.player;
    const startTileX = Math.floor(p.x / TILE_SIZE) - Math.floor(VIEW_TILES_X / 2);
    const startTileY = Math.floor(p.y / TILE_SIZE) - Math.floor(VIEW_TILES_Y / 2);
    
    // Camera offset
    const camX = p.x - canvas.width / 2;
    const camY = p.y - canvas.height / 2;
    
    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Day/night cycle
    const timeOfDay = gameState.time / 1440;
    let brightness = 1;
    if (timeOfDay < 0.25) brightness = 0.3 + timeOfDay * 2.8; // Dawn
    else if (timeOfDay > 0.75) brightness = 1 - (timeOfDay - 0.75) * 2.8; // Dusk
    else if (timeOfDay > 0.8 || timeOfDay < 0.2) brightness = 0.3; // Night
    
    // Draw tiles
    for (let y = 0; y < VIEW_TILES_Y; y++) {
        for (let x = 0; x < VIEW_TILES_X; x++) {
            const tileX = startTileX + x;
            const tileY = startTileY + y;
            const tile = getTile(tileX, tileY);
            
            const screenX = tileX * TILE_SIZE - camX;
            const screenY = tileY * TILE_SIZE - camY;
            
            // Base biome color
            ctx.fillStyle = tile.biome.color;
            ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
            
            // Add noise variation
            const rng = new SeededRandom(tileX * 100 + tileY);
            ctx.fillStyle = `rgba(0,0,0,${rng.next() * 0.1})`;
            ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
            
            // Decorations
            if (tile.decoration >= 0) {
                ctx.fillStyle = 'rgba(100,100,100,0.3)';
                ctx.beginPath();
                ctx.arc(screenX + TILE_SIZE/2, screenY + TILE_SIZE/2, 3 + tile.decoration, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Trees
            if (tile.tree) {
                ctx.fillStyle = '#2a4a2a';
                ctx.fillRect(screenX + 8, screenY + 20, 16, 12);
                ctx.fillStyle = '#1a3a1a';
                ctx.beginPath();
                ctx.moveTo(screenX + 16, screenY);
                ctx.lineTo(screenX + 4, screenY + 20);
                ctx.lineTo(screenX + 28, screenY + 20);
                ctx.closePath();
                ctx.fill();
            }
        }
    }
    
    // Get nearby chunks for entity rendering
    const playerChunkX = Math.floor(p.x / TILE_SIZE / CHUNK_SIZE);
    const playerChunkY = Math.floor(p.y / TILE_SIZE / CHUNK_SIZE);
    
    // Collect entities from nearby chunks
    entities = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const chunkEntities = getChunkEntities(playerChunkX + dx, playerChunkY + dy);
            entities.push(...chunkEntities);
        }
    }
    
    // Draw entities
    for (const entity of entities) {
        if (!entity.active && !(entity instanceof Chest)) continue;
        
        const screenX = entity.x - camX;
        const screenY = entity.y - camY;
        
        if (screenX < -50 || screenX > canvas.width + 50 || screenY < -50 || screenY > canvas.height + 50) continue;
        
        if (entity instanceof Enemy) {
            // Draw enemy
            ctx.fillStyle = entity.color;
            ctx.beginPath();
            ctx.arc(screenX, screenY, 12, 0, Math.PI * 2);
            ctx.fill();
            
            // Health bar
            const healthPercent = entity.health / entity.maxHealth;
            ctx.fillStyle = '#333';
            ctx.fillRect(screenX - 15, screenY - 20, 30, 4);
            ctx.fillStyle = healthPercent > 0.5 ? '#4a4' : healthPercent > 0.25 ? '#aa4' : '#a44';
            ctx.fillRect(screenX - 15, screenY - 20, 30 * healthPercent, 4);
        } else if (entity instanceof NPC) {
            // Draw NPC
            ctx.fillStyle = entity.color;
            ctx.beginPath();
            ctx.arc(screenX, screenY, 14, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(screenX, screenY - 4, 5, 0, Math.PI * 2);
            ctx.fill();
        } else if (entity instanceof Chest) {
            // Draw chest
            ctx.fillStyle = entity.opened ? '#654321' : '#8b4513';
            ctx.fillRect(screenX - 12, screenY - 8, 24, 16);
            if (!entity.opened) {
                ctx.fillStyle = '#ffd700';
                ctx.fillRect(screenX - 3, screenY - 2, 6, 6);
            }
        }
    }
    
    // Draw player
    const playerScreenX = canvas.width / 2;
    const playerScreenY = canvas.height / 2;
    
    // Player shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(playerScreenX, playerScreenY + 12, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Player body
    const bobOffset = Math.sin(p.animFrame) * 2;
    ctx.fillStyle = '#4a90d9';
    ctx.beginPath();
    ctx.arc(playerScreenX, playerScreenY + bobOffset, 14, 0, Math.PI * 2);
    ctx.fill();
    
    // Player face
    ctx.fillStyle = '#f5deb3';
    ctx.beginPath();
    ctx.arc(playerScreenX, playerScreenY - 4 + bobOffset, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Direction indicator
    ctx.fillStyle = '#2a5a9a';
    if (p.direction === 'up') ctx.fillRect(playerScreenX - 3, playerScreenY - 16, 6, 6);
    if (p.direction === 'down') ctx.fillRect(playerScreenX - 3, playerScreenY + 8, 6, 6);
    if (p.direction === 'left') ctx.fillRect(playerScreenX - 16, playerScreenY - 3, 6, 6);
    if (p.direction === 'right') ctx.fillRect(playerScreenX + 10, playerScreenY - 3, 6, 6);
    
    // Attack animation
    if (p.attacking) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        const attackAngle = { 'up': -Math.PI/2, 'down': Math.PI/2, 'left': Math.PI, 'right': 0 }[p.direction];
        ctx.arc(playerScreenX, playerScreenY, 30, attackAngle - 0.5, attackAngle + 0.5);
        ctx.stroke();
    }
    
    // Draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const part = particles[i];
        part.x += part.vx * 0.016;
        part.y += part.vy * 0.016;
        part.life -= 0.016;
        
        if (part.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        
        ctx.fillStyle = part.color;
        ctx.globalAlpha = part.life;
        ctx.beginPath();
        ctx.arc(part.x - camX, part.y - camY, part.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    
    // Day/night overlay
    if (brightness < 1) {
        ctx.fillStyle = `rgba(10, 10, 40, ${1 - brightness})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    // Render minimap
    renderMinimap(camX, camY);
}

function renderMinimap(camX, camY) {
    const mapScale = 0.5;
    const p = gameState.player;
    
    minimapCtx.fillStyle = '#111';
    minimapCtx.fillRect(0, 0, 150, 150);
    
    const startTileX = Math.floor(p.x / TILE_SIZE) - 75;
    const startTileY = Math.floor(p.y / TILE_SIZE) - 75;
    
    for (let y = 0; y < 150; y++) {
        for (let x = 0; x < 150; x++) {
            const tileX = startTileX + x;
            const tileY = startTileY + y;
            const tile = getTile(tileX, tileY);
            
            minimapCtx.fillStyle = tile.biome.color;
            minimapCtx.fillRect(x, y, 1, 1);
        }
    }
    
    // Player position
    minimapCtx.fillStyle = '#ff0000';
    minimapCtx.fillRect(74, 74, 3, 3);
}

// ============== GAME LOOP ==============
let lastTime = 0;

function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;
    
    // Update
    updatePlayer(dt);
    
    // Update entities
    for (const entity of entities) {
        if (entity.update) entity.update(dt);
    }
    
    // Render
    render();
    
    requestAnimationFrame(gameLoop);
}

// ============== INIT ==============
function init() {
    // Give player starting items
    addToInventory('wooden_sword');
    addToInventory('health_potion');
    addToInventory('health_potion');
    
    updateInventoryUI();
    updateUI();
    
    requestAnimationFrame(gameLoop);
}

init();
