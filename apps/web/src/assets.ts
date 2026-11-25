/**
 * Resolve URLs de assets. No build normal são arquivos em /assets. No build de página única
 * (scripts/build-artifact.sh) os arquivos ficam em src/_inline e viram data: URIs.
 */
const inline = import.meta.glob('./_inline/**/*.{webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const hasInline = Object.keys(inline).length > 0;

export function assetUrl(path: string): string {
  if (!hasInline) return path;
  return inline['./_inline/' + path.replace(/^\/?assets\//, '')] ?? path;
}
