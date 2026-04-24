import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import NodeID3 from 'node-id3';
import type { Database as DB } from 'better-sqlite3';
import { config } from '../config.js';
import { downloadEvents } from '../events.js';

export type TrackMeta = {
  id: number;
  title: string;
  artistName: string;
  albumTitle: string | null;
  bpm: number | null;
};

export type DownloadRunner = (meta: TrackMeta) => Promise<string>; // resolves to file path

// Production runner — spawns yt-dlp
export const ytDlpRunner: DownloadRunner = async (meta) => {
  const { title, artistName } = meta;
  const safeArtist = artistName.replace(/[/\\?%*:|"<>]/g, '_');
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '_');
  const outputPath = `${config.musicCachePath}/${safeArtist} - ${safeTitle}.mp3`;

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-f', 'bestaudio',
      '-x',
      '--audio-format', 'mp3',
      '--embed-metadata',
      '--embed-thumbnail',
      `ytsearch1:${artistName} ${title}`,
      '-o', outputPath,
      '--no-playlist',
    ];
    const proc = spawn('yt-dlp', args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });
  });

  if (!existsSync(outputPath)) {
    throw new Error(`yt-dlp completed but output file not found: ${outputPath}`);
  }

  return outputPath;
};

type DownloadRow = {
  status: string;
  file_path: string | null;
};

export class DownloadService {
  constructor(
    private readonly db: DB,
    private readonly runner: DownloadRunner = ytDlpRunner,
  ) {}

  async startDownload(meta: TrackMeta): Promise<Promise<void>> {
    this.db
      .prepare(
        `INSERT INTO downloads (track_id, status, started_at, error, file_path, finished_at)
         VALUES (?, 'queued', ?, NULL, NULL, NULL)
         ON CONFLICT (track_id) DO UPDATE SET
           status = 'queued',
           started_at = excluded.started_at,
           error = NULL,
           file_path = NULL,
           finished_at = NULL`,
      )
      .run(meta.id, Date.now());

    const jobPromise = this.runJob(meta);
    return jobPromise;
  }

  private async runJob(meta: TrackMeta): Promise<void> {
    this.db
      .prepare(`UPDATE downloads SET status = 'downloading' WHERE track_id = ?`)
      .run(meta.id);

    try {
      const filePath = await this.runner(meta);

      // Write ID3 tags — best-effort; don't fail the job if tagging fails
      try {
        const tags: NodeID3.Tags = {
          title: meta.title,
          artist: meta.artistName,
        };
        if (meta.albumTitle) {
          tags.album = meta.albumTitle;
        }
        if (meta.bpm !== null) {
          tags.bpm = String(meta.bpm);
        }
        NodeID3.update(tags, filePath);
      } catch {
        // Non-fatal — the audio file is still usable without ID3 tags
      }

      this.db
        .prepare(
          `UPDATE downloads SET status = 'ready', file_path = ?, finished_at = ? WHERE track_id = ?`,
        )
        .run(filePath, Date.now(), meta.id);

      downloadEvents.emit('download_ready', { trackId: meta.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.db
        .prepare(
          `UPDATE downloads SET status = 'failed', error = ?, finished_at = ? WHERE track_id = ?`,
        )
        .run(message, Date.now(), meta.id);

      downloadEvents.emit('download_failed', { trackId: meta.id, error: message });
    }
  }
}
