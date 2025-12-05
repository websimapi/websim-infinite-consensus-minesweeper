import { DBManager } from './db.js';
import { GameLogic } from './logic.js';
import { loadAssets, getImage, playSound } from './assets.js';
import confetti from 'canvas-confetti';

const { useState, useEffect, useRef, useCallback } = React;
const { createRoot } = ReactDOM;

const TILE_SIZE = 40; // Size of tiles in pixels

const App = () => {
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('Connecting...');
    const [gameInfo, setGameInfo] = useState({ flags: 0 });
    const [mode, setMode] = useState('reveal'); // 'reveal' | 'flag'
    const [gameOver, setGameOver] = useState(null); // { won, message, by }

    // Game State refs
    const canvasRef = useRef(null);
    const logicRef = useRef(new GameLogic());
    const dbRef = useRef(null);

    // Viewport State - Moved to Refs for performance
    const camera = useRef({ x: 0, y: 0 });
    const isDragging = useRef(false);
    const lastMouse = useRef({ x: 0, y: 0 });
    const longPressTimer = useRef(null);
    const frameId = useRef(null);

    // Initialize
    useEffect(() => {
        const init = async () => {
            try {
                setStatus('Loading Assets...');
                await loadAssets();

                setStatus('Syncing Database...');
                dbRef.current = new DBManager(
                    logicRef.current,
                    (newState) => {
                        // On State Change
                        draw();
                        updateGameInfo();
                        checkGameOver(newState);
                    },
                    (statusMsg) => setStatus(statusMsg)
                );

                await dbRef.current.init();
                setLoading(false);
                draw();
            } catch (e) {
                console.error(e);
                setStatus('Error: ' + e.message);
            }
        };
        init();

        // Resize handler
        window.addEventListener('resize', draw);
        return () => window.removeEventListener('resize', draw);
    }, []);

    const updateGameInfo = () => {
        const state = logicRef.current.state;
        // Count flags across chunks
        let flags = 0;
        if (state.chunks) {
            for (const key in state.chunks) {
                flags += Object.keys(state.chunks[key].flagged).length;
            }
        }
        setGameInfo({ flags });
    };

    const checkGameOver = (state) => {
        if (state.exploded) {
            setGameOver({
                won: false,
                message: "BOOM!",
                by: state.exploded.by
            });
            if (state.exploded.time > Date.now() - 2000) {
                playSound('sfx_explode');
            }
        } else {
            setGameOver(null);
        }
    };

    // Drawing Logic
    const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        // Ensure accurate canvas size (might need debounce in real world, but fine here)
        if (canvas.width !== window.innerWidth) canvas.width = window.innerWidth;
        if (canvas.height !== window.innerHeight) canvas.height = window.innerHeight;
        
        const width = canvas.width;
        const height = canvas.height;
        const cam = camera.current;

        // Background
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(0, 0, width, height);

        // Determine visible chunks
        const startX = -width/2 - cam.x;
        const endX = width/2 - cam.x;
        const startY = -height/2 - cam.y;
        const endY = height/2 - cam.y;

        const startChunkCol = Math.floor(startX / (TILE_SIZE * logicRef.current.CHUNK_SIZE));
        const endChunkCol = Math.floor(endX / (TILE_SIZE * logicRef.current.CHUNK_SIZE));
        const startChunkRow = Math.floor(startY / (TILE_SIZE * logicRef.current.CHUNK_SIZE));
        const endChunkRow = Math.floor(endY / (TILE_SIZE * logicRef.current.CHUNK_SIZE));

        const state = logicRef.current.state;
        const exploded = !!state.exploded;
        const chunkSizePx = TILE_SIZE * logicRef.current.CHUNK_SIZE;

        // Iterate ONLY visible chunks
        for (let cx = startChunkCol; cx <= endChunkCol; cx++) {
            for (let cy = startChunkRow; cy <= endChunkRow; cy++) {
                const chunkKey = `${cx},${cy}`;
                const chunk = state.chunks[chunkKey];
                
                // Even if chunk doesn't exist in state, we might need to draw unrevealed tiles?
                // Minesweeper usually draws "hidden" tiles everywhere.
                // To optimize, we assume infinite hidden tiles, but only look up data if chunk exists.
                
                const chunkOffsetX = cx * logicRef.current.CHUNK_SIZE;
                const chunkOffsetY = cy * logicRef.current.CHUNK_SIZE;

                // Iterate tiles within the chunk
                for (let lx = 0; lx < logicRef.current.CHUNK_SIZE; lx++) {
                    for (let ly = 0; ly < logicRef.current.CHUNK_SIZE; ly++) {
                        const gridX = chunkOffsetX + lx;
                        const gridY = chunkOffsetY + ly;
                        
                        // Culling: Check if tile is actually on screen (chunks at edges are partially visible)
                        const drawX = width/2 + cam.x + gridX * TILE_SIZE;
                        const drawY = height/2 + cam.y + gridY * TILE_SIZE;
                        
                        if (drawX < -TILE_SIZE || drawX > width || drawY < -TILE_SIZE || drawY > height) continue;

                        const key = `${gridX},${gridY}`;
                        
                        let isRevealed = false;
                        let isFlagged = false;
                        let count = 0;

                        if (chunk) {
                            if (chunk.revealed[key] !== undefined) {
                                isRevealed = true;
                                count = chunk.revealed[key];
                            }
                            isFlagged = !!chunk.flagged[key];
                        }

                        // Draw Base Tile
                        if (isRevealed) {
                            ctx.drawImage(getImage('tile_revealed'), drawX, drawY, TILE_SIZE, TILE_SIZE);

                            if (count > 0) {
                                ctx.font = 'bold 20px monospace';
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                const colors = ['blue', 'green', 'red', 'darkblue', 'brown', 'cyan', 'black', 'gray'];
                                ctx.fillStyle = colors[count-1] || 'black';
                                ctx.fillText(count, drawX + TILE_SIZE/2, drawY + TILE_SIZE/2 + 2);
                            }
                        } else {
                            ctx.drawImage(getImage('tile_hidden'), drawX, drawY, TILE_SIZE, TILE_SIZE);
                        }

                        // Draw Overlays
                        if (isFlagged) {
                            ctx.drawImage(getImage('tile_flag'), drawX, drawY, TILE_SIZE, TILE_SIZE);
                        }

                        // Show mine if exploded
                        if (exploded && logicRef.current.hasMine(gridX, gridY)) {
                            if (!isFlagged) { // If flagged correctly, keep flag? usually minesweeper shows mines
                                ctx.drawImage(getImage('tile_mine'), drawX, drawY, TILE_SIZE, TILE_SIZE);
                            }
                        }

                        // Highlight exploded mine
                        if (state.exploded && state.exploded.x === gridX && state.exploded.y === gridY) {
                            ctx.drawImage(getImage('tile_exploded'), drawX, drawY, TILE_SIZE, TILE_SIZE);
                            ctx.drawImage(getImage('tile_mine'), drawX, drawY, TILE_SIZE, TILE_SIZE);
                        }
                    }
                }
            }
        }
    };

    // Interaction Handlers
    const screenToWorld = (sx, sy) => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const wx = Math.floor((sx - width/2 - camera.current.x) / TILE_SIZE);
        const wy = Math.floor((sy - height/2 - camera.current.y) / TILE_SIZE);
        return { x: wx, y: wy };
    };

    const handleAction = async (gridX, gridY, actionType) => {
        if (loading || dbRef.current.locked || gameOver) return;

        playSound(actionType === 'flag' ? 'sfx_flag' : 'sfx_click');

        const success = await dbRef.current.performMove((logic) => {
            if (actionType === 'flag') {
                return logic.flag(gridX, gridY);
            } else {
                return logic.reveal(gridX, gridY, dbRef.current.currentUser.username);
            }
        });

        if (success) {
            draw();
            // Check for instant explosion
            if (logicRef.current.state.exploded) {
                playSound('sfx_explode');
            }
        }
    };

    const onPointerDown = (e) => {
        isDragging.current = false;
        lastMouse.current = { x: e.clientX, y: e.clientY };

        // Long press detection for mobile flagging
        longPressTimer.current = setTimeout(() => {
            isDragging.current = true; // prevent click
            // Could trigger flag mode here visually?
        }, 300);
    };

    const onPointerMove = (e) => {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            isDragging.current = true;
            clearTimeout(longPressTimer.current);
        }

        if (isDragging.current) {
            camera.current = { x: camera.current.x + dx, y: camera.current.y + dy };
            draw(); // Immediate redraw
        }

        lastMouse.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e) => {
        clearTimeout(longPressTimer.current);

        if (!isDragging.current) {
            const { x, y } = screenToWorld(e.clientX, e.clientY);
            handleAction(x, y, mode);
        }
    };

    // Reset Game
    const handleReset = async () => {
        if (!gameOver) return;
        await dbRef.current.performMove((logic) => {
            logic.reset();
            return 'reset';
        });
        setGameOver(null);
    };

    if (loading) {
        return <div className="loading">{status}</div>;
    }

    return (
        <>
            <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={() => { isDragging.current = false; }}
                style={{ touchAction: 'none' }}
            />

            <div className="ui-layer">
                <div className="top-bar">
                    <div className="status-indicator">
                        <div className={`status-dot ${dbRef.current?.locked ? 'syncing' : 'online'}`}></div>
                        <span>{status}</span>
                    </div>
                    <div className="game-info">
                        {gameInfo.flags}
                    </div>
                </div>

                <div className="controls">
                    <button 
                        className={`control-btn ${mode === 'reveal' ? 'active' : ''}`}
                        onClick={() => setMode('reveal')}
                    >
                        
                    </button>
                    <button 
                        className={`control-btn flag-mode ${mode === 'flag' ? 'active' : ''}`}
                        onClick={() => setMode('flag')}
                    >
                        
                    </button>
                </div>
            </div>

            {gameOver && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>{gameOver.message}</h2>
                        <p>Died by: {gameOver.by}</p>
                        <button onClick={handleReset}>New Game</button>
                    </div>
                </div>
            )}
        </>
    );
};

const root = createRoot(document.getElementById('root'));
root.render(<App />);