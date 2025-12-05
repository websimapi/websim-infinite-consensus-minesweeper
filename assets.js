export const ASSETS = {
    tile_revealed: '/tile_revealed.png',
    tile_flag: '/tile_flag.png',
    tile_mine: '/tile_mine.png',
    tile_hidden: '/tile_hidden.png',
    tile_exploded: '/tile_exploded.png',
    sfx_flag: '/sfx_flag.mp3',
    sfx_explode: '/sfx_explode.mp3',
    sfx_click: '/sfx_click.mp3'
};

const images = {};
const sounds = {};

export const loadAssets = async () => {
    const imagePromises = Object.entries(ASSETS).map(([key, src]) => {
        if (src.endsWith('.png')) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.src = src;
                img.onload = () => {
                    images[key] = img;
                    resolve();
                };
                img.onerror = reject;
            });
        }
    });    
    
    // Preload sounds is tricky without user interaction, so we load them on demand or just cache the URL
    // We'll use Audio context later.
    
    await Promise.all(imagePromises.filter(Boolean));
};

export const getImage = (key) => images[key];

export const playSound = (key) => {
    const audio = new Audio(ASSETS[key]);
    audio.volume = 0.5;
    audio.play().catch(e => console.log('Audio play failed (interaction needed)', e));
};