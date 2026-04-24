import 'dotenv/config';

const required = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const optional = (value: string | undefined, fallback: string): string => value ?? fallback;

export const config = {
  env: optional(process.env['NODE_ENV'], 'development'),
  host: optional(process.env['HOST'], '127.0.0.1'),
  port: Number(optional(process.env['PORT'], '3010')),
  dbPath: optional(process.env['DB_PATH'], `${process.env['HOME']}/.crateswipe/db.sqlite`),
  musicCachePath: optional(process.env['MUSIC_CACHE_PATH'], `${process.env['HOME']}/music/crateswipe`),
  jwtSecret: optional(process.env['JWT_SECRET'], 'dev-only-change-me'),
  deezer: {
    baseUrl: optional(process.env['DEEZER_BASE_URL'], 'https://api.deezer.com'),
  },
  lastfm: {
    apiKey: process.env['LASTFM_API_KEY'],
    apiSecret: process.env['LASTFM_API_SECRET'],
  },
  getSongBpm: {
    apiKey: process.env['GETSONGBPM_API_KEY'],
  },
  odesli: {
    baseUrl: optional(process.env['ODESLI_BASE_URL'], 'https://api.song.link/v1-alpha.1'),
  },
} as const;

export const requireLastfm = () => ({
  apiKey: required('LASTFM_API_KEY', config.lastfm.apiKey),
  apiSecret: required('LASTFM_API_SECRET', config.lastfm.apiSecret),
});

export const requireGetSongBpm = () => ({
  apiKey: required('GETSONGBPM_API_KEY', config.getSongBpm.apiKey),
});

export const packageVersion = '0.1.0';
