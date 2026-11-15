/** Exact field-only snapshot from upstream v12-x1-all.ts V12Bar.
 * No trading runtime, venue client, or effectful JS module imported.
 */
export interface V12Bar{
 ts:number;open:number;high:number;low:number;
 close:number;volume:number;closed?:boolean;
 endTs:number;sourceCount:2;
}
