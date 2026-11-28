/** Review-only parsing of original venue response text, before Number rounding.
 * No changes to the trading client's normal parser or order path.
 * Integer tokens outside the JS safe range become decimal strings.
 */
export function parseLosslessIncomeJson(raw:string):unknown {
    if(typeof raw!=="string"||raw.length>8*1024*1024)throw Error("MTM_JSON_SIZE_INVALID");
    // Validate original syntax before any token substitution.
    JSON.parse(raw);
    const token=/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    const normalized=raw.replace(token,value=>{
        if(value.startsWith('"'))return value;
        const n=Number(value);
        if(!Number.isFinite(n))throw Error("MTM_JSON_NONFINITE");
        if(Number.isSafeInteger(n)||!Number.isInteger(n))return value;
        if(!/^-?\d+$/.test(value))throw Error("MTM_JSON_UNSAFE_NONDECIMAL_INTEGER");
        return JSON.stringify(value);
    });
    return JSON.parse(normalized);
}
