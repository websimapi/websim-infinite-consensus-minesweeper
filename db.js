// Handles the unique "Consensus" synchronization logic
export class DBManager {
    constructor(gameLogic, onStateChange, onStatus) {
        this.room = new WebsimSocket();
        this.collectionName = 'minesweeper_consensus_v4';
        this.gameLogic = gameLogic;
        this.onStateChange = onStateChange;
        this.onStatus = onStatus;
        
        this.myRecord = null;
        this.locked = false;
        this.localVersion = 0;
        this.currentUser = null;
    }

    async init() {
        this.onStatus('Connecting to room...');
        await this.room.initialize();
        this.currentUser = await window.websim.getCurrentUser();

        // Subscribe to Room State (Signal Channel)
        this.room.subscribeRoomState(this.handleRoomStateUpdate.bind(this));

        // Find or Create My Record
        const records = await this.room.collection(this.collectionName).filter({
            username: this.currentUser.username
        }).getList();

        if (records.length > 0) {
            this.myRecord = records[0];
        } else {
            this.onStatus('Creating user record...');
            this.myRecord = await this.room.collection(this.collectionName).create({
                state: this.gameLogic.getState(),
                last_move: null,
                version: 0
            });
        }
        
        // Initial Sync Check
        await this.syncIfNeeded();
    }

    async syncIfNeeded() {
        const { lastUpdatedBy, version } = this.room.roomState;
        
        if (version && version > this.localVersion) {
            this.onStatus(`Syncing from ${lastUpdatedBy ? 'peer' : 'room'}...`);
            
            // If we have a lastUpdatedBy, fetch their record
            if (lastUpdatedBy && lastUpdatedBy !== this.room.clientId) {
                const peer = this.room.peers[lastUpdatedBy];
                // Peer might have left, but record remains if we filter by username
                // But room.peers only has active. We need to find the record by "owner"
                // Actually, let's just use the fact we can query the collection.
                // We need the user's username. We can assume lastUpdatedBy is clientId.
                // WEBSIM TRICK: We don't easily know username from clientId if they left.
                // So let's rely on roomState storing username too.
                
                const targetUsername = this.room.roomState.lastUpdatedUsername;
                if (targetUsername) {
                    const records = await this.room.collection(this.collectionName).filter({
                        username: targetUsername
                    }).getList();
                    
                    if (records.length > 0) {
                        const masterState = records[0].state;
                        this.gameLogic.loadState(masterState);
                        
                        // IMPORTANT: Update MY record to match the consensus
                        // This fulfills "append and edit in the info into their row"
                        await this.room.collection(this.collectionName).update(this.myRecord.id, {
                            state: masterState,
                            version: version
                        });
                        
                        this.localVersion = version;
                        this.onStateChange(this.gameLogic.getState());
                    }
                }
            } else if (lastUpdatedBy === this.room.clientId) {
                // I updated it, just sync version
                this.localVersion = version;
            }
        }
        this.onStatus('Online');
    }

    async handleRoomStateUpdate(state) {
        if (state.lockedBy) {
            this.locked = true;
            const locker = this.room.peers[state.lockedBy]?.username || 'User';
            this.onStatus(`Locked by ${locker}...`);
        } else {
            this.locked = false;
            await this.syncIfNeeded();
        }
    }

    async performMove(actionCallback) {
        if (this.locked) return false;

        try {
            this.onStatus('Acquiring lock...');
            
            // 1. Attempt Lock
            await this.room.updateRoomState({ lockedBy: this.room.clientId });
            
            // Small delay to ensure propagation/reduce race conditions (simple polling lock)
            // Real consensus is harder, but this is "Consensus Lite"
            await new Promise(r => setTimeout(r, 100)); 
            
            // Verify lock
            if (this.room.roomState.lockedBy !== this.room.clientId) {
                this.onStatus('Lock failed, retry...');
                return false;
            }

            // 2. Perform Logic
            const result = actionCallback(this.gameLogic);
            if (!result || result.result === 'ignored') {
                // Nothing changed
                await this.room.updateRoomState({ lockedBy: null });
                this.onStatus('Online');
                return false;
            }

            this.onStatus('Saving to DB...');
            
            // 3. Update My DB Row
            const nextVersion = (this.room.roomState.version || 0) + 1;
            const newState = this.gameLogic.getState();
            
            await this.room.collection(this.collectionName).update(this.myRecord.id, {
                state: newState,
                version: nextVersion,
                last_move: new Date().toISOString()
            });
        } catch (e) {
            // Error occurred, unlock and rethrow
            await this.room.updateRoomState({ lockedBy: null });
            throw e;
        }
    }
}