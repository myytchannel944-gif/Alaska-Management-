declare module './types' {
    export interface BotConfig {
        logChannel: string | null;
        staffRole:   string | null;
        iaRole:      string | null;
        mgmtRole:    string | null;
    }
}
