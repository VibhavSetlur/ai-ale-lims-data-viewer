export type DeploymentChannel = 'static' | 'static-dev' | 'dynamic' | 'server';

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
  static: {
    label: 'Static',
    branch: 'static',
    url: 'https://modelseed.org/annotation/projects/aiale-dev/',
    database: 'Full LIMS mirror: data/lims_indexed.db',
    barcodePolicy: 'Barcode tab shown when verAB_barcodes is present',
    audience: 'Static production release',
  },
  'static-dev': {
    label: 'Static development',
    branch: 'static-dev',
    url: 'Local export only, not deployed',
    database: 'Local validated LIMS snapshot',
    barcodePolicy: 'Barcode tab follows baked database capability',
    audience: 'Static development verification',
  },
  dynamic: {
    label: 'Dynamic',
    branch: 'dynamic',
    url: 'http://localhost:3457/',
    database: 'Runtime SQLITE_PATH or configured DB connection',
    barcodePolicy: 'Barcode tab follows active database capability',
    audience: 'Dynamic production release',
  },
  server: {
    label: 'Server',
    branch: 'dynamic-dev',
    url: 'http://localhost:3457/',
    database: 'Runtime SQLITE_PATH or configured DB connection',
    barcodePolicy: 'Barcode tab follows active database capability',
    audience: 'Local development runtime',
  },
};

function cleanChannel(value: string | undefined): DeploymentChannel {
  if (value === 'static' || value === 'static-dev' || value === 'dynamic' || value === 'server') return value;
  return process.env.NEXT_PUBLIC_STATIC === '1' ? 'static' : 'server';
}

export function getBuildInfo(): BuildInfo {
  const mode = process.env.NEXT_PUBLIC_STATIC === '1' ? 'static' : 'server';
  return {
    version: process.env.NEXT_PUBLIC_VIEWER_VERSION || '1.15.0',
    channel: cleanChannel(process.env.NEXT_PUBLIC_DEPLOYMENT_CHANNEL),
    branch: process.env.NEXT_PUBLIC_DEPLOYMENT_BRANCH || (mode === 'static' ? 'static' : 'dynamic-dev'),
    commit: process.env.NEXT_PUBLIC_GIT_COMMIT || 'local',
    mode,
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  };
}
