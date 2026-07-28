export type DeploymentChannel = 'dev' | 'public' | 'server';

export interface BuildInfo {
  version: string;
  channel: DeploymentChannel;
  branch: string;
  commit: string;
  mode: 'server' | 'static';
  basePath: string;
}

export const DEPLOYMENT_CHANNELS: Record<DeploymentChannel, {
  label: string;
  branch: string;
  url: string;
  database: string;
  barcodePolicy: string;
  audience: string;
}> = {
  dev: {
    label: 'Dev',
    branch: 'deploy/aiale-dev',
    url: 'https://modelseed.org/annotation/projects/aiale-dev/',
    database: 'Full LIMS mirror: data/lims_indexed.db',
    barcodePolicy: 'Barcode tab shown when verAB_barcodes is present',
    audience: 'Internal test deployment',
  },
  public: {
    label: 'Public',
    branch: 'deploy/aiale-public',
    url: 'https://modelseed.org/annotation/projects/aiale/',
    database: 'TFMN1 trimmed mirror: data/lims_TFMN1_indexed.db',
    barcodePolicy: 'Barcode tab hidden because verAB_barcodes is absent',
    audience: 'Publication snapshot',
  },
  server: {
    label: 'Server',
    branch: 'main',
    url: 'http://localhost:3457/',
    database: 'Runtime SQLITE_PATH or configured DB connection',
    barcodePolicy: 'Barcode tab follows active database capability',
    audience: 'Local runtime',
  },
};

function cleanChannel(value: string | undefined): DeploymentChannel {
  if (value === 'dev' || value === 'public' || value === 'server') return value;
  return process.env.NEXT_PUBLIC_STATIC === '1' ? 'public' : 'server';
}

export function getBuildInfo(): BuildInfo {
  const mode = process.env.NEXT_PUBLIC_STATIC === '1' ? 'static' : 'server';
  return {
    version: process.env.NEXT_PUBLIC_VIEWER_VERSION || '1.11.0',
    channel: cleanChannel(process.env.NEXT_PUBLIC_DEPLOYMENT_CHANNEL),
    branch: process.env.NEXT_PUBLIC_DEPLOYMENT_BRANCH || (mode === 'static' ? 'deploy/aiale-public' : 'main'),
    commit: process.env.NEXT_PUBLIC_GIT_COMMIT || 'local',
    mode,
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  };
}
