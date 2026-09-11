// Minimal ambient typing for the one @noble/hashes submodule used here.
// The package's exports map (subpath "./blake2.js") is invisible to TS
// "moduleResolution: Node", so this declares the exact surface consumed.
// Runtime resolution is handled by Node/Vite via the exports map.
declare module '@noble/hashes/blake2.js' {
  export interface Blake2Opts {
    dkLen?: number;
    key?: Uint8Array;
    salt?: Uint8Array;
    personalization?: Uint8Array;
  }
  export function blake2b(msg: Uint8Array, opts?: Blake2Opts): Uint8Array;
}
