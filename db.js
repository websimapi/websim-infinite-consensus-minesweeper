// Handles the unique "Consensus" synchronization logic
export class DBManager {
    constructor() {
        this.room = new WebsimSocket();
        this.collectionName = 'minesweeper_states_v2';
        this.myRecord = null;
        this.isLocked = false;

        // Callbacks
        this.onStateChange = () => {};
        this.onSyncStatus = () => {};
        this.onHistoryUpdate = () => {};
    }

    async init() {
        await this.room.initialize();
        this.currentUser = await window.websim.getCurrentUser();

        // Find my record or create it
        const records = await this.room.collection(this.collectionName).filter({
            username: this.currentUser.username
        }).getList();

        if (records.length > 0) {
            this.myRecord = records[0];
        } else {
            // Initial Empty State
            this.myRecord = await this.room.collection(this.collectionName).create({
                current_game: null,
                history: []
            });
        }

        // Subscribe to RoomState for locking and versioning
        this.room.subscribeRoomState((state) => {
            this.handleRoomStateUpdate(state);
        });

        // Try to sync initially
        await this.initialSync();
    }

    async initialSync() {
        this.onSyncStatus('Syncing...');

        // Check room state for the latest version
        const { lastUpdatedBy, version } = this.room.roomState;

        if (lastUpdatedBy && lastUpdatedBy !== this.room.clientId) {
             // Find that user's record
             const peer = this.room.peers[lastUpdatedBy];
             if (peer) {
                 const records = await this.room.collection(this.collectionName).filter({
                     username: peer.username
                 }).getList();

                 if (records.length > 0) {
                     const masterState = records[0].current_game;
                     const masterHistory = records[0].history;
                     // Update my record to match
                     if (masterState) {
                         await this.updateMyRecord(masterState, masterHistory);
                         this.onStateChange(masterState);
                         this.onHistoryUpdate(masterHistory);
                     }
                 }
             }
        } else if (!this.myRecord.current_game) {
            // I am alone or first, or no state exists. 
            // If I have no state, start fresh.
            this.onStateChange(null); // Triggers logic to create new game
        } else {
            // I have a state, assume it's good for now
            this.onStateChange(this.myRecord.current_game);
            this.onHistoryUpdate(this.myRecord.history);
        }

        this.onSyncStatus('Online');
    }

    handleRoomStateUpdate(state) {
        // If locked by someone else, update UI
        if (state.lockedBy && state.lockedBy !== this.room.clientId) {
            this.isLocked = true;
            this.onSyncStatus(`Busy (${this.room.peers[state.lockedBy]?.username || 'Unknown'})...`);
        } else {
            this.isLocked = false;
            this.onSyncStatus('Online');
        }

        // If a version update happened and I didn't do it, sync
        if (state.lastUpdatedBy && state.lastUpdatedBy !== this.room.clientId) {
             // We
        }
    }
}