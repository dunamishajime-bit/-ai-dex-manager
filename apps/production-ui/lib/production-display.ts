/** Display each side explicitly; family defaults apply only to MR/BRK. */
export function formatQ102SideGross(gross: Record<string, Record<string, number>>): string {
 return Object.entries(gross).map(([family, sides]) => {
  const values = Object.entries(sides).map(([side,value]) => `${side === 'default' ? '' : side+' '}${Number.isFinite(value)?value.toFixed(2)+'x':'UNKNOWN'}`);
  return `${family} ${values.join(' / ')}`;
 }).join(' / ');
}
