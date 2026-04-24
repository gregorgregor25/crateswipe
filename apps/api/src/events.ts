import { EventEmitter } from 'node:events';

export const downloadEvents = new EventEmitter();
// Events:
//   downloadEvents.emit('download_ready', { trackId: number })
//   downloadEvents.emit('download_failed', { trackId: number, error: string })
