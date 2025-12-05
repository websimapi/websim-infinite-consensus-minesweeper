// Deterministic Random Number Generator
// Using a simple Linear Congruential Generator for speed and seedability
class LCG {
    constructor(seed) {
        this.m = 0x80000000; // 2**31;
        this.a = 1103515245;
        this.c = 12345;
        this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
    }

    nextInt() {
        this.state = (this.a * this.state + this.c) % this.m;
        return this.state;
    }

    nextFloat() {
        // returns in range [0,1]
        return this.nextInt() / (this.m - 1);
    }
}

export class GameLogic {
    constructor() {
        this.CHUNK_SIZE = 16;
        this.MINE_PROBABILITY = 0.15;
        this.state = {
            seed: Math.floor(Math.random() * 1000000),
            chunks: {}, // "cx,cy": { revealed: {}, flagged: {} }
            exploded: null, // {x, y, by}
            startTime: Date.now()
        };
    }

    reset(newSeed) {
        this.state = {
            seed: newSeed || Math.floor(Math.random() * 1000000),
            chunks: {},
            exploded: null,
            startTime: Date.now()
        };
    }

    loadState(jsonState) {
        if (!jsonState) return;
        // Migration from old flat state if needed (v4 -> v5)
        if (jsonState.revealed && !jsonState.chunks) {
            this.reset(jsonState.seed);
            // We would migrate here, but since we bumped DB version, we start fresh.
        } else {
            this.state = { ...jsonState };
        }
    }

    getState() {
        return JSON.parse(JSON.stringify(this.state));
    }

    getChunkKey(x, y) {
        const cx = Math.floor(x / this.CHUNK_SIZE);
        const cy = Math.floor(y / this.CHUNK_SIZE);
        return `${cx},${cy}`;
    }

    getChunk(x, y, create = false) {
        const key = this.getChunkKey(x, y);
        if (!this.state.chunks[key] && create) {
            this.state.chunks[key] = { revealed: {}, flagged: {} };
        }
        return this.state.chunks[key];
    }

    isRevealed(x, y) {
        const chunk = this.getChunk(x, y);
        const key = `${x},${y}`;
        return chunk && chunk.revealed[key] !== undefined;
    }

    isFlagged(x, y) {
        const chunk = this.getChunk(x, y);
        const key = `${x},${y}`;
        return chunk && chunk.flagged[key];
    }

    // Hash function to determine if a mine exists at x,y based on seed
    hasMine(x, y) {
        // We combine x, y, and seed to get a unique deterministic value
        // Simple hash: (x * 73856093) ^ (y * 19349663) ^ (seed * 83492791)
        // Then normalize.

        // Better: Use the LCG initialized with a distinctive hash of the coord
        // To avoid patterns, we hash the coords first
        const h1 = (x * 374761393) ^ (y * 668265263); 
        const h2 = (h1 ^ this.state.seed); 
        const localSeed = h2 & 0x7FFFFFFF; // ensure positive

        const rng = new LCG(localSeed);
        return rng.nextFloat() < this.MINE_PROBABILITY;
    }

    countNeighbors(x, y) {
        let count = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (this.hasMine(x + dx, y + dy)) {
                    count++;
                }
            }
        }
        return count;
    }

    // Actions
    flag(x, y) {
        const chunk = this.getChunk(x, y, true);
        const key = `${x},${y}`;
        
        if (chunk.revealed[key] !== undefined) return false; // Can't flag revealed

        if (chunk.flagged[key]) {
            delete chunk.flagged[key];
            return 'unflagged';
        } else {
            chunk.flagged[key] = true;
            return 'flagged';
        }
    }

    reveal(x, y, username) {
        if (this.isFlagged(x, y)) return { result: 'ignored' };
        if (this.isRevealed(x, y)) return { result: 'ignored' };

        if (this.hasMine(x, y)) {
            this.state.exploded = { x, y, by: username, time: Date.now() };
            return { result: 'exploded' };
        }

        // Flood fill if 0
        const queue = [[x, y]];
        const visited = new Set();
        visited.add(`${x},${y}`);

        while (queue.length > 0) {
            const [cx, cy] = queue.shift();
            
            const neighbors = this.countNeighbors(cx, cy);
            
            // Set revealed in correct chunk
            const chunk = this.getChunk(cx, cy, true);
            chunk.revealed[`${cx},${cy}`] = neighbors;

            // If it's a blank tile (0 mines around), auto-reveal neighbors
            if (neighbors === 0) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = cx + dx;
                        const ny = cy + dy;
                        const nKey = `${nx},${ny}`;

                        // Check visited and state using helpers
                        if (!visited.has(nKey) && !this.isRevealed(nx, ny) && !this.isFlagged(nx, ny)) {
                            visited.add(nKey);
                            queue.push([nx, ny]);
                        }
                    }
                }
            }
        }

        return { result: 'safe' };
    }
}