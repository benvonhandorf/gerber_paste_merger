import { unzipSync } from 'fflate';
import { identifyLayers } from '@tracespace/identify-layers';
import { parseGerber } from '../gerber/parse';
import { makeDesignId, type Design, type DesignLayer } from '../model';

export interface LoadResult {
  designs: Design[];
  warnings: string[];
}

interface RawFile {
  name: string;
  text: string;
}

function zipBaseName(filename: string): string {
  return filename.replace(/\.[Zz][Ii][Pp]$/, '');
}

function fileBaseName(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, '');
}

async function unzipToRawFiles(file: File): Promise<RawFile[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);
  const decoder = new TextDecoder();
  const files: RawFile[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/') || data.length === 0) continue; // directory entries, or macOS resource-fork noise
    files.push({ name: path.split('/').pop() ?? path, text: decoder.decode(data) });
  }
  return files;
}

/** Splits the dropped/selected files into per-zip groups plus one "loose files" group. */
async function expandFiles(files: File[]): Promise<{ groups: Array<{ name: string; files: RawFile[] }> }> {
  const groups: Array<{ name: string; files: RawFile[] }> = [];
  const loose: RawFile[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      groups.push({ name: zipBaseName(file.name), files: await unzipToRawFiles(file) });
    } else {
      loose.push({ name: file.name, text: await file.text() });
    }
  }
  if (loose.length > 0) {
    const name = loose.length === 1 ? fileBaseName(loose[0]!.name) : `Design ${groups.length + 1}`;
    groups.push({ name, files: loose });
  }
  return { groups };
}

function buildDesign(name: string, rawFiles: RawFile[], warnings: string[]): Design | null {
  const identities = identifyLayers(rawFiles.map((f) => f.name));
  const layers: DesignLayer[] = [];
  for (const raw of rawFiles) {
    const identity = identities[raw.name];
    // Drill files are out of scope for this tool, and anything unrecognized
    // by filename can't be auto-classified - both are silently skipped
    // rather than guessed at.
    if (!identity || identity.type === null || identity.type === 'drill') continue;

    const parsed = parseGerber(raw.text);
    if (!parsed.ok) {
      warnings.push(`${name} / ${raw.name}: ${parsed.warning ?? 'could not be parsed as a Gerber file'}`);
      continue;
    }
    if (parsed.warning) warnings.push(`${name} / ${raw.name}: ${parsed.warning}`);

    layers.push({
      type: identity.type,
      side: identity.side ?? 'all',
      filename: raw.name,
      image: parsed.image,
    });
  }
  if (layers.length === 0) return null;
  return { id: makeDesignId(), name, layers, x: 0, y: 0, rotation: 0, flipped: false, visible: true };
}

/**
 * Loads a batch of dropped/selected files as one or more designs. Each zip
 * becomes its own design (named after the zip); every loose (non-zip) file
 * from the same batch is grouped into a single additional design, since a
 * batch is normally "all the gerbers for one board" selected together.
 */
export async function loadFiles(files: File[]): Promise<LoadResult> {
  const warnings: string[] = [];
  const { groups } = await expandFiles(files);
  const designs: Design[] = [];

  for (const group of groups) {
    const design = buildDesign(group.name, group.files, warnings);
    if (design) designs.push(design);
    else warnings.push(`${group.name}: no recognizable Gerber layers found.`);
  }

  return { designs, warnings };
}
