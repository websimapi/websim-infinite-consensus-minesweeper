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
            revealed: {}, // "x,y": value (0-8)
            flagged: {},  // "x,y": true
            exploded: null, // {x, y, by}
            startTime: Date.now()
        };
    }

    reset(newSeed) {
        this.state = {
            seed: newSeed || Math.floor(Math.random() * 1000000),
            revealed: {},
            flagged: {},
            exploded: null,
            startTime: Date.now()
        };
    }

    loadState(jsonState) {
        if (!jsonState) return;
        this.state = { ...jsonState };
    }

    getState() {
        return JSON.parse(JSON.stringify(this.state));
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
        const key = `${x},${y}`;
        if (this.state.revealed[key] !== undefined) return false; // Can't flag revealed

        if (this.state.flagged[key]) {
            delete this.state.flagged[key];
            return 'unflagged';
        } else {
            this.state.flagged[key] = true;
            return 'flagged';
        }
    }

    reveal(x, y, username) {
        const key = `${x},${y}`;
        if (this.state.flagged[key]) return { result: 'ignored' };
        if (this.state.revealed[key] !== undefined) return { result: 'ignored' };

        if (this.hasMine(x, y)) {
            this.state.exploded = { x, y, by: username, time: Date.now() };
            return { result: 'exploded' };
        }

        // Flood fill if 0
        const queue = [[x, y]];
        const visited = new Set();
        visited.add(key);

        while (queue.length > 0) {
            const [cx, cy] = queue.shift();
            const cKey = `${cx},${cy}`;

            const neighbors = this.countNeighbors(cx, cy);
            this.state.revealed[cKey] = neighbors;

            // If it's a blank tile (0 mines around), auto-reveal neighbors
            if (neighbors === 0) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = cx + dx;
                        const ny = cy + dy;
                        const nKey = `${nx},${ny}`;

                        if (!visited.has(nKey) && this.state.revealed[nKey] === undefined && !this.state.flagged[nKey]) {
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